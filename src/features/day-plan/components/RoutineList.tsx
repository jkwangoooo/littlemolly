import type { RoutineTask } from '../../../shared/types/dayPlan'
import { ROUTINE_TITLE } from '../dayPlanLabels'

/**
 * 休息日家务（拖地 / 洗衣）。只展示「完成」勾选，没有编辑面板——它们是每日实例，
 * 由正常休息日自动补齐（docs/00「仅正常休息日」），无需用户安排。
 * 历史日期只渲染内容，勾选禁用。列表为空时不渲染整个区块。
 */
export function RoutineList({
  routines,
  writable,
  onToggle,
}: {
  routines: RoutineTask[]
  writable: boolean
  onToggle: (id: string) => void
}) {
  if (routines.length === 0) return null

  return (
    <div className="execute-list">
      <h3>{ROUTINE_TITLE}</h3>
      {routines.map((routine) => (
        <label className="execution-row" data-routine={routine.kind} key={routine.id}>
          <input
            type="checkbox"
            checked={routine.completed}
            disabled={!writable}
            aria-label={`${routine.title}已完成`}
            onChange={() => onToggle(routine.id)}
          />
          <span>
            <strong>{routine.title}</strong>
          </span>
        </label>
      ))}
    </div>
  )
}
