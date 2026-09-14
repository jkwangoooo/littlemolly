import type { DailyMeal, DayPlan } from '../../../shared/types/dayPlan'
import { MEAL_NAMES } from '../dayPlanLabels'

export type ExecutionTarget = 'morning' | 'exercise' | 'meal'

/**
 * 执行区。显示的是各项实际完成勾选，与准备区的「已安排」严格分开：
 * 「三餐已安排」不等于「三餐已吃」。
 */
export function ExecuteList({
  plan,
  meals,
  writable,
  onToggle,
}: {
  plan: DayPlan | null
  meals: DailyMeal[]
  writable: boolean
  onToggle: (target: ExecutionTarget, id?: string) => void
}) {
  const showExercise = plan?.exercise_decision && plan.exercise_decision !== 'undecided'

  return (
    <div className="execute-list">
      <h3>今日计划</h3>

      {meals.map((meal) => (
        <label className="execution-row" key={meal.id}>
          <input
            type="checkbox"
            checked={meal.completed}
            disabled={!writable}
            onChange={() => onToggle('meal', meal.id)}
          />
          <span>
            <strong>{MEAL_NAMES[meal.meal_type]}</strong>
            <small>
              {meal.plan_content || '未安排'}
              {meal.note ? ` · ${meal.note}` : ''}
            </small>
          </span>
        </label>
      ))}

      {plan?.morning_focus ? (
        <label className="execution-row">
          <input
            type="checkbox"
            checked={plan.morning_completed}
            disabled={!writable}
            onChange={() => onToggle('morning')}
          />
          <span>
            <strong>晨间专注 5:00-6:30</strong>
            <small>{plan.morning_focus}</small>
          </span>
        </label>
      ) : null}

      {showExercise ? (
        <label className="execution-row">
          <input
            type="checkbox"
            checked={plan.exercise_completed}
            disabled={!writable}
            onChange={() => onToggle('exercise')}
          />
          <span>
            <strong>{plan.exercise_decision === 'exercise' ? '健身' : '不健身'}</strong>
            <small>{plan.exercise_content || '已决定'}</small>
          </span>
        </label>
      ) : null}
    </div>
  )
}
