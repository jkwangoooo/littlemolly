const DB_NAME = 'happy-little-molly-local'
const DB_VERSION = 4

/**
 * 本地对象仓库契约。新增仓库时必须同时做四件事，缺一不可：
 * 1. 把名字加进 LocalStore（否则类型不放行）；
 * 2. 在 STORES 里补一条定义（keyPath 与索引）；
 * 3. 提升 DB_VERSION；
 * 4. 在 MIGRATIONS 里登记该版本新增的仓库。
 * 只做第 1 步会导致类型放行但运行时报错。
 */
export type LocalStore =
  | 'users'
  | 'day_plans'
  | 'daily_meals'
  | 'custom_tasks'
  | 'food_options'
  | 'supplement_templates'
  | 'exercise_options'
  | 'daily_meal_items'
  | 'daily_supplements'
  | 'daily_exercise_items'
  | 'routine_tasks'

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
  { name: 'food_options', keyPath: 'id', indexes: [{ name: 'user_id', keyPath: 'user_id' }] },
  { name: 'supplement_templates', keyPath: 'id', indexes: [{ name: 'user_id', keyPath: 'user_id' }] },
  { name: 'exercise_options', keyPath: 'id', indexes: [{ name: 'user_id', keyPath: 'user_id' }] },
  { name: 'daily_meal_items', keyPath: 'id', indexes: [{ name: 'daily_meal_id', keyPath: 'daily_meal_id' }] },
  { name: 'daily_supplements', keyPath: 'id', indexes: [{ name: 'day_plan_id', keyPath: 'day_plan_id' }] },
  { name: 'daily_exercise_items', keyPath: 'id', indexes: [{ name: 'day_plan_id', keyPath: 'day_plan_id' }] },
  { name: 'routine_tasks', keyPath: 'id', indexes: [{ name: 'day_plan_id', keyPath: 'day_plan_id' }] },
]

/**
 * 一个版本对数据库做过的全部改动。
 * `stores` 是该版本新建的仓库；`migrate` 是该版本需要的数据搬迁，
 * 拿到的 `tx` 就是 versionchange 事务本身——升级期间不允许另开事务。
 */
type Migration = { stores?: LocalStore[]; migrate?: (tx: IDBTransaction) => void }

/** 老库把三餐内容与健身内容存成自由文本，这两个形状只用于迁移读取。 */
type LegacyMeal = { id: string; plan_content?: string }
type LegacyPlan = { id: string; exercise_decision?: string; exercise_content?: string }

/**
 * v3 数据搬迁：把老库的自由文本转成「名称快照项」。
 *
 * 迁移前 `daily_meals.plan_content` 与 `day_plans.exercise_content` 各存一段文字，
 * 迁移后内容改存 `daily_meal_items` / `daily_exercise_items`，每段文字转成一条快照项，
 * 关联选项留空表示「没有来源选项」。原字段的值有意保留不清空：
 * 万一以后发现搬迁有误，数据还在原地，而新的写入自然会丢掉这些字段。
 */
function backfillSnapshots(tx: IDBTransaction): void {
  const timestamp = new Date().toISOString()

  const meals = tx.objectStore('daily_meals').getAll()
  meals.onsuccess = () => {
    const items = tx.objectStore('daily_meal_items')
    for (const meal of meals.result as LegacyMeal[]) {
      const text = (meal.plan_content ?? '').trim()
      if (!text) continue
      items.put({
        id: createId(),
        daily_meal_id: meal.id,
        food_option_id: null,
        food_name_snapshot: text,
        sort_order: 0,
        created_at: timestamp,
      })
    }
  }

  const plans = tx.objectStore('day_plans').getAll()
  plans.onsuccess = () => {
    const items = tx.objectStore('daily_exercise_items')
    for (const plan of plans.result as LegacyPlan[]) {
      if (plan.exercise_decision !== 'exercise') continue
      const text = (plan.exercise_content ?? '').trim()
      if (!text) continue
      items.put({
        id: createId(),
        day_plan_id: plan.id,
        exercise_option_id: null,
        name_snapshot: text,
        sort_order: 0,
        created_at: timestamp,
      })
    }
  }
}

/** 版本号 → 该版本的改动。升级时按版本升序补齐，已存在的跳过。**只追加，不改写旧版本。** */
const MIGRATIONS: Record<number, Migration> = {
  1: { stores: ['users', 'day_plans', 'daily_meals', 'custom_tasks'] },
  2: { stores: ['food_options', 'supplement_templates', 'exercise_options'] },
  3: {
    stores: ['daily_meal_items', 'daily_supplements', 'daily_exercise_items'],
    migrate: backfillSnapshots,
  },
  4: { stores: ['routine_tasks'] },
}

/**
 * 结构快照，仅供 `scripts/check-local-data.mjs` 做迁移回归（「迁移只追加」是硬性规则）。
 * 业务代码请使用上面的读写函数，不要引用这个对象。
 */
export const LOCAL_SCHEMA = { version: DB_VERSION, stores: STORES, migrations: MIGRATIONS } as const

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
      const transaction = request.transaction
      if (!transaction) throw new Error('升级事务不可用，无法执行数据搬迁。')

      for (const version of Object.keys(MIGRATIONS).map(Number).sort((left, right) => left - right)) {
        if (version <= event.oldVersion) continue
        const migration = MIGRATIONS[version]
        for (const storeName of migration.stores ?? []) applyMigration(database, storeName)
        migration.migrate?.(transaction)
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
