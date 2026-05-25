import { useState, useEffect, useCallback } from 'react'
import { format, addDays, subDays, startOfDay, endOfDay } from 'date-fns'
import {
  getDb, collection, doc, getDoc, getDocs, addDoc, deleteDoc,
  setDoc, query, where, orderBy, Timestamp,
} from '../lib/firebase'
import { callGemini } from '../lib/gemini'
import { Session, SensorReading, MedicationDose, JournalEntry } from '../types'

function fmtSecs(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function avg(arr: number[]) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
}

interface DayStats {
  avgTemp: number; avgHum: number; avgNoise: number; avgLight: number; avgScore: number
}

export default function DailyTab() {
  const [date, setDate] = useState(new Date())
  const [sessions, setSessions] = useState<Session[]>([])
  const [stats, setStats] = useState<DayStats | null>(null)
  const [medication, setMedication] = useState<MedicationDose[]>([])
  const [journal, setJournal] = useState('')
  const [loading, setLoading] = useState(false)
  const [journalSaving, setJournalSaving] = useState(false)
  const [journalSaved, setJournalSaved] = useState(false)
  const [aiInsight, setAiInsight] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // New dose form
  const [doseType, setDoseType] = useState<'Regular' | 'XR'>('Regular')
  const [doseMg, setDoseMg] = useState(10)
  const [doseTime, setDoseTime] = useState(() => format(new Date(), 'HH:mm'))
  const [addingDose, setAddingDose] = useState(false)

  const dateStr = format(date, 'yyyy-MM-dd')
  const displayDate = format(date, 'EEEE, MMM d, yyyy')

  const loadData = useCallback(async () => {
    setLoading(true)
    const db = getDb()
    const dayStart = Timestamp.fromDate(startOfDay(date))
    const dayEnd = Timestamp.fromDate(endOfDay(date))

    try {
      // Sessions
      const sSnap = await getDocs(
        query(
          collection(db, 'sessions'),
          where('startTime', '>=', dayStart),
          where('startTime', '<=', dayEnd),
          orderBy('startTime')
        )
      )
      setSessions(sSnap.docs.map(d => ({ id: d.id, ...d.data() } as Session)))

      // Readings for environment summary
      const rSnap = await getDocs(
        query(
          collection(db, 'readings'),
          where('timestamp', '>=', dayStart),
          where('timestamp', '<=', dayEnd),
          orderBy('timestamp')
        )
      )
      const readings = rSnap.docs.map(d => d.data() as SensorReading)
      if (readings.length) {
        setStats({
          avgTemp:  avg(readings.map(r => r.temp)),
          avgHum:   avg(readings.map(r => r.humidity)),
          avgNoise: avg(readings.map(r => r.noise)),
          avgLight: avg(readings.map(r => r.light)),
          avgScore: avg(readings.map(r => r.focusScore)),
        })
      } else {
        setStats(null)
      }

      // Medication
      const mSnap = await getDocs(collection(db, 'medication', dateStr, 'doses'))
      setMedication(mSnap.docs.map(d => ({ id: d.id, ...d.data() } as MedicationDose)))

      // Journal
      const jSnap = await getDoc(doc(db, 'journal', dateStr))
      setJournal(jSnap.exists() ? (jSnap.data() as JournalEntry).content : '')
      setJournalSaved(false)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }, [date, dateStr])

  useEffect(() => { loadData() }, [loadData])

  async function handleAddDose() {
    setAddingDose(true)
    const db = getDb()
    const ref = await addDoc(collection(db, 'medication', dateStr, 'doses'), {
      type: doseType, dose: doseMg, time: doseTime,
    })
    setMedication(prev => [...prev, { id: ref.id, type: doseType, dose: doseMg, time: doseTime }])
    setAddingDose(false)
  }

  async function handleDeleteDose(id: string) {
    const db = getDb()
    await deleteDoc(doc(db, 'medication', dateStr, 'doses', id))
    setMedication(prev => prev.filter(d => d.id !== id))
  }

  async function handleSaveJournal() {
    setJournalSaving(true)
    const db = getDb()
    await setDoc(doc(db, 'journal', dateStr), {
      content: journal,
      updatedAt: Timestamp.fromDate(new Date()),
    })
    setJournalSaved(true)
    setJournalSaving(false)
  }

  async function handleDailyAnalysis() {
    const apiKey = localStorage.getItem('geminiApiKey') ?? ''
    if (!apiKey) return
    setAiLoading(true)
    setAiInsight('')
    try {
      const result = await callGemini({
        apiKey,
        recentReadings: [],
        currentReading: null,
        medicationLog: medication,
        journal,
        contextAnswers: [],
      })
      setAiInsight(result.insight)
    } catch (e: unknown) {
      setAiInsight(e instanceof Error ? e.message : 'Error')
    }
    setAiLoading(false)
  }

  const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <div className={`bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5 ${className}`}>
      {children}
    </div>
  )

  const SectionHeader = ({ label }: { label: string }) => (
    <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-4">{label}</h3>
  )

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* Date navigation */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => setDate(d => subDays(d, 1))}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-all"
        >‹</button>
        <h2 className="text-lg font-semibold text-white flex-1 text-center">{displayDate}</h2>
        <button
          onClick={() => setDate(d => addDays(d, 1))}
          disabled={format(addDays(date, 1), 'yyyy-MM-dd') > format(new Date(), 'yyyy-MM-dd')}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-all disabled:opacity-30"
        >›</button>
      </div>

      {loading && (
        <div className="text-center py-12 text-slate-500">Loading day data…</div>
      )}

      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Sessions */}
          <Card>
            <SectionHeader label="Sessions" />
            {sessions.length === 0 ? (
              <p className="text-slate-500 text-sm">No sessions recorded this day.</p>
            ) : (
              <div className="space-y-3">
                {sessions.map(s => {
                  const start = s.startTime?.toDate?.()
                  const end = s.endTime?.toDate?.()
                  return (
                    <div key={s.id} className="bg-[#0f0f1a] rounded-xl p-4 border border-indigo-900/20">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-white font-medium mono text-sm">
                            {start ? format(start, 'HH:mm') : '--:--'}
                            {' → '}
                            {end ? format(end, 'HH:mm') : <span className="text-green-400">ongoing</span>}
                          </p>
                          <p className="text-slate-400 text-xs mt-1">
                            {s.durationSeconds ? fmtSecs(s.durationSeconds) : '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {s.timedOut && (
                            <span className="text-xs px-2 py-0.5 bg-amber-900/30 border border-amber-700/30 text-amber-300 rounded">
                              timed out
                            </span>
                          )}
                          {!s.endTime && (
                            <span className="text-xs px-2 py-0.5 bg-green-900/30 border border-green-700/30 text-green-300 rounded">
                              active
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {/* Environment summary */}
          <Card>
            <SectionHeader label="Environment Summary" />
            {!stats ? (
              <p className="text-slate-500 text-sm">No sensor data for this day.</p>
            ) : (
              <>
                <div className="mb-4 text-center">
                  <span className="text-4xl font-bold text-white">{stats.avgScore}</span>
                  <span className="text-slate-400 text-sm ml-1">/100 avg score</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Temperature', value: stats.avgTemp, unit: '°C' },
                    { label: 'Humidity',    value: stats.avgHum,  unit: '%' },
                    { label: 'Noise',       value: stats.avgNoise, unit: 'dB' },
                    { label: 'Light',       value: stats.avgLight, unit: 'lx' },
                  ].map(item => (
                    <div key={item.label} className="bg-[#0f0f1a] rounded-lg p-3 border border-indigo-900/20">
                      <p className="text-xs text-slate-500 mb-1">{item.label}</p>
                      <p className="text-white font-semibold mono">{item.value}<span className="text-xs text-slate-500 ml-0.5">{item.unit}</span></p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          {/* Medication log */}
          <Card>
            <SectionHeader label="Medication Log" />

            <div className="flex flex-wrap gap-2 mb-4">
              <select
                value={doseType}
                onChange={e => setDoseType(e.target.value as 'Regular' | 'XR')}
                className="bg-[#0f0f1a] border border-indigo-900/40 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option>Regular</option>
                <option>XR</option>
              </select>
              <input
                type="number" min={1} max={100} value={doseMg}
                onChange={e => setDoseMg(Number(e.target.value))}
                className="w-20 bg-[#0f0f1a] border border-indigo-900/40 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder="mg"
              />
              <input
                type="time" value={doseTime}
                onChange={e => setDoseTime(e.target.value)}
                className="bg-[#0f0f1a] border border-indigo-900/40 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={handleAddDose} disabled={addingDose}
                className="px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 text-indigo-300 rounded-lg text-sm transition-all disabled:opacity-50"
              >
                + Add
              </button>
            </div>

            {medication.length === 0 ? (
              <p className="text-slate-500 text-sm">No doses logged today.</p>
            ) : (
              <div className="space-y-2">
                {[...medication].sort((a, b) => a.time.localeCompare(b.time)).map(d => (
                  <div key={d.id} className="flex items-center justify-between bg-[#0f0f1a] rounded-lg px-4 py-2.5 border border-indigo-900/20">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">💊</span>
                      <div>
                        <span className="text-white text-sm font-medium">{d.type} {d.dose} mg</span>
                        <span className="text-slate-500 text-xs ml-2 mono">{d.time}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteDose(d.id)}
                      className="text-slate-600 hover:text-red-400 text-lg transition-colors"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Journal */}
          <Card>
            <div className="flex items-center justify-between mb-1">
              <SectionHeader label="Daily Journal" />
              <span className="text-xs text-indigo-400/60 -mt-3">Gemini will read this</span>
            </div>
            <textarea
              value={journal}
              onChange={e => { setJournal(e.target.value); setJournalSaved(false) }}
              rows={6}
              placeholder="How are you feeling today? Any distractions, sleep quality, stress level…"
              className="w-full bg-[#0f0f1a] border border-indigo-900/40 rounded-xl p-3 text-sm text-slate-200
                         placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
            />
            <div className="flex items-center justify-between mt-3">
              {journalSaved && <span className="text-xs text-green-400">✓ Saved</span>}
              {!journalSaved && <span />}
              <button
                onClick={handleSaveJournal} disabled={journalSaving}
                className="px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 text-indigo-300 rounded-lg text-sm transition-all"
              >
                {journalSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Daily AI Analysis */}
      {!loading && (
        <div className="bg-[#1a1a2e] border border-purple-900/30 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-purple-400">✨</span>
              <h3 className="font-semibold text-white">Daily AI Analysis</h3>
            </div>
            <button
              onClick={handleDailyAnalysis} disabled={aiLoading}
              className="px-4 py-2 bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30
                         text-purple-300 rounded-lg text-sm transition-all disabled:opacity-50"
            >
              {aiLoading ? <span className="animate-spin inline-block">⟳</span> : '✨'} Analyze {format(date, 'MMM d')}
            </button>
          </div>
          {aiInsight ? (
            <p className="text-slate-200 leading-relaxed text-sm">{aiInsight}</p>
          ) : (
            <p className="text-slate-500 text-sm">Click Analyze to get an AI summary of this day's focus data, medication, and journal.</p>
          )}
        </div>
      )}
    </div>
  )
}
