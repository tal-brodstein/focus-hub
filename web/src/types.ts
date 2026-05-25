import { Timestamp } from 'firebase/firestore'

export interface SensorReading {
  temp: number
  humidity: number
  noise: number
  light: number
  vibration: number
  focusScore: number
  sessionActive: boolean
  sessionSeconds: number
  distractionEvent: boolean
  sessionTimeout: boolean
  timestamp: Timestamp
}

export interface LiveDataPoint extends SensorReading {
  timeLabel: string
  // normalized 0–100 for chart rendering
  tempN: number
  humN: number
  noiseN: number
  lightN: number
}

export interface Session {
  id?: string
  startTime: Timestamp
  endTime?: Timestamp
  durationSeconds?: number
  timedOut?: boolean
}

export interface MedicationDose {
  id: string
  type: 'Regular' | 'XR'
  dose: number
  time: string // "HH:MM"
}

export interface JournalEntry {
  content: string
  updatedAt?: Timestamp
}

export interface ContextAnswer {
  timestamp: Timestamp
  question: string
  answer: string
  focusScore: number
  temp: number
  humidity: number
  noise: number
  light: number
}

export interface GeminiQuestion {
  question: string
  options: string[]
}

export interface GeminiResult {
  insight: string
  questions: GeminiQuestion[]
}

export type TabName = 'live' | 'daily' | 'weekly' | 'monthly' | 'medication' | 'settings'

export interface FirebaseConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket?: string
  messagingSenderId?: string
  appId: string
}
