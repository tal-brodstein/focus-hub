#!/usr/bin/env python3
"""
bridge.py — Reads Arduino JSON over serial and writes to Firebase Firestore.

Firestore layout:
  status/current      latest reading, overwritten each cycle (live dashboard)
  readings/{id}       one doc per reading (time-series archive)
  sessions/{id}       one doc per focus session, updated on state changes
  distractions/{id}   one doc each time distractionEvent=true
"""

import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta

import serial
import serial.tools.list_ports
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

# ── Config ────────────────────────────────────────────────────────────
BAUD_RATE        = 9600
RECONNECT_DELAY  = 5   # seconds between reconnect attempts
READLINE_TIMEOUT = 3   # serial readline timeout in seconds
WRITE_INTERVAL_S = 10  # minimum seconds between Firestore writes (free-tier budget)


# ── Serial helpers ────────────────────────────────────────────────────

def find_arduino_port():
    """Scan connected ports and return the most likely Arduino device path."""
    KEYWORDS = (
        "arduino", "ch340", "ch341", "cp210", "ftdi",
        "usb serial", "usb-serial", "usb uart",
    )
    ports = serial.tools.list_ports.comports()
    for p in ports:
        combined = f"{p.description or ''} {p.manufacturer or ''}".lower()
        if any(kw in combined for kw in KEYWORDS):
            return p.device
    # Fallback: return first available port
    return ports[0].device if ports else None


def get_port():
    """Return port from .env or auto-detect."""
    env_port = os.getenv("SERIAL_PORT")
    if env_port:
        return env_port
    detected = find_arduino_port()
    if detected:
        print(f"[serial] Auto-detected port: {detected}")
    return detected


def open_port(port):
    """Open serial port; returns Serial object or None on failure."""
    try:
        ser = serial.Serial(port, BAUD_RATE, timeout=READLINE_TIMEOUT)
        print(f"[serial] Connected to {port} at {BAUD_RATE} baud")
        return ser
    except serial.SerialException as exc:
        print(f"[serial] Cannot open {port}: {exc}")
        return None


def close_port(ser):
    try:
        if ser and ser.is_open:
            ser.close()
    except Exception:
        pass


# ── Firebase ──────────────────────────────────────────────────────────

def init_firebase():
    """Initialize Firebase Admin SDK and return a Firestore client."""
    creds_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "./firebase-credentials.json")
    if not os.path.isfile(creds_path):
        sys.exit(f"[firebase] Credentials file not found: {creds_path}")
    cred = credentials.Certificate(creds_path)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print(f"[firebase] Initialized from {creds_path}")
    return db


# ── Session state machine ─────────────────────────────────────────────

class SessionTracker:
    """
    Watches sessionActive / sessionTimeout transitions and keeps exactly one
    open Firestore session document at a time.

    Handles bridge restarts mid-session: if the first reading already shows
    sessionActive=True, a new session doc is created with a start time estimated
    from the Arduino's reported sessionSeconds.
    """

    def __init__(self, db):
        self.db             = db
        self._prev_active   = False
        self._prev_timeout  = False
        self._session_ref   = None   # current open session DocumentReference
        self._last_secs     = 0      # last sessionSeconds while session was active

    def update(self, data, now):
        active  = data.get("sessionActive",  False)
        timeout = data.get("sessionTimeout", False)
        secs    = int(data.get("sessionSeconds", 0))

        # ── false → true: start a new session ────────────────────────
        if active and not self._prev_active:
            # Estimate true start using elapsed seconds already reported by the
            # Arduino. This keeps the stored startTime correct even when the
            # bridge is restarted mid-session.
            start_time = now - timedelta(seconds=secs)
            ref = self.db.collection("sessions").document()
            ref.set({"startTime": start_time, "timedOut": False})
            self._session_ref = ref
            self._last_secs   = secs
            print(
                f"[firestore] sessions/{ref.id} created  "
                f"start≈{start_time.strftime('%Y-%m-%d %H:%M:%S')} UTC"
            )

        # ── true → false: close the current session ───────────────────
        elif not active and self._prev_active and self._session_ref:
            # Use the last captured sessionSeconds value; the Arduino resets it
            # to 0 in the same cycle that sessionActive flips to false.
            self._session_ref.update({
                "endTime":         now,
                "durationSeconds": self._last_secs,
            })
            print(
                f"[firestore] sessions/{self._session_ref.id} closed  "
                f"duration={self._last_secs}s"
            )
            self._session_ref = None

        # ── timeout flag turned on ─────────────────────────────────────
        if timeout and not self._prev_timeout and self._session_ref:
            self._session_ref.update({"timedOut": True})
            print(f"[firestore] sessions/{self._session_ref.id} timedOut=true")

        # Capture sessionSeconds only while the session is active so that the
        # value doesn't get overwritten with 0 on the close cycle.
        if active:
            self._last_secs = secs

        self._prev_active  = active
        self._prev_timeout = timeout


