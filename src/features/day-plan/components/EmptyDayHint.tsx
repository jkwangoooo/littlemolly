import { EMPTY_DAY_TEXT } from '../dayPlanLabels'

/**
 * 未来空日期的引导块。
 * 纯展示，不触发任何写入：用户勾选准备项或保存任一编辑面板时才会真正创建当天计划，
 * 因此计划一旦产生，这个引导会自行消失，不需要额外的关闭状态。
 * 只在「未来且无计划」时由调用方渲染，历史日期与今天都不显示。
 */
export function EmptyDayHint() {
  return (
    <div className="empty-day">
      <strong>{EMPTY_DAY_TEXT.title}</strong>
      <p className="muted">{EMPTY_DAY_TEXT.body}</p>
    </div>
  )
}
