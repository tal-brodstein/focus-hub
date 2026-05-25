import { useState } from 'react'
import { testFirebaseConfig, initFirebase } from '../lib/firebase'
import { testGeminiKey } from '../lib/gemini'

interface Props {
  onComplete: () => void
}

type Step = 'firebase' | 'gemini'

interface TestState {
  status: 'idle' | 'testing' | 'ok' | 'fail'
  message: string
}

const PLACEHOLDER_FB = JSON.stringify(
  {
    apiKey: 'AIza...',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    storageBucket: 'your-project.appspot.com',
    messagingSenderId: '123456789',
    appId: '1:123456789:web:abc123',
  },
  null,
  2
)

export default function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('firebase')
  const [fbJson, setFbJson] = useState('')
  const [fbTest, setFbTest] = useState<TestState>({ status: 'idle', message: '' })
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiTest, setGeminiTest] = useState<TestState>({ status: 'idle', message: '' })
  const [saving, setSaving] = useState(false)

  async function handleTestFirebase() {
    setFbTest({ status: 'testing', message: 'Connecting…' })
    let config: Record<string, string>
    try {
      config = JSON.parse(fbJson)
    } catch {
      setFbTest({ status: 'fail', message: 'Invalid JSON — check your paste.' })
      return
    }
    const result = await testFirebaseConfig(config)
    setFbTest({ status: result.ok ? 'ok' : 'fail', message: result.message })
  }

  async function handleTestGemini() {
    if (!geminiKey.trim()) {
      setGeminiTest({ status: 'fail', message: 'Enter an API key first.' })
      return
    }
    setGeminiTest({ status: 'testing', message: 'Testing…' })
    const result = await testGeminiKey(geminiKey.trim())
    setGeminiTest({ status: result.ok ? 'ok' : 'fail', message: result.message })
  }

  function handleSave() {
    setSaving(true)
    try {
      const config = JSON.parse(fbJson)
      localStorage.setItem('firebaseConfig', JSON.stringify(config))
      localStorage.setItem('geminiApiKey', geminiKey.trim())
      initFirebase(config)
      onComplete()
    } catch {
      setSaving(false)
    }
  }

  const fbValid = (() => {
    try { const c = JSON.parse(fbJson); return !!c.apiKey && !!c.projectId } catch { return false }
  })()
  const geminiValid = geminiKey.trim().length > 10

  const TestBadge = ({ state }: { state: TestState }) => {
    if (state.status === 'idle') return null
    const cls =
      state.status === 'testing' ? 'text-indigo-300 bg-indigo-900/40' :
      state.status === 'ok'      ? 'text-green-300  bg-green-900/30' :
                                   'text-red-300    bg-red-900/30'
    return (
      <div className={`mt-2 px-3 py-2 rounded-lg text-sm ${cls} border border-current/20`}>
        {state.status === 'testing' && <span className="animate-pulse">⟳ </span>}
        {state.status === 'ok'      && '✓ '}
        {state.status === 'fail'    && '✗ '}
        {state.message}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center p-4">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-indigo-700/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🎯</div>
          <h1 className="text-3xl font-bold text-white mb-1">Focus Hub Setup</h1>
          <p className="text-slate-400">Connect your data sources to get started</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {(['firebase', 'gemini'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-3">
              <button
                onClick={() => setStep(s)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all
                  ${step === s
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50'
                    : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                  ${step === s ? 'bg-white/20' : 'bg-slate-700'}`}>
                  {i + 1}
                </span>
                {s === 'firebase' ? 'Firebase' : 'Gemini AI'}
              </button>
              {i === 0 && <span className="text-slate-600">→</span>}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-[#1a1a2e] border border-indigo-900/40 rounded-2xl p-6 shadow-2xl">
          {step === 'firebase' && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">🔥</span>
                <div>
                  <h2 className="text-lg font-semibold text-white">Firebase Configuration</h2>
                  <p className="text-sm text-slate-400">
                    Go to Firebase Console → Project Settings → Your Apps → Config
                  </p>
                </div>
              </div>

              <label className="block text-sm font-medium text-slate-300 mb-2">
                Paste your Firebase config JSON
              </label>
              <textarea
                value={fbJson}
                onChange={e => { setFbJson(e.target.value); setFbTest({ status: 'idle', message: '' }) }}
                placeholder={PLACEHOLDER_FB}
                rows={9}
                className="w-full bg-[#0f0f1a] border border-indigo-900/40 rounded-xl p-3 text-sm mono
                           text-slate-200 placeholder:text-slate-600 focus:outline-none
                           focus:border-indigo-500 resize-none"
              />

              <TestBadge state={fbTest} />

              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleTestFirebase}
                  disabled={!fbValid || fbTest.status === 'testing'}
                  className="flex-1 py-2.5 rounded-xl border border-indigo-500/40 text-indigo-300
                             hover:bg-indigo-900/30 disabled:opacity-40 disabled:cursor-not-allowed
                             text-sm font-medium transition-all"
                >
                  {fbTest.status === 'testing' ? 'Testing…' : 'Test Connection'}
                </button>
                <button
                  onClick={() => setStep('gemini')}
                  disabled={!fbValid}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white
                             disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-all"
                >
                  Next →
                </button>
              </div>
            </>
          )}

          {step === 'gemini' && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">✨</span>
                <div>
                  <h2 className="text-lg font-semibold text-white">Gemini AI Key</h2>
                  <p className="text-sm text-slate-400">
                    Get your key at{' '}
                    <span className="text-indigo-400 mono">aistudio.google.com</span>
                  </p>
                </div>
              </div>

              <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3 mb-4 text-xs text-amber-300/80">
                ⚠ This key is stored in your browser's localStorage. Use it only on trusted devices.
              </div>

              <label className="block text-sm font-medium text-slate-300 mb-2">
                Gemini API Key
              </label>
              <input
                type="password"
                value={geminiKey}
                onChange={e => { setGeminiKey(e.target.value); setGeminiTest({ status: 'idle', message: '' }) }}
                placeholder="AIza…"
                className="w-full bg-[#0f0f1a] border border-indigo-900/40 rounded-xl px-4 py-3 mono
                           text-slate-200 placeholder:text-slate-600 focus:outline-none
                           focus:border-indigo-500"
              />

              <TestBadge state={geminiTest} />

              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleTestGemini}
                  disabled={!geminiValid || geminiTest.status === 'testing'}
                  className="flex-1 py-2.5 rounded-xl border border-indigo-500/40 text-indigo-300
                             hover:bg-indigo-900/30 disabled:opacity-40 disabled:cursor-not-allowed
                             text-sm font-medium transition-all"
                >
                  {geminiTest.status === 'testing' ? 'Testing…' : 'Test Key'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!geminiValid || saving}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600
                             hover:from-indigo-500 hover:to-purple-500 text-white font-semibold
                             disabled:opacity-40 disabled:cursor-not-allowed text-sm transition-all
                             shadow-lg shadow-indigo-900/40"
                >
                  {saving ? 'Launching…' : '🚀 Launch Dashboard'}
                </button>
              </div>

              <button
                onClick={() => setStep('firebase')}
                className="w-full mt-3 text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                ← Back to Firebase
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
