import type {
  DailyExerciseItem,
  DailyMeal,
  DailyMealItem,
  DailySupplement,
  DayPlan,
  MealType,
  PlanItemInput,
} from '../../shared/types/dayPlan'
import { MEAL_TYPES } from '../../shared/types/dayPlan'
import type { SupplementPeriod, SupplementTemplate } from '../../shared/types/options'

/**
 * 三个编辑面板的草稿构造与增删改。
 *
 * 放在独立的 `.ts` 里而不是各自主组件里，有两个理由：
 * 一是组件文件只导出组件（否则 Vite 的热更新边界会退化到整页刷新）；
 * 二是这些函数是纯函数，不依赖 React，将来要单测也不必挂渲染器。
 *
 * 共同的底线：草稿只带「内容」，凡属于执行状态的字段（三餐 / 补剂的 `completed`）
 * 一律原样带着但不提供编辑入口，避免保存时顺手清掉（docs/01 不变量 6）。
 */

// ---------------------------------------------------------------- 三餐

export type MealDraft = Record<MealType, { note: string; items: PlanItemInput[] }>

/** 每餐的备注 + 该餐已选内容，按名称快照展示（不查询选项现在叫什么）。 */
export function buildMealDraft(meals: DailyMeal[], mealItems: DailyMealItem[]): MealDraft {
  const draft = {} as MealDraft
  for (const type of MEAL_TYPES) {
    const meal = meals.find((item) => item.meal_type === type)
    const items = meal ? mealItems.filter((item) => item.daily_meal_id === meal.id) : []
    draft[type] = {
      note: meal?.note ?? '',
      items: items.map((item) => ({ optionId: item.food_option_id, name: item.food_name_snapshot })),
    }
  }
  return draft
}

// ---------------------------------------------------------------- 健身

export type ExerciseDraft = {
  decision: DayPlan['exercise_decision']
  note: string
  items: PlanItemInput[]
}

export function buildExerciseDraft(plan: DayPlan | null, items: DailyExerciseItem[]): ExerciseDraft {
  return {
    decision: plan?.exercise_decision ?? 'undecided',
    note: plan?.exercise_note ?? '',
    items: items.map((item) => ({ optionId: item.exercise_option_id, name: item.name_snapshot })),
  }
}

// ---------------------------------------------------------------- 补剂

export type SupplementDraftRow = {
  id: string | null
  name: string
  period: SupplementPeriod
  planned: boolean
  completed: boolean
}

/** 与 `ensureDaySupplements` 使用同一个去重键，两处必须一致。 */
export function supplementKey(period: SupplementPeriod, name: string): string {
  return `${period}:${name}`
}

/** 当前启用中的模板所覆盖的键集合，用来判断某一行是不是「模板来源」。 */
export function templateKeys(templates: SupplementTemplate[]): Set<string> {
  return new Set(templates.map((template) => supplementKey(template.period, template.name)))
}

/**
 * 把这一天已有的补剂实例 + 当前启用中的模板合成面板草稿。
 *
 * `mergeTemplates` 只在可写日期为真：模板里还没落到这一天的项以「未入库行」补进草稿，
 * 让用户一打开面板就能看到模板内容，而不是先存一次才出现。历史日期不合并，
 * 否则会把没写进库的模板行伪装成那一天的记录。
 */
export function buildSupplementDraft(
  rows: DailySupplement[],
  templates: SupplementTemplate[],
  mergeTemplates: boolean,
): SupplementDraftRow[] {
  const draft: SupplementDraftRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name_snapshot,
    period: row.period,
    planned: row.planned,
    completed: row.completed,
  }))
  if (!mergeTemplates) return draft

  const seen = new Set(draft.map((row) => supplementKey(row.period, row.name)))
  for (const template of templates) {
    const key = supplementKey(template.period, template.name)
    if (seen.has(key)) continue
    seen.add(key)
    draft.push({ id: null, name: template.name, period: template.period, planned: true, completed: false })
  }
  return draft
}

export function patchSupplement(
  draft: SupplementDraftRow[],
  index: number,
  patch: Partial<SupplementDraftRow>,
): SupplementDraftRow[] {
  return draft.map((row, position) => (position === index ? { ...row, ...patch } : row))
}

export function removeSupplementAt(draft: SupplementDraftRow[], index: number): SupplementDraftRow[] {
  return draft.filter((_, position) => position !== index)
}

export function appendSupplement(draft: SupplementDraftRow[], period: SupplementPeriod): SupplementDraftRow[] {
  return [...draft, { id: null, name: '', period, planned: true, completed: false }]
}
