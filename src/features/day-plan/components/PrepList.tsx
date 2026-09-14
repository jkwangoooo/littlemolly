import type { DailyMeal, DailyMealItem, DailySupplement, DayPlan } from '../../../shared/types/dayPlan'
import { MEAL_TYPES } from '../../../shared/types/dayPlan'
import { SUPPLEMENT_PERIODS } from '../../../shared/types/options'
import { SUPPLEMENT_PERIOD_LABEL } from '../../../shared/periodLabels'
import { MEAL_NAMES, PREPARE_COMPLETE_TEXT } from '../dayPlanLabels'

export type PrepKey = 'outfit_ready' | 'meals_ready' | 'supplements_ready' | 'morning_ready' | 'exercise_ready'
export type PrepEditor = 'meals' | 'supplements' | 'morning' | 'exercise'

type PrepRow = { key: PrepKey; label: string; summary: string; editor?: PrepEditor }

function exerciseSummary(plan: DayPlan | null): string {
  if (plan?.exercise_decision === 'exercise') return '已决定健身'
  if (plan?.exercise_decision === 'rest') return '决定不健身'
  return '点击选择'
}

/** 三餐摘要按早餐 → 午餐 → 晚餐固定顺序列出内容项，展示一律用名称快照。 */
function mealSummary(meals: DailyMeal[], mealItems: DailyMealItem[]): string {
  return MEAL_TYPES.map((type) => {
    const meal = meals.find((item) => item.meal_type === type)
    const names = meal
      ? mealItems.filter((item) => item.daily_meal_id === meal.id).map((item) => item.food_name_snapshot)
      : []
    return `${MEAL_NAMES[type]}：${names.join('、') || '未安排'}`
  }).join(' · ')
}

/** 补剂摘要只列「今天吃」的项，按时段聚合；一条都没有时给出下一步动作。 */
function supplementSummary(supplements: DailySupplement[]): string {
  const planned = supplements.filter((row) => row.planned)
  if (!planned.length) return '点击安排补剂'

  const groups = SUPPLEMENT_PERIODS.map((period) => {
    const names = planned.filter((row) => row.period === period).map((row) => row.name_snapshot)
    return names.length ? `${SUPPLEMENT_PERIOD_LABEL[period]} ${names.join('、')}` : ''
  }).filter(Boolean)

  return groups.join(' · ') || '点击安排补剂'
}

/**
 * 工作日五项准备。左侧勾选只表示「此项已准备」，点整行打开对应的底部编辑面板，
 * 两者严格分离；进度只由五个勾选框决定。
 */
export function PrepList({
  plan,
  meals,
  mealItems,
  supplements,
  progress,
  writable,
  onToggle,
  onOpenEditor,
}: {
  plan: DayPlan | null
  meals: DailyMeal[]
  mealItems: DailyMealItem[]
  supplements: DailySupplement[]
  progress: number
  writable: boolean
  onToggle: (key: PrepKey) => void
  onOpenEditor: (editor: PrepEditor) => void
}) {
  const rows: PrepRow[] = [
    { key: 'outfit_ready', label: '衣服已经准备好', summary: '只记录是否准备好' },
    { key: 'meals_ready', label: '三餐已安排', summary: mealSummary(meals, mealItems), editor: 'meals' },
    {
      key: 'supplements_ready',
      label: '早中晚补剂已安排',
      summary: supplementSummary(supplements),
      editor: 'supplements',
    },
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
