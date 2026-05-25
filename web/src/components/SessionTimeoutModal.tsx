import { useState } from 'react'

interface Props {
  sessionSeconds: number
  onDismiss: () => void
}

function fmtHours(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h ${m}m`
}

export default function SessionTimeoutModal({ sessionSeconds, onDismiss }: Props) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1a2e] border border-amber-500/40 rounded-2xl p-8 max-w-md w-full shadow-2xl">
        {/* Warning icon */}
        <div className="flex justify-center mb-4">
          <span className="text-5xl animate-pulse-slow">⚠️</span>
        </div>

        <h2 className="text-xl font-bold text-white text-center mb-2">
          Long Session Alert
        </h2>
        <p className="text-slate-300 text-center mb-6">
          Your session has been running for{' '}
          <span className="text-amber-400 font-semibold mono">{fmtHours(sessionSeconds)}</span>.
          Did you forget to stop it?
        </p>

        <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3 mb-6 text-sm text-amber-300/80 text-center">
          Press the session button on your device to end the session.
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => { setDismissed(true); onDismiss(); }}
            className="flex-1 bg-red-600/20 hover:bg-red-600/40 border border-red-500/40 text-red-300
                       py-3 rounded-xl font-medium transition-all text-sm"
          >
            Yes, I forgot — dismiss
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="flex-1 bg-green-600/20 hover:bg-green-600/40 border border-green-500/40 text-green-300
                       py-3 rounded-xl font-medium transition-all text-sm"
          >
            No, still working
          </button>
        </div>
      </div>
    </div>
  )
}
