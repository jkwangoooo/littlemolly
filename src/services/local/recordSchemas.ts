import type { DataError } from '../../shared/errors'
import type { LocalStore } from './localDb'

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

/**
 * 11 张对象仓库的字段契约。
 * 时间字段统一用 ISO 字符串；`note` / `morning_focus` 这类自由文本允许空串。
 */
export const RECORD_SCHEMAS: Record<LocalStore, Record<string, FieldRule>> = {
  users: { id: TEXT, email: TEXT, password_hash: TEXT, created_at: TIMESTAMP },

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

/** 契约覆盖的仓库清单，供回归脚本断言「不漏表」。 */
export const SCHEMA_STORES: LocalStore[] = Object.keys(RECORD_SCHEMAS) as LocalStore[]