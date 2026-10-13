import type {
  OptionDraft,
  OptionKind,
  OptionRecordMap,
  SupplementPeriod,
  SupplementTemplate,
} from '../../shared/types/options'
import { SUPPLEMENT_PERIODS } from '../../shared/types/options'
<<<<<<< HEAD
import { assertAuthContextCurrent, captureAuthContext, type AuthContext } from '../session'
import {
  atomicReadWrite, newId, readTransaction,
  type LocalStore, type TransactionReader, type TransactionWork,
} from './localDb'
import type { DailyExerciseItem, DailyMeal, DailyMealItem, DayPlan } from '../../shared/types/dayPlan'
=======
import { currentUser } from './authService'
import { getAll, newId, put, remove, type LocalStore } from './localDb'
>>>>>>> origin/main
import { seedExampleOptions } from './optionSeed'

/**
 * 选项管理服务（L1）。
 *
 * 职责边界：
<<<<<<< HEAD
 * - 选项是「用户维护的候选清单」，按 Supabase UID 隔离。
=======
 * - 选项是「用户维护的候选清单」，按 `user_id` 隔离，不同本地账号互不可见。
>>>>>>> origin/main
 * - 停用只影响 `listSelectableOptions` 的结果，即 L2 选择器的数据来源；不得改写历史计划。
 * - 删除是硬删除。历史安全由「计划保存名称快照」保证（docs/01 不变量 5 / 6，L2 落地），
 *   因此这里不需要软删除来兜底。
 */

const STORE_BY_KIND: Record<OptionKind, LocalStore> = {
  food: 'food_options',
  supplement: 'supplement_templates',
  exercise: 'exercise_options',
}

<<<<<<< HEAD
function ownedWrite(context: AuthContext) {
  return { owner: context.owner, guard: () => assertAuthContextCurrent(context) }
=======
function userId(): string {
  const user = currentUser()
  if (!user) throw new Error('请先登录。')
  return user.id
>>>>>>> origin/main
}

function now(): string {
  return new Date().toISOString()
}

function periodIndex(period: SupplementPeriod): number {
  return SUPPLEMENT_PERIODS.indexOf(period)
}

/**
 * 排序规则：补剂先按时段（早 / 中 / 晚）再按 sort_order，其余类别只看 sort_order。
 * 名称只作为同序号时的稳定兜底，不参与用户可见的「排序」语义。
 */
function sortFor<K extends OptionKind>(kind: K, list: OptionRecordMap[K][]): OptionRecordMap[K][] {
  return [...list].sort((left, right) => {
    if (kind === 'supplement') {
      const leftPeriod = periodIndex((left as SupplementTemplate).period)
      const rightPeriod = periodIndex((right as SupplementTemplate).period)
      if (leftPeriod !== rightPeriod) return leftPeriod - rightPeriod
    }
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}

<<<<<<< HEAD
async function allFor<K extends OptionKind>(
  reader: TransactionReader, kind: K, owner: string,
): Promise<OptionRecordMap[K][]> {
  const rows = await reader.getAll<OptionRecordMap[K]>(STORE_BY_KIND[kind])
  return sortFor(kind, rows.filter((row) => row.user_id === owner))
=======
async function allFor<K extends OptionKind>(kind: K): Promise<OptionRecordMap[K][]> {
  const user = userId()
  const rows = await getAll<OptionRecordMap[K]>(STORE_BY_KIND[kind])
  return sortFor(kind, rows.filter((row) => row.user_id === user))
>>>>>>> origin/main
}

/** 全部选项（含已停用），供选项管理页展示。 */
export async function listOptions<K extends OptionKind>(kind: K): Promise<OptionRecordMap[K][]> {
<<<<<<< HEAD
  const context = captureAuthContext()
  return readTransaction({
    stores: [STORE_BY_KIND[kind]],
    read: (reader) => allFor(reader, kind, context.owner),
    guard: () => assertAuthContextCurrent(context),
  })
=======
  return allFor(kind)
>>>>>>> origin/main
}

/**
 * 仅启用中的选项，供「新计划选择器」使用。
 * 这是 L2 三餐 / 补剂 / 健身选择器的唯一数据来源，停用项不会出现在这里。
 */
export async function listSelectableOptions<K extends OptionKind>(kind: K): Promise<OptionRecordMap[K][]> {
<<<<<<< HEAD
  return (await listOptions(kind)).filter((row) => row.active)
=======
  return (await allFor(kind)).filter((row) => row.active)
>>>>>>> origin/main
}

function nextOrder(list: Array<{ sort_order: number }>): number {
  return list.reduce((max, item) => Math.max(max, item.sort_order), -1) + 1
}

export async function createOption<K extends OptionKind>(kind: K, draft: OptionDraft): Promise<OptionRecordMap[K]> {
<<<<<<< HEAD
  const context = captureAuthContext()
=======
  const user = userId()
>>>>>>> origin/main
  const name = draft.name.trim()
  if (!name) throw new Error('请填写名称。')

  const period = kind === 'supplement' ? draft.period : undefined
  if (kind === 'supplement' && !period) throw new Error('请选择补剂的时段。')

<<<<<<< HEAD
  const saved = await atomicReadWrite({
    stores: [STORE_BY_KIND[kind]],
    ...ownedWrite(context),
    read: async (reader) => {
      const existing = await allFor(reader, kind, context.owner)
      if (existing.some(
        (item) => item.name === name && (kind !== 'supplement' || (item as SupplementTemplate).period === period),
      )) throw new Error('已有同名选项。')
      const timestamp = now()
      return {
        id: newId(), user_id: context.owner, name, active: true,
        sort_order: nextOrder(existing), created_at: timestamp, updated_at: timestamp,
        ...(period ? { period } : {}),
      } as OptionRecordMap[K]
    },
    build: (record) => ({ put: [{ store: STORE_BY_KIND[kind], value: record }] }),
  })
  return saved
=======
  const existing = await allFor(kind)
  const duplicated = existing.some(
    (item) => item.name === name && (kind !== 'supplement' || (item as SupplementTemplate).period === period),
  )
  if (duplicated) throw new Error('已有同名选项。')

  const timestamp = now()
  const record = {
    id: newId(),
    user_id: user,
    name,
    active: true,
    sort_order: nextOrder(existing),
    created_at: timestamp,
    updated_at: timestamp,
    ...(period ? { period } : {}),
  } as OptionRecordMap[K]

  await put(STORE_BY_KIND[kind], record)
  return record
>>>>>>> origin/main
}

export async function renameOption<K extends OptionKind>(kind: K, id: string, name: string): Promise<OptionRecordMap[K]> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('请填写名称。')

<<<<<<< HEAD
  const context = captureAuthContext()
  return atomicReadWrite({
    stores: [STORE_BY_KIND[kind]],
    ...ownedWrite(context),
    read: async (reader) => {
      const existing = await allFor(reader, kind, context.owner)
      const target = existing.find((item) => item.id === id)
      if (!target) throw new Error('选项不存在。')
      if (existing.some(
        (item) => item.id !== id && item.name === trimmed
          && (kind !== 'supplement' || (item as SupplementTemplate).period === (target as SupplementTemplate).period),
      )) throw new Error('已有同名选项。')
      return { ...target, name: trimmed, updated_at: now() } as OptionRecordMap[K]
    },
    build: (record) => ({ put: [{ store: STORE_BY_KIND[kind], value: record }] }),
  })
}

export async function setOptionActive<K extends OptionKind>(kind: K, id: string, active: boolean): Promise<OptionRecordMap[K]> {
  const context = captureAuthContext()
  return atomicReadWrite({
    stores: [STORE_BY_KIND[kind]],
    ...ownedWrite(context),
    read: async (reader) => {
      const target = (await allFor(reader, kind, context.owner)).find((item) => item.id === id)
      if (!target) throw new Error('选项不存在。')
      return { ...target, active, updated_at: now() } as OptionRecordMap[K]
    },
    build: (record) => ({ put: [{ store: STORE_BY_KIND[kind], value: record }] }),
  })
=======
  const existing = await allFor(kind)
  const target = existing.find((item) => item.id === id)
  if (!target) throw new Error('选项不存在。')

  const duplicated = existing.some(
    (item) =>
      item.id !== id &&
      item.name === trimmed &&
      (kind !== 'supplement' || (item as SupplementTemplate).period === (target as SupplementTemplate).period),
  )
  if (duplicated) throw new Error('已有同名选项。')

  const next = { ...target, name: trimmed, updated_at: now() } as OptionRecordMap[K]
  await put(STORE_BY_KIND[kind], next)
  return next
}

export async function setOptionActive<K extends OptionKind>(kind: K, id: string, active: boolean): Promise<OptionRecordMap[K]> {
  const existing = await allFor(kind)
  const target = existing.find((item) => item.id === id)
  if (!target) throw new Error('选项不存在。')

  const next = { ...target, active, updated_at: now() } as OptionRecordMap[K]
  await put(STORE_BY_KIND[kind], next)
  return next
>>>>>>> origin/main
}

/**
 * 上移 / 下移一位。只在同一分组内交换：补剂以时段为界，跨时段不给移动，
 * 避免把「早」的补剂排到「晚」分组里去。
 */
export async function moveOption<K extends OptionKind>(kind: K, id: string, delta: -1 | 1): Promise<boolean> {
<<<<<<< HEAD
  const context = captureAuthContext()
  const rows = await atomicReadWrite({
    stores: [STORE_BY_KIND[kind]],
    ...ownedWrite(context),
    read: async (reader) => {
      const sorted = await allFor(reader, kind, context.owner)
      const target = sorted.find((item) => item.id === id)
      if (!target) throw new Error('选项不存在。')
      const group = kind === 'supplement'
        ? sorted.filter((item) => (item as SupplementTemplate).period === (target as SupplementTemplate).period)
        : sorted
      const neighbour = group[group.findIndex((item) => item.id === id) + delta]
      if (!neighbour) return []
      const timestamp = now()
      return [
        { ...target, sort_order: neighbour.sort_order, updated_at: timestamp },
        { ...neighbour, sort_order: target.sort_order, updated_at: timestamp },
      ] as OptionRecordMap[K][]
    },
    build: (records) => ({ put: records.map((value) => ({ store: STORE_BY_KIND[kind], value })) }),
  })
  return rows.length > 0
}

export async function deleteOption<K extends OptionKind>(kind: K, id: string): Promise<void> {
  const context = captureAuthContext()
  const stores: LocalStore[] = [STORE_BY_KIND[kind]]
  if (kind === 'food') stores.push('day_plans', 'daily_meals', 'daily_meal_items')
  if (kind === 'exercise') stores.push('day_plans', 'daily_exercise_items')
  await atomicReadWrite({
    stores,
    ...ownedWrite(context),
    // 云端选项删除自带 ON DELETE SET NULL，不重复上传历史计划的引用清理。
    trackChange: (change) => change.store === STORE_BY_KIND[kind] && change.op === 'delete',
    read: async (reader): Promise<TransactionWork> => {
      const target = await reader.get<OptionRecordMap[K]>(STORE_BY_KIND[kind], id)
      if (!target) return {}
      if (target.user_id !== context.owner) throw new Error('选项不属于当前账号。')
      const work: TransactionWork = { remove: [{ store: STORE_BY_KIND[kind], id }], put: [] }
      if (kind === 'supplement') return work
      const plans = await reader.getAll<DayPlan>('day_plans')
      const ownedPlans = new Set(plans.filter((plan) => plan.user_id === context.owner).map((plan) => plan.id))
      // 删除来源选项时仅断开可选引用，保留所有日期的名称快照与执行状态。
      if (kind === 'food') {
        const meals = await reader.getAll<DailyMeal>('daily_meals')
        const ownedMeals = new Set(meals.filter((meal) => ownedPlans.has(meal.day_plan_id)).map((meal) => meal.id))
        const linked = (await reader.getAll<DailyMealItem>('daily_meal_items')).filter((row) => row.food_option_id === id)
        if (linked.some((row) => !ownedMeals.has(row.daily_meal_id))) throw new Error('选项存在归属不明的引用，已取消删除。')
        work.put = linked.map((row) => ({ store: 'daily_meal_items', value: { ...row, food_option_id: null } }))
      } else {
        const linked = (await reader.getAll<DailyExerciseItem>('daily_exercise_items')).filter((row) => row.exercise_option_id === id)
        if (linked.some((row) => !ownedPlans.has(row.day_plan_id))) throw new Error('选项存在归属不明的引用，已取消删除。')
        work.put = linked.map((row) => ({ store: 'daily_exercise_items', value: { ...row, exercise_option_id: null } }))
      }
      return work
    },
    build: (work) => work,
  })
}

/** 为已经准备好的当前账号补齐示例选项（幂等）。 */
export async function seedExampleOptionsForCurrentUser(): Promise<void> {
  await seedExampleOptions(captureAuthContext().owner)
=======
  const sorted = await allFor(kind)
  const target = sorted.find((item) => item.id === id)
  if (!target) throw new Error('选项不存在。')

  const group = kind === 'supplement'
    ? sorted.filter((item) => (item as SupplementTemplate).period === (target as SupplementTemplate).period)
    : sorted
  const index = group.findIndex((item) => item.id === id)
  const neighbour = group[index + delta]
  if (!neighbour) return false

  const timestamp = now()
  const targetNext = { ...target, sort_order: neighbour.sort_order, updated_at: timestamp } as OptionRecordMap[K]
  const neighbourNext = { ...neighbour, sort_order: target.sort_order, updated_at: timestamp } as OptionRecordMap[K]
  await put(STORE_BY_KIND[kind], targetNext)
  await put(STORE_BY_KIND[kind], neighbourNext)
  return true
}

export async function deleteOption<K extends OptionKind>(kind: K, id: string): Promise<void> {
  const existing = await allFor(kind)
  if (!existing.some((item) => item.id === id)) return
  await remove(STORE_BY_KIND[kind], id)
}

/** 为当前账号补齐示例选项（幂等），供注册时播种与选项页空状态手动载入共用。 */
export async function seedExampleOptionsForCurrentUser(): Promise<void> {
  await seedExampleOptions(userId())
>>>>>>> origin/main
}
