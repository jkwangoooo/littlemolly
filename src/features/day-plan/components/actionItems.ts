import type { DailyExerciseItem, DailyMeal, DailyMealItem, DailySupplement, DayMode, DayPlan } from '../../../shared/types/dayPlan'
import { MEAL_TYPES } from '../../../shared/types/dayPlan'
import { SUPPLEMENT_PERIODS } from '../../../shared/types/options'
import { SUPPLEMENT_PERIOD_LABEL } from '../../../shared/periodLabels'
import {
  EXECUTE_EXERCISE_DECIDED,
  EXECUTE_EXERCISE_LABEL,
  EXECUTE_MEAL_EMPTY,
  EXECUTE_MORNING_LABEL,
  MEAL_NAMES,
} from '../dayPlanLabels'
import type { NextActionItem } from './NextAction'

function join(detail: string, note?: string): string {
  return [detail, note].filter(Boolean).join(' · ')
}

export function getExecuteActionItems({
  plan,
  meals,
  mealItems,
  supplements,
  exerciseItems,
  mode,
}: {
  plan: DayPlan | null
  meals: DailyMeal[]
  mealItems: DailyMealItem[]
  supplements: DailySupplement[]
  exerciseItems: DailyExerciseItem[]
  mode: DayMode
}): NextActionItem[] {
  const isRest = mode === 'rest'
  const actions: NextActionItem[] = []
  const plannedSupplements = supplements.filter((item) => item.planned)
  const showMorning = !isRest && Boolean(plan?.morning_focus)
  const showExercise = plan?.exercise_decision === 'exercise'
  const showMeals = !isRest && (meals.length > 0 || showMorning || showExercise || plannedSupplements.length > 0)

  if (showMorning && plan) {
    actions.push({
      id: 'morning',
      label: EXECUTE_MORNING_LABEL,
      detail: plan.morning_focus,
      completed: plan.morning_completed,
    })
  }

  if (showMeals) {
    for (const type of MEAL_TYPES) {
      const meal = meals.find((item) => item.meal_type === type)
      const names = meal
        ? mealItems.filter((item) => item.daily_meal_id === meal.id).map((item) => item.food_name_snapshot)
        : []
      actions.push({
        id: `meal-${type}`,
        label: MEAL_NAMES[type],
        detail: join(names.join('、') || EXECUTE_MEAL_EMPTY, meal?.note),
        completed: Boolean(meal?.completed),
      })
    }
  }

  for (const row of plannedSupplements) {
    actions.push({
      id: `supplement-${row.id}`,
      label: `${SUPPLEMENT_PERIOD_LABEL[row.period]} · ${row.name_snapshot}`,
      completed: row.completed,
    })
  }

  if (showExercise && plan) {
    actions.push({
      id: 'exercise',
      label: EXECUTE_EXERCISE_LABEL.exercise,
      detail: join(
        exerciseItems.map((item) => item.name_snapshot).join('、') || EXECUTE_EXERCISE_DECIDED,
        plan.exercise_note,
      ),
      completed: plan.exercise_completed,
    })
  }

  return actions
}

function exerciseSummary(plan: DayPlan | null): string {
  if (plan?.exercise_decision === 'exercise') return '已决定健身'
  if (plan?.exercise_decision === 'rest') return '决定不健身'
  return '点击选择'
}

function mealSummary(meals: DailyMeal[], mealItems: DailyMealItem[]): string {
  return MEAL_TYPES.map((type) => {
    const meal = meals.find((item) => item.meal_type === type)
    const names = meal
      ? mealItems.filter((item) => item.daily_meal_id === meal.id).map((item) => item.food_name_snapshot)
      : []
    return `${MEAL_NAMES[type]}：${names.join('、') || '未安排'}`
  }).join(' · ')
}

function supplementSummary(supplements: DailySupplement[]): string {
  const planned = supplements.filter((row) => row.planned)
  if (!planned.length) return '点击安排补剂'

  const groups = SUPPLEMENT_PERIODS.map((period) => {
    const names = planned.filter((row) => row.period === period).map((row) => row.name_snapshot)
    return names.length ? `${SUPPLEMENT_PERIOD_LABEL[period]} ${names.join('、')}` : ''
  }).filter(Boolean)

  return groups.join(' · ') || '点击安排补剂'
}

export function getPrepActionItems({
  plan,
  meals,
  mealItems,
  supplements,
}: {
  plan: DayPlan | null
  meals: DailyMeal[]
  mealItems: DailyMealItem[]
  supplements: DailySupplement[]
}): NextActionItem[] {
  return [
    { id: 'outfit_ready', label: '衣服已经准备好', detail: '只记录是否准备好' },
    { id: 'meals_ready', label: '三餐已安排', detail: mealSummary(meals, mealItems) },
    { id: 'supplements_ready', label: '早中晚补剂已安排', detail: supplementSummary(supplements) },
    { id: 'morning_ready', label: '晨间事项已安排', detail: plan?.morning_focus || '5:00-6:30 · 点击填写' },
    { id: 'exercise_ready', label: '健身安排已决定', detail: exerciseSummary(plan) },
  ].map((item) => ({ ...item, completed: Boolean(plan?.[item.id as keyof DayPlan]) }))
}
