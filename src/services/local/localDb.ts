import { readSession } from '../session'
import {
  compactionVictims,
  createSeqGenerator,
  dedupeChanges,
  OUTBOX_CHANGE_EVENT,
  type OutboxChange,
  type OutboxEntry,
} from './outboxRules'
import { assertRecord, isSyncableStore } from './recordSchemas'

const DB_NAME = 'happy-little-molly-local'
/** 当前结构版本。备份文件里会记下它，便于以后判断「这份备份是哪一代的库导出的」。 */
export const DB_VERSION = 7

/**
 * 本地对象仓库契约。新增仓库时必须同时做五件事，缺一不可：
 * 1. 把名字加进 LocalStore（否则类型不放行）；
 * 2. 在 STORES 里补一条定义（keyPath 与索引）；
 * 3. 提升 DB_VERSION；
 * 4. 在 MIGRATIONS 里登记该版本新增的仓库；
 * 5. 在 `recordSchemas.ts` 的 `STORE_KIND` 与 `RECORD_SCHEMAS` 里各补一条
 *    （前者决定它属于用户数据 / 元数据 / 设备状态，后者是它的字段契约；
 *    两张表都由 `Record<LocalStore, ...>` 兜底，漏一张就编译不过）。
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
  | 'sync_outbox'
  | 'sync_state'

/**
 * 进同步队列的仓库：只有用户数据。
 * `users` 是应用身份（决策 D5：不迁移本地密码），`sync_*` 是本机状态，都不进队列。
 */
export type UserDataStore = Exclude<LocalStore, 'users' | 'sync_outbox' | 'sync_state'>

type IndexDefinition = { name: string; keyPath: string | string[]; unique?: boolean }
type StoreDefinition = { name: LocalStore; keyPath: string; indexes?: IndexDefinition[] }

