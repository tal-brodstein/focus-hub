import { TabName } from '../types'

interface Props {
  active: TabName
  onChange: (tab: TabName) => void
  connected: boolean
}

const TABS: { id: TabName; label: string; icon: string }[] = [
  { id: 'live',       label: 'Live',       icon: '⬤' },
  { id: 'daily',      label: 'Daily',      icon: '📅' },
  { id: 'weekly',     label: 'Weekly',     icon: '📊' },
  { id: 'monthly',    label: 'Monthly',    icon: '🗓' },
  { id: 'medication', label: 'Medication', icon: '💊' },
  { id: 'settings',   label: 'Settings',   icon: '⚙' },
]

export default function Navigation({ active, onChange, connected }: Props) {
  return (
    <nav className="sticky top-0 z-40 bg-[#0f0f1a]/95 backdrop-blur border-b border-indigo-900/30">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <span className="text-indigo-400 text-lg">🎯</span>
          <span className="font-semibold text-white tracking-tight">Focus Hub</span>
          {/* Connection indicator */}
          <span
            className={`ml-2 w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse-slow' : 'bg-red-500'}`}
            title={connected ? 'Firebase connected' : 'Disconnected'}
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap
                ${
                  active === tab.id
                    ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
            >
              <span className={active === tab.id && tab.id === 'live' ? 'text-green-400' : ''}>
                {tab.id === 'live' && active === tab.id ? '●' : tab.icon}
              </span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}
