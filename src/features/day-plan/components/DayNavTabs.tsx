/** 今日页顶部页签：执行今天 / 准备明天。主入口「今日/本周/选项」统一走底部导航。 */
export function DayNavTabs({
  isPrepare,
  onExecuteToday,
  onPrepareTomorrow,
}: {
  isPrepare: boolean
  onExecuteToday: () => void
  onPrepareTomorrow: () => void
}) {
  return (
    <nav className="nav-tabs" aria-label="今日导航">
      <button className={isPrepare ? '' : 'active'} type="button" onClick={onExecuteToday}>
        执行今天
      </button>
      <button className={isPrepare ? 'active' : ''} type="button" onClick={onPrepareTomorrow}>
        准备明天
      </button>
    </nav>
  )
}