# ── Firestore writes ──────────────────────────────────────────────────

def write_reading(db, data, session_tracker):
    """Dispatch one parsed sensor reading to all relevant Firestore paths."""
    now     = datetime.now(timezone.utc)
    payload = {**data, "timestamp": now}

    # 1. Live dashboard — single document, always overwritten
    db.collection("status").document("current").set(payload)
    print(
        f"[firestore] status/current  "
        f"score={data.get('focusScore')}  "
        f"temp={data.get('temp')}C  "
        f"hum={data.get('humidity')}%  "
        f"session={'on' if data.get('sessionActive') else 'off'}  "
        f"distract={'YES' if data.get('distractionEvent') else 'no'}"
    )

    # 2. Time-series archive — one document per reading
    ref = db.collection("readings").document()
    ref.set(payload)
    print(f"[firestore] readings/{ref.id} written")

    # 3. Session state machine
    session_tracker.update(data, now)

    # 4. Distraction log — only when the flag is true (Arduino clears it next cycle)
    if data.get("distractionEvent"):
        dis_ref = db.collection("distractions").document()
        dis_ref.set({
            "timestamp":      now,
            "temp":           data.get("temp"),
            "humidity":       data.get("humidity"),
            "noise":          data.get("noise"),
            "light":          data.get("light"),
            "vibration":      data.get("vibration"),
            "focusScore":     data.get("focusScore"),
            "sessionSeconds": data.get("sessionSeconds"),
        })
        print(f"[firestore] distractions/{dis_ref.id} recorded")


# ── Main read loop ────────────────────────────────────────────────────

def run(db, port):
    ser             = None
    session_tracker = SessionTracker(db)
    last_write      = 0.0   # wall-clock time of the last full Firestore write
    prev_active     = None  # last known sessionActive value for transition detection

    try:
        while True:
            # (Re)connect if we have no open port
            if ser is None or not ser.is_open:
                ser = open_port(port)
                if ser is None:
                    print(f"[serial] Retrying in {RECONNECT_DELAY}s …")
                    time.sleep(RECONNECT_DELAY)
                    continue

            # Read one line from the Arduino
            try:
                raw = ser.readline()
            except serial.SerialException as exc:
                print(f"[serial] Lost connection: {exc}")
                close_port(ser)
                ser = None
                print(f"[serial] Reconnecting in {RECONNECT_DELAY}s …")
                time.sleep(RECONNECT_DELAY)
                continue

            if not raw:
                # readline() timed out — Arduino is still running, just wait
                continue

            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                print(f"[serial] Skipping non-JSON: {line[:80]}")
                continue

            now_wall        = time.time()
            cur_active      = bool(data.get("sessionActive", False))
            session_changed = (prev_active is not None) and (cur_active != prev_active)
            # Always write immediately on button events so the dashboard stays responsive:
            # distractionEvent is only true for one Arduino cycle (would be missed if throttled),
            # and sessionActive transitions must reach the dashboard without delay.
            force_write     = bool(data.get("distractionEvent")) or session_changed
            prev_active     = cur_active

            if force_write or (now_wall - last_write) >= WRITE_INTERVAL_S:
                try:
                    write_reading(db, data, session_tracker)
                except Exception as exc:
                    print(f"[firestore] Write error: {exc}")
                last_write = now_wall
            else:
                # Throttled — keep session-tracker state current without writing to Firestore
                session_tracker.update(data, datetime.now(timezone.utc))

    except KeyboardInterrupt:
        print("\n[bridge] Interrupted — stopping.")
    finally:
        close_port(ser)
        print("[serial] Port closed.")


# ── Entry point ───────────────────────────────────────────────────────

def main():
    load_dotenv()

    db   = init_firebase()
    port = get_port()

    if not port:
        sys.exit(
            "[serial] No port found. Connect an Arduino or set SERIAL_PORT in .env"
        )

    print(f"[bridge] Starting  port={port}")
    run(db, port)


if __name__ == "__main__":
    main()
