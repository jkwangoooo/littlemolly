import type { DailyMeal, DayPlan } from '../../../shared/types/dayPlan'
import { MEAL_NAMES, PREPARE_COMPLETE_TEXT } from '../dayPlanLabels'

export type PrepKey = 'outfit_ready' | 'meals_ready' | 'supplements_ready' | 'morning_ready' | 'exercise_ready'
export type PrepEditor = 'meals' | 'morning' | 'exercise'

type PrepRow = { key: PrepKey; label: string; summary: string; editor?: PrepEditor }

function exerciseSummary(plan: DayPlan | null): string {
  if (plan?.exercise_decision === 'exercise') return '已决定健身'
  if (plan?.exercise_decision === 'rest') return '决定不健身'
  return '点击选择'
}

function mealSummary(meals: DailyMeal[]): string {
  const joined = meals.map((meal) => `${MEAL_NAMES[meal.meal_type]}：${meal.plan_content || '未填写'}`).join(' · ')
  return joined || '点击编辑三餐'
}

/**
 * 工作日五项准备。左侧勾选只表示「此项已准备」，点整行打开对应的底部编辑面板，
 * 两者严格分离；进度只由五个勾选框决定。
 */
export function PrepList({
  plan,
  meals,
  progress,
  writable,
  onToggle,
  onOpenEditor,
}: {
  plan: DayPlan | null
  meals: DailyMeal[]
  progress: number
  writable: boolean
  onToggle: (key: PrepKey) => void
  onOpenEditor: (editor: PrepEditor) => void
}) {
  const rows: PrepRow[] = [
    { key: 'outfit_ready', label: '衣服已经准备好', summary: '只记录是否准备好' },
    { key: 'meals_ready', label: '三餐已安排', summary: mealSummary(meals), editor: 'meals' },
    { key: 'supplements_ready', label: '早中晚补剂已安排', summary: '本阶段只记录准备状态' },
    {
      key: 'morning_ready',
      label: '晨间事项已安排',
      summary: plan?.morning_focus || '5:00-6:30 · 点击填写',
      editor: 'morning',
    },
    { key: 'exercise_ready', label: '健身安排已决定', summary: exerciseSummary(plan), editor: 'exercise' },
  ]

  return (
    <>
      <div className="progress-head">
        <strong>明日准备进度 {progress}/5</strong>
        <span>{progress === 5 ? PREPARE_COMPLETE_TEXT : ''}</span>
      </div>
      <div className="prep-list">
        {rows.map((row) => (
          <div className="prep-row" key={row.key}>
            <input
              type="checkbox"
              checked={Boolean(plan?.[row.key])}
              disabled={!writable}
              aria-label={row.label}
              onChange={() => onToggle(row.key)}
            />
            <button
              className="row-main"
              type="button"
              disabled={!row.editor}
              onClick={() => row.editor && onOpenEditor(row.editor)}
            >
              <strong>{row.label}</strong>
              <span>{row.summary}</span>
            </button>
            {row.editor ? <span className="arrow">›</span> : null}
          </div>
        ))}
      </div>
    </>
  )
}
