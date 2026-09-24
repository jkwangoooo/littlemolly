import type { DayPlan } from '../../shared/types/dayPlan'
import type { DateRelation } from '../../shared/date/dateUtils'

/** 周视图单日状态。history 优先于是否存在计划，历史日期永远只读。 */
export type WeekDayStatus = 'history' | 'running' | 'ready' | 'unplanned'

export const WEEK_DAY_STATUS_TEXT: Record<WeekDayStatus, string> = {
  history: '历史仅查看',
  running: '执行中',
  ready: '待准备',
  unplanned: '未规划',
}

export function resolveWeekDayStatus(relation: DateRelation, plan: DayPlan | null): WeekDayStatus {
  if (relation === 'history') return 'history'
  if (!plan) return 'unplanned'
  return relation === 'today' ? 'running' : 'ready'
}
