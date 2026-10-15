import type { DataError } from '../../shared/errors'
import type { LocalStore } from './localDb'
import { DEVICE_STORES, META_STORES, RECORD_SCHEMAS, SCHEMA_STORES, validateRecord } from './recordSchemas'

/**
 * 本地备份文件格式（L5）——纯数据层。
 *
 * 不碰 IndexedDB、不碰界面，因此可以在 Node 里被 `scripts/check-backup.mjs` 直接导入做回归。
 * 这一层与写入分离，正是「导入前全量校验」得以成立的前提：调用方拿到 `parseBackup` 的
 * 返回值，就意味着整份文件已通过检查，此前**一条记录都没写**（docs/05 L5 硬性要求）。
 *
 * 文件形状（`records` 用「仓库名 → 记录数组」，避免每条记录重复仓库名）：
 *
 * ```json
 * {
 *   "app": "happy-little-molly",
 *   "format": "local-backup",
 *   "version": 3,
 *   "db_version": 8,
 *   "exported_at": "2026-09-15T02:30:00.000Z",
 *   "source_user": { "username": "W" },
 *   "counts": { "day_plans": 3, "food_options": 6 },
 *   "records": { "day_plans": [ ... ], "food_options": [ ... ] }
 * }
 * ```
 *
 * 格式版本 1 与 2 的差别只有一处：登录凭据从「邮箱」改成「账号」，
 * 因此 `source_user.email` 与 `records.users[].email` 都改名为 `username`。
 * v3 移除 `users.password_hash`。v1/v2 只读兼容，旧凭据字段不会进入返回记录。
 */

/**
 * 文件格式版本。`records` 的组织方式或字段名变了才提升；数据库结构版本另记 `db_version`。
 *
 * v1 → v2：登录名从 `email` 改名 `username`。
 * v2 → v3：`users` 只保留资料字段，备份不携带密码。
 */
export const BACKUP_FORMAT_VERSION = 3
/** 文件标记，用来一眼认出「这不是随便一个 JSON」。 */
export const BACKUP_FORMAT = 'local-backup'
export const BACKUP_APP = 'happy-little-molly'

/**
 * 参与备份的仓库：**契约清单去掉设备状态**（10 张用户数据 + `users`），共 11 张。
 *
 * S2 起不再直接抄 `SCHEMA_STORES`：那个清单现在也包含 `sync_outbox` / `sync_state`
 * （本机的待上传队列与同步状态），抄进来会让备份文件里出现「这台设备的内部状态」，
 * 换台设备导入就是一堆没有意义的行。`check:backup` 会断言设备仓库一个都不在。
 *
 * 写法上刻意用「过滤」而不是「拼接」：`SCHEMA_STORES` 的键序就是摘要里
 * 「日计划 3 · 三餐 1 · 餐次内容 6」的排列顺序，拼接会把它改掉，
 * 而那是用户看得见的文案——S2 是管道改造，不该顺手动它。
 *
 * 为什么 `users` 仍在名单里：备份要能自洽——`day_plans.user_id` 必须能在
 * `records.users` 里找到父记录，外键校验才通得过（见 `FOREIGN_KEYS`），
 * 界面也才有来源账号可显示。它不参与「共 N 条」计数，导入时也不会被写入。
 */
export const BACKUP_STORES: LocalStore[] = SCHEMA_STORES.filter(
  (store) => !DEVICE_STORES.includes(store),
)

/**
 * 只作文件自洽用途、不计入「数据条数」的仓库。
 * `users` 由账号体系管理：备份里带一条只为让外键校验能通过、并显示来源账号，
 * 导入时不会写入，也不会出现在「共 N 条」里。
 */
export const BACKUP_META_STORES: LocalStore[] = [...META_STORES]

export type BackupRecord = Record<string, unknown>

/**
 * 备份里出现的仓库名（界面与脚本用的别名）。
 *
 * 对外只暴露这个别名，不让界面直接依赖 `localDb` 的 `LocalStore`：
 * 备份格式是两种后端共用的纯数据契约，界面不该因为「仓库名怎么定义」
 * 而被绑到 IndexedDB 那一侧（L6 门面化的同一条理由）。
 */
export type BackupStore = LocalStore

export interface BackupFile {
  app: string
  format: string
  version: number
  db_version: number
  exported_at: string
  source_user: { username: string }
  counts: Record<string, number>
  records: Partial<Record<LocalStore, BackupRecord[]>>
}

export interface BackupSummary {
  /** 数据条数合计，不含元数据仓库。 */
  total: number
  /** 每个仓库的条数，只列非空仓库。 */
  counts: Partial<Record<LocalStore, number>>
  /** 来源账号（仅作展示：导入后数据归当前账号所有）。 */
  sourceUsername: string
  exportedAt: string
  dbVersion: number
  formatVersion: number
  /** 用户可见的提醒，例如「备份来自更新的版本」。 */
  warnings: string[]
}

/** 一份已经过全量校验、可以直接写库的备份。 */
export interface ValidatedBackup {
  summary: BackupSummary
  /** 仓库 → 校验通过的记录（字段已确认齐备）。 */
  records: Partial<Record<LocalStore, BackupRecord[]>>
}

function fail(message: string, details?: string): never {
  const error = new Error(message) as DataError
  error.code = 'backup_invalid'
  if (details) error.details = details
  throw error
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 从 `source_user` 里读出来源账号。格式版本 1 用的字段名是 `email`，v2 起是 `username`；
 * 两种都认——它只用于展示，认错不会影响导入结果的正确性。
 */
function readSourceUsername(source: unknown, legacy: boolean): string {
  if (!isPlainObject(source)) return ''
  const value = legacy ? (source.username ?? source.email) : source.username
  return typeof value === 'string' ? value : ''
}

/**
 * 把 v1/v2 的 `users` 资料归一到 v3：v1 的 `email` 改为 `username`，并丢掉旧密码字段。
 *
 * 为什么必须做：`records.users` 也要逐条过字段契约，而契约里已经没有 `email` 了，
 * 旧备份会因为「多出未定义字段 email」+「缺少字段 username」被**整份拒绝**。
 * 手里只有一份旧备份的人，恰恰是最需要把它导进去的人（同 `sanitizeRecord` 那条理由）。
 *
 * 归一之后统一走 v3 的资料与业务校验，不存在第二条导入分支。
 * 旧备份只恢复数据，不能创建账号、修改密码或建立登录会话。
 */
function normalizeLegacyUserRows(records: Record<string, unknown>, version: number): void {
  const rows = records.users
  if (!Array.isArray(rows)) return
  records.users = rows.map((row) => {
    if (!isPlainObject(row)) return row
    const next: Record<string, unknown> = { ...row }
    if (version < 2) {
      next.username = row.username ?? row.email
      delete next.email
    }
    delete next.password_hash
    return next
  })
}

/**
 * 引用完整性：每条外键都必须能在备份内找到父记录。
 *
 * 少了这一步，坏备份会「格式合法但导入后页面空白」——三餐项挂在不存在的一餐上，
 * 界面既不报错也读不出内容，比直接拒绝导入更难排查。
 */
const FOREIGN_KEYS: Array<{ store: LocalStore; field: string; parent: LocalStore }> = [
  { store: 'day_plans', field: 'user_id', parent: 'users' },
  { store: 'food_options', field: 'user_id', parent: 'users' },
  { store: 'exercise_options', field: 'user_id', parent: 'users' },
  { store: 'supplement_templates', field: 'user_id', parent: 'users' },
  { store: 'daily_meals', field: 'day_plan_id', parent: 'day_plans' },
  { store: 'custom_tasks', field: 'day_plan_id', parent: 'day_plans' },
  { store: 'daily_supplements', field: 'day_plan_id', parent: 'day_plans' },
  { store: 'daily_exercise_items', field: 'day_plan_id', parent: 'day_plans' },
  { store: 'routine_tasks', field: 'day_plan_id', parent: 'day_plans' },
  { store: 'daily_meal_items', field: 'daily_meal_id', parent: 'daily_meals' },
]

/**
 * 数一份记录集合的条数。
 *
 * 同步状态和整体替换需要判断「当前 Auth UID 的本机或云端有多少条数据」，
 * 那个数字必须与备份摘要里的 `total` **是同一个口径**——
 * 否则会出现「界面说本地有 12 条，导出的备份却说 10 条」这种自相矛盾。
 * 元数据仓库（`users`）不计入，与 `BackupSummary.total` 的注释一致。
 */
export function countRecords(records: Partial<Record<LocalStore, BackupRecord[]>>): {
  counts: Partial<Record<LocalStore, number>>
  total: number
} {
  const counts: Partial<Record<LocalStore, number>> = {}
  let total = 0
  for (const store of BACKUP_STORES) {
    const rows = records[store]
    if (!rows?.length || BACKUP_META_STORES.includes(store)) continue
    counts[store] = rows.length
    total += rows.length
  }
  return { counts, total }
}

/**
 * 解析并全量校验一段备份文本。
 *
 * 任何问题都以带 `code = 'backup_invalid'` 的错误抛出，**不返回半成品**：
 * 拿到返回值就意味着「这份备份可以整体写入」。
 *
 * `currentDbVersion` 传入当前数据库结构版本（可选）。只在两边不一致时给一条提醒，
 * 不因此拒绝导入——记录本身已经逐条按当前契约校验过了。
 */
export function parseBackup(
  text: string,
  currentDbVersion?: number,
  options: { allowEmpty?: boolean } = {},
): ValidatedBackup {
  if (typeof text !== 'string' || !text.trim()) fail('备份内容为空。')

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (reason) {
    fail('备份内容不是合法的 JSON。', reason instanceof Error ? reason.message : undefined)
  }
  if (!isPlainObject(raw)) fail('备份内容必须是一个 JSON 对象。')

  if (raw.app !== BACKUP_APP) fail('这不是「幸福小Molly」的备份文件。', `文件标记 app = ${String(raw.app)}`)
  if (raw.format !== BACKUP_FORMAT) fail('文件格式标记不正确，无法确认是可导入的备份。')
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    fail('备份格式版本号无效。')
  }
  if (raw.version > BACKUP_FORMAT_VERSION) {
    fail('备份来自更新的版本，当前版本无法读取。', `备份格式版本 ${raw.version}，当前支持到 ${BACKUP_FORMAT_VERSION}`)
  }
  if (typeof raw.db_version !== 'number' || !Number.isInteger(raw.db_version) || raw.db_version < 1) {
    fail('备份缺少有效的数据库结构版本号。')
  }
  if (typeof raw.exported_at !== 'string' || !raw.exported_at) fail('备份缺少导出时间。')

  /** 格式版本 1 的登录名字段是 `email`，读入时归一（见 `normalizeLegacyUserRows`）。 */
  const legacy = raw.version < 2
  const sourceUsername = readSourceUsername(raw.source_user, legacy)

  if (!isPlainObject(raw.records)) fail('备份缺少 records 字段。')
  if (raw.version < 3) normalizeLegacyUserRows(raw.records, raw.version)

  const known = new Set<string>(BACKUP_STORES)
  for (const key of Object.keys(raw.records)) {
    if (!known.has(key)) {
      if (key === 'legacy_users') fail('新格式备份不得包含任何身份凭据。', 'legacy_users 不允许导入')
      fail('备份里出现了当前版本不认识的仓库。', `未知仓库 ${key}`)
    }
  }

  const records: Partial<Record<LocalStore, BackupRecord[]>> = {}
  for (const store of BACKUP_STORES) {
    const rows = raw.records[store]
    if (rows === undefined) continue
    if (!Array.isArray(rows)) fail(`仓库 ${store} 的内容不是数组。`)

    const checked: BackupRecord[] = []
    const seen = new Set<string>()
    for (const [index, row] of rows.entries()) {
      if (!isPlainObject(row)) fail(`仓库 ${store} 的第 ${index + 1} 条不是对象。`)
      const issues = validateRecord(store, row)
      if (issues.length) {
        fail(`备份数据格式不正确（${store} 第 ${index + 1} 条）。`, issues.slice(0, 3).join('；'))
      }
      const id = String(row.id)
      if (seen.has(id)) fail(`备份里出现重复主键（${store}：${id}）。`)
      seen.add(id)
      checked.push(row)
    }
    records[store] = checked
  }

  // 同一天同一账号只能有一份计划（`day_plans` 的 user_date 唯一索引）。手改过的备份若违反，
  // 写入会在事务里撞约束并整体回滚；这里提前拦下，用户能看到具体是哪一天。
  const dayKeys = new Set<string>()
  for (const plan of records.day_plans ?? []) {
    const key = `${String(plan.user_id)}@${String(plan.plan_date)}`
    if (dayKeys.has(key)) fail('备份里同一天有重复的计划。', `日期 ${String(plan.plan_date)} 出现多份计划`)
    dayKeys.add(key)
  }

  const idsOf = (store: LocalStore): Set<string> => new Set((records[store] ?? []).map((row) => String(row.id)))
  if ((records.users?.length ?? 0) !== 1) {
    fail('备份必须属于一个明确的来源账号。', 'users 元数据必须恰好包含一条资料记录')
  }
  for (const link of FOREIGN_KEYS) {
    const rows = records[link.store] ?? []
    if (!rows.length) continue
    const parents = idsOf(link.parent)
    if (!parents.size) {
      fail('备份缺少关联的父记录。', `${link.store} 需要 ${link.parent}，但备份里没有对应数据`)
    }
    for (const row of rows) {
      const value = row[link.field]
      if (typeof value !== 'string' || !parents.has(value)) {
        fail('备份里的关联关系已断裂。', `${link.store}.${link.field} 指向不存在的 ${link.parent}：${String(value)}`)
      }
    }
  }

  // 选项引用与快照父链必须属于同一来源；缺失来源请显式使用 null。
  const planOwners = new Map((records.day_plans ?? []).map((row) => [String(row.id), String(row.user_id)]))
  const mealPlans = new Map((records.daily_meals ?? []).map((row) => [String(row.id), String(row.day_plan_id)]))
  for (const link of [
    { store: 'daily_meal_items', field: 'food_option_id', parent: 'food_options', meal: true },
    { store: 'daily_exercise_items', field: 'exercise_option_id', parent: 'exercise_options', meal: false },
  ] as const) {
    const parents = new Map((records[link.parent] ?? []).map((row) => [String(row.id), row]))
    for (const row of records[link.store] ?? []) {
      const value = row[link.field]
      if (value === null) continue
      const parent = parents.get(String(value))
      const planId = link.meal ? mealPlans.get(String(row.daily_meal_id)) : String(row.day_plan_id)
      const owner = planId ? planOwners.get(planId) : undefined
      if (!parent || !owner || parent.user_id !== owner) {
        fail('备份里的选项引用无效或归属不一致。', `${link.store}.${link.field}：${String(value)}`)
      }
    }
  }

  const { counts, total } = countRecords(records)
  if (!total && !options.allowEmpty) fail('备份里没有任何数据。')

  const warnings: string[] = []
  if (legacy) {
    warnings.push('备份是旧版格式（登录名字段为 email），已按当前的账号格式读取，内容不受影响。')
  }
  if (raw.version < 3) {
    warnings.push('旧备份中的密码字段已忽略；导入只恢复业务数据，不创建账号或登录会话。')
  }
  if (typeof currentDbVersion === 'number' && raw.db_version !== currentDbVersion) {
    warnings.push(`备份由结构版本 ${raw.db_version} 的数据库导出，当前是 ${currentDbVersion}，导入后按当前结构使用。`)
  }

  const summary: BackupSummary = {
    total,
    counts,
    sourceUsername,
    exportedAt: raw.exported_at,
    dbVersion: raw.db_version,
    formatVersion: raw.version,
    warnings,
  }

  return { summary, records }
}

/** 组装备份文件对象（导出侧）。字段顺序固定，便于人眼比对与 diff。 */
export function buildBackup(input: {
  dbVersion: number
  exportedAt: string
  sourceUsername: string
  records: Partial<Record<LocalStore, BackupRecord[]>>
}): BackupFile {
  const counts: Record<string, number> = {}
  for (const store of BACKUP_STORES) {
    const rows = input.records[store]
    if (rows?.length) counts[store] = rows.length
  }
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    db_version: input.dbVersion,
    exported_at: input.exportedAt,
    source_user: { username: input.sourceUsername },
    counts,
    records: input.records,
  }
}

/** 序列化成可下载 / 可复制的文本。缩进 2 空格：备份是给人看的最后一道防线。 */
export function serializeBackup(file: BackupFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/** 备份文件名，日期取导出时间在 `Asia/Shanghai` 的那一天。 */
export function backupFileName(exportedAt: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(exportedAt))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `happy-little-molly-备份-${values.year}-${values.month}-${values.day}.json`
}

/**
 * 供界面展示的一行摘要，例如「共 128 条（日计划 12 · 常用食物 6）」。
 *
 * 参数收成结构类型（而不是只收 `BackupSummary`）是 S5 的事：整体替换的
 * 条数摘要（`ReplaceCounts`）形状与它一致，界面因此可以复用同一句话的拼装，
 * 不必再写一个「条数 + 仓库名」的渲染函数——那种复制出来的第二份，
 * 迟早会在某次改文案时漏掉一边。
 */
