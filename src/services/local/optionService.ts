import type {
  OptionDraft,
  OptionKind,
  OptionRecordMap,
  SupplementPeriod,
  SupplementTemplate,
} from '../../shared/types/options'
import { SUPPLEMENT_PERIODS } from '../../shared/types/options'
import { currentUser } from './authService'
import { getAll, newId, put, remove, type LocalStore } from './localDb'
import { seedExampleOptions } from './optionSeed'

/**
 * 选项管理服务（L1）。
 *
 * 职责边界：
 * - 选项是「用户维护的候选清单」，按 `user_id` 隔离，不同本地账号互不可见。
 * - 停用只影响 `listSelectableOptions` 的结果，即 L2 选择器的数据来源；不得改写历史计划。
 * - 删除是硬删除。历史安全由「计划保存名称快照」保证（docs/01 不变量 5 / 6，L2 落地），
 *   因此这里不需要软删除来兜底。
 */

const STORE_BY_KIND: Record<OptionKind, LocalStore> = {
  food: 'food_options',
  supplement: 'supplement_templates',
  exercise: 'exercise_options',
}

function userId(): string {
  const user = currentUser()
  if (!user) throw new Error('请先登录。')
  return user.id
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

async function allFor<K extends OptionKind>(kind: K): Promise<OptionRecordMap[K][]> {
  const user = userId()
  const rows = await getAll<OptionRecordMap[K]>(STORE_BY_KIND[kind])
  return sortFor(kind, rows.filter((row) => row.user_id === user))
}

/** 全部选项（含已停用），供选项管理页展示。 */
export async function listOptions<K extends OptionKind>(kind: K): Promise<OptionRecordMap[K][]> {
  return allFor(kind)
}

/**
 * 仅启用中的选项，供「新计划选择器」使用。
 * 这是 L2 三餐 / 补剂 / 健身选择器的唯一数据来源，停用项不会出现在这里。
 */
export async function listSelectableOptions<K extends OptionKind>(kind: K): Promise<OptionRecordMap[K][]> {
  return (await allFor(kind)).filter((row) => row.active)
}

function nextOrder(list: Array<{ sort_order: number }>): number {
  return list.reduce((max, item) => Math.max(max, item.sort_order), -1) + 1
}

export async function createOption<K extends OptionKind>(kind: K, draft: OptionDraft): Promise<OptionRecordMap[K]> {
  const user = userId()
  const name = draft.name.trim()
  if (!name) throw new Error('请填写名称。')

  const period = kind === 'supplement' ? draft.period : undefined
  if (kind === 'supplement' && !period) throw new Error('请选择补剂的时段。')

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
}

export async function renameOption<K extends OptionKind>(kind: K, id: string, name: string): Promise<OptionRecordMap[K]> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('请填写名称。')

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
}

/**
 * 上移 / 下移一位。只在同一分组内交换：补剂以时段为界，跨时段不给移动，
 * 避免把「早」的补剂排到「晚」分组里去。
 */
export async function moveOption<K extends OptionKind>(kind: K, id: string, delta: -1 | 1): Promise<boolean> {
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
}
