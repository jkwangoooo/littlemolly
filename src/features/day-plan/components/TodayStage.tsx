import type { TodayRoute as Route, TodayRouteNode } from './todayRouteModel'
import { TodayStack } from './TodayStack'

export function TodayStage({
  route,
  prepare,
  progress,
  saving,
  saveError,
  canRetry,
  onRetry,
  onToggle,
  onArrange,
  onCopyYesterday,
  onAddTask,
  onEditTask,
  onDeleteTask,
}: {
  route: Route
  prepare: boolean
  progress: number
  saving: boolean
  saveError: string | null
  canRetry: boolean
  onRetry: () => void
  onToggle: (node: TodayRouteNode) => void
  onArrange: (node: TodayRouteNode) => void
  onCopyYesterday: () => void
  onAddTask: () => void
  onEditTask: (node: TodayRouteNode) => void
  onDeleteTask: (node: TodayRouteNode) => void
}) {
  return (
    <div className="today-stage">
      <TodayStack
        route={route}
        progress={progress}
        saving={saving}
        saveError={saveError}
        canRetry={canRetry}
        onRetry={onRetry}
        prepare={prepare}
        onToggle={onToggle}
        onArrange={onArrange}
        onCopyYesterday={onCopyYesterday}
        onAddTask={onAddTask}
        onEditTask={onEditTask}
        onDeleteTask={onDeleteTask}
      />
    </div>
  )
}
