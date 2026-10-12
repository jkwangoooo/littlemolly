import type { BackupRecord } from './backupFormat'
import type { LocalStore, TransactionReader, UserDataStore } from './localDb'
import { USER_DATA_STORES } from './recordSchemas'

export type WorkspaceRecords = Partial<Record<LocalStore, BackupRecord[]>>

export const OWNER_STORES = new Set<LocalStore>([
  'day_plans', 'food_options', 'exercise_options', 'supplement_templates',
])

const PLAN_CHILDREN = new Set<LocalStore>([
  'daily_meals', 'custom_tasks', 'daily_supplements', 'daily_exercise_items', 'routine_tasks',
])

type RecordReference = { store: LocalStore; id: string }

/** 业务图里会让残留记录重新接入某个工作区的直接引用。 */
function recordReferences(store: LocalStore, row: BackupRecord): RecordReference[] {
  const references: RecordReference[] = []
  const add = (parent: LocalStore, value: unknown) => {
    if (typeof value === 'string' && value) references.push({ store: parent, id: value })
  }
  if (PLAN_CHILDREN.has(store)) add('day_plans', row.day_plan_id)
  if (store === 'daily_meal_items') {
    add('daily_meals', row.daily_meal_id)
    add('food_options', row.food_option_id)
  }
  if (store === 'daily_exercise_items') add('exercise_options', row.exercise_option_id)
  return references
}

/** 同一个 IDB 事务中的一致业务快照。 */
export async function readWorkspaceRecords(reader: TransactionReader): Promise<WorkspaceRecords> {
  const entries = await Promise.all(USER_DATA_STORES.map(async (store) =>
    [store, await reader.getAll<BackupRecord>(store)] as const,
  ))
  return Object.fromEntries(entries) as WorkspaceRecords
}

/** 沿根表与完整父链确定 owner；断链记录没有可证明的 owner。 */
export function recordOwner(
  records: WorkspaceRecords,
  store: LocalStore,
  row: BackupRecord,
): string | null {
  if (OWNER_STORES.has(store)) return typeof row.user_id === 'string' ? row.user_id : null
  if (PLAN_CHILDREN.has(store)) {
    const plan = records.day_plans?.find((item) => item.id === row.day_plan_id)
    return plan && typeof plan.user_id === 'string' ? plan.user_id : null
  }
  if (store === 'daily_meal_items') {
    const meal = records.daily_meals?.find((item) => item.id === row.daily_meal_id)
    if (!meal) return null
    return recordOwner(records, 'daily_meals', meal)
  }
  return null
}

export function selectWorkspaceRecords(
  records: WorkspaceRecords,
  owner: string,
  validate = true,
): WorkspaceRecords {
  const selected: WorkspaceRecords = {}
  for (const store of USER_DATA_STORES) {
    const rows = (records[store] ?? []).filter((row) => recordOwner(records, store, row) === owner)
    if (rows.length) selected[store] = rows
  }
  if (validate) {
    // 老库删除选项时可能未清外键；只读快照保留名称，绝不改动原记录。
    for (const link of [
      { store: 'daily_meal_items', field: 'food_option_id', parent: 'food_options' },
      { store: 'daily_exercise_items', field: 'exercise_option_id', parent: 'exercise_options' },
    ] as const) {
      const options = new Map((records[link.parent] ?? []).map((row) => [row.id, row]))
      if (!selected[link.store]) continue
      selected[link.store] = selected[link.store]?.map((row) => {
        const id = row[link.field]
        if (id === null || typeof id !== 'string') return row
        const option = options.get(id)
        if (!option) return { ...row, [link.field]: null }
        if (option.user_id !== owner) throw new Error('历史记录的来源选项不属于当前账号。')
        return row
      })
    }
    assertWorkspaceGraph(selected, owner)
  }
  return selected
}

