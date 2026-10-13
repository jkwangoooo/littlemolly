<<<<<<< HEAD
import {
  assertAuthContextCurrent,
  captureAuthContext,
  readSession,
} from '../session'
=======
import type { DayPlan, DailyMeal, DailyMealItem } from '../../shared/types/dayPlan'
import { currentUser } from './authService'
>>>>>>> origin/main
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
<<<<<<< HEAD
import {
  atomicReadWrite, DB_VERSION, readTransaction, type LocalStore, type TransactionWork,
} from './localDb'
import type { OutboxEntry } from './outboxRules'
import { sanitizeRecord, USER_DATA_STORES } from './recordSchemas'
import {
  assertNoIdCollisions, assertWorkspaceGraph, OWNER_STORES,
  readWorkspaceRecords, selectWorkspaceRecords, type WorkspaceRecords,
} from './workspaceRecords'
import {
  mergeWorkspaceSyncState, type LocalProfile, type WorkspaceState,
  type WorkspaceSyncPatch, type WorkspaceSyncState,
} from './workspaceService'
=======
import { DB_VERSION, getAll, runTransaction, type LocalStore } from './localDb'
import { sanitizeRecord } from './recordSchemas'
>>>>>>> origin/main

/**
 * 本地数据导出 / 导入（L5）。
 *
<<<<<<< HEAD
 * 三条设计约束：业务写入先落本机，备份只恢复数据，不管理认证身份。
 *
 * 1. **导出按 UID**：只导出当前 Auth UID 的记录，不包含其他工作区的数据。
 *    文件里额外带一条本账号的 `users` 记录，让文件自洽——导入时才能做关联完整性校验，
 *    界面也才有来源账号可显示。它不参与「共 N 条」的计数，也不会在导入时被写入。
 * 2. **导入先全量校验**：`parseBackup` 返回即代表整份文件可用；任一环节不通过就抛错，
 *    此时**一条记录都没写**，现有数据完好（docs/05 L5 的硬性要求）。
 * 3. **导入是「替换当前 UID 的数据」**：清掉当前工作区的记录，再整体写入备份内容，
 *    两者在同一个事务里，不存在「删完了但没写进去」的中间态。其他 UID 的数据不受影响。
 *    写入时 `user_id` 一律重映射为当前 Auth UID；新设备登录同一账号后可恢复云端或导入备份。
 */

/** 导入时跳过来源资料；认证身份由 Supabase Auth 管理，不从备份文件里创建或替换。 */
const IMPORT_SKIP_STORES = new Set<LocalStore>(BACKUP_META_STORES)

=======
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

>>>>>>> origin/main
export interface BackupExport {
  file: BackupFile
  text: string
  summary: BackupSummary
<<<<<<< HEAD
  /** 与业务导出同一快照的队列 ID，仅供成功的整体上传退役对应条目。 */
  outboxIds: string[]
}

export type BackupOwnerOptions = {
  owner?: string
  ownerUid?: string
  username?: string
  guard?: () => void
}

function captureOwner(options: BackupOwnerOptions): { owner: string; username: string; guard: () => void } {
  if (options.owner && options.ownerUid && options.owner !== options.ownerUid) {
    throw new Error('备份操作的两个 owner 参数不一致。')
  }
  const explicit = options.owner ?? options.ownerUid
  if (explicit) {
    if (!options.guard) throw new Error('指定工作区的备份操作必须提供身份代次守卫。')
    options.guard()
    return { owner: explicit, username: options.username ?? '', guard: options.guard }
  }
  const context = captureAuthContext()
  const user = readSession()?.user
  if (!user || user.id !== context.owner) throw new Error('请先登录。')
  return {
    owner: context.owner,
    username: user.username,
    guard: () => { assertAuthContextCurrent(context); options.guard?.() },
  }
=======
}

function requireUser(): { id: string; email: string } {
  const user = currentUser()
  if (!user) throw new Error('请先登录。')
  return { id: user.id, email: user.email }
>>>>>>> origin/main
}

