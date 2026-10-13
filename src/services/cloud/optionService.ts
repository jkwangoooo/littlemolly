import type {
  OptionDraft,
  OptionKind,
  OptionRecordMap,
  SupplementPeriod,
  SupplementTemplate,
} from '../../shared/types/options'
import { SUPPLEMENT_PERIODS } from '../../shared/types/options'
import { currentUser } from './authService'
import { throwSupabaseError } from './errors'
import { seedExampleOptions } from './optionSeed'
import { requireSupabase } from './supabase'

/**
 * 选项管理服务（Supabase 实现，L6）。
 *
 * 与 `local/optionService.ts` 逐条等价，包括三条容易写歪的规则：
 *
 * - 排序：补剂先按时段（早 / 中 / 晚）再按 `sort_order`，其余类别只看 `sort_order`；
 *   名称只作为同序号时的稳定兜底，不参与用户可见的「排序」语义；
 * - 同名判断：食物与健身按名称，补剂按「名称 + 时段」；重命名时要排除自己；
 * - 停用只影响 `listSelectableOptions`，**不得改写历史计划**——历史靠名称快照独立保存，
 *   所以这里的写入永远只碰选项表本身。
 */

const TABLE_BY_KIND: Record<OptionKind, 'food_options' | 'supplement_templates' | 'exercise_options'> = {
  food: 'food_options',
  supplement: 'supplement_templates',
  exercise: 'exercise_options',
}

const BASE_COLUMNS = 'id,user_id,name,active,sort_order,created_at,updated_at'
/** 补剂模板比另外两类多一个时段字段。 */
const COLUMNS_BY_KIND: Record<OptionKind, string> = {
  food: BASE_COLUMNS,
  supplement: `${BASE_COLUMNS},period`,
  exercise: BASE_COLUMNS,
}

function userId(): string {
  const user = currentUser()
  if (!user) throw new Error('请先登录。')
  return user.id
}

function periodIndex(period: SupplementPeriod): number {
  return SUPPLEMENT_PERIODS.indexOf(period)
}

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
  const { data, error } = await requireSupabase()
    .from(TABLE_BY_KIND[kind])
    .select(COLUMNS_BY_KIND[kind])
    .eq('user_id', user)
  if (error) throwSupabaseError(error)
  return sortFor(kind, (data ?? []) as OptionRecordMap[K][])
}

/** 全部选项（含已停用），供选项管理页展示。 */
export async function listOptions<K extends OptionKind>(kind: K): Promise<OptionRecordMap[K][]> {
  return allFor(kind)
}

/** 仅启用中的选项，供「新计划选择器」使用。停用项不会出现在这里。 */
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

  const payload: Record<string, unknown> = {
    user_id: user,
    name,
    active: true,
    sort_order: nextOrder(existing),
  }
  if (period) payload.period = period

  const { data, error } = await requireSupabase()
    .from(TABLE_BY_KIND[kind])
    .insert(payload)
    .select(COLUMNS_BY_KIND[kind])
    .single()
  if (error) throwSupabaseError(error)
  return data as OptionRecordMap[K]
}

export async function renameOption<K extends OptionKind>(
  kind: K,
  id: string,
  name: string,
): Promise<OptionRecordMap[K]> {
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

  const { data, error } = await requireSupabase()
    .from(TABLE_BY_KIND[kind])
    .update({ name: trimmed })
    .eq('id', id)
    .select(COLUMNS_BY_KIND[kind])
    .single()
  if (error) throwSupabaseError(error)
  return data as OptionRecordMap[K]
}

export async function setOptionActive<K extends OptionKind>(
  kind: K,
  id: string,
  active: boolean,
): Promise<OptionRecordMap[K]> {
  const existing = await allFor(kind)
  if (!existing.some((item) => item.id === id)) throw new Error('选项不存在。')

  const { data, error } = await requireSupabase()
    .from(TABLE_BY_KIND[kind])
    .update({ active })
    .eq('id', id)
    .select(COLUMNS_BY_KIND[kind])
    .single()
  if (error) throwSupabaseError(error)
  return data as OptionRecordMap[K]
}

/**
 * 上移 / 下移一位。只在同一分组内交换：补剂以时段为界，跨时段不给移动。
 * 两次 `update` 各自独立，因此中间失败会留下「两条同序号」的状态——
 * 这只影响排序展示，不丢内容；下一次移动会重新拉平（与本地同样的取舍）。
 */
export async function moveOption<K extends OptionKind>(kind: K, id: string, delta: -1 | 1): Promise<boolean> {
  const sorted = await allFor(kind)
  const target = sorted.find((item) => item.id === id)
  if (!target) throw new Error('选项不存在。')

  const group =
    kind === 'supplement'
      ? sorted.filter((item) => (item as SupplementTemplate).period === (target as SupplementTemplate).period)
      : sorted
  const index = group.findIndex((item) => item.id === id)
  const neighbour = group[index + delta]
  if (!neighbour) return false

  const table = TABLE_BY_KIND[kind]
  const first = await requireSupabase().from(table).update({ sort_order: neighbour.sort_order }).eq('id', target.id)
  if (first.error) throwSupabaseError(first.error)
  const second = await requireSupabase().from(table).update({ sort_order: target.sort_order }).eq('id', neighbour.id)
  if (second.error) throwSupabaseError(second.error)
  return true
}

export async function deleteOption<K extends OptionKind>(kind: K, id: string): Promise<void> {
  const existing = await allFor(kind)
  if (!existing.some((item) => item.id === id)) return

  // 历史计划的名称快照不受影响：daily_meal_items / daily_exercise_items 的外键是
  // `on delete set null`，删掉选项只会让那一项失去来源链接，展示仍用快照。
  const { error } = await requireSupabase().from(TABLE_BY_KIND[kind]).delete().eq('id', id)
  if (error) throwSupabaseError(error)
}

/** 为当前账号补齐示例选项（幂等），供注册时播种与选项页空状态手动载入共用。 */
export async function seedExampleOptionsForCurrentUser(): Promise<void> {
  await seedExampleOptions(userId())
}
