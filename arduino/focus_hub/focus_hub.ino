/*
 * focus_hub.ino — Environmental focus monitor
 *
 * Pin map:
 *   DHT11 data    → D2
 *   Sound sensor  → A0  (analog)
 *   Photoresistor → A1  (voltage divider: VCC–LDR–A1–10K–GND)
 *   Active buzzer → A2
 *   Vibration in  → A3  (analog — piezo or any 0-5 V vibration sensor)
 *   RGB LED       → R=D9,  G=D10, B=D11  (common cathode, 220 Ω each)
 *   Ind. LEDs     → Temp=D3, Hum=D4, Noise=D5, Light=D6, Vib=D7  (220 Ω each)
 *   Session LED   → D8  (220 Ω)
 *   Btn session   → D12 (INPUT_PULLUP, active LOW)
 *   Btn distract  → D13 (INPUT_PULLUP, active LOW)
 *
 * External libraries required (Sketch → Include Library → Manage Libraries):
 *   DHT sensor library  by Adafruit
 *
 * Note: D4 and D7 are not hardware-PWM pins on Arduino Uno/Nano.
 *       analogWrite() on those pins acts as digitalWrite() on AVR targets.
 *       Use an Arduino Mega for full PWM on all five indicator LEDs.
 */

#include <DHT.h>

// ── Pin definitions ───────────────────────────────────────────────────
#define PIN_DHT           2
#define PIN_LED_TEMP      3
#define PIN_LED_HUM       4
#define PIN_LED_NOISE     5
#define PIN_LED_LIGHT     6
#define PIN_LED_VIB       7
#define PIN_LED_SESSION   8
#define PIN_RGB_R         9
#define PIN_RGB_G        10
#define PIN_RGB_B        11
#define PIN_BTN_SESSION  12
#define PIN_BTN_DISTRACT 13
#define PIN_SOUND        A0
#define PIN_LIGHT        A1
#define PIN_BUZZER       A2
#define PIN_VIB          A3

// ── Timing constants ──────────────────────────────────────────────────
#define SENSOR_MS          2000UL
#define SESSION_LIMIT_S   36000UL   // 10 hours → sessionTimeout
#define ALERT_INTERVAL_MS 30000UL   // buzzer repeat period during timeout
#define FLASH_INTERVAL_MS   150UL   // ~3 Hz LED flash during timeout
#define DEBOUNCE_MS          50UL
#define NOISE_SAMPLE_MS      50UL

// ── Objects ───────────────────────────────────────────────────────────
DHT dht(PIN_DHT, DHT11);

// ── Sensor state ──────────────────────────────────────────────────────
float g_temp  = 20.0f;
float g_hum   = 50.0f;
float g_noise = 40.0f;
float g_light = 400.0f;
float g_vib   = 0.0f;
int   g_score = 0;

// ── Session state ─────────────────────────────────────────────────────
bool          g_sessionActive  = false;
unsigned long g_sessionStartMs = 0;
unsigned long g_sessionSecs    = 0;
bool          g_sessionTimeout = false;
bool          g_distraction    = false;

// ── Loop timers ───────────────────────────────────────────────────────
unsigned long t_sensor = 0;
unsigned long t_alert  = 0;
unsigned long t_flash  = 0;
bool          flashOn  = false;

// ── Button debounce ───────────────────────────────────────────────────
bool          btn1Prev = HIGH;
bool          btn2Prev = HIGH;
unsigned long btn1Ms   = 0;
unsigned long btn2Ms   = 0;

// ── Prototypes ────────────────────────────────────────────────────────
void readSensors();
int  calcScore();
void updateLeds();
void setRgb(uint8_t r, uint8_t g, uint8_t b);
void handleTimeoutAlert(unsigned long now);
void handleButtons(unsigned long now);
void sendJson();

