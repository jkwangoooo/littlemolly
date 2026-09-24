import type { DailyMeal, DailyMealItem, DailySupplement, DayPlan } from '../../../shared/types/dayPlan'
import { PREPARE_COMPLETE_TEXT } from '../dayPlanLabels'
import { getPrepActionItems } from './actionItems'
import { CollapsibleSection } from './CollapsibleSection'

export type PrepKey = 'outfit_ready' | 'meals_ready' | 'supplements_ready' | 'morning_ready' | 'exercise_ready'
export type PrepEditor = 'meals' | 'supplements' | 'morning' | 'exercise'

type PrepRow = { key: PrepKey; label: string; summary: string; editor?: PrepEditor }

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
  collapsed,
  onToggleSection,
  onToggle,
  onOpenEditor,
}: {
  plan: DayPlan | null
  meals: DailyMeal[]
  mealItems: DailyMealItem[]
  supplements: DailySupplement[]
  progress: number
  writable: boolean
  collapsed: boolean
  onToggleSection: () => void
  onToggle: (key: PrepKey) => void
  onOpenEditor: (editor: PrepEditor) => void
}) {
  const rows: PrepRow[] = getPrepActionItems({ plan, meals, mealItems, supplements }).map((item) => ({
    key: item.id as PrepKey,
    label: item.label,
    summary: item.detail ?? '',
    editor: item.id === 'meals_ready'
      ? 'meals'
      : item.id === 'supplements_ready'
        ? 'supplements'
        : item.id === 'morning_ready'
          ? 'morning'
          : item.id === 'exercise_ready'
            ? 'exercise'
            : undefined,
  }))

  return (
    <CollapsibleSection
      section="prepare"
      title="工作日准备区"
      collapsed={collapsed}
      onToggle={onToggleSection}
    >
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
    </CollapsibleSection>
  )
}
