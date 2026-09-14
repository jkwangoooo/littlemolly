const DB_NAME = 'happy-little-molly-local'
const DB_VERSION = 1

/**
 * 本地对象仓库契约。新增仓库时必须同时做四件事，缺一不可：
 * 1. 把名字加进 LocalStore（否则类型不放行）；
 * 2. 在 STORES 里补一条定义（keyPath 与索引）；
 * 3. 提升 DB_VERSION；
 * 4. 在 MIGRATIONS 里登记该版本新增的仓库。
 * 只做第 1 步会导致类型放行但运行时报错。
 */
export type LocalStore = 'users' | 'day_plans' | 'daily_meals' | 'custom_tasks'

type IndexDefinition = { name: string; keyPath: string | string[]; unique?: boolean }
type StoreDefinition = { name: LocalStore; keyPath: string; indexes?: IndexDefinition[] }

const STORES: StoreDefinition[] = [
  { name: 'users', keyPath: 'id', indexes: [{ name: 'email', keyPath: 'email', unique: true }] },
  {
    name: 'day_plans',
    keyPath: 'id',
    indexes: [
      { name: 'user_date', keyPath: ['user_id', 'plan_date'], unique: true },
      { name: 'user_id', keyPath: 'user_id' },
    ],
  },
  {
    name: 'daily_meals',
    keyPath: 'id',
    indexes: [
      { name: 'plan_type', keyPath: ['day_plan_id', 'meal_type'], unique: true },
      { name: 'day_plan_id', keyPath: 'day_plan_id' },
    ],
  },
  {
    name: 'custom_tasks',
    keyPath: 'id',
    indexes: [{ name: 'day_plan_id', keyPath: 'day_plan_id' }],
  },
]

/** 版本号 → 该版本引入的对象仓库。升级时按版本升序补齐，已存在的跳过。 */
const MIGRATIONS: Record<number, LocalStore[]> = {
  1: ['users', 'day_plans', 'daily_meals', 'custom_tasks'],
}

function applyMigration(database: IDBDatabase, storeName: LocalStore): void {
  if (database.objectStoreNames.contains(storeName)) return

  const definition = STORES.find((store) => store.name === storeName)
  if (!definition) throw new Error(`未定义的对象仓库：${storeName}`)

  const store = database.createObjectStore(definition.name, { keyPath: definition.keyPath })
  for (const index of definition.indexes ?? []) {
    store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false })
  }
}

function createId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库。'))

    request.onupgradeneeded = (event) => {
      const database = request.result

      for (const version of Object.keys(MIGRATIONS).map(Number).sort((left, right) => left - right)) {
        if (version <= event.oldVersion) continue
        for (const storeName of MIGRATIONS[version]) applyMigration(database, storeName)
      }
    }

    request.onsuccess = () => {
      const database = request.result
      for (const existing of Array.from(database.objectStoreNames)) {
        if (!STORES.some((store) => store.name === existing)) {
          console.warn(`对象仓库 ${existing} 不在 STORES 清单中，请检查迁移表。`)
        }
      }
      resolve(database)
    }
  })
}

let databasePromise: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  databasePromise ??= openDatabase()
  return databasePromise
}

/** 生成记录主键。 */
export function newId(): string {
  return createId()
}

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
