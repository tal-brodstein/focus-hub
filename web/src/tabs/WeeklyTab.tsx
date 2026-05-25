import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, startOfDay, endOfDay,
} from 'date-fns'
import { getDb, collection, query, where, orderBy, getDocs, Timestamp } from '../lib/firebase'
import { Session, SensorReading } from '../types'
import { callGemini } from '../lib/gemini'

interface DayData {
  day: string         // "Mon"
  date: string        // "Dec 9"
  hours: number       // focused hours
  avgScore: number
  sessions: number
}

function avg(arr: number[]) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
}

export default function WeeklyTab() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [data, setData] = useState<DayData[]>([])
  const [loading, setLoading] = useState(false)
  const [aiInsight, setAiInsight] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    loadWeek()
  }, [weekStart])

  async function loadWeek() {
    setLoading(true)
    const db = getDb()
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

    const days = eachDayOfInterval({ start: weekStart, end: weekEnd })

    // Fetch all sessions and readings for the week in bulk
    const [sessionsSnap, readingsSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'sessions'),
        where('startTime', '>=', Timestamp.fromDate(startOfDay(weekStart))),
        where('startTime', '<=', Timestamp.fromDate(endOfDay(weekEnd))),
        orderBy('startTime')
      )),
      getDocs(query(
        collection(db, 'readings'),
        where('timestamp', '>=', Timestamp.fromDate(startOfDay(weekStart))),
        where('timestamp', '<=', Timestamp.fromDate(endOfDay(weekEnd))),
        orderBy('timestamp')
      )),
    ])

    const sessions = sessionsSnap.docs.map(d => d.data() as Session)
    const readings = readingsSnap.docs.map(d => d.data() as SensorReading)

    const dayData: DayData[] = days.map(day => {
      const dayKey = format(day, 'yyyy-MM-dd')
      const daySessions = sessions.filter(s => {
        const d = s.startTime?.toDate?.()
        return d && format(d, 'yyyy-MM-dd') === dayKey
      })
      const dayReadings = readings.filter(r => {
        const d = r.timestamp?.toDate?.()
        return d && format(d, 'yyyy-MM-dd') === dayKey
      })

      const totalSecs = daySessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)

      return {
        day: format(day, 'EEE'),
        date: format(day, 'MMM d'),
        hours: Math.round((totalSecs / 3600) * 10) / 10,
        avgScore: avg(dayReadings.map(r => r.focusScore)),
        sessions: daySessions.length,
      }
    })

    setData(dayData)
    setLoading(false)
  }

  async function handleWeeklyAnalysis() {
    const apiKey = localStorage.getItem('geminiApiKey') ?? ''
    if (!apiKey) return
    setAiLoading(true)
    setAiInsight('')
    const summary = data
      .map(d => `${d.day} ${d.date}: ${d.hours}h focused, avg score ${d.avgScore}`)
      .join('\n')
    try {
      const result = await callGemini({
        apiKey,
        recentReadings: [],
        currentReading: null,
        medicationLog: [],
        journal: `Weekly data:\n${summary}`,
        contextAnswers: [],
      })
      setAiInsight(result.insight)
    } catch (e: unknown) {
      setAiInsight(e instanceof Error ? e.message : 'Error')
    }
    setAiLoading(false)
  }

  const totalHours = data.reduce((s, d) => s + d.hours, 0)
  const overallAvgScore = avg(data.filter(d => d.avgScore > 0).map(d => d.avgScore))
  const bestDay = [...data].sort((a, b) => b.hours - a.hours)[0]
  const worstDay = [...data].filter(d => d.hours > 0).sort((a, b) => a.hours - b.hours)[0]

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

  function barColor(score: number) {
    if (score >= 80) return '#6366f1'
    if (score >= 50) return '#8b5cf6'
    return '#4c1d95'
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* Week navigation */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => setWeekStart(w => subWeeks(w, 1))}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-all"
        >‹</button>
        <h2 className="text-lg font-semibold text-white flex-1 text-center">
          {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
        </h2>
        <button
          onClick={() => setWeekStart(w => addWeeks(w, 1))}
          disabled={addWeeks(weekStart, 1) > new Date()}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-all disabled:opacity-30"
        >›</button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500">Loading week…</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Hours',   value: `${totalHours.toFixed(1)}h`, icon: '⏱' },
              { label: 'Avg Score',     value: overallAvgScore || '—',       icon: '🎯' },
              { label: 'Best Day',      value: bestDay?.day ?? '—',          icon: '🏆' },
              { label: 'Worst Day',     value: worstDay?.day ?? '—',         icon: '📉' },
            ].map(item => (
              <div key={item.label} className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-4 text-center">
                <span className="text-2xl">{item.icon}</span>
                <p className="text-xl font-bold text-white mt-1 mono">{item.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.label}</p>
              </div>
            ))}
          </div>

          {/* Bar chart */}
          <div className="bg-[#1a1a2e] border border-indigo-900/30 rounded-xl p-5">
            <h3 className="font-semibold text-white mb-5">Focused Hours per Day</h3>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: '#64748b', fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    unit="h"
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{ background: '#16213e', border: '1px solid #312e81', borderRadius: 12, fontSize: 12 }}
                    labelStyle={{ color: '#94a3b8' }}
                    formatter={(val, name) => [val, name]}
                    cursor={{ fill: '#ffffff08' }}
                  />
                  <Bar dataKey="hours" name="Hours" radius={[6, 6, 0, 0]}>
                    {data.map((d, i) => (
                      <Cell key={i} fill={barColor(d.avgScore)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Day details */}
            <div className="mt-4 grid grid-cols-7 gap-1">
              {data.map(d => (
                <div key={d.day} className="text-center">
                  <p className="text-xs text-slate-500">{d.date}</p>
                  {d.avgScore > 0 && (
                    <p className="text-xs text-indigo-400 font-medium mt-0.5">{d.avgScore}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Weekly AI Analysis */}
          <div className="bg-[#1a1a2e] border border-purple-900/30 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-purple-400">✨</span>
                <h3 className="font-semibold text-white">Weekly AI Analysis</h3>
              </div>
              <button
                onClick={handleWeeklyAnalysis} disabled={aiLoading}
                className="px-4 py-2 bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30
                           text-purple-300 rounded-lg text-sm transition-all disabled:opacity-50"
              >
                {aiLoading ? <span className="animate-spin inline-block">⟳</span> : '✨'} Analyze Week
              </button>
            </div>
            {aiInsight ? (
              <p className="text-slate-200 leading-relaxed text-sm">{aiInsight}</p>
            ) : (
              <p className="text-slate-500 text-sm">Click to get an AI summary of your week's focus patterns.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
