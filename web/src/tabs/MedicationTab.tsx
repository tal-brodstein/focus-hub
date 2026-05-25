import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import { getDb, collection, query, where, orderBy, getDocs, Timestamp } from '../lib/firebase'
import { SensorReading, MedicationDose } from '../types'

interface DayRecord {
  date: string
  avgScore: number
  hasMedication: boolean
  doses: MedicationDose[]
}

interface TimeWindowScore {
  window: string    // "0-2h", "2-4h", etc.
  avgScore: number
  count: number
}

function avg(arr: number[]) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
}

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export default function MedicationTab() {
  const [records, setRecords] = useState<DayRecord[]>([])
  const [timingData, setTimingData] = useState<TimeWindowScore[]>([])
  const [loading, setLoading] = useState(true)
  const [lookback, setLookback] = useState(30)

  useEffect(() => { loadData() }, [lookback])

  async function loadData() {
    setLoading(true)
    const db = getDb()
    const endDate = new Date()
    const startDate = subDays(endDate, lookback)

    // Load readings for the period
    const readingsSnap = await getDocs(query(
      collection(db, 'readings'),
      where('timestamp', '>=', Timestamp.fromDate(startOfDay(startDate))),
      where('timestamp', '<=', Timestamp.fromDate(endOfDay(endDate))),
      orderBy('timestamp')
    ))
    const readings = readingsSnap.docs.map(d => d.data() as SensorReading)

    // Group readings by day
    const readingsByDay = new Map<string, SensorReading[]>()
    for (const r of readings) {
      const key = format(r.timestamp.toDate(), 'yyyy-MM-dd')
      if (!readingsByDay.has(key)) readingsByDay.set(key, [])
      readingsByDay.get(key)!.push(r)
    }

    // Load medication for each day
    const days: DayRecord[] = []
    const dateRange: string[] = []
    for (let i = lookback; i >= 0; i--) {
      dateRange.push(format(subDays(endDate, i), 'yyyy-MM-dd'))
    }

    const medPromises = dateRange.map(async (dateStr) => {
      try {
        const medSnap = await getDocs(collection(db, 'medication', dateStr, 'doses'))
        const doses = medSnap.docs.map(d => ({ id: d.id, ...d.data() } as MedicationDose))
        const dayReadings = readingsByDay.get(dateStr) ?? []
        return {
          date: dateStr,
          avgScore: avg(dayReadings.map(r => r.focusScore)),
          hasMedication: doses.length > 0,
          doses,
        } as DayRecord
      } catch {
        return null
      }
    })

    const results = (await Promise.all(medPromises)).filter(Boolean) as DayRecord[]
    setRecords(results)

    // Build timing analysis
    const timingBuckets: Record<string, number[]> = {
      '0–2h': [], '2–4h': [], '4–6h': [], '6–8h': [],
    }

    for (const day of results) {
      if (!day.hasMedication) continue
      const dayReadings = readingsByDay.get(day.date) ?? []
      if (!dayReadings.length) continue

      for (const dose of day.doses) {
        const doseMins = parseTimeToMinutes(dose.time)
        for (const r of dayReadings) {
          const rDate = r.timestamp.toDate()
          const rMins = rDate.getHours() * 60 + rDate.getMinutes()
          const diff = rMins - doseMins
          if (diff < 0 || diff > 480) continue
          if (diff < 120) timingBuckets['0–2h'].push(r.focusScore)
          else if (diff < 240) timingBuckets['2–4h'].push(r.focusScore)
          else if (diff < 360) timingBuckets['4–6h'].push(r.focusScore)
          else timingBuckets['6–8h'].push(r.focusScore)
        }
      }
    }

    setTimingData(
      Object.entries(timingBuckets).map(([window, scores]) => ({
        window,
        avgScore: avg(scores),
        count: scores.length,
      }))
    )

    setLoading(false)
  }

  const medDays    = records.filter(r => r.hasMedication && r.avgScore > 0)
  const noMedDays  = records.filter(r => !r.hasMedication && r.avgScore > 0)
  const avgMed     = avg(medDays.map(r => r.avgScore))
  const avgNoMed   = avg(noMedDays.map(r => r.avgScore))
  const diff       = avgMed - avgNoMed

  // Comparison bar chart data
  const comparisonData = [
    { label: 'With Medication', score: avgMed,   fill: '#6366f1' },
    { label: 'No Medication',   score: avgNoMed, fill: '#475569' },
  ]

  // 30-day history for timeline
  const historyData = records.filter(r => r.avgScore > 0).slice(-30)

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Medication Analysis</h2>
        <select
          value={lookback}
          onChange={e => setLookback(Number(e.target.value))}
          className="bg-[#1a1a2e] border border-indigo-900/40 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-500">Loading medication data…</div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Med Days',        value: medDays.length,    icon: '💊' },
              { label: 'No-Med Days',     value: noMedDays.length,  icon: '📋' },
              { label: 'Avg Score (med)', value: avgMed || '—',     icon: '🎯' },
              { label: 'Score Diff',      value: diff > 0 ? `+${diff}` : diff || '—', icon: diff >= 0 ? '📈' : '📉' },
            ].map(item => (
              <div key={item.label} className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-4 text-center">
                <span className="text-2xl">{item.icon}</span>
                <p className="text-xl font-bold text-white mt-1 mono">{item.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Comparison chart */}
            <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5">
              <h3 className="font-semibold text-white mb-4">Focus Score: Med vs No Med</h3>
              {avgMed === 0 && avgNoMed === 0 ? (
                <p className="text-slate-500 text-sm">Not enough data for comparison.</p>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonData} barCategoryGap="40%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} width={30} />
                      <Tooltip
                        contentStyle={{ background: '#16213e', border: '1px solid #312e81', borderRadius: 12, fontSize: 12 }}
                        cursor={{ fill: '#ffffff08' }}
                      />
                      <Bar dataKey="score" radius={[8, 8, 0, 0]} fill="#6366f1">
                        {comparisonData.map((d, i) => (
                          <rect key={i} fill={d.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Timing analysis */}
            <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5">
              <h3 className="font-semibold text-white mb-1">Focus vs Time After Dose</h3>
              <p className="text-xs text-slate-500 mb-4">Average focus score by 2-hour window after medication</p>
              {timingData.every(d => d.count === 0) ? (
                <p className="text-slate-500 text-sm">Not enough data yet.</p>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={timingData} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" vertical={false} />
                      <XAxis dataKey="window" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} width={30} />
                      <Tooltip
                        contentStyle={{ background: '#16213e', border: '1px solid #312e81', borderRadius: 12, fontSize: 12 }}
                        cursor={{ fill: '#ffffff08' }}
                        formatter={(v, _, props) => [`${v} (n=${props.payload.count})`, 'Avg Score']}
                      />
                      <Bar dataKey="avgScore" name="Avg Score" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* 30-day history timeline */}
          <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5">
            <h3 className="font-semibold text-white mb-4">Daily History</h3>
            {historyData.length === 0 ? (
              <p className="text-slate-500 text-sm">No history data available.</p>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" />
                    <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false}
                      tickFormatter={v => format(new Date(v), 'MM/dd')} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} width={28} />
                    <Tooltip
                      contentStyle={{ background: '#16213e', border: '1px solid #312e81', borderRadius: 12, fontSize: 12 }}
                      labelFormatter={v => format(new Date(v), 'MMM d')}
                    />
                    <Line dataKey="avgScore" name="Avg Score" stroke="#6366f1" strokeWidth={2} dot={(props) => {
                      const { cx, cy, payload } = props
                      return (
                        <circle
                          key={payload.date}
                          cx={cx} cy={cy} r={4}
                          fill={payload.hasMedication ? '#22c55e' : '#475569'}
                          stroke="#0f0f1a" strokeWidth={1}
                        />
                      )
                    }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-green-500" />
                Medication day
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-slate-500" />
                No medication
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