const STORES: StoreDefinition[] = [
  { name: 'users', keyPath: 'id', indexes: [{ name: 'username', keyPath: 'username', unique: true }] },
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
  // ---- 设备状态（S2）：不进备份、不同步，只服务「待上传队列」与「上次同步到哪儿」 ----
  {
    name: 'sync_outbox',
    keyPath: 'id',
    indexes: [
      // seq 给批次一个稳定的全序（真正的推送顺序由依赖层级决定，见 outboxRules.ts）。
      { name: 'seq', keyPath: 'seq' },
      // store_record 是压缩用的键：同一 (store, record_id) 只保留最后一条。
      { name: 'store_record', keyPath: ['store', 'record_id'] },
    ],
  },
  // 按**本地账号**分行：`id` 就是本地账号 id（v7 起，见 MIGRATIONS[7]）。
  // 字段见 recordSchemas.ts 的 sync_state 契约。
  { name: 'sync_state', keyPath: 'id' },
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
/** v5 之前的 `users` 用 `email` 当登录名，这个形状只用于迁移读取。 */
type LegacyUser = { id: string; email?: string; username?: string }

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

/**
 * v5 数据搬迁：登录凭据从「邮箱 + 密码」换成「账号 + 密码」，`users` 的字段与唯一索引一起换名。
 *
 * 数据与结构必须同时搬，少一件这个库就打不开或者登不进去：
 *
 * 1. **数据**：`email` **原样**搬成 `username`。刻意不做「取 @ 前面那段」这类加工——
 *    老用户凭习惯敲的仍然是自己原来的邮箱，截断成 `molly` 之后他输 `molly@example.com`
 *    只会得到「账号或密码不正确」，而且没有任何线索；原样保留则零成本继续登录，
 *    账号卡上显示的也正好是他记得的那个字符串。代价是历史账号可能带 `@`，
 *    所以 `signIn` 有意不做格式校验（新注册才校验，见 `shared/authRules.ts`）。
 * 2. **结构**：唯一索引 `email` 换成 `username`。不换的话新代码按 `username` 建索引会撞名，
 *    而旧的唯一约束会永远挂在库上，`check:local-data` 也会报「定义与迁移表不一致」。
 *
 * 顺序是「先搬数据、再换索引」：`email` 唯一索引还在时先改名不触发任何约束冲突
 * （改名后的记录只是不再被那个索引收录），换完索引后新写入自然按 `username` 去重。
 * `username` 与 `email` 一对一同源，所以换成唯一索引也不会撞约束。
 */
function renameUsersToUsername(tx: IDBTransaction): void {
  const users = tx.objectStore('users')

  const existing = users.getAll()
  existing.onsuccess = () => {
    for (const row of existing.result as LegacyUser[]) {
      // 幂等：已经是新形状的记录不再动，升级中途被打断后重跑也安全。
      if (typeof row.username === 'string' && row.username) continue
      const next: Record<string, unknown> = { ...row, username: (row.email ?? '').trim() || `user-${row.id}` }
      delete next.email
      users.put(next)
    }
  }

  if (users.indexNames.contains('email')) users.deleteIndex('email')
  if (!users.indexNames.contains('username')) users.createIndex('username', 'username', { unique: true })
}

/**
 * v7 搬迁的**纯规则**：把 `sync_state` 的行重新归属到 `owner`（当前登录的本地账号）。
 *
 * 抽成纯函数（而不是直接写在事务回调里）是为了能被 `scripts/check-local-data.mjs`
 * 在 Node 里直接回归——搬迁逻辑一旦写歪，症状是「换个账号登录就看到别人的云端绑定」，
 * 只有真机上换账号才会暴露，而那时数据已经推到别人的云端账号里了。
 *
 * 三种情形：
 * - 行本来就是 `owner` 的：原样不动（幂等，升级中途被打断后重跑也安全）；
 * - 别的行（老库里的 `'singleton'`）：主键改写成 `owner`，**旧主键那一行必须删掉**，
 *   否则它会永远留在库里，而且下次 `getAll` 还会读到；
 * - `owner` 为 `null`（升级时没人登录）：删掉。一个无法归属到任何本地账号的绑定是不可用的，
 *   留着它只会让下一个登录的账号读到别人的绑定——正是这次改造要防的事。
 *   删除方向是安全的：用户重新绑一次即可，本地业务数据一条都不动。
 */
export function rekeySyncStateRows(
  rows: Array<Record<string, unknown> & { id: string }>,
  owner: string | null,
): { put: Array<Record<string, unknown>>; remove: string[] } {
  const put: Array<Record<string, unknown>> = []
  const remove: string[] = []
  for (const row of rows) {
    if (!owner) {
      remove.push(row.id)
      continue
    }
    if (row.id === owner) continue
    put.push({ ...row, id: owner })
    remove.push(row.id)
  }
  return { put, remove }
}

/**
 * v7 数据搬迁：`sync_state` 从「设备级单行」改成「按本地账号分行」。
 *
 * 为什么必须改：绑定关系是**某个本地账号**与某个云端账号之间的关系，不是设备与云端之间的关系。
 * 换本地账号（退出后用另一个账号登录）时，新账号会读到上一任的绑定，
 * 于是它的改动被推到**别人**的云端账号里——数据事故，而且全程没有任何提示。
 *
 * 只搬归属，不动其余字段：云端账号、绑定时间、设备 id 原样保留，绑定关系不丢。
 * 规则本身在 `rekeySyncStateRows` 里（纯函数，可回归）。
 */
function rekeySyncStateByLocalUser(tx: IDBTransaction): void {
  const store = tx.objectStore('sync_state')
  const existing = store.getAll()
  existing.onsuccess = () => {
    // 会话在**搬迁那一刻**读：这正是「这次升级是谁在登录」的唯一答案。
    const plan = rekeySyncStateRows(
      existing.result as Array<Record<string, unknown> & { id: string }>,
      readSession()?.user.id ?? null,
    )
    for (const row of plan.put) store.put(row)
    for (const id of plan.remove) store.delete(id)
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
  5: { migrate: renameUsersToUsername },
  /**
   * v6 只新建两张**设备状态**表，没有数据搬迁。
   *
   * 这两张表从空开始就是正确状态：outbox 为空表示「没有待上传的变更」，
   * `sync_state` 缺行表示「还没绑定云端账号」。老用户升级后不会多出任何待上传项——
   * 他们的历史数据是「已经存在的本地数据」，要送上去必须由人主动点「本地上传云端」（S5），
   * 这正是 docs/19 §3 第 4 条「整体替换只由人触发」的含义。
   */
  6: { stores: ['sync_outbox', 'sync_state'] },
  /**
   * v7 不新增仓库，只做一次搬迁：`sync_state` 的主键从 `'singleton'` 换成**登录中的本地账号 id**。
   *
   * 结构一个字节都没变（`keyPath` 一直是 `id`，本来就没有索引），所以这里只有 `migrate`。
   * 为什么必须搬、`owner` 为 null 时为什么删掉，见 `rekeySyncStateByLocalUser`。
   *
   * 同一次搬迁还把 `sync_outbox` 里那些**没有归属账号**的老条目留着不动：
   * 它们会被 `entriesOfOwner` 过滤掉（永不被推送），下次绑定或解绑时随队列一起清掉。
   * 这里不删它们，是因为「删」是不可逆的，而「不推」已经足够安全。
   */
  7: { migrate: rekeySyncStateByLocalUser },
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
    // 另一个标签页还占用着旧版本连接时，升级会被阻塞。不挂这个回调就只能干等，
    // 界面会一直停在「正在保存」而看不出原因。
    request.onblocked = () =>
      reject(new Error('本地数据库正被其他标签页占用，请关闭其他窗口后重试。'))

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
      // 别处（另一个标签页或新版本代码）要求升级时，只有主动让出连接，
      // 对方才不会被 onblocked 卡住。让出后本页下次读写会重新打开数据库，
      // 走一遍迁移，因此中间不会有「读到旧结构」的窗口期。
      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }
      resolve(database)
    }
  })
}

let databasePromise: Promise<IDBDatabase> | null = null

/**
 * 取数据库连接。
 *
 * 失败时必须清掉缓存：否则一次打开失败（例如升级被其他标签页阻塞）之后，
 * 后续每次读写都会拿到同一个已经 rejected 的 promise，页面从此永远报同一个错。
 * 清掉之后下一次调用会重新尝试打开，用户关掉别的标签页再点「重试」就能恢复。
 */
function database(): Promise<IDBDatabase> {
  databasePromise ??= openDatabase().catch((reason: unknown) => {
    databasePromise = null
    throw reason
  })
  return databasePromise
}

/** 生成记录主键。 */
export function newId(): string {
  return createId()
}

/**
 * 写入请求的失败必须被监听到。
 *
 * 只挂 `transaction.onerror` 是不够的：仓储层的类型或约束错误先在**请求**上触发，
 * 若没人接，浏览器不会把它传给事务，事务照样 complete——「写失败却被当成成功」。
 * 这里把请求错误转成 reject，让调用方看到真实原因。
 */
function guardRequest(request: IDBRequest, fallback: string): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error(fallback))
    request.onsuccess = () => resolve()
  })
}

// ---------------------------------------------------------------- 写入钩子（S2）

/**
 * 写入选项。
 *
 * `track` 默认 `true`：用户数据的写入会在**同一个事务**里追加一条出站队列记录，
 * 与业务写入同生共死——不存在「数据写了但队列没记」或反过来。
 *
 * `track: false` 只有三种正当用途（docs/18 §5.1）：
 * 1. 写 `sync_outbox` / `sync_state` 自身（否则自激循环）；
 * 2. **云端恢复到本地**的整体替换（数据本来就是从云端来的，回推没有意义）；
 * 3. 迁移搬迁（`MIGRATIONS[n].migrate`）——历史数据不该被当成新变更。
 *
 * `owner` 是入队条目的归属本地账号，默认取**当前会话**。
 * 只有一种正当用途：写入发生在会话建立**之前**——注册时播种示例选项正是这样，
 * 那时调用方明确知道这批数据属于谁，必须显式传进来；
 * 不传的话条目会变成「无归属」，永远不会被推送（见 `outboxRules.entriesOfOwner`）。
 */
export type WriteOptions = { track?: boolean; owner?: string }

const nextSeq = createSeqGenerator()

/** 事务要开哪几个仓库：有队列记录时把 `sync_outbox` 一起带上，两者才能原子。 */
function storeNamesFor(storeName: LocalStore, entries: OutboxEntry[]): LocalStore[] {
  return entries.length ? [storeName, 'sync_outbox'] : [storeName]
}

/**
 * 组出要写的队列记录（**在事务外调用**）。
 *
 * 校验必须发生在开事务之前：`assertRecord` 若在事务中途抛出，业务写入的请求已经发出去、
 * 事务照样会提交，结果就是「数据写了、队列没记」——恰好是这个钩子要防的事。
 * 放在事务外，校验失败时连事务都不会开。
 *
 * `owner` 由调用方给：默认是当前会话的本地账号 id，注册播种那种「还没有会话」的写入
 * 由调用方显式指定。读不到任何归属时记 `null`——这类条目永不被推送
 * （见 `outboxRules.entriesOfOwner`），因此它只可能是安全的。
 */
function buildOutboxEntries(changes: OutboxChange[], owner: string | null): OutboxEntry[] {
  return changes.map((change) => {
    const entry: OutboxEntry = {
      id: createId(),
      seq: nextSeq(),
      store: change.store,
      record_id: change.record_id,
      op: change.op,
      local_user_id: owner,
      created_at: new Date().toISOString(),
      attempts: 0,
      last_error: null,
    }
    assertRecord('sync_outbox', entry)
    return entry
  })
}

/**
 * 队列条目的归属人：显式指定优先，否则取当前会话。
 *
 * 归属在**写入那一刻**确定：一条队列条目只在「它所属的本地账号」当前绑定的云端账号下
 * 才会被推送（过滤在 `outboxRules.entriesOfOwner`，`sync/outbox.ts` 用它）。
 */
function outboxOwner(options: WriteOptions): string | null {
  return options.owner ?? readSession()?.user.id ?? null
}

/**
 * 在已有事务里写入队列记录，并顺手压缩。
 *
 * 顺序必须是「先读后写」：先用 `store_record` 索引取出同键的旧行、删掉其中还没尝试过的，
 * 再写新行——反过来写会把自己读进来，然后被自己删掉。
 *
 * `attempts > 0` 的旧行不动（见 `outboxRules.ts` 的 `compactionVictims`）。
 */
function writeOutbox(
  transaction: IDBTransaction,
  entries: OutboxEntry[],
  onError: (reason: unknown) => void,
): void {
  if (!entries.length) return
  const outbox = transaction.objectStore('sync_outbox')
  const byKey = outbox.index('store_record')

  for (const entry of entries) {
    const existing = byKey.getAll([entry.store, entry.record_id])
    existing.onerror = () => onError(existing.error ?? new Error('读取本地待上传队列失败。'))
    existing.onsuccess = () => {
      for (const id of compactionVictims(existing.result as OutboxEntry[])) {
        void guardRequest(outbox.delete(id), '清理本地待上传队列失败。').catch(onError)
      }
      void guardRequest(outbox.put(entry), '写入本地待上传队列失败。').catch(onError)
    }
  }
}

/**
 * 广播「队列有新内容」（S4）。
 *
 * 写入成功后调用，推送调度器（`sync/pushQueue.ts`）监听它并排一次推送。
 *
 * **为什么是事件而不是回调 / 直接调用**：写入路径不该知道同步层的存在。
 * 它只说「我这儿多了一条待上传记录」，谁听、听了做什么都与它无关。
 * 这既是分层，也是硬约束——`localDb.ts` 在 `check:*` 脚本里被 Node 直接导入，
 * 一旦它 import 了拖着 supabase 的模块，那批脚本立刻全挂（S3 踩过一次同类问题）。
 *
 * `globalThis.dispatchEvent` 在 Node 里不存在，所以用可选调用：脚本里静默跳过。
 */
function notifyOutboxChange(): void {
  globalThis.dispatchEvent?.(new Event(OUTBOX_CHANGE_EVENT))
}

export async function getAll<T>(storeName: LocalStore): Promise<T[]> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
    request.onerror = () => reject(request.error ?? new Error('读取本地数据库失败。'))
    request.onsuccess = () => resolve(request.result as T[])
  })
}

/**
 * 读一条记录（S4）。
 *
 * 推送队列里只记「哪条记录变了」的引用，所以推送前必须按 `record_id` 回主表读**当前**行
 * ——这让「按主键取一条」成了推送路径上最频繁的一次读。用 `get(id)` 而不是
 * `getAll().find(...)`：后者会把整张表搬进内存，而一张表的行数可能上千。
 *
 * **读不到返回 `null` 而不是抛错**：记录可能已经被删了，这是推送路径上的**正常情况**
 * （队列里还留着一条 upsert，但记录已经不存在）。调用方据此跳过，
 * 对应的删除会以 `delete` 的形式单独进队列。
 */
