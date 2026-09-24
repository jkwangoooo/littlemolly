import type { SupplementPeriod } from './options'

export type DayMode = 'work' | 'rest'

export interface DayPlan {
  id: string
  user_id: string
  plan_date: string
  mode: DayMode
  mode_override: boolean
  created_at: string
  updated_at: string
  outfit_ready: boolean
  meals_ready: boolean
  supplements_ready: boolean
  morning_ready: boolean
  exercise_ready: boolean
  morning_focus: string
  morning_completed: boolean
  exercise_decision: 'undecided' | 'exercise' | 'rest'
  exercise_note: string
  exercise_completed: boolean
}

export type MealType = 'breakfast' | 'lunch' | 'dinner'

/**
 * 三餐固定顺序：界面展示与保存都以它为准。
 * 不要用名称的字母序排（`breakfast < dinner < lunch`，会把晚餐排到午餐前面）。
 */
export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner']

/** 每日三餐主记录。内容不在这里，见 `DailyMealItem`。 */
export interface DailyMeal {
  id: string
  day_plan_id: string
  meal_type: MealType
  note: string
  completed: boolean
}

/**
 * 一餐里的一项内容。
 *
 * `food_name_snapshot` 是当时写入的名称快照，展示一律用它：
 * 之后选项被改名、停用或删除，历史计划都不会跟着变（docs/01 不变量 5）。
 * 由老库自由文本迁移来的项没有来源选项，`food_option_id` 为空。
 */
export interface DailyMealItem {
  id: string
  daily_meal_id: string
  food_option_id: string | null
  food_name_snapshot: string
  sort_order: number
  created_at: string
}

/**
 * 每日补剂实例：从模板复制出来之后就是那一天自己的内容，模板再改也不回填。
 *
 * - `planned` 是内容层：这天是否吃这一条，属「计划」，复制昨天会带走它。
 * - `completed` 是执行层：实际吃了没，复制昨天不带（docs/01 不变量 6）。
 */
export interface DailySupplement {
  id: string
  day_plan_id: string
  name_snapshot: string
  period: SupplementPeriod
  planned: boolean
  completed: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

/** 每日健身多选项，规则与三餐项一致：名称快照优先，选项变更不改历史。 */
export interface DailyExerciseItem {
  id: string
  day_plan_id: string
  exercise_option_id: string | null
  name_snapshot: string
  sort_order: number
  created_at: string
}

export interface CustomTask { id: string; day_plan_id: string; task_time: string; title: string; note: string; completed: boolean }

/**
 * 休息日固定家务（拖地 / 洗衣）。它是某一天的「每日实例」，不是全局模板：
 * 只在正常休息日（周六 / 周日默认 `rest` 且无人工覆盖）自动补齐，用户勾选完成。
 * 临时不上班（`mode_override` 为 true）不自动带家务（docs/00 / docs/01 不变量 7）。
 */
export type RoutineKind = 'mop' | 'laundry'

export interface RoutineTask {
  id: string
  day_plan_id: string
  kind: RoutineKind
  title: string
  completed: boolean
}

/** 休息日家务固定顺序（docs/00）：拖地在先、洗衣在后。 */
export const ROUTINE_ORDER: RoutineKind[] = ['mop', 'laundry']

/**
 * 家务展示名称。放在共享层是因为本地与云端两套适配器都要靠它补齐每日实例，
 * 各写一份迟早会分叉成两种文案。
 */
export const ROUTINE_TITLES: Record<RoutineKind, string> = { mop: '拖地', laundry: '洗衣' }

/**
 * 编辑面板提交的一项内容：只有名称与来源选项，快照字段由服务层补齐。
 * `optionId` 为空表示「没有来源选项」——旧记录迁移来的内容，或已停用选项留下的历史选择。
 */
export interface PlanItemInput {
  optionId: string | null
  name: string
}

// ---------------------------------------------------------------- 面板输入形状
//
// 这三个类型在 L6 从 `services/local/dayPlanService.ts` 提到共享层：本地与云端两套适配器
// 必须接受**完全一样**的面板输入，放在共享层就不会出现「两边各写一份、慢慢分叉」的情况。
// 两个服务模块仍会重新导出它们，页面原有的导入路径不变。

/** 一餐的完整内容：面板提交什么，这一餐就是什么。 */
export type MealInput = { meal_type: MealType; note: string; items: PlanItemInput[] }

/** 一条补剂实例：`id` 为空表示这次是新加的一条。 */
export type SupplementInput = {
  id: string | null
  name: string
  period: SupplementPeriod
  planned: boolean
  completed: boolean
}

/** 一次健身安排：决定与备注写进计划主记录，项目多选写进每日健身项。 */
export type ExerciseInput = {
  decision: DayPlan['exercise_decision']
  note: string
  items: PlanItemInput[]
}