/**
 * 导出当前账号的全部记录。
 *
 * 用 `sanitizeRecord` 而不是严格校验：v3 迁移有意把老库的 `daily_meals.plan_content`、
 * `day_plans.exercise_content` 留在原地（见 `localDb.ts` 的 `backfillSnapshots`），
 * 旧记录上这些字段依然存在。严格校验会让老用户**一条都导不出来**，恰好是最需要备份的人。
 * 清洗只丢掉新旧写入本来就会丢的字段，不触碰任何现存内容；丢弃项会计入警告。
 */
<<<<<<< HEAD
export async function exportBackup(options: BackupOwnerOptions = {}): Promise<BackupExport> {
  const captured = captureOwner(options)
  const { records, dropped, profile, outboxIds } = await collectSnapshot(captured)

  // 自洽记录：任何一份导出的备份都至少带一条 `users`，否则外键校验无父可依。
  const username = profile?.username ?? captured.username
  records.users = [{
    id: captured.owner, username,
    created_at: profile?.created_at ?? new Date(0).toISOString(),
  }]

  const exportedAt = new Date().toISOString()
  const file = buildBackup({ dbVersion: DB_VERSION, exportedAt, sourceUsername: username, records })
=======
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
>>>>>>> origin/main
  const text = serializeBackup(file)
  const warnings: string[] = []
  if (dropped.length) {
    const unique = [...new Set(dropped)]
    warnings.push(`有 ${unique.length} 个旧版本遗留字段未随备份导出，不影响内容与执行状态。`)
  }
<<<<<<< HEAD
  return {
    file,
    text,
    outboxIds,
    summary: summarizeRecords(records, { sourceUsername: username, exportedAt, dbVersion: DB_VERSION, warnings }),
  }
}

/**
 * 取当前账号的全部业务记录（10 张用户数据表）。
 *
 * 从 `exportBackup` 里抽出来（S3），因为「当前账号有哪些数据」这个问题现在有三个消费者：
 * 1. 本地备份导出（`exportBackup`）；
 * 2. 显示当前 UID 的本机数据条数（`sync/status.ts`）；
 * 3. S5「本地上传云端」的整体替换取数（`sync/replaceCloud.ts`，`docs/18 §5.4` 已预告复用）。
 *
 * 三处各写一遍筛选规则必然分叉，而这里恰恰是最容易写错的一段：
 * 子表没有 `user_id`，归属要**沿父键逐级推导**——`daily_meals` 靠 `day_plans.id`、
 * `daily_meal_items` 靠 `daily_meals.id`。少推一级就会把别的账号的数据算进来，
 * 或者反过来漏掉自己的数据（表现为「明明有记录却提示本地是空的」）。
 *
 * **不含 `users`**：那是备份为了外键自洽才补的合成记录（见 `exportBackup`），
 * 不属于用户业务数据，也不参与同步。
 *
 * 用 `sanitizeRecord` 而不是严格校验的理由见 `exportBackup` 的注释。
 */
export async function collectUserRecords(options: BackupOwnerOptions = {}): Promise<{
  records: Partial<Record<LocalStore, BackupRecord[]>>
  dropped: string[]
}> {
  const { records, dropped } = await collectSnapshot(captureOwner(options))
  return { records, dropped }
}

async function collectSnapshot(captured: { owner: string; guard: () => void }): Promise<{
  records: WorkspaceRecords
  dropped: string[]
  profile: LocalProfile | null
  outboxIds: string[]
}> {
  return readTransaction({
    stores: [...USER_DATA_STORES, 'users', 'sync_outbox'],
    guard: captured.guard,
    read: async (reader) => {
      const [all, profile, outbox] = await Promise.all([
        readWorkspaceRecords(reader),
        reader.get<LocalProfile>('users', captured.owner),
        reader.getAll<OutboxEntry>('sync_outbox'),
      ])
      const selected = selectWorkspaceRecords(all, captured.owner)
      const records: WorkspaceRecords = {}
      const dropped: string[] = []
      for (const store of USER_DATA_STORES) {
        const rows = (selected[store] ?? []).map((row) => {
          const clean = sanitizeRecord(store, row)
          dropped.push(...clean.dropped.map((key) => `${store}.${key}`))
          return clean.value
        })
        if (rows.length) records[store] = rows
      }
      return {
        records, dropped, profile,
        outboxIds: outbox.filter((row) => row.local_user_id === captured.owner).map((row) => row.id),
      }
    },
  })
=======
  return { file, text, summary: summarizeRecords(records, { sourceEmail: user.email, exportedAt, dbVersion: DB_VERSION, warnings }) }
}

