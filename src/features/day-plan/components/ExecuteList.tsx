import type { DailyExerciseItem, DailyMeal, DailyMealItem, DailySupplement, DayMode, DayPlan, MealType } from '../../../shared/types/dayPlan'
import { MEAL_TYPES } from '../../../shared/types/dayPlan'
import { SUPPLEMENT_PERIOD_LABEL } from '../../../shared/periodLabels'
import {
  EXECUTE_EMPTY,
  EXECUTE_EXERCISE_DECIDED,
  EXECUTE_EXERCISE_LABEL,
  EXECUTE_MEAL_EMPTY,
  EXECUTE_MORNING_LABEL,
  EXECUTE_SUPPLEMENT_TITLE,
  EXECUTE_TITLE,
  MEAL_NAMES,
} from '../dayPlanLabels'

/**
 * 执行区的勾选目标。用判别联合而不是 `(target, id?)`：
 * 三餐的 id 其实是「哪一餐」，补剂的 id 才是记录主键，两者混在一个字符串参数里迟早会传错。
 */
export type ExecutionToggle =
  | { kind: 'meal'; mealType: MealType }
  | { kind: 'supplement'; id: string }
  | { kind: 'morning' }
  | { kind: 'exercise' }

function join(detail: string, note?: string): string {
  return [detail, note].filter(Boolean).join(' · ')
}

/**
 * 执行区。显示的是各项实际完成勾选，与准备区的「已安排」严格分开：
 * 「三餐已安排」不等于「三餐已吃」。
 *
 * 补剂只列「今天吃」的项——被取消勾选的那几条是这一天的内容，但当天并不打算吃，
 * 放在执行区只会变成永远勾不动的噪音。健身只在决定为「健身」时才出现。
 *
 * 休息日（`mode === 'rest'`）只保留补剂与健身，隐藏三餐与晨间——这两项是工作日专属
 * （docs/00「仅工作日」），休息日不展示。
 */
export function ExecuteList({
  plan,
  meals,
  mealItems,
  supplements,
  exerciseItems,
  writable,
  mode,
  onToggle,
}: {
  plan: DayPlan | null
  meals: DailyMeal[]
  mealItems: DailyMealItem[]
  supplements: DailySupplement[]
  exerciseItems: DailyExerciseItem[]
  writable: boolean
  mode: DayMode
  onToggle: (toggle: ExecutionToggle) => void
}) {
  const isRest = mode === 'rest'
  const plannedSupplements = supplements.filter((row) => row.planned)
  const showMorning = !isRest && Boolean(plan?.morning_focus)
  const showExercise = plan?.exercise_decision === 'exercise'
  const showMeals = !isRest
  // 休息日不展示三餐与晨间，因此空态只看「补剂 + 健身」是否有内容。
  const empty = (isRest
    ? plannedSupplements.length === 0 && !showExercise
    : meals.length === 0 && !showMorning && !showExercise && plannedSupplements.length === 0)

  return (
    <div className="execute-list">
      <h3>{EXECUTE_TITLE}</h3>

      {empty ? <p className="muted empty-note">{EXECUTE_EMPTY}</p> : null}

      {!empty && showMeals
        ? MEAL_TYPES.map((type) => {
            const meal = meals.find((item) => item.meal_type === type)
            const names = meal
              ? mealItems.filter((item) => item.daily_meal_id === meal.id).map((item) => item.food_name_snapshot)
              : []
            return (
              <label className="execution-row" data-meal={type} key={type}>
                <input
                  type="checkbox"
                  checked={Boolean(meal?.completed)}
                  disabled={!writable}
                  aria-label={`${MEAL_NAMES[type]}已完成`}
                  onChange={() => onToggle({ kind: 'meal', mealType: type })}
                />
                <span>
                  <strong>{MEAL_NAMES[type]}</strong>
                  <small>{join(names.join('、') || EXECUTE_MEAL_EMPTY, meal?.note)}</small>
                </span>
              </label>
            )
          })
        : null}

      {showMorning && plan ? (
        <label className="execution-row">
          <input
            type="checkbox"
            checked={plan.morning_completed}
            disabled={!writable}
            aria-label={`${EXECUTE_MORNING_LABEL}已完成`}
            onChange={() => onToggle({ kind: 'morning' })}
          />
          <span>
            <strong>{EXECUTE_MORNING_LABEL}</strong>
            <small>{plan.morning_focus}</small>
          </span>
        </label>
      ) : null}

      {plannedSupplements.length ? (
        <>
          <h3 className="section-title">{EXECUTE_SUPPLEMENT_TITLE}</h3>
          {plannedSupplements.map((row) => (
            <label className="execution-row" data-supplement={row.period} key={row.id}>
              <input
                type="checkbox"
                checked={row.completed}
                disabled={!writable}
                aria-label={`${row.name_snapshot}已完成`}
                onChange={() => onToggle({ kind: 'supplement', id: row.id })}
              />
              <span>
                <strong>
                  {SUPPLEMENT_PERIOD_LABEL[row.period]} · {row.name_snapshot}
                </strong>
              </span>
            </label>
          ))}
        </>
      ) : null}

      {showExercise && plan ? (
        <label className="execution-row">
          <input
            type="checkbox"
            checked={plan.exercise_completed}
            disabled={!writable}
            aria-label={`${EXECUTE_EXERCISE_LABEL.exercise}已完成`}
            onChange={() => onToggle({ kind: 'exercise' })}
          />
          <span>
            <strong>{EXECUTE_EXERCISE_LABEL.exercise}</strong>
            <small>
              {join(
                exerciseItems.map((item) => item.name_snapshot).join('、') || EXECUTE_EXERCISE_DECIDED,
                plan.exercise_note,
              )}
            </small>
          </span>
        </label>
      ) : null}
    </div>
  )
}
