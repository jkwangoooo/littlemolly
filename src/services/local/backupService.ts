import type { DayPlan, DailyMeal, DailyMealItem } from '../../shared/types/dayPlan'
import { currentUser } from './authService'
import {
  BACKUP_META_STORES,
  BACKUP_STORES,
  buildBackup,
  parseBackup,
  serializeBackup,
  summarizeRecords,
  type BackupFile,
  type BackupRecord,
  type BackupSummary,
  type ValidatedBackup,
} from './backupFormat'
import { DB_VERSION, getAll, runTransaction, type LocalStore } from './localDb'
import { sanitizeRecord } from './recordSchemas'

/**
 * 本地数据导出 / 导入（L5）。
 *
 * 三条设计约束，都由「本地库是唯一数据源、丢了就没了」推出来：
 *
 * 1. **导出按账号**：只导出当前账号的记录，绝不把另一个本地账号的计划塞进你的备份文件。
 *    文件里额外带一条本账号的 `users` 记录，让文件自洽——导入时才能做关联完整性校验，
 *    界面也才有来源邮箱可显示。它不参与「共 N 条」的计数，也不会在导入时被写入。
 * 2. **导入先全量校验**：`parseBackup` 返回即代表整份文件可用；任一环节不通过就抛错，
 *    此时**一条记录都没写**，现有数据完好（docs/05 L5 的硬性要求）。
 * 3. **导入是「替换当前账号的数据」**：清掉本账号现有记录，再整体写入备份内容，
 *    两者在同一个事务里，不存在「删完了但没写进去」的中间态。其他本地账号不受影响。
 *    写入时 `user_id` 一律重映射为当前账号，因此换设备时可以「先注册、再导入」完成搬家。
 */

/** 只做类型标注，不引入额外模块：选项类记录这里只用到归属字段。 */
type UserOwnedRow = { id: string; user_id: string }

/** 导入时跳过写入的仓库：账号由登录 / 注册管理，不从备份文件里替换。 */
const IMPORT_SKIP_STORES = new Set<LocalStore>(BACKUP_META_STORES)

/** 带 `user_id` 的仓库：导入时统一重映射到当前账号。 */
const USER_SCOPED_STORES = new Set<LocalStore>([
  'day_plans',
  'food_options',
  'exercise_options',
  'supplement_templates',
])

export interface BackupExport {
  file: BackupFile
  text: string
  summary: BackupSummary
}

function requireUser(): { id: string; email: string } {
  const user = currentUser()
  if (!user) throw new Error('请先登录。')
  return { id: user.id, email: user.email }
}

/**
 * 导出当前账号的全部记录。
 *
 * 用 `sanitizeRecord` 而不是严格校验：v3 迁移有意把老库的 `daily_meals.plan_content`、
 * `day_plans.exercise_content` 留在原地（见 `localDb.ts` 的 `backfillSnapshots`），
 * 旧记录上这些字段依然存在。严格校验会让老用户**一条都导不出来**，恰好是最需要备份的人。
 * 清洗只丢掉新旧写入本来就会丢的字段，不触碰任何现存内容；丢弃项会计入警告。
 */
export async function exportBackup(): Promise<BackupExport> {
  const user = requireUser()
  const records: Partial<Record<LocalStore, BackupRecord[]>> = {}
  const dropped: string[] = []

  // 先取本账号的计划与餐次，子表靠这两级父键筛选；否则只能全表扫，还会串到别的账号。
  const plans = (await getAll<DayPlan>('day_plans')).filter((plan) => plan.user_id === user.id)
  const planIds = new Set(plans.map((plan) => plan.id))
  const meals = (await getAll<DailyMeal>('daily_meals')).filter((meal) => planIds.has(meal.day_plan_id))
  const mealIds = new Set(meals.map((meal) => meal.id))

  const picked: Array<{ store: LocalStore; rows: unknown[] }> = [
    { store: 'day_plans', rows: plans },
    { store: 'food_options', rows: (await getAll<UserOwnedRow>('food_options')).filter((row) => row.user_id === user.id) },
    { store: 'exercise_options', rows: (await getAll<UserOwnedRow>('exercise_options')).filter((row) => row.user_id === user.id) },
    {
      store: 'supplement_templates',
      rows: (await getAll<UserOwnedRow>('supplement_templates')).filter((row) => row.user_id === user.id),
    },
    { store: 'daily_meals', rows: meals },
    {
      store: 'daily_meal_items',
      rows: (await getAll<DailyMealItem>('daily_meal_items')).filter((item) => mealIds.has(item.daily_meal_id)),
    },
    { store: 'custom_tasks', rows: await rowsOfPlan('custom_tasks', planIds) },
    { store: 'daily_supplements', rows: await rowsOfPlan('daily_supplements', planIds) },
    { store: 'daily_exercise_items', rows: await rowsOfPlan('daily_exercise_items', planIds) },
    { store: 'routine_tasks', rows: await rowsOfPlan('routine_tasks', planIds) },
  ]

  for (const { store, rows } of picked) {
    const clean: BackupRecord[] = []
    for (const row of rows) {
      const result = sanitizeRecord(store, row as BackupRecord)
      for (const key of result.dropped) dropped.push(`${store}.${key}`)
      clean.push(result.value)
    }
    if (clean.length) records[store] = clean
  }

  // 自洽记录：任何一份导出的备份都至少带一条 `users`，否则外键校验无父可依。
  records.users = [{ id: user.id, email: user.email, password_hash: '', created_at: new Date(0).toISOString() }]

  const exportedAt = new Date().toISOString()
  const file = buildBackup({ dbVersion: DB_VERSION, exportedAt, sourceEmail: user.email, records })
  const text = serializeBackup(file)
  const warnings: string[] = []
  if (dropped.length) {
    const unique = [...new Set(dropped)]
    warnings.push(`有 ${unique.length} 个旧版本遗留字段未随备份导出，不影响内容与执行状态。`)
  }
  return { file, text, summary: summarizeRecords(records, { sourceEmail: user.email, exportedAt, dbVersion: DB_VERSION, warnings }) }
}