export function describeBackupSummary(
  summary: { total: number; counts: Partial<Record<LocalStore, number>> },
  labelOf: (store: LocalStore) => string,
): string {
  const parts = Object.entries(summary.counts)
    .filter(([, count]) => count > 0)
    .map(([store, count]) => `${labelOf(store as LocalStore)} ${count}`)
  return parts.length ? `共 ${summary.total} 条（${parts.join(' · ')}）` : '没有数据'
}

/** 仓库总数，供回归脚本与界面共用同一口径。 */
export const BACKUP_STORE_COUNT = BACKUP_STORES.length

/**
 * 汇总一份记录集合，得到界面要展示的摘要。
 * 导出侧与导入侧都用它，保证「导入前后的条数口径」完全一致。
 */
export function summarizeRecords(
  records: Partial<Record<LocalStore, BackupRecord[]>>,
  meta: { sourceUsername: string; exportedAt: string; dbVersion: number; formatVersion?: number; warnings?: string[] },
): BackupSummary {
  const { counts, total } = countRecords(records)
  return {
    total,
    counts,
    sourceUsername: meta.sourceUsername,
    exportedAt: meta.exportedAt,
    dbVersion: meta.dbVersion,
    formatVersion: meta.formatVersion ?? BACKUP_FORMAT_VERSION,
    warnings: meta.warnings ?? [],
  }
}

/** 某仓库是否有字段契约。避免调用方自己拼 `RECORD_SCHEMAS[...]`。 */
export function hasSchema(store: LocalStore): boolean {
  return Boolean(RECORD_SCHEMAS[store])
}
