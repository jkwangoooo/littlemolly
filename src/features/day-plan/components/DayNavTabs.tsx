/** 今日页顶部页签：执行今天 / 准备明天 / 本周。 */
export function DayNavTabs({
  isPrepare,
  onExecuteToday,
  onPrepareTomorrow,
  onOpenWeek,
}: {
  isPrepare: boolean
  onExecuteToday: () => void
  onPrepareTomorrow: () => void
  onOpenWeek: () => void
}) {
  return (
    <nav className="nav-tabs" aria-label="今日导航">
      <button className={isPrepare ? '' : 'active'} type="button" onClick={onExecuteToday}>
        执行今天
      </button>
      <button className={isPrepare ? 'active' : ''} type="button" onClick={onPrepareTomorrow}>
        准备明天
      </button>
      <button type="button" onClick={onOpenWeek}>
        本周
      </button>
    </nav>
  )
}
