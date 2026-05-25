import { useState } from 'react'
import { initFirebase } from './lib/firebase'
import { useLiveData } from './hooks/useLiveData'
import SetupWizard from './components/SetupWizard'
import Navigation from './components/Navigation'
import LiveTab from './tabs/LiveTab'
import DailyTab from './tabs/DailyTab'
import WeeklyTab from './tabs/WeeklyTab'
import MonthlyTab from './tabs/MonthlyTab'
import MedicationTab from './tabs/MedicationTab'
import SettingsTab from './tabs/SettingsTab'
import { TabName } from './types'

// Runs synchronously during state initialisation — before the first render —
// so the wizard never flashes when config is already stored.
function tryInitFirebase(): boolean {
  const raw     = localStorage.getItem('firebaseConfig')
  const gemKey  = localStorage.getItem('geminiApiKey')
  if (!raw || !gemKey) return false
  try {
    initFirebase(JSON.parse(raw))
    return true
  } catch {
    return false
  }
}

// Inner shell — only rendered once Firebase is ready so useLiveData can call getDb()
function Dashboard() {
  const [tab, setTab] = useState<TabName>('live')
  const liveData = useLiveData()

  return (
    <div className="min-h-screen" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <Navigation active={tab} onChange={setTab} connected={liveData.connected} />

      <main>
        {tab === 'live'       && <LiveTab liveData={liveData} />}
        {tab === 'daily'      && <DailyTab />}
        {tab === 'weekly'     && <WeeklyTab />}
        {tab === 'monthly'    && <MonthlyTab />}
        {tab === 'medication' && <MedicationTab />}
        {tab === 'settings'   && <SettingsTab />}
      </main>
    </div>
  )
}

export default function App() {
  // Lazy initialiser: tryInitFirebase runs once, synchronously, before the first
  // render. If localStorage has both keys, Firebase is initialised immediately
  // and ready=true, so the dashboard renders directly with no wizard flash.
  const [ready, setReady] = useState(tryInitFirebase)

  if (!ready) {
    return <SetupWizard onComplete={() => setReady(true)} />
  }

  return <Dashboard />
}
