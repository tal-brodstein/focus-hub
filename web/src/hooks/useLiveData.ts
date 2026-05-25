import { useState, useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { getDb } from '../lib/firebase'
import { SensorReading, LiveDataPoint } from '../types'
import { format } from 'date-fns'

function norm(value: number, min: number, max: number): number {
  return Math.round(Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)))
}

export function useLiveData() {
  const [current, setCurrent] = useState<SensorReading | null>(null)
  const [history, setHistory] = useState<LiveDataPoint[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let db
    try {
      db = getDb()
    } catch {
      setError('Firebase not initialized')
      return
    }

    const unsubscribe = onSnapshot(
      doc(db, 'status', 'current'),
      snapshot => {
        setConnected(true)
        setError(null)
        if (snapshot.exists()) {
          const data = snapshot.data() as SensorReading
          setCurrent(data)

          const date = data.timestamp?.toDate?.() ?? new Date()
          const point: LiveDataPoint = {
            ...data,
            timeLabel: format(date, 'HH:mm:ss'),
            tempN: norm(data.temp, 15, 35),
            humN: data.humidity,
            noiseN: norm(data.noise, 30, 90),
            lightN: norm(data.light, 0, 1000),
          }
          setHistory(prev => [...prev.slice(-29), point])
        }
      },
      err => {
        setConnected(false)
        setError(err.message)
      }
    )

    return () => unsubscribe()
  }, [])

  return { current, history, connected, error }
}
