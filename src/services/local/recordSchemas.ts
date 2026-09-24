import type { DataError } from '../../shared/errors'
import type { LocalStore, UserDataStore } from './localDb'

/**
 * 本地记录的字段契约（L5 加固）。
 *
 * 目的：把「写坏数据」挡在服务层，而不是等界面上出现空白或崩溃。
 * 本模块只做纯数据判断，不碰 IndexedDB，因此 `scripts/check-local-data.mjs`
 * 与 `scripts/check-backup.mjs` 可以在 Node 里直接导入它做回归。
 *
 * 三条规则：
 * 1. 与 `localDb.ts` 的仓库清单一一对应：契约里少一个、多一个仓库都算错
 *    （`check:local-data` 会强制两者同改）；
 * 2. 记录必须是普通对象，字段不多不少、类型正确——多出来的字段一律拒绝，
 *    因为本地库里出现未定义字段，通常意味着某处绕开了服务层直接写库；
 * 3. 主键 `id` 必须是非空字符串，时间戳必须是 ISO 字符串，业务日期必须是 `YYYY-MM-DD`。
 */

export type FieldRule = {
  type: 'string' | 'number' | 'boolean'
  /** 允许 null（例如「没有来源选项」的 `food_option_id`）。 */
  nullable?: boolean
  /** 取值白名单（枚举字段）。 */
  oneOf?: readonly string[]
  /** 字符串形状：业务日期键 `YYYY-MM-DD`；时间戳 ISO 字符串。 */
  format?: 'date' | 'datetime'
}

const TEXT: FieldRule = { type: 'string' }
const FLAG: FieldRule = { type: 'boolean' }
const ORDER: FieldRule = { type: 'number' }
const DATE_KEY: FieldRule = { type: 'string', format: 'date' }
const TIMESTAMP: FieldRule = { type: 'string', format: 'datetime' }
/** 可选来源选项：有值时是选项 id，没有来源选项时为 null。 */
const OPTIONAL_ID: FieldRule = { type: 'string', nullable: true }

const MODE: FieldRule = { type: 'string', oneOf: ['work', 'rest'] }
const MEAL_TYPE: FieldRule = { type: 'string', oneOf: ['breakfast', 'lunch', 'dinner'] }
const PERIOD: FieldRule = { type: 'string', oneOf: ['morning', 'noon', 'evening'] }
const DECISION: FieldRule = { type: 'string', oneOf: ['undecided', 'exercise', 'rest'] }
const ROUTINE_KIND: FieldRule = { type: 'string', oneOf: ['mop', 'laundry'] }
/** 允许为 null 的自由文本（例如「还没有失败过」的 `last_error`）。 */
const OPTIONAL_TEXT: FieldRule = { type: 'string', nullable: true }
/** 允许为 null 的时间戳（例如「还没推送过」的 `last_push_at`）。 */
const OPTIONAL_TIMESTAMP: FieldRule = { type: 'string', format: 'datetime', nullable: true }
const OUTBOX_OP: FieldRule = { type: 'string', oneOf: ['upsert', 'delete'] }

// ---------------------------------------------------------------- 仓库三分类（S2）

/**
 * 仓库三分类：**用户数据 / 元数据 / 设备状态**。
 *
 * 为什么要拆：在这之前 `SCHEMA_STORES` 一个常量同时驱动「字段契约」「备份仓库」
 * 两件事，`sync_outbox` / `sync_state` 一旦进来就会自动混进备份文件，
 * 并且 `check:local-data` 也会把设备状态当成业务数据去数。拆开之后两者互不干扰。
 *
 * - `user`：真正的用户数据。进备份、进同步队列。
 * - `meta`：`users`。只用于备份的外键自洽与来源账号展示；**不进同步**——
 *   本地账号是应用身份，云端账号是侧挂绑定，本地密码（djb2）不迁移（决策 D5）。
 * - `device`：`sync_outbox` / `sync_state`。纯粹的本机状态，不进备份、不同步。
 *
 * 这张表是**穷尽的**：`Record<LocalStore, ...>` 要求 13 张仓库一张不落，
 * 少写一张 TypeScript 直接报错，所以三分类永远不会与 `LocalStore` 走散。
 */
const STORE_KIND: Record<LocalStore, 'user' | 'meta' | 'device'> = {
  // ---- 用户数据：进备份、进同步 ----
  day_plans: 'user',
  daily_meals: 'user',
  custom_tasks: 'user',
  food_options: 'user',
  supplement_templates: 'user',
  exercise_options: 'user',
  daily_meal_items: 'user',
  daily_supplements: 'user',
  daily_exercise_items: 'user',
  routine_tasks: 'user',
  // ---- 元数据：只服务备份自洽与账号展示 ----
  users: 'meta',
  // ---- 设备状态：本机自己的账本 ----
  sync_outbox: 'device',
  sync_state: 'device',
}