export async function getOne<T>(storeName: LocalStore, id: string): Promise<T | null> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(id)
    request.onerror = () => reject(request.error ?? new Error('读取本地数据库失败。'))
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
  })
}

/**
 * 数一张表的行数（S3）。
 *
 * 与 `getAll(...).length` 的区别是**不把数据搬进内存**：绑定云端账号时要回答
 * 「本地这个账号有多少条数据」，队列里也可能积压成百上千条，
 * 而这个问题只需要一个数字。用 IDB 自带的 `count()` 由存储层直接数。
 */
export async function count(storeName: LocalStore): Promise<number> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).count()
    request.onerror = () => reject(request.error ?? new Error('读取本地数据库失败。'))
    request.onsuccess = () => resolve(request.result)
  })
}

/**
 * 写入一条记录。入库前先过一遍字段契约（L5）：缺字段、类型错、枚举越界、
 * 多出未定义字段都会被拒，避免坏数据落库后界面才崩。
 *
 * S2 起：用户数据的写入会在同一事务里追加一条 `upsert` 队列记录（`track: false` 可关闭）。
 */
export async function put<T extends { id: string }>(
  storeName: LocalStore,
  value: T,
  options: WriteOptions = {},
): Promise<T> {
  assertRecord(storeName, value)
  const entries = buildOutboxEntries(
    (options.track ?? true) && isSyncableStore(storeName)
      ? [{ store: storeName, record_id: value.id, op: 'upsert' }]
      : [],
    outboxOwner(options),
  )

  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNamesFor(storeName, entries), 'readwrite')
    const failure = (reason: unknown) =>
      reject(reason instanceof Error ? reason : new Error('写入本地数据库失败。'))
    transaction.onerror = () => reject(transaction.error ?? new Error('写入本地数据库失败。'))
    transaction.onabort = () => reject(transaction.error ?? new Error('写入本地数据库被中止。'))
    void guardRequest(transaction.objectStore(storeName).put(value), '写入本地数据库失败。').catch(reject)
    writeOutbox(transaction, entries, failure)
    transaction.oncomplete = () => {
      resolve(value)
      // 只在真的记了队列时才广播：`track: false` 与设备仓库的写入不该唤醒推送。
      if (entries.length) notifyOutboxChange()
    }
  })
}

/** 删除一条记录；用户数据的删除同样会进队列（`op: 'delete'`）。 */
export async function remove(
  storeName: LocalStore,
  id: string,
  options: WriteOptions = {},
): Promise<void> {
  const entries = buildOutboxEntries(
    (options.track ?? true) && isSyncableStore(storeName)
      ? [{ store: storeName, record_id: id, op: 'delete' }]
      : [],
    outboxOwner(options),
  )

  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNamesFor(storeName, entries), 'readwrite')
    const failure = (reason: unknown) =>
      reject(reason instanceof Error ? reason : new Error('删除本地数据失败。'))
    transaction.onerror = () => reject(transaction.error ?? new Error('删除本地数据失败。'))
    transaction.onabort = () => reject(transaction.error ?? new Error('删除本地数据被中止。'))
    void guardRequest(transaction.objectStore(storeName).delete(id), '删除本地数据失败。').catch(reject)
    writeOutbox(transaction, entries, failure)
    transaction.oncomplete = () => {
      resolve()
      if (entries.length) notifyOutboxChange()
    }
  })
}

// ---------------------------------------------------------------- 跨仓库事务

/** 一次事务里要做的写入；函数体内只允许同步发起请求，不要 await 别的东西。 */
export type TransactionWork = {
  put?: Array<{ store: LocalStore; value: { id: string } }>
  remove?: Array<{ store: LocalStore; id: string }>
  clear?: LocalStore[]
}