// ═════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(9600);

  const uint8_t outputs[] = {
    PIN_LED_TEMP, PIN_LED_HUM,  PIN_LED_NOISE, PIN_LED_LIGHT,
    PIN_LED_VIB,  PIN_LED_SESSION,
    PIN_RGB_R,    PIN_RGB_G,    PIN_RGB_B,
    PIN_BUZZER
  };
  for (uint8_t i = 0; i < sizeof(outputs); i++) {
    pinMode(outputs[i], OUTPUT);
  }
  pinMode(PIN_BTN_SESSION,  INPUT_PULLUP);
  pinMode(PIN_BTN_DISTRACT, INPUT_PULLUP);

  dht.begin();
}

// ═════════════════════════════════════════════════════════════════════
void loop() {
  unsigned long now = millis();

  handleButtons(now);

  if (g_sessionActive) {
    g_sessionSecs    = (now - g_sessionStartMs) / 1000UL;
    g_sessionTimeout = g_sessionSecs >= SESSION_LIMIT_S;
  }

  if (g_sessionTimeout) {
    handleTimeoutAlert(now);
  }

  if (now - t_sensor >= SENSOR_MS) {
    t_sensor      = now;
    readSensors();
    g_score       = calcScore();
    updateLeds();
    sendJson();
    g_distraction = false;
  }
}

// ── Sensor reading ────────────────────────────────────────────────────
void readSensors() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) g_temp = t;
  if (!isnan(h)) g_hum  = h;

  // Noise: peak-to-peak amplitude over 50 ms → approximate dB
  unsigned long t0 = millis();
  int sMax = 0, sMin = 1023;
  while (millis() - t0 < NOISE_SAMPLE_MS) {
    int v = analogRead(PIN_SOUND);
    if (v > sMax) sMax = v;
    if (v < sMin) sMin = v;
  }
  g_noise = (float)map(sMax - sMin, 0, 1023, 30, 90);

  // Light: higher ADC = brighter
  g_light = (float)map(analogRead(PIN_LIGHT), 0, 1023, 0, 1000);

  // Vibration: raw analog read mapped to 0.00–2.00 g-equivalent range
  g_vib = analogRead(PIN_VIB) / 511.5f;
}

// ── Focus score (0–100) ───────────────────────────────────────────────
int calcScore() {
  int s = 0;

  // Temperature: optimal 20–23 °C
  if (g_temp >= 20.0f && g_temp <= 23.0f) {
    s += 25;
  } else if (g_temp < 20.0f) {
    s += max(0, (int)(25.0f * (g_temp - 15.0f) / 5.0f));
  } else {
    s += max(0, (int)(25.0f * (30.0f - g_temp) / 7.0f));
  }

  // Humidity: optimal 40–60 %
  if (g_hum >= 40.0f && g_hum <= 60.0f) {
    s += 25;
  } else if (g_hum < 40.0f) {
    s += max(0, (int)(25.0f * (g_hum - 20.0f) / 20.0f));
  } else {
    s += max(0, (int)(25.0f * (80.0f - g_hum) / 20.0f));
  }

  // Noise: optimal < 55 dB
  if (g_noise < 55.0f) {
    s += 25;
  } else {
    s += max(0, (int)(25.0f * (90.0f - g_noise) / 35.0f));
  }

  // Light: optimal 300–500 lx
  if (g_light >= 300.0f && g_light <= 500.0f) {
    s += 25;
  } else if (g_light < 300.0f) {
    s += max(0, (int)(25.0f * g_light / 300.0f));
  } else {
    s += max(0, (int)(25.0f * (1000.0f - g_light) / 500.0f));
  }

  return constrain(s, 0, 100);
}

