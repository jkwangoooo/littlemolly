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
 * 编辑面板提交的一项内容：只有名称与来源选项，快照字段由服务层补齐。
 * `optionId` 为空表示「没有来源选项」——旧记录迁移来的内容，或已停用选项留下的历史选择。
 */
export interface PlanItemInput {
  optionId: string | null
  name: string
}