/** 按 `day_plan_id` 归属筛出子表记录。 */
async function rowsOfPlan(store: LocalStore, planIds: Set<string>): Promise<BackupRecord[]> {
  const rows = await getAll<BackupRecord>(store)
  return rows.filter((row) => planIds.has(String(row.day_plan_id)))
}

/**
 * 只做校验，不写库。界面用它先拿到「将要导入多少条」再弹确认框，
 * 避免用户点了导入才知道文件不对。
 *
 * 额外提示：`summary.total === 0` 表示这份备份没有可导入的内容（导入会被拒绝），
 * 界面应据此拦住用户，不要走到确认框。
 */
export function inspectBackup(text: string): ValidatedBackup {
  return parseBackup(text, DB_VERSION)
}

/**
 * 导入备份：整体替换当前账号的数据。
 *
 * 顺序是「先读、再校验、最后写」，中间任何一步失败都不写库。
 * 写入集中在同一个事务（`runTransaction`），删与写同生共死。
 */
export async function importBackup(text: string): Promise<BackupSummary> {
  const user = requireUser()
  const backup = parseBackup(text, DB_VERSION)

  // 1. 组装要写的记录：`user_id` 一律改归当前账号；`users` 不写（账号由登录 / 注册管理）。
  const puts: Array<{ store: LocalStore; value: { id: string } }> = []
  const remapped: Partial<Record<LocalStore, BackupRecord[]>> = {}
  for (const store of BACKUP_STORES) {
    if (IMPORT_SKIP_STORES.has(store)) continue
    const rows = backup.records[store]
    if (!rows?.length) continue
    const next: BackupRecord[] = []
    for (const row of rows) {
      const record = USER_SCOPED_STORES.has(store) ? { ...row, user_id: user.id } : { ...row }
      next.push(record)
      puts.push({ store, value: record as { id: string } })
    }
    remapped[store] = next
  }

  // 空备份若放行，等于「用一个没有内容的文件清空自己的数据」，风险与收益完全不对称。
  if (!puts.length) throw new Error('这份备份没有可导入的内容，已取消导入。')

  // 2. 事务外查出本账号现有记录 id（事务内只发写入请求，不能 await 别的东西）。
  const removals = await collectOwned(user.id)

  // 3. 单事务：先删本账号旧记录，再写备份内容。任一步失败整体回滚。
  await runTransaction({ remove: removals, put: puts })

  return summarizeRecords(remapped, {
    sourceEmail: backup.summary.sourceEmail,
    exportedAt: backup.summary.exportedAt,
    dbVersion: backup.summary.dbVersion,
    formatVersion: backup.summary.formatVersion,
    warnings: backup.summary.warnings,
  })
}

/** 当前账号在本地库里的全部记录 id，按仓库归类；用于导入前清空本账号数据。 */
async function collectOwned(userId: string): Promise<Array<{ store: LocalStore; id: string }>> {
  const owned: Array<{ store: LocalStore; id: string }> = []
  const plans = (await getAll<DayPlan>('day_plans')).filter((plan) => plan.user_id === userId)
  const planIds = new Set(plans.map((plan) => plan.id))
  const meals = (await getAll<DailyMeal>('daily_meals')).filter((meal) => planIds.has(meal.day_plan_id))
  const mealIds = new Set(meals.map((meal) => meal.id))

  for (const plan of plans) owned.push({ store: 'day_plans', id: plan.id })
  for (const meal of meals) owned.push({ store: 'daily_meals', id: meal.id })
  for (const item of await getAll<DailyMealItem>('daily_meal_items')) {
    if (mealIds.has(item.daily_meal_id)) owned.push({ store: 'daily_meal_items', id: item.id })
  }
  for (const store of ['food_options', 'exercise_options', 'supplement_templates'] as const) {
    for (const row of await getAll<UserOwnedRow>(store)) {
      if (row.user_id === userId) owned.push({ store, id: row.id })
    }
  }
  for (const store of ['custom_tasks', 'daily_supplements', 'daily_exercise_items', 'routine_tasks'] as const) {
    for (const row of await getAll<BackupRecord>(store)) {
      if (planIds.has(String(row.day_plan_id))) owned.push({ store, id: String(row.id) })
    }
  }
  return owned
}

/** 仓库总数口径，界面与脚本共用。 */
export const BACKUP_TOTAL_STORES = BACKUP_STORES.length