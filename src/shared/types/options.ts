/**
 * 选项管理领域类型（L1）。
 *
 * 对应 docs/01 数据契约：`food_options`、`supplement_templates`、`exercise_options`。
 * 三类选项的公共字段一致，因此共用一个基础结构；补剂额外带 `period`（早 / 中 / 晚）。
 *
 * 选项是「用户维护的候选清单」，不是计划内容本身。停用只影响新计划的选择器，
 * 不得改写任何历史计划——历史靠名称快照独立保存（L2 落地）。
 */

/** 补剂时段，与 docs/01 的早 / 中 / 晚对应。 */
export type SupplementPeriod = 'morning' | 'noon' | 'evening'

export const SUPPLEMENT_PERIODS: SupplementPeriod[] = ['morning', 'noon', 'evening']

interface OptionBase {
  id: string
  user_id: string
  name: string
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type FoodOption = OptionBase
export type ExerciseOption = OptionBase

export interface SupplementTemplate extends OptionBase {
  period: SupplementPeriod
}

/** 选项类别标识。服务层用它映射到对应的对象仓库，避免调用方直接写仓库名。 */
export type OptionKind = 'food' | 'supplement' | 'exercise'

/** 类别 → 记录类型。让服务层的读写保持类型安全。 */
export interface OptionRecordMap {
  food: FoodOption
  supplement: SupplementTemplate
  exercise: ExerciseOption
}

export type AnyOption = OptionRecordMap[OptionKind]

/** 新增或重命名选项时的输入。补剂必须给时段，其他类别忽略该字段。 */
export interface OptionDraft {
  name: string
  period?: SupplementPeriod
}
