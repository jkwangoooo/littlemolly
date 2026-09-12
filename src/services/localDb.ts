const DB_NAME = 'happy-little-molly-local'
const DB_VERSION = 1
const SESSION_KEY = 'happy-little-molly.session'

export type LocalUser = { id: string; email: string; password_hash: string; created_at: string }
export type LocalStore = 'users' | 'day_plans' | 'daily_meals' | 'custom_tasks'

function createId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库。'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('users')) database.createObjectStore('users', { keyPath: 'id' }).createIndex('email', 'email', { unique: true })
      if (!database.objectStoreNames.contains('day_plans')) {
        const store = database.createObjectStore('day_plans', { keyPath: 'id' })
        store.createIndex('user_date', ['user_id', 'plan_date'], { unique: true })
        store.createIndex('user_id', 'user_id')
      }
      if (!database.objectStoreNames.contains('daily_meals')) {
        const store = database.createObjectStore('daily_meals', { keyPath: 'id' })
        store.createIndex('plan_type', ['day_plan_id', 'meal_type'], { unique: true })
        store.createIndex('day_plan_id', 'day_plan_id')
      }
      if (!database.objectStoreNames.contains('custom_tasks')) database.createObjectStore('custom_tasks', { keyPath: 'id' }).createIndex('day_plan_id', 'day_plan_id')
    }
    request.onsuccess = () => resolve(request.result)
  })
}

let databasePromise: Promise<IDBDatabase> | null = null
function database(): Promise<IDBDatabase> {
  databasePromise ??= openDatabase()
  return databasePromise
}

export function newId(): string { return createId() }

export async function getAll<T>(storeName: LocalStore): Promise<T[]> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
    request.onerror = () => reject(request.error ?? new Error('读取本地数据库失败。'))
    request.onsuccess = () => resolve(request.result as T[])
  })
}

export async function put<T extends { id: string }>(storeName: LocalStore, value: T): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    transaction.onerror = () => reject(transaction.error ?? new Error('写入本地数据库失败。'))
    transaction.objectStore(storeName).put(value)
    transaction.oncomplete = () => resolve(value)
  })
}

export async function remove(storeName: LocalStore, id: string): Promise<void> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    transaction.onerror = () => reject(transaction.error ?? new Error('删除本地数据失败。'))
    transaction.objectStore(storeName).delete(id)
    transaction.oncomplete = () => resolve()
  })
}

export async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function readSession(): { user: { id: string; email: string } } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) as { user: { id: string; email: string } } : null
  } catch { return null }
}

export function writeSession(session: { user: { id: string; email: string } } | null): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  else localStorage.removeItem(SESSION_KEY)
  window.dispatchEvent(new Event('molly-auth-change'))
}