/** 按 `day_plan_id` 归属筛出子表记录。 */
async function rowsOfPlan(store: LocalStore, planIds: Set<string>): Promise<BackupRecord[]> {
  const rows = await getAll<BackupRecord>(store)
  return rows.filter((row) => planIds.has(String(row.day_plan_id)))
>>>>>>> origin/main
}

/**
 * 只做校验，不写库。界面用它先拿到「将要导入多少条」再弹确认框，
 * 避免用户点了导入才知道文件不对。
 *
<<<<<<< HEAD
 * 普通文件仍拒绝空备份。首次登录仅检查云端快照时可显式允许空数据，
 * 但这不放宽文件导入，也不会通过空快照清除已有本地记录。
 */
export function inspectBackup(text: string, options: { allowEmpty?: boolean } = {}): ValidatedBackup {
  return parseBackup(text, DB_VERSION, options)
=======
 * 额外提示：`summary.total === 0` 表示这份备份没有可导入的内容（导入会被拒绝），
 * 界面应据此拦住用户，不要走到确认框。
 */
export function inspectBackup(text: string): ValidatedBackup {
  return parseBackup(text, DB_VERSION)
>>>>>>> origin/main
}

/**
 * 导入备份：整体替换当前账号的数据。
 *
 * 顺序是「先读、再校验、最后写」，中间任何一步失败都不写库。
<<<<<<< HEAD
 * 写入集中在同一个事务（`atomicReadWrite`），删与写同生共死。
 *
 * ## `options.track` 为什么存在（S5）
 *
 * 默认 `true`：导入一份本地备份，等于「本机多了一批改动」，
 * 完成联网认证后由上传队列处理，避免本机导入的变更遗漏上行。
 *
 * S5 的「从云端恢复到本地」传 `false`：那批数据的来源**就是云端**，
 * 回推没有意义。不传的话会立刻产生上百条队列条目、紧接着被推回云端，
 * 一旦那次推送失败，界面会在一次成功的恢复之后显示「上传失败」——
 * 一次纯噪音的往返，还会把用户引向一个不存在的问题。
 * 这也是 `localDb.ts` 的 `WriteOptions` 注释里预告的那三类 `track:false` 之一。
 */
export async function importBackup(
  text: string,
  options: BackupOwnerOptions & {
    track?: boolean
    clearOutbox?: boolean
    profile?: LocalProfile
    workspaceState?: WorkspaceState
    syncStatePatch?: WorkspaceSyncPatch
    requireEmptyTarget?: boolean
  } = {},
): Promise<BackupSummary> {
  const captured = captureOwner(options)
  const backup = parseBackup(text, DB_VERSION)
  if (options.profile && options.profile.id !== captured.owner) throw new Error('账号资料与目标工作区不一致。')
  if (options.workspaceState && options.workspaceState.id !== captured.owner) throw new Error('准备状态与目标工作区不一致。')

  // 1. 组装要写的记录：`user_id` 改归当前 Auth UID；来源 `users` 资料不写入。
=======
 * 写入集中在同一个事务（`runTransaction`），删与写同生共死。
 */
export async function importBackup(text: string): Promise<BackupSummary> {
  const user = requireUser()
  const backup = parseBackup(text, DB_VERSION)

  // 1. 组装要写的记录：`user_id` 一律改归当前账号；`users` 不写（账号由登录 / 注册管理）。
>>>>>>> origin/main
  const puts: Array<{ store: LocalStore; value: { id: string } }> = []
  const remapped: Partial<Record<LocalStore, BackupRecord[]>> = {}
  for (const store of BACKUP_STORES) {
    if (IMPORT_SKIP_STORES.has(store)) continue
    const rows = backup.records[store]
    if (!rows?.length) continue
    const next: BackupRecord[] = []
    for (const row of rows) {
<<<<<<< HEAD
      const record = OWNER_STORES.has(store) ? { ...row, user_id: captured.owner } : { ...row }
=======
      const record = USER_SCOPED_STORES.has(store) ? { ...row, user_id: user.id } : { ...row }
>>>>>>> origin/main
      next.push(record)
      puts.push({ store, value: record as { id: string } })
    }
    remapped[store] = next
  }

  // 空备份若放行，等于「用一个没有内容的文件清空自己的数据」，风险与收益完全不对称。
  if (!puts.length) throw new Error('这份备份没有可导入的内容，已取消导入。')
<<<<<<< HEAD
  assertWorkspaceGraph(remapped, captured.owner)

  await atomicReadWrite({
    stores: [...USER_DATA_STORES, 'users', 'legacy_users', 'workspace_state', 'sync_outbox', 'sync_state'],
    owner: captured.owner,
    guard: captured.guard,
    track: options.track ?? true,
    read: async (reader) => ({
      all: await readWorkspaceRecords(reader),
      outbox: await reader.getAll<OutboxEntry>('sync_outbox'),
      syncState: await reader.get<WorkspaceSyncState>('sync_state', captured.owner),
    }),
    build: ({ all, outbox, syncState }) => {
      const owned = selectWorkspaceRecords(all, captured.owner)
      if (options.requireEmptyTarget && USER_DATA_STORES.some((store) => owned[store]?.length)) {
        throw new Error('此 UID 下已有未确认归属的本地数据，请先明确选择旧工作区迁移，不能用首次云端恢复覆盖。')
      }
      assertNoIdCollisions(all, remapped, captured.owner)
      const removals: NonNullable<TransactionWork['remove']> = []
      for (const store of USER_DATA_STORES) {
        for (const row of owned[store] ?? []) removals.push({ store, id: String(row.id) })
      }
      if (options.clearOutbox) {
        for (const row of outbox) {
          if (row.local_user_id === captured.owner) removals.push({ store: 'sync_outbox', id: row.id })
        }
      }
      const metadata: NonNullable<TransactionWork['put']> = []
      if (options.profile) metadata.push({ store: 'users', value: options.profile })
      if (options.workspaceState) metadata.push({ store: 'workspace_state', value: options.workspaceState })
      if (options.syncStatePatch) metadata.push({
        store: 'sync_state',
        value: mergeWorkspaceSyncState(captured.owner, syncState, options.syncStatePatch),
      })
      return { remove: removals, put: [...puts, ...metadata] }
    },
  })

  return summarizeRecords(remapped, {
    sourceUsername: backup.summary.sourceUsername,
=======

  // 2. 事务外查出本账号现有记录 id（事务内只发写入请求，不能 await 别的东西）。
  const removals = await collectOwned(user.id)

  // 3. 单事务：先删本账号旧记录，再写备份内容。任一步失败整体回滚。
  await runTransaction({ remove: removals, put: puts })

  return summarizeRecords(remapped, {
    sourceEmail: backup.summary.sourceEmail,
>>>>>>> origin/main
    exportedAt: backup.summary.exportedAt,
    dbVersion: backup.summary.dbVersion,
    formatVersion: backup.summary.formatVersion,
    warnings: backup.summary.warnings,
  })
}

<<<<<<< HEAD
/** 首次云端 hydrate：业务、用户资料、工作区状态、同步状态和队列清理共用一个事务。 */
export async function initializeCloudWorkspace(input: {
  snapshot: string | unknown
  profile: LocalProfile
  guard: () => void
  syncStatePatch?: WorkspaceSyncPatch
}): Promise<BackupSummary> {
  const text = typeof input.snapshot === 'string' ? input.snapshot : JSON.stringify(input.snapshot)
  const source = parseBackup(text, DB_VERSION)
  if (source.records.users?.[0]?.id !== input.profile.id) {
    throw new Error('云端快照归属与当前认证 UID 不一致。')
  }
  const summary = await importBackup(text, {
    owner: input.profile.id,
    username: input.profile.username,
    guard: input.guard,
    track: false,
    clearOutbox: true,
    requireEmptyTarget: true,
    profile: input.profile,
    workspaceState: {
      id: input.profile.id,
      initialized: true,
      initialized_at: new Date().toISOString(),
      initialized_from: 'cloud',
      updated_at: new Date().toISOString(),
    },
    syncStatePatch: input.syncStatePatch,
  })
  return summary
}

/** 仓库总数口径，界面与脚本共用。 */
export const BACKUP_TOTAL_STORES = BACKUP_STORES.length
=======
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
>>>>>>> origin/main
