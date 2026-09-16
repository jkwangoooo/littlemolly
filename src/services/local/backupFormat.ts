import type { DataError } from '../../shared/errors'
import type { LocalStore } from './localDb'
import { RECORD_SCHEMAS, SCHEMA_STORES, validateRecord } from './recordSchemas'

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
 *   "version": 1,
 *   "db_version": 4,
 *   "exported_at": "2026-09-15T02:30:00.000Z",
 *   "source_user": { "email": "someone@example.com" },
 *   "counts": { "day_plans": 3, "food_options": 6 },
 *   "records": { "day_plans": [ ... ], "food_options": [ ... ] }
 * }
 * ```
 */

/** 文件格式版本。`records` 的组织方式变了才提升；数据库结构版本另记 `db_version`。 */
export const BACKUP_FORMAT_VERSION = 1
/** 文件标记，用来一眼认出「这不是随便一个 JSON」。 */
export const BACKUP_FORMAT = 'local-backup'
export const BACKUP_APP = 'happy-little-molly'

/** 参与备份的仓库：与字段契约同源，漏一张表都会被 `check:local-data` 抓到。 */
export const BACKUP_STORES: LocalStore[] = [...SCHEMA_STORES]

/**
 * 只作文件自洽用途、不计入「数据条数」的仓库。
 * `users` 由账号体系管理：备份里带一条只为让外键校验能通过、并显示来源邮箱，
 * 导入时不会写入，也不会出现在「共 N 条」里。
 */
export const BACKUP_META_STORES: LocalStore[] = ['users']

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
  source_user: { email: string }
  counts: Record<string, number>
  records: Partial<Record<LocalStore, BackupRecord[]>>
}

export interface BackupSummary {
  /** 数据条数合计，不含元数据仓库。 */
  total: number
  /** 每个仓库的条数，只列非空仓库。 */
  counts: Partial<Record<LocalStore, number>>
  /** 来源账号邮箱（仅作展示：导入后数据归当前账号所有）。 */
  sourceEmail: string
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

function countRecords(records: Partial<Record<LocalStore, BackupRecord[]>>): {
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
export function parseBackup(text: string, currentDbVersion?: number): ValidatedBackup {
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

  const sourceEmail =
    isPlainObject(raw.source_user) && typeof raw.source_user.email === 'string' ? raw.source_user.email : ''

  if (!isPlainObject(raw.records)) fail('备份缺少 records 字段。')

  const known = new Set<string>(BACKUP_STORES)
  for (const key of Object.keys(raw.records)) {
    if (!known.has(key)) fail('备份里出现了当前版本不认识的仓库。', `未知仓库 ${key}`)
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

  const { counts, total } = countRecords(records)
  if (!total) fail('备份里没有任何数据。')

  const warnings: string[] = []
  if (typeof currentDbVersion === 'number' && raw.db_version !== currentDbVersion) {
    warnings.push(`备份由结构版本 ${raw.db_version} 的数据库导出，当前是 ${currentDbVersion}，导入后按当前结构使用。`)
  }

  const summary: BackupSummary = {
    total,
    counts,
    sourceEmail,
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
  sourceEmail: string
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
    source_user: { email: input.sourceEmail },
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

/** 供界面展示的一行摘要，例如「共 128 条（日计划 12 · 常用食物 6）」。 */
export function describeBackupSummary(summary: BackupSummary, labelOf: (store: LocalStore) => string): string {
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
  meta: { sourceEmail: string; exportedAt: string; dbVersion: number; formatVersion?: number; warnings?: string[] },
): BackupSummary {
  const { counts, total } = countRecords(records)
  return {
    total,
    counts,
    sourceEmail: meta.sourceEmail,
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