import { useState, useEffect } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  addMonths, subMonths, startOfDay, endOfDay,
  getDay, getDaysInMonth,
} from 'date-fns'
import { getDb, collection, query, where, orderBy, getDocs, Timestamp } from '../lib/firebase'
import { SensorReading, Session } from '../types'

interface DayScore {
  date: string    // "YYYY-MM-DD"
  avgScore: number
  hours: number
}

function scoreToColor(score: number): string {
  if (score === 0) return '#1a1a2e'           // no data
  if (score >= 80) return '#1d4ed8'           // blue-700
  if (score >= 65) return '#2563eb'           // blue-600
  if (score >= 50) return '#7c3aed'           // violet-600
  if (score >= 35) return '#9333ea80'         // purple, faded
  return '#1e1e3a'                            // low score
}

function avg(arr: number[]) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
}

export default function MonthlyTab() {
  const [month, setMonth] = useState(() => new Date())
  const [dayScores, setDayScores] = useState<Map<string, DayScore>>(new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => { loadMonth() }, [month])

  async function loadMonth() {
    setLoading(true)
    const db = getDb()
    const mStart = startOfMonth(month)
    const mEnd = endOfMonth(month)

    const [readingsSnap, sessionsSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'readings'),
        where('timestamp', '>=', Timestamp.fromDate(startOfDay(mStart))),
        where('timestamp', '<=', Timestamp.fromDate(endOfDay(mEnd))),
        orderBy('timestamp')
      )),
      getDocs(query(
        collection(db, 'sessions'),
        where('startTime', '>=', Timestamp.fromDate(startOfDay(mStart))),
        where('startTime', '<=', Timestamp.fromDate(endOfDay(mEnd))),
        orderBy('startTime')
      )),
    ])

    const readings = readingsSnap.docs.map(d => d.data() as SensorReading)
    const sessions = sessionsSnap.docs.map(d => d.data() as Session)

    // Group readings by day
    const byDay = new Map<string, number[]>()
    for (const r of readings) {
      const key = format(r.timestamp.toDate(), 'yyyy-MM-dd')
      if (!byDay.has(key)) byDay.set(key, [])
      byDay.get(key)!.push(r.focusScore)
    }

    // Group session seconds by day
    const sesByDay = new Map<string, number>()
    for (const s of sessions) {
      const key = format(s.startTime.toDate(), 'yyyy-MM-dd')
      sesByDay.set(key, (sesByDay.get(key) ?? 0) + (s.durationSeconds ?? 0))
    }

    const map = new Map<string, DayScore>()
    for (const [date, scores] of byDay) {
      map.set(date, {
        date,
        avgScore: avg(scores),
        hours: Math.round(((sesByDay.get(date) ?? 0) / 3600) * 10) / 10,
      })
    }

    setDayScores(map)
    setLoading(false)
  }

  // Calendar grid
  const mStart = startOfMonth(month)
  const mEnd = endOfMonth(month)
  const days = eachDayOfInterval({ start: mStart, end: mEnd })
  const startPad = (getDay(mStart) + 6) % 7  // Mon=0 pad

  const scores = [...dayScores.values()]
  const withData = scores.filter(d => d.avgScore > 0)
  const totalHours = scores.reduce((s, d) => s + d.hours, 0)
  const avgScore = avg(withData.map(d => d.avgScore))
  const daysActive = withData.length

  // Streak
  let currentStreak = 0
  const today = format(new Date(), 'yyyy-MM-dd')
  let check = today
  while (dayScores.has(check) && dayScores.get(check)!.hours > 0) {
    currentStreak++
    const d = new Date(check)
    d.setDate(d.getDate() - 1)
    check = format(d, 'yyyy-MM-dd')
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {/* Month navigation */}
      <div className="flex items-center gap-4">
        <button onClick={() => setMonth(m => subMonths(m, 1))}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-all">‹</button>
        <h2 className="text-lg font-semibold text-white flex-1 text-center">
          {format(month, 'MMMM yyyy')}
        </h2>
        <button onClick={() => setMonth(m => addMonths(m, 1))}
          disabled={format(addMonths(month, 1), 'yyyy-MM') > format(new Date(), 'yyyy-MM')}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-all disabled:opacity-30">›</button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Hours',    value: `${totalHours.toFixed(1)}h`, icon: '⏱' },
          { label: 'Avg Score',      value: avgScore || '—',             icon: '🎯' },
          { label: 'Active Days',    value: daysActive,                  icon: '📅' },
          { label: 'Current Streak', value: `${currentStreak}d`,         icon: '🔥' },
        ].map(item => (
          <div key={item.label} className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-4 text-center">
            <span className="text-2xl">{item.icon}</span>
            <p className="text-xl font-bold text-white mt-1 mono">{item.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Heatmap */}
      <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Focus Heatmap</h3>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Low</span>
            {['#1e1e3a', '#9333ea80', '#7c3aed', '#2563eb', '#1d4ed8'].map(c => (
              <span key={c} className="w-4 h-4 rounded" style={{ background: c }} />
            ))}
            <span>High</span>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-slate-500">Loading…</div>
        ) : (
          <>
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                <div key={d} className="text-center text-xs text-slate-600">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {/* Padding cells */}
              {Array.from({ length: startPad }).map((_, i) => (
                <div key={`pad-${i}`} />
              ))}

              {days.map(day => {
                const key = format(day, 'yyyy-MM-dd')
                const ds = dayScores.get(key)
                const isToday = key === today
                const isFuture = key > today

                return (
                  <div
                    key={key}
                    title={ds ? `${format(day, 'MMM d')}: Score ${ds.avgScore}, ${ds.hours}h focused` : format(day, 'MMM d')}
                    className={`aspect-square rounded flex items-center justify-center relative
                      ${isToday ? 'ring-1 ring-indigo-400' : ''}
                      ${isFuture ? 'opacity-20' : ''}
                    `}
                    style={{ background: ds && ds.avgScore > 0 ? scoreToColor(ds.avgScore) : '#0f0f1a' }}
                  >
                    <span className={`text-xs ${isToday ? 'text-white font-bold' : 'text-slate-500'}`}>
                      {format(day, 'd')}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Score legend */}
      <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5">
        <h3 className="font-semibold text-white mb-4">Score Breakdown</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { range: '80–100', label: 'Excellent', color: '#1d4ed8' },
            { range: '65–79',  label: 'Good',      color: '#2563eb' },
            { range: '50–64',  label: 'Fair',      color: '#7c3aed' },
            { range: '35–49',  label: 'Poor',      color: '#9333ea50' },
          ].map(item => (
            <div key={item.range} className="flex items-center gap-2">
              <span className="w-5 h-5 rounded flex-shrink-0" style={{ background: item.color }} />
              <div>
                <p className="text-white text-sm">{item.label}</p>
                <p className="text-slate-500 text-xs mono">{item.range}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