/** 复制旧工作区时全图换 ID，原 owner 的记录与来源关系保留在原处。 */
export function copyWorkspaceRecords(
  records: WorkspaceRecords,
  existing: WorkspaceRecords,
  owner: string,
  createId: () => string,
): WorkspaceRecords {
  const reserved = new Set(USER_DATA_STORES.flatMap((store) =>
    (existing[store] ?? []).map((row) => String(row.id)),
  ))
  for (const store of USER_DATA_STORES) {
    for (const row of existing[store] ?? []) {
      for (const reference of recordReferences(store, row)) reserved.add(reference.id)
    }
  }
  const maps = new Map<LocalStore, Map<string, string>>()
  for (const store of USER_DATA_STORES) {
    const ids = new Map<string, string>()
    for (const row of records[store] ?? []) {
      let next: string | null = null
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const candidate = createId()
        if (candidate && !reserved.has(candidate)) {
          next = candidate
          reserved.add(candidate)
          break
        }
      }
      if (!next) throw new Error('无法为旧工作区生成无冲突的记录 ID，已取消迁移。')
      ids.set(String(row.id), next)
    }
    maps.set(store, ids)
  }
  const mappedId = (store: LocalStore, id: unknown): string => {
    const value = maps.get(store)?.get(String(id))
    if (!value) throw new Error(`旧工作区存在断裂引用，已取消迁移（${store}：${String(id)}）。`)
    return value
  }
  const copied: WorkspaceRecords = {}
  for (const store of USER_DATA_STORES) {
    const rows = (records[store] ?? []).map((row) => {
      const next: BackupRecord = { ...row, id: mappedId(store, row.id) }
      if (OWNER_STORES.has(store)) next.user_id = owner
      if (PLAN_CHILDREN.has(store)) next.day_plan_id = mappedId('day_plans', row.day_plan_id)
      if (store === 'daily_meal_items') {
        next.daily_meal_id = mappedId('daily_meals', row.daily_meal_id)
        next.food_option_id = row.food_option_id === null ? null : mappedId('food_options', row.food_option_id)
      }
      if (store === 'daily_exercise_items') {
        next.exercise_option_id = row.exercise_option_id === null
          ? null : mappedId('exercise_options', row.exercise_option_id)
      }
      return next
    })
    if (rows.length) copied[store] = rows
  }
  assertWorkspaceGraph(copied, owner)
  assertNoIdCollisions(existing, copied, owner)
  return copied
}

/** 根 owner、父链和来源选项同时校验；快照名称不能掩盖跨 owner 引用。 */
export function assertWorkspaceGraph(records: WorkspaceRecords, owner: string): void {
  const byId = (store: LocalStore, id: unknown) => records[store]?.find((row) => row.id === id)
  for (const store of USER_DATA_STORES) {
    for (const row of records[store] ?? []) {
      if (recordOwner(records, store, row) !== owner) {
        throw new Error(`记录归属无法确认（${store}：${String(row.id)}）。`)
      }
      if (store === 'daily_meal_items' && row.food_option_id !== null) {
        const option = byId('food_options', row.food_option_id)
        if (!option || option.user_id !== owner) throw new Error('餐次的食物选项不属于当前账号。')
      }
      if (store === 'daily_exercise_items' && row.exercise_option_id !== null) {
        const option = byId('exercise_options', row.exercise_option_id)
        if (!option || option.user_id !== owner) throw new Error('运动项目的选项不属于当前账号。')
      }
    }
  }
}

/** 全局主键只能替换相同 owner 的现有记录，孤儿记录也不能被覆盖。 */
export function assertNoIdCollisions(
  existing: WorkspaceRecords,
  incoming: WorkspaceRecords,
  owner: string,
): void {
  const incomingIds = new Map<LocalStore, Set<string>>()
  for (const store of USER_DATA_STORES) {
    incomingIds.set(store, new Set((incoming[store] ?? []).map((row) => String(row.id))))
  }
  for (const store of USER_DATA_STORES) {
    const current = new Map((existing[store] ?? []).map((row) => [String(row.id), row]))
    for (const row of incoming[store] ?? []) {
      const collision = current.get(String(row.id))
      if (collision && recordOwner(existing, store, collision) !== owner) {
        throw new Error(`记录 ID 与其他工作区冲突，已取消写入（${store}：${String(row.id)}）。`)
      }
    }
  }
  for (const store of USER_DATA_STORES) {
    for (const row of existing[store] ?? []) {
      if (recordOwner(existing, store, row) === owner) continue
      for (const reference of recordReferences(store, row)) {
        const exists = (existing[reference.store] ?? []).some((item) => String(item.id) === reference.id)
        if (!exists && incomingIds.get(reference.store)?.has(reference.id)) {
          throw new Error(
            `导入会让其他工作区的残留记录重新接入当前账号，已取消写入（${store}：${String(row.id)}）。`,
          )
        }
      }
    }
  }
}

/** 业务服务按 ID 修改记录时，在同一事务里验证其根 owner。 */
export async function requireOwnedRecord<T extends { id: string }>(
  reader: TransactionReader,
  store: UserDataStore,
  id: string,
  owner: string,
): Promise<T> {
  const row = await reader.get<BackupRecord & { id: string }>(store, id)
  if (!row) throw new Error('记录不存在，请刷新后重试。')
  if (OWNER_STORES.has(store)) {
    if (row.user_id !== owner) throw new Error('这条记录不属于当前账号。')
  } else if (PLAN_CHILDREN.has(store)) {
    await requireOwnedRecord(reader, 'day_plans', String(row.day_plan_id), owner)
  } else {
    await requireOwnedRecord(reader, 'daily_meals', String(row.daily_meal_id), owner)
  }
  return row as unknown as T
}