/**
 * 把多个仓库的写入放进同一个事务：要么全部生效，要么全部不生效。
 *
 * 为什么需要它：单个 put 各自开事务时，一次「复制昨天」要跨 6 张表写几十条，
 * 中途失败会留下写了一半的目标日；导入备份更是必须整体成功或整体回滚。
 *
 * 注意：事务是「按需提交」的——中途一旦 await 了事务外的 promise，事务就会先提交，
 * 因此这里的写入必须在同一个同步段里全部发出。查询请先在事务外做完。
 *
 * S2 起：`put` / `remove` 会各记一条队列记录（批内同键去重，后写覆盖先写），
 * 与业务写入在同一个事务里。`clear` 例外——它删的是整张表，语义上不属于「某条记录变了」，
 * 因此对用户数据仓库**要求显式 `{ track: false }`**，而不是悄悄漏记一批删除。
 */
export async function runTransaction(work: TransactionWork, options: WriteOptions = {}): Promise<void> {
  for (const item of work.put ?? []) assertRecord(item.store, item.value)

  const changes: OutboxChange[] = []
  if (options.track ?? true) {
    // 先删除、后写入：同一次调用里同一条记录既被删又被写时（「导入备份替换当前账号数据」正是这个形状），
    // 去重后应收敛成 `upsert`——记录最终是存在的。
    for (const item of work.remove ?? []) {
      if (isSyncableStore(item.store)) changes.push({ store: item.store, record_id: item.id, op: 'delete' })
    }
    for (const item of work.put ?? []) {
      if (isSyncableStore(item.store)) {
        changes.push({ store: item.store, record_id: item.value.id, op: 'upsert' })
      }
    }
    for (const storeName of work.clear ?? []) {
      if (isSyncableStore(storeName)) {
        throw new Error(
          `清空用户数据仓库（${storeName}）必须显式传 { track: false }，并自行保证云端一致。`,
        )
      }
    }
  }
  const tracked = dedupeChanges(changes)
  const entries = buildOutboxEntries(tracked, outboxOwner(options))

  const names = [
    ...new Set([
      ...(work.clear ?? []),
      ...(work.put ?? []).map((item) => item.store),
      ...(work.remove ?? []).map((item) => item.store),
      ...(entries.length ? (['sync_outbox'] as LocalStore[]) : []),
    ]),
  ]
  if (!names.length) return

  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(names, 'readwrite')
    const failure = new Error('写入本地数据库失败。')
    transaction.onerror = () => reject(transaction.error ?? failure)
    transaction.onabort = () => reject(transaction.error ?? failure)
    transaction.oncomplete = () => {
      resolve()
      if (entries.length) notifyOutboxChange()
    }

    for (const storeName of work.clear ?? []) {
      void guardRequest(transaction.objectStore(storeName).clear(), '清空本地数据失败。').catch(reject)
    }
    for (const item of work.remove ?? []) {
      void guardRequest(transaction.objectStore(item.store).delete(item.id), '删除本地数据失败。').catch(reject)
    }
    for (const item of work.put ?? []) {
      void guardRequest(transaction.objectStore(item.store).put(item.value), '写入本地数据库失败。').catch(reject)
    }
    writeOutbox(transaction, entries, (reason) =>
      reject(reason instanceof Error ? reason : new Error('写入本地数据库失败。')),
    )
  })
}

// ---------------------------------------------------------------- 事务内先读后写

/** 读请求 → promise。`get` 未命中时结果是 `undefined`，由调用方决定要不要折成 `null`。 */
function requestResult<T>(request: IDBRequest, fallback: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error(fallback))
    request.onsuccess = () => resolve(request.result as T)
  })
}

const READ_FAILED = '读取本地数据库失败。'

/**
 * 事务内的读接口。**只能在同一个事务里当场 await**：
 * 不要把它存起来、不要拿它去等事务外的任何东西（那会让事务先提交，见 `readModifyWrite`）。
 */
export type TransactionReader = {
  get: <T>(storeName: LocalStore, id: string) => Promise<T | null>
  getByIndex: <T>(storeName: LocalStore, indexName: string, key: IDBValidKey) => Promise<T | null>
  getAll: <T>(storeName: LocalStore) => Promise<T[]>
}