function storesOfKind(kind: 'user' | 'meta' | 'device'): LocalStore[] {
  return (Object.keys(STORE_KIND) as LocalStore[]).filter((name) => STORE_KIND[name] === kind)
}

/** 参与备份与同步的用户数据仓库（10 张）。 */
export const USER_DATA_STORES: LocalStore[] = storesOfKind('user')
/** 只用于备份外键自洽与来源账号展示（`users`）。 */
export const META_STORES: LocalStore[] = storesOfKind('meta')
/** 本机状态：不进备份、不进同步队列。 */
export const DEVICE_STORES: LocalStore[] = storesOfKind('device')
/** 全部仓库（13 张），顺序为「用户数据 → 元数据 → 设备状态」。 */
export const ALL_STORES: LocalStore[] = Object.keys(STORE_KIND) as LocalStore[]

/** 同步队列里只可能出现用户数据仓库；元数据与设备状态永远不参与同步。 */
export function isSyncableStore(storeName: LocalStore): storeName is UserDataStore {
  return STORE_KIND[storeName] === 'user'
}

/**
 * 13 张对象仓库的字段契约。
 * 时间字段统一用 ISO 字符串；`note` / `morning_focus` 这类自由文本允许空串。
 */
export const RECORD_SCHEMAS: Record<LocalStore, Record<string, FieldRule>> = {
  users: { id: TEXT, username: TEXT, password_hash: TEXT, created_at: TIMESTAMP },

  day_plans: {
    id: TEXT,
    user_id: TEXT,
    plan_date: DATE_KEY,
    mode: MODE,
    mode_override: FLAG,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    outfit_ready: FLAG,
    meals_ready: FLAG,
    supplements_ready: FLAG,
    morning_ready: FLAG,
    exercise_ready: FLAG,
    morning_focus: TEXT,
    morning_completed: FLAG,
    exercise_decision: DECISION,
    exercise_note: TEXT,
    exercise_completed: FLAG,
  },

  daily_meals: { id: TEXT, day_plan_id: TEXT, meal_type: MEAL_TYPE, note: TEXT, completed: FLAG },

  daily_meal_items: {
    id: TEXT,
    daily_meal_id: TEXT,
    food_option_id: OPTIONAL_ID,
    food_name_snapshot: TEXT,
    sort_order: ORDER,
    created_at: TIMESTAMP,
  },

  custom_tasks: { id: TEXT, day_plan_id: TEXT, task_time: TEXT, title: TEXT, note: TEXT, completed: FLAG },

  food_options: {
    id: TEXT,
    user_id: TEXT,
    name: TEXT,
    active: FLAG,
    sort_order: ORDER,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  },

  exercise_options: {
    id: TEXT,
    user_id: TEXT,
    name: TEXT,
    active: FLAG,
    sort_order: ORDER,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  },

  supplement_templates: {
    id: TEXT,
    user_id: TEXT,
    name: TEXT,
    period: PERIOD,
    active: FLAG,
    sort_order: ORDER,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  },

  daily_supplements: {
    id: TEXT,
    day_plan_id: TEXT,
    name_snapshot: TEXT,
    period: PERIOD,
    planned: FLAG,
    completed: FLAG,
    sort_order: ORDER,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  },

  daily_exercise_items: {
    id: TEXT,
    day_plan_id: TEXT,
    exercise_option_id: OPTIONAL_ID,
    name_snapshot: TEXT,
    sort_order: ORDER,
    created_at: TIMESTAMP,
  },

  routine_tasks: { id: TEXT, day_plan_id: TEXT, kind: ROUTINE_KIND, title: TEXT, completed: FLAG },

  /**
   * 出站队列（S2）。**只记「哪条记录变了」，不存数据副本**：
   * 推送时按 `record_id` 回主表读当前行，拿到的永远是最后写入的值；
   * 若在这里存 `payload`，副本会与主表分叉，而且契约系统只认标量字段，
   * 存一份任意形状的对象会逼着放宽整张表的校验。
   */
  sync_outbox: {
    id: TEXT,
    seq: ORDER,
    /** 只可能是用户数据仓库——`users` 与 `sync_*` 都不进队列。 */
    store: { type: 'string', oneOf: USER_DATA_STORES },
    record_id: TEXT,
    op: OUTBOX_OP,
    /**
     * 归属的本地账号 id（S4 补丁 ②）。推送时按它过滤（`outboxRules.entriesOfOwner`），
     * 免得换过账号之后把上一个账号的改动推到这个账号绑定的云端。
     * `null` 表示写入时读不到会话（迁移期 / Node 脚本），这类条目永不被推送。
     */
    local_user_id: OPTIONAL_TEXT,
    created_at: TIMESTAMP,
    attempts: ORDER,
    last_error: OPTIONAL_TEXT,
  },

  /**
   * 同步状态（**按本地账号一行**，`id` 就是本地账号 id，v7 起）。
   *
   * 早先是设备级单行（`id` 恒为 `singleton`），那样换本地账号后新账号会读到
   * 上一任的云端绑定，把自己的数据推到别人的云端账号里——见 `localDb.ts` 的 v7 迁移。
   *
   * `last_error` 在方案里是一个 `{ message, at }` 对象，这里**摊平成两列**：
   * 字段契约只支持标量，嵌套对象会让 `validateRecord` 无法表达。
   */
  sync_state: {
    id: TEXT,
    enabled: FLAG,
    cloud_user_id: OPTIONAL_TEXT,
    cloud_email: OPTIONAL_TEXT,
    device_id: TEXT,
    bound_at: OPTIONAL_TIMESTAMP,
    last_push_at: OPTIONAL_TIMESTAMP,
    last_restore_at: OPTIONAL_TIMESTAMP,
    last_error_message: OPTIONAL_TEXT,
    last_error_at: OPTIONAL_TIMESTAMP,
    updated_at: TIMESTAMP,
  },
}

