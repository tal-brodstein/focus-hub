import { GoogleGenerativeAI } from '@google/generative-ai'
import { GeminiResult, GeminiQuestion, SensorReading, ContextAnswer, MedicationDose } from '../types'

const MODEL = 'gemini-2.5-flash'

interface GeminiParams {
  apiKey: string
  recentReadings: SensorReading[]
  currentReading: SensorReading | null
  medicationLog: MedicationDose[]
  journal: string
  contextAnswers: ContextAnswer[]
}

export async function callGemini(params: GeminiParams): Promise<GeminiResult> {
  const genAI = new GoogleGenerativeAI(params.apiKey)
  const model = genAI.getGenerativeModel({ model: MODEL })
  const prompt = buildPrompt(params)
  const result = await model.generateContent(prompt)
  return parseResponse(result.response.text())
}

export async function testGeminiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: MODEL })
    const result = await model.generateContent('Reply with only the word "OK".')
    const text = result.response.text().trim()
    return { ok: true, message: `Connected! Response: "${text.slice(0, 40)}"` }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

function sensorStatus(sensor: string, value: number): string {
  switch (sensor) {
    case 'temp':
      return value >= 20 && value <= 23 ? '✓ optimal' : value < 20 ? '↓ too cold' : '↑ too warm'
    case 'humidity':
      return value >= 40 && value <= 60 ? '✓ optimal' : value < 40 ? '↓ too dry' : '↑ too humid'
    case 'noise':
      return value < 55 ? '✓ optimal' : value < 70 ? '⚠ loud' : '✗ very loud'
    case 'light':
      return value >= 300 && value <= 500 ? '✓ optimal' : value < 300 ? '↓ dim' : '↑ bright'
    default:
      return ''
  }
}

function buildPrompt(p: GeminiParams): string {
  const cur = p.currentReading
  const now = new Date()

  const readingsTable = p.recentReadings
    .slice(-10)
    .map(r => {
      const d = r.timestamp?.toDate?.() ?? now
      return (
        `  ${d.toLocaleTimeString()} | ` +
        `Score:${r.focusScore} T:${r.temp}°C H:${r.humidity}% ` +
        `N:${r.noise}dB L:${r.light}lx V:${r.vibration.toFixed(2)}g`
      )
    })
    .join('\n')

  const medStr =
    p.medicationLog.length > 0
      ? p.medicationLog.map(m => `${m.time} — ${m.type} ${m.dose} mg`).join(', ')
      : 'None logged today'

  const journalStr = p.journal.trim() || 'No journal entry for today'

  const contextStr =
    p.contextAnswers.length > 0
      ? p.contextAnswers
          .slice(-20)
          .map(a => `Q: ${a.question}\nA: ${a.answer}`)
          .join('\n---\n')
      : 'No previous context'

  const sessionLine = cur?.sessionActive
    ? `Active — ${Math.floor((cur.sessionSeconds ?? 0) / 3600)}h ${Math.floor(((cur.sessionSeconds ?? 0) % 3600) / 60)}m elapsed`
    : 'No active session'

  return `You are a focus coach for a user with ADHD. Speak directly to them. Reference exact numbers.

DATE/TIME: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}

CURRENT ENVIRONMENT (Focus Score: ${cur?.focusScore ?? 'N/A'}/100):
• Temperature: ${cur?.temp ?? 'N/A'}°C — ${cur ? sensorStatus('temp', cur.temp) : 'N/A'} (optimal 20–23°C)
• Humidity:    ${cur?.humidity ?? 'N/A'}% — ${cur ? sensorStatus('humidity', cur.humidity) : 'N/A'} (optimal 40–60%)
• Noise:       ${cur?.noise ?? 'N/A'} dB — ${cur ? sensorStatus('noise', cur.noise) : 'N/A'} (optimal <55 dB)
• Light:       ${cur?.light ?? 'N/A'} lx — ${cur ? sensorStatus('light', cur.light) : 'N/A'} (optimal 300–500 lx)
• Vibration:   ${cur?.vibration?.toFixed(2) ?? 'N/A'} g

SESSION: ${sessionLine}

LAST 10 READINGS:
${readingsTable || '  No data yet'}

TODAY'S MEDICATION:
${medStr}

TODAY'S JOURNAL:
${journalStr}

RECENT CONTEXT FROM PREVIOUS QUESTIONS:
${contextStr}

INSTRUCTIONS:
1. Write 2–3 sentences of specific, actionable insight referencing actual numbers above.
2. Be direct — name the biggest issue and suggest one concrete action.
3. Then produce EXACTLY 2 follow-up questions about factors sensors cannot measure
   (e.g. hunger, sleep, stress, distractions, medication effect, posture, motivation).
4. Output the questions as a JSON array at the very end — no text after the JSON block.

Format:
[{"question":"...?","options":["Yes","No","Not applicable"]},{"question":"...?","options":["Yes","No","Not applicable"]}]`
}

function parseResponse(text: string): GeminiResult {
  const trimmed = text.trim()

  // Find the last JSON array — questions are always at the end
  const lastBracket = trimmed.lastIndexOf('[')
  if (lastBracket !== -1) {
    const jsonStr = trimmed.slice(lastBracket)
    try {
      const parsed: unknown = JSON.parse(jsonStr)
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        typeof (parsed[0] as Record<string, unknown>).question === 'string'
      ) {
        return {
          insight: trimmed.slice(0, lastBracket).trim(),
          questions: parsed as GeminiQuestion[],
        }
      }
    } catch {
      // fall through — return raw text
    }
  }

  return { insight: trimmed, questions: [] }
}