/**
 * **事务内的「先读后写」**（S4 补丁 ①）。
 *
 * ## 为什么需要它
 *
 * 在这之前，「读一条 → 算下一条 → 写回去」被拆成两次独立的调用，中间隔着事务边界。
 * 两个并发的调用会同时读到「不存在」，于是各建一条记录、各生成一个 id，
 * 第二条 `put` 撞上唯一索引，整个写入失败并冒泡到界面
 * （`Unable to add key to index 'user_date'`）。这不是理论问题：注册后落在休息日时，
 * 「自动建一份 rest 计划」与「界面上的首次写入」会同时发生。
 *
 * ## 为什么这样就够了
 *
 * IndexedDB 的事务**在创建那一刻就开始**，而不是发出第一个请求时；同一个对象仓库上的
 * 两个 `readwrite` 事务**串行执行**（第二个要等第一个结束才开始）。
 * 于是把读和写放进同一个事务之后，第二个调用读到的必然是第一个已经写好的结果，
 * 「两个人都以为不存在」这个前提在结构上就不成立了。
 *
 * ## 两条纪律
 *
 * 1. `read` 里只能 await **本事务**发出的请求。事务在「没有待处理请求」时自动提交，
 *    而 promise 回调是微任务（仍在同一个任务内），所以紧接着发下一个请求是安全的；
 *    一旦 await 了 `fetch` / `setTimeout` / 另一个事务，事务会先提交，后面的写入会抛 `TransactionInactiveError`。
 * 2. 校验（`assertRecord`）必须在**写入请求发出之前**完成。事务中途抛错时事务会照常提交，
 *    所以「先写进去、再发现字段不合法」会留下一条脏数据；本函数把顺序钉死为
 *    「读 → 算 → 校验 → 写」，校验不过时那条 `put` 根本不会发出去。
 *
 * `track` 语义与 `put` 一致：用户数据的写入会在同一事务里追加一条队列记录。
 */
export async function readModifyWrite<T extends { id: string }>(input: {
  /** 事务要带上的仓库（读的 + 写的）。`writeStore` 会自动并进来。 */
  stores: LocalStore[]
  writeStore: LocalStore
  /** 事务内的读：拿当前值（不存在给 `null`）。 */
  read: (tx: TransactionReader) => Promise<T | null>
  /** 由当前值算出要写的记录。**必须是纯计算**，不要在里面对事务发请求。 */
  build: (existing: T | null) => T
  track?: boolean
}): Promise<T> {
  const track = (input.track ?? true) && isSyncableStore(input.writeStore)
  const names = [
    ...new Set<LocalStore>([
      ...input.stores,
      input.writeStore,
      ...(track ? (['sync_outbox'] as LocalStore[]) : []),
    ]),
  ]

  const db = await database()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(names, 'readwrite')
    const failure = (reason: unknown) =>
      reject(reason instanceof Error ? reason : new Error('写入本地数据库失败。'))
    transaction.onerror = () => reject(transaction.error ?? new Error('写入本地数据库失败。'))
    transaction.onabort = () => reject(transaction.error ?? new Error('写入本地数据库被中止。'))

    let written: T | null = null
    let queued = false
    // 与 `put` 同口径：等事务真的提交了才算成功，中途被中止时不会先给出「已保存」。
    transaction.oncomplete = () => {
      if (!written) return
      resolve(written)
      if (queued) notifyOutboxChange()
    }

    const reader: TransactionReader = {
      get: <V>(storeName: LocalStore, id: string) =>
        requestResult<V | undefined>(transaction.objectStore(storeName).get(id), READ_FAILED).then(
          (value) => value ?? null,
        ),
      getByIndex: <V>(storeName: LocalStore, indexName: string, key: IDBValidKey) =>
        requestResult<V | undefined>(
          transaction.objectStore(storeName).index(indexName).get(key),
          READ_FAILED,
        ).then((value) => value ?? null),
      getAll: <V>(storeName: LocalStore) => requestResult<V[]>(transaction.objectStore(storeName).getAll(), READ_FAILED),
    }

    void (async () => {
      try {
        const existing = await input.read(reader)
        const next = input.build(existing)
        assertRecord(input.writeStore, next)
        const entries = buildOutboxEntries(
          track ? [{ store: input.writeStore as UserDataStore, record_id: next.id, op: 'upsert' }] : [],
          outboxOwner(input),
        )
        await guardRequest(transaction.objectStore(input.writeStore).put(next), '写入本地数据库失败。')
        writeOutbox(transaction, entries, failure)
        written = next
        queued = entries.length > 0
      } catch (reason) {
        failure(reason)
      }
    })()
  })
}
