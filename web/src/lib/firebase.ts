import { initializeApp, getApps, getApp, deleteApp, FirebaseApp } from 'firebase/app'
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  Firestore,
} from 'firebase/firestore'

const APP_NAME = 'focus-hub'

let _db: Firestore | null = null

export function initFirebase(config: Record<string, string>): void {
  const existing = getApps().find(a => a.name === APP_NAME)
  let app: FirebaseApp
  if (existing) {
    app = existing
  } else {
    app = initializeApp(config, APP_NAME)
  }
  _db = getFirestore(app)
}

export function getDb(): Firestore {
  if (!_db) throw new Error('Firebase not initialized')
  return _db
}

export function isFirebaseReady(): boolean {
  return _db !== null
}

/** Used by SetupWizard to test a config without affecting the main app instance. */
export async function testFirebaseConfig(
  config: Record<string, string>
): Promise<{ ok: boolean; message: string }> {
  const testName = `test-${Date.now()}`
  let testApp: FirebaseApp | null = null
  try {
    testApp = initializeApp(config, testName)
    const testDb = getFirestore(testApp)
    await getDoc(doc(testDb, 'status', 'current'))
    return { ok: true, message: 'Connected successfully!' }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    // permission-denied means the project exists but reads are blocked — the web client
    // cannot subscribe to snapshots under these rules, so we must fail the test.
    if (msg.includes('permission') || msg.includes('PERMISSION_DENIED')) {
      return {
        ok: false,
        message:
          'Permission denied — Firestore security rules are blocking reads. ' +
          'Open Firebase Console → Firestore Database → Rules and allow read access ' +
          'for the status collection (e.g. allow read: if true;).',
      }
    }
    return { ok: false, message: msg }
  } finally {
    if (testApp) {
      const apps = getApps()
      const found = apps.find(a => a.name === testName)
      if (found) deleteApp(found).catch(() => undefined)
    }
  }
}

export {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
}
