import { useState } from 'react'
import { testFirebaseConfig, initFirebase, getDb, collection, getDocs, orderBy, query, limit } from '../lib/firebase'
import { testGeminiKey } from '../lib/gemini'
import { SensorReading } from '../types'
import { format } from 'date-fns'

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; message: string }

function TestBadge({ state }: { state: TestState }) {
  if (state.status === 'idle') return null
  const cls =
    state.status === 'testing' ? 'text-indigo-300 bg-indigo-900/30' :
    state.status === 'ok'      ? 'text-green-300  bg-green-900/20' :
                                 'text-red-300    bg-red-900/20'
  return (
    <div className={`mt-2 px-3 py-2 rounded-lg text-sm ${cls} border border-current/20`}>
      {state.status === 'testing' && <span className="animate-pulse">⟳ </span>}
      {state.status === 'ok'      && '✓ '}
      {state.status === 'fail'    && '✗ '}
      {state.message}
    </div>
  )
}

export default function SettingsTab() {
  const [geminiKey, setGeminiKey]       = useState(localStorage.getItem('geminiApiKey') ?? '')
  const [geminiTest, setGeminiTest]     = useState<TestState>({ status: 'idle', message: '' })
  const [fbJson, setFbJson]             = useState(() => {
    const saved = localStorage.getItem('firebaseConfig')
    return saved ? JSON.stringify(JSON.parse(saved), null, 2) : ''
  })
  const [fbTest, setFbTest]             = useState<TestState>({ status: 'idle', message: '' })
  const [sessionLimit, setSessionLimit] = useState(
    Number(localStorage.getItem('sessionLimitHours') ?? 10)
  )
  const [exporting, setExporting]       = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearDone, setClearDone]       = useState(false)

  function handleGeminiUpdate() {
    localStorage.setItem('geminiApiKey', geminiKey.trim())
    setGeminiTest({ status: 'ok', message: 'Saved!' })
    setTimeout(() => setGeminiTest({ status: 'idle', message: '' }), 2000)
  }

  async function handleGeminiTest() {
    setGeminiTest({ status: 'testing', message: 'Testing…' })
    const result = await testGeminiKey(geminiKey.trim())
    setGeminiTest({ status: result.ok ? 'ok' : 'fail', message: result.message })
  }

  async function handleFbSave() {
    let config: Record<string, string>
    try {
      config = JSON.parse(fbJson)
    } catch {
      setFbTest({ status: 'fail', message: 'Invalid JSON' })
      return
    }
    localStorage.setItem('firebaseConfig', JSON.stringify(config))
    try {
      initFirebase(config)
      setFbTest({ status: 'ok', message: 'Saved! Reload page to apply.' })
    } catch (e: unknown) {
      setFbTest({ status: 'ok', message: 'Saved! Reload page to apply.' })
    }
  }

  async function handleFbTest() {
    let config: Record<string, string>
    try {
      config = JSON.parse(fbJson)
    } catch {
      setFbTest({ status: 'fail', message: 'Invalid JSON' })
      return
    }
    setFbTest({ status: 'testing', message: 'Connecting…' })
    const result = await testFirebaseConfig(config)
    setFbTest({ status: result.ok ? 'ok' : 'fail', message: result.message })
  }

  function handleSessionLimit() {
    localStorage.setItem('sessionLimitHours', String(sessionLimit))
  }

  async function handleExportCSV() {
    setExporting(true)
    try {
      const db = getDb()
      const snap = await getDocs(
        query(collection(db, 'readings'), orderBy('timestamp', 'desc'), limit(5000))
      )
      const rows = snap.docs.map(d => {
        const r = d.data() as SensorReading
        const ts = r.timestamp?.toDate?.() ?? new Date()
        return [
          format(ts, 'yyyy-MM-dd HH:mm:ss'),
          r.temp, r.humidity, r.noise, r.light, r.vibration,
          r.focusScore, r.sessionActive, r.sessionSeconds,
          r.distractionEvent, r.sessionTimeout,
        ].join(',')
      })
      const header = 'timestamp,temp,humidity,noise,light,vibration,focusScore,sessionActive,sessionSeconds,distractionEvent,sessionTimeout'
      const csv = [header, ...rows.reverse()].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `focus-hub-export-${format(new Date(), 'yyyy-MM-dd')}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
    }
    setExporting(false)
  }

  function handleClearData() {
    if (!clearConfirm) {
      setClearConfirm(true)
      return
    }
    localStorage.removeItem('firebaseConfig')
    localStorage.removeItem('geminiApiKey')
    localStorage.removeItem('sessionLimitHours')
    setClearDone(true)
    setTimeout(() => window.location.reload(), 1500)
  }

  const SectionCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5">
      <h3 className="font-semibold text-white mb-4">{title}</h3>
      {children}
    </div>
  )

  const Label = ({ children }: { children: React.ReactNode }) => (
    <label className="block text-sm font-medium text-slate-300 mb-1.5">{children}</label>
  )

  const BtnRow = ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-wrap gap-2 mt-3">{children}</div>
  )

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <h2 className="text-lg font-semibold text-white">Settings</h2>

      {/* Gemini API Key */}
      <SectionCard title="✨ Gemini AI">
        <Label>API Key</Label>
        <input
          type="password"
          value={geminiKey}
          onChange={e => setGeminiKey(e.target.value)}
          className="w-full bg-[#0f0f1a] border border-indigo-900/40 rounded-xl px-4 py-3 mono
                     text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
          placeholder="AIza…"
        />
        <TestBadge state={geminiTest} />
        <BtnRow>
          <button
            onClick={handleGeminiTest}
            className="px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 text-indigo-300 rounded-lg text-sm transition-all"
          >Test</button>
          <button
            onClick={handleGeminiUpdate}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-all"
          >Update</button>
        </BtnRow>
      </SectionCard>

      {/* Firebase config */}
      <SectionCard title="🔥 Firebase">
        <Label>Config JSON</Label>
        <textarea
          value={fbJson}
          onChange={e => { setFbJson(e.target.value); setFbTest({ status: 'idle', message: '' }) }}
          rows={8}
          className="w-full bg-[#0f0f1a] border border-indigo-900/40 rounded-xl p-3 text-sm mono
                     text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
        />
        <TestBadge state={fbTest} />
        <BtnRow>
          <button
            onClick={handleFbTest}
            className="px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 text-indigo-300 rounded-lg text-sm transition-all"
          >Test</button>
          <button
            onClick={handleFbSave}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-all"
          >Save</button>
        </BtnRow>
        <p className="text-xs text-slate-600 mt-2">Reload the page after saving to reconnect Firebase.</p>
      </SectionCard>

      {/* Session timeout threshold */}
      <SectionCard title="⏱ Session Timeout Threshold">
        <Label>Warn after (hours)</Label>
        <div className="flex items-center gap-3">
          <input
            type="number" min={1} max={24} value={sessionLimit}
            onChange={e => setSessionLimit(Number(e.target.value))}
            className="w-24 bg-[#0f0f1a] border border-indigo-900/40 rounded-xl px-4 py-3
                       text-white mono focus:outline-none focus:border-indigo-500"
          />
          <span className="text-slate-400 text-sm">hours (default: 10)</span>
        </div>
        <BtnRow>
          <button
            onClick={handleSessionLimit}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-all"
          >Save</button>
        </BtnRow>
        <p className="text-xs text-slate-600 mt-2">
          Note: the actual timeout is controlled by the Arduino firmware (hardcoded to 36,000 s).
          This setting is informational only.
        </p>
      </SectionCard>

      {/* Data management */}
      <SectionCard title="💾 Data Management">
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-300 mb-2">Export up to 5,000 readings as CSV</p>
            <button
              onClick={handleExportCSV} disabled={exporting}
              className="px-4 py-2 bg-green-700/20 hover:bg-green-700/40 border border-green-600/30 text-green-300 rounded-lg text-sm transition-all disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : '⬇ Export CSV'}
            </button>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <p className="text-sm text-slate-300 mb-1">Clear all local settings</p>
            <p className="text-xs text-slate-600 mb-3">
              This removes your Firebase config and Gemini key from localStorage.
              It does not delete any Firestore data.
            </p>
            {clearDone ? (
              <p className="text-sm text-green-400">✓ Cleared. Reloading…</p>
            ) : (
              <button
                onClick={handleClearData}
                className={`px-4 py-2 rounded-lg text-sm transition-all border
                  ${clearConfirm
                    ? 'bg-red-700/40 border-red-500/50 text-red-300 font-semibold'
                    : 'bg-red-900/20 border-red-900/30 text-red-400 hover:bg-red-900/40'
                  }`}
              >
                {clearConfirm ? '⚠ Click again to confirm' : '🗑 Clear All Settings'}
              </button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* About */}
      <div className="text-center text-xs text-slate-700 space-y-1 pb-4">
        <p>Focus Hub · Arduino + Firebase + Gemini</p>
        <p>Data stored in your Firebase project</p>
      </div>
    </div>
  )
}