// ── LED output ────────────────────────────────────────────────────────
void updateLeds() {
  analogWrite(PIN_LED_TEMP,  (int)constrain(map((long)g_temp,  0,    40,   0, 255), 0, 255));
  analogWrite(PIN_LED_HUM,   (int)constrain(map((long)g_hum,   0,    100,  0, 255), 0, 255));
  analogWrite(PIN_LED_NOISE, (int)constrain(map((long)g_noise, 30,   90,   0, 255), 0, 255));
  analogWrite(PIN_LED_LIGHT, (int)constrain(map((long)g_light, 0,    1000, 0, 255), 0, 255));
  analogWrite(PIN_LED_VIB,   (int)constrain((long)(g_vib * 127.5f),  0, 255));

  if      (g_score >= 80) setRgb(  0, 255,   0);
  else if (g_score >= 50) setRgb(255, 200,   0);
  else                    setRgb(255,   0,   0);

  if (!g_sessionTimeout) {
    digitalWrite(PIN_LED_SESSION, g_sessionActive ? HIGH : LOW);
  }
}

void setRgb(uint8_t r, uint8_t g, uint8_t b) {
  analogWrite(PIN_RGB_R, r);
  analogWrite(PIN_RGB_G, g);
  analogWrite(PIN_RGB_B, b);
}

// ── 10-hour timeout alert ─────────────────────────────────────────────
void handleTimeoutAlert(unsigned long now) {
  if (now - t_flash >= FLASH_INTERVAL_MS) {
    t_flash = now;
    flashOn = !flashOn;
    digitalWrite(PIN_LED_SESSION, flashOn ? HIGH : LOW);
  }

  if (now - t_alert >= ALERT_INTERVAL_MS) {
    t_alert = now;
    for (int i = 0; i < 3; i++) {
      digitalWrite(PIN_BUZZER, HIGH); delay(100);
      digitalWrite(PIN_BUZZER, LOW);  delay(100);
    }
  }
}

// ── Button handling ───────────────────────────────────────────────────
void handleButtons(unsigned long now) {
  bool b1 = digitalRead(PIN_BTN_SESSION);
  bool b2 = digitalRead(PIN_BTN_DISTRACT);

  if (b1 == LOW && btn1Prev == HIGH && (now - btn1Ms) > DEBOUNCE_MS) {
    btn1Ms = now;
    if (g_sessionActive) {
      g_sessionActive  = false;
      g_sessionTimeout = false;
      g_sessionSecs    = 0;
      flashOn          = false;
      t_alert          = 0;
      digitalWrite(PIN_LED_SESSION, LOW);
      digitalWrite(PIN_BUZZER, LOW);
    } else {
      g_sessionActive  = true;
      g_sessionStartMs = now;
      g_sessionSecs    = 0;
      g_sessionTimeout = false;
    }
  }
  btn1Prev = b1;

  if (b2 == LOW && btn2Prev == HIGH && (now - btn2Ms) > DEBOUNCE_MS) {
    btn2Ms        = now;
    g_distraction = true;
  }
  btn2Prev = b2;
}

// ── Serial JSON output ────────────────────────────────────────────────
void sendJson() {
  Serial.print(F("{\"temp\":"));             Serial.print(g_temp, 1);
  Serial.print(F(",\"humidity\":"));         Serial.print((int)g_hum);
  Serial.print(F(",\"noise\":"));            Serial.print((int)g_noise);
  Serial.print(F(",\"light\":"));            Serial.print((int)g_light);
  Serial.print(F(",\"vibration\":"));        Serial.print(g_vib, 2);
  Serial.print(F(",\"focusScore\":"));       Serial.print(g_score);
  Serial.print(F(",\"sessionActive\":"));    Serial.print(g_sessionActive  ? F("true") : F("false"));
  Serial.print(F(",\"sessionSeconds\":"));   Serial.print(g_sessionSecs);
  Serial.print(F(",\"distractionEvent\":")); Serial.print(g_distraction    ? F("true") : F("false"));
  Serial.print(F(",\"sessionTimeout\":"));   Serial.print(g_sessionTimeout ? F("true") : F("false"));
  Serial.println(F("}"));
}