/** `YYYY-MM-DD`，并且必须能被 Date 解析成真实日期（排除 2026-02-30 这类）。 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
/** ISO 8601 时间戳，例如 `2026-09-15T02:30:00.000Z`。 */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidDateKey(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** 收集一条记录的全部字段问题；空数组表示合法。 */
export function validateRecord(storeName: LocalStore, value: unknown): string[] {
  const issues: string[] = []
  if (!isPlainObject(value)) return ['记录不是普通对象']

  const schema = RECORD_SCHEMAS[storeName]
  const allowed = new Set(Object.keys(schema))

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`出现未定义字段 ${key}`)
  }

  for (const [key, rule] of Object.entries(schema)) {
    if (!(key in value)) {
      issues.push(`缺少字段 ${key}`)
      continue
    }
    const field = value[key]

    if (field === null) {
      if (!rule.nullable) issues.push(`字段 ${key} 不允许为空`)
      continue
    }
    if (rule.nullable && field === undefined) continue

    const actual = typeof field
    if (actual !== rule.type) {
      issues.push(`字段 ${key} 应为 ${rule.type}，实际是 ${actual}`)
      continue
    }
    if (rule.type === 'string') {
      const text = field as string
      if (key === 'id' && !text) issues.push('主键 id 不能为空')
      if (rule.oneOf && !rule.oneOf.includes(text)) issues.push(`字段 ${key} 只能是 ${rule.oneOf.join(' / ')}`)
      if (rule.format === 'date' && !isValidDateKey(text)) issues.push(`字段 ${key} 不是合法的业务日期（应形如 2026-09-15）`)
      if (rule.format === 'datetime' && !TIMESTAMP_PATTERN.test(text)) issues.push(`字段 ${key} 不是合法的 ISO 时间戳`)
    }
    if (rule.type === 'number' && !Number.isFinite(field as number)) {
      issues.push(`字段 ${key} 不是有限数字`)
    }
  }

  return issues
}

/** 写入前调用：不合法就抛出带 `code` 的错误，由界面统一展示。 */
export function assertRecord(storeName: LocalStore, value: unknown): void {
  const issues = validateRecord(storeName, value)
  if (!issues.length) return
  const error = new Error(`本地数据格式不正确（${storeName}）：${issues.slice(0, 3).join('；')}`) as DataError
  error.code = 'local_record_invalid'
  error.details = issues.join('；')
  throw error
}

/**
 * 导出专用：丢掉契约之外的字段，返回干净记录与被丢弃的字段名。
 *
 * 为什么导出要清洗而不直接拒绝：v3 迁移有意把老库的 `daily_meals.plan_content`、
 * `day_plans.exercise_content` 留在原地（见 `localDb.ts` 的 `backfillSnapshots` 注释），
 * 这些字段在旧记录上依然存在。若导出按写入标准严格校验，老用户会**导出不出任何备份**——
 * 恰好是最需要备份的那批人。新旧写入本来就会丢掉这些字段，清洗不影响任何现存内容。
 *
 * 注意：导入侧仍然严格（见 `backupFormat.ts`），备份文件里出现未知字段一律拒绝。
 */
export function sanitizeRecord(
  storeName: LocalStore,
  value: Record<string, unknown>,
): { value: Record<string, unknown>; dropped: string[] } {
  const schema = RECORD_SCHEMAS[storeName]
  const clean: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, field] of Object.entries(value)) {
    if (key in schema) clean[key] = field
    else dropped.push(key)
  }
  return { value: clean, dropped }
}

/**
 * 契约覆盖的仓库清单，供回归脚本断言「不漏表」。
 *
 * 与 `ALL_STORES` 是同一个集合（13 张）——只是取值路径不同：这里从契约对象取键，
 * 那里从三分类表取键。两边都由 `Record<LocalStore, ...>` 兜底，
 * `check:sync` 再断言一次「两者相等」，避免将来有人只改了一边。
 */
export const SCHEMA_STORES: LocalStore[] = Object.keys(RECORD_SCHEMAS) as LocalStore[]