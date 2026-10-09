import type { TodayRoute as Route } from './todayRouteModel'
import './dayPlanAside.css'

export function DayPlanAside({
  route,
  prepare,
  progress,
  saving,
  relation,
}: {
  route: Route
  prepare: boolean
  progress: number
  saving: boolean
  relation: 'today' | 'tomorrow' | 'future' | 'history'
}) {
  const completed = route.nodes.filter((node) => node.kind !== 'prep' && node.state !== 'readonly' && node.completed).length
  const executable = route.nodes.filter((node) => node.kind !== 'prep' && node.state !== 'readonly').length
  const focus = route.focus

  return (
    <aside className="day-plan-aside" aria-label="日程概览">
      <section className="day-plan-aside-section">
        <p className="eyebrow">当前状态</p>
        <strong className="day-plan-aside-title">{prepare ? '准备明天' : '执行今天'}</strong>
        <p className="day-plan-aside-copy">
          {relation === 'history' ? '这是历史日期，只读查看。' : relation === 'future' || relation === 'tomorrow' ? '提前安排下一步，让明天更从容。' : '按节奏完成今天正在发生的事。'}
        </p>
      </section>

      <section className="day-plan-aside-section">
        <div className="day-plan-aside-row">
          <span>{prepare ? '准备进度' : '完成进度'}</span>
          <strong>{prepare ? `${progress}/5` : `${completed}/${executable}`}</strong>
        </div>
        <div className="day-plan-progress" aria-hidden="true">
          <span style={{ width: `${Math.round((prepare ? progress / 5 : executable ? completed / executable : 0) * 100)}%` }} />
        </div>
      </section>

      <section className="day-plan-aside-section">
        <p className="eyebrow">下一项</p>
        <strong className="day-plan-aside-focus">{focus?.title ?? '今天已经安排好了'}</strong>
        <p className="day-plan-aside-copy">{focus?.detail || (saving ? '正在保存到本地…' : '完成一项，再继续下一项。')}</p>
      </section>
    </aside>
  )
}
