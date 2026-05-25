import { useState, useEffect, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { format } from 'date-fns'
import CircularGauge from '../components/CircularGauge'
import SessionTimeoutModal from '../components/SessionTimeoutModal'
import { callGemini } from '../lib/gemini'
import {
  getDb, collection, getDocs, doc, getDoc, addDoc,
  query, orderBy, limit, Timestamp,
} from '../lib/firebase'
import { GeminiQuestion, MedicationDose, ContextAnswer, SensorReading, LiveDataPoint } from '../types'

// ── Colour helpers ─────────────────────────────────────────────────────
function scoreColor(v: number) {
  if (v >= 80) return '#22c55e'
  if (v >= 50) return '#eab308'
  return '#ef4444'
}
function tempColor(v: number) {
  return v >= 20 && v <= 23 ? '#22c55e' : v >= 17 && v <= 27 ? '#eab308' : '#ef4444'
}
function humColor(v: number) {
  return v >= 40 && v <= 60 ? '#22c55e' : v >= 30 && v <= 70 ? '#eab308' : '#ef4444'
}
function noiseColor(v: number) {
  return v < 55 ? '#22c55e' : v < 70 ? '#eab308' : '#ef4444'
}
function lightColor(v: number) {
  return v >= 300 && v <= 500 ? '#22c55e' : v >= 150 && v <= 700 ? '#eab308' : '#ef4444'
}

function fmtTimer(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// ── AI Insight card ────────────────────────────────────────────────────
function AIInsightCard({ current, history }: { current: SensorReading | null; history: LiveDataPoint[] }) {
  const [insight, setInsight] = useState('')
  const [questions, setQuestions] = useState<GeminiQuestion[]>([])
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function fetchGeminiData() {
    const db = getDb()
    const today = format(new Date(), 'yyyy-MM-dd')

    // Today's medication
    let medLog: MedicationDose[] = []
    try {
      const medSnap = await getDocs(collection(db, 'medication', today, 'doses'))
      medLog = medSnap.docs.map(d => ({ id: d.id, ...d.data() } as MedicationDose))
    } catch { /* no medication data */ }

    // Today's journal
    let journal = ''
    try {
      const jSnap = await getDoc(doc(db, 'journal', today))
      if (jSnap.exists()) journal = (jSnap.data() as { content: string }).content
    } catch { /* no journal */ }

    // Last 20 context answers
    let contextAnswers: ContextAnswer[] = []
    try {
      const cSnap = await getDocs(
        query(collection(db, 'context_answers'), orderBy('timestamp', 'desc'), limit(20))
      )
      contextAnswers = cSnap.docs.map(d => d.data() as ContextAnswer).reverse()
    } catch { /* no context */ }

    return { medLog, journal, contextAnswers }
  }

  async function handleRefresh() {
    const apiKey = localStorage.getItem('geminiApiKey') ?? ''
    if (!apiKey) { setError('No Gemini API key configured.'); return }
    setLoading(true)
    setError('')
    try {
      const { medLog, journal, contextAnswers } = await fetchGeminiData()
      const result = await callGemini({
        apiKey,
        recentReadings: history,
        currentReading: current,
        medicationLog: medLog,
        journal,
        contextAnswers,
      })
      setInsight(result.insight)
      setQuestions(result.questions)
      setAnswers({})
      setSubmitted(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Gemini call failed')
    }
    setLoading(false)
  }

  async function handleSubmit() {
    if (Object.keys(answers).length === 0) return
    const db = getDb()
    for (const [idx, answer] of Object.entries(answers)) {
      const q = questions[Number(idx)]
      if (!q) continue
      await addDoc(collection(db, 'context_answers'), {
        timestamp: Timestamp.fromDate(new Date()),
        question: q.question,
        answer,
        focusScore: current?.focusScore ?? 0,
        temp: current?.temp ?? 0,
        humidity: current?.humidity ?? 0,
        noise: current?.noise ?? 0,
        light: current?.light ?? 0,
      })
    }
    setSubmitted(true)
  }

  return (
    <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-purple-400">✨</span>
          <h3 className="font-semibold text-white">AI Focus Coach</h3>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">gemini-2.5-flash</span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/40
                     border border-purple-500/30 text-purple-300 rounded-lg text-sm transition-all
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <span className="animate-spin">⟳</span> : '⟳'} Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 bg-red-900/20 border border-red-500/30 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {!insight && !loading && (
        <p className="text-slate-500 text-sm text-center py-6">
          Click Refresh to get an AI insight about your current environment.
        </p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8 gap-3 text-slate-400">
          <span className="animate-spin text-xl">⟳</span>
          <span>Analyzing your environment…</span>
        </div>
      )}

      {insight && !loading && (
        <>
          <p className="text-slate-200 leading-relaxed text-sm mb-5">{insight}</p>

          {questions.length > 0 && !submitted && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider">
                Help me understand your environment
              </p>
              {questions.map((q, i) => (
                <div key={i} className="bg-[#0f0f1a] rounded-xl p-4 border border-indigo-900/20">
                  <p className="text-sm text-slate-300 mb-3">{q.question}</p>
                  <div className="flex flex-wrap gap-2">
                    {q.options.map(opt => (
                      <button
                        key={opt}
                        onClick={() => setAnswers(prev => ({ ...prev, [i]: opt }))}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all
                          ${answers[i] === opt
                            ? 'bg-indigo-600 border-indigo-400 text-white'
                            : 'border-slate-600 text-slate-400 hover:border-indigo-500 hover:text-indigo-300'
                          }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button
                onClick={handleSubmit}
                disabled={Object.keys(answers).length === 0}
                className="w-full py-2.5 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30
                           text-indigo-300 rounded-xl text-sm font-medium transition-all
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Submit answers
              </button>
            </div>
          )}

          {submitted && (
            <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-4 text-center">
              <p className="text-green-300 text-sm">
                ✓ Thanks! This helps me understand your environment better.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Custom chart tooltip ───────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#16213e] border border-indigo-900/40 rounded-xl p-3 text-xs shadow-xl">
      <p className="text-slate-400 mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-white font-mono">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

type LiveData = { current: SensorReading | null; history: LiveDataPoint[]; connected: boolean; error: string | null }

// ── Main LiveTab ───────────────────────────────────────────────────────
export default function LiveTab({ liveData }: { liveData: LiveData }) {
  const { current, history, connected, error } = liveData
  const [localSeconds, setLocalSeconds] = useState(0)
  const [distractionCount, setDistractionCount] = useState(0)
  const [showTimeoutModal, setShowTimeoutModal] = useState(false)
  // null = not yet seen (avoids spurious reset on first mount with a running session)
  const prevActive = useRef<boolean | null>(null)

  // Interpolated session timer — syncs with Arduino every snapshot, interpolates between
  useEffect(() => {
    if (!current?.sessionActive) {
      setLocalSeconds(0)
      return
    }
    setLocalSeconds(current.sessionSeconds)
    const interval = setInterval(() => setLocalSeconds(s => s + 1), 1000)
    return () => clearInterval(interval)
  }, [current?.sessionSeconds, current?.sessionActive])

  // Distraction count (this session)
  useEffect(() => {
    if (!current) return
    const wasActive = prevActive.current
    prevActive.current = current.sessionActive
    // Only reset on a genuine false→true edge; null means first mount, skip reset
    if (wasActive === false && current.sessionActive) {
      setDistractionCount(0)
    }
    // Only count distractions that occur while a session is active
    if (current.distractionEvent && current.sessionActive) {
      setDistractionCount(c => c + 1)
    }
  }, [current])

  // Session timeout modal
  useEffect(() => {
    if (current?.sessionTimeout && current?.sessionActive) {
      setShowTimeoutModal(true)
    }
  }, [current?.sessionTimeout, current?.sessionActive])

  const score = current?.focusScore ?? 0
  const rgbColor = score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444'

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* ── Connection error banner ────────────────────────────────── */}
      {error && !connected && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
          <span className="font-semibold">Firebase error:</span> {error}
        </div>
      )}

      {/* ── Top stat cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Focus Score */}
        <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5 flex flex-col items-center">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Focus Score</p>
          <div className="w-36 h-36">
            <CircularGauge
              value={score} max={100} label="score" unit="/100"
              color={rgbColor} size="md"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {score >= 80 ? '🟢 Excellent' : score >= 50 ? '🟡 Fair' : '🔴 Poor'} environment
          </p>
        </div>

        {/* Session Timer */}
        <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5 flex flex-col items-center justify-center">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Session Timer</p>
          <div className={`mono text-5xl font-bold tracking-tight ${current?.sessionActive ? 'text-white' : 'text-slate-600'}`}>
            {fmtTimer(localSeconds)}
          </div>
          <div className="mt-3 flex items-center gap-2">
            {current?.sessionActive ? (
              <>
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-sm text-green-400">Active</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-slate-600" />
                <span className="text-sm text-slate-500">Inactive</span>
              </>
            )}
          </div>
          {current?.sessionTimeout && (
            <span className="mt-2 px-2 py-0.5 bg-amber-900/30 border border-amber-500/30 rounded text-xs text-amber-300">
              ⚠ 10h timeout
            </span>
          )}
        </div>

        {/* Distraction Count */}
        <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5 flex flex-col items-center justify-center">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Distractions</p>
          <div className={`text-6xl font-bold mono ${distractionCount > 5 ? 'text-red-400' : distractionCount > 2 ? 'text-amber-400' : 'text-slate-200'}`}>
            {distractionCount}
          </div>
          <p className="mt-3 text-sm text-slate-500">this session</p>
          {!connected && (
            <span className="mt-2 text-xs text-red-400">● disconnected</span>
          )}
        </div>
      </div>

      {/* ── Sensor gauges ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Temperature', value: current?.temp ?? 0, max: 40, unit: '°C', color: tempColor(current?.temp ?? 0) },
          { label: 'Humidity',    value: current?.humidity ?? 0, max: 100, unit: '%', color: humColor(current?.humidity ?? 0) },
          { label: 'Noise',       value: current?.noise ?? 0, max: 90, unit: 'dB', color: noiseColor(current?.noise ?? 0) },
          { label: 'Light',       value: current?.light ?? 0, max: 1000, unit: 'lx', color: lightColor(current?.light ?? 0) },
        ].map(g => (
          <div key={g.label} className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-4">
            <div className="w-full aspect-square max-w-[140px] mx-auto">
              <CircularGauge {...g} size="md" />
            </div>
          </div>
        ))}
      </div>

      {/* ── Live chart ─────────────────────────────────────────────── */}
      <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Live Feed</h3>
          <span className="text-xs text-slate-500">last 60 s · normalized 0–100</span>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" />
              <XAxis
                dataKey="timeLabel"
                tick={{ fill: '#475569', fontSize: 10 }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: '#475569', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                formatter={(v) => <span style={{ color: '#94a3b8' }}>{v}</span>}
              />
              <Line name="Score"    dataKey="focusScore" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line name="Temp"     dataKey="tempN"      stroke="#f97316" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="4 2" />
              <Line name="Humidity" dataKey="humN"       stroke="#38bdf8" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="4 2" />
              <Line name="Noise"    dataKey="noiseN"     stroke="#f43f5e" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="4 2" />
              <Line name="Light"    dataKey="lightN"     stroke="#facc15" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── AI Insight ─────────────────────────────────────────────── */}
      <AIInsightCard current={current} history={history} />

      {/* ── Session Timeout Modal ───────────────────────────────────── */}
      {showTimeoutModal && (
        <SessionTimeoutModal
          sessionSeconds={localSeconds}
          onDismiss={() => setShowTimeoutModal(false)}
        />
      )}
    </div>
  )
}
