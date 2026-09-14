import { useEffect, useState } from 'react'
import type { DayPlan } from '../../shared/types/dayPlan'
import { classifyDate, defaultModeForDate, formatDateLabel, getBusinessDateKey, getWeekDates, WEEKDAY_LABELS } from '../../shared/date/dateUtils'
import { listDayPlans } from '../../services/local/dayPlanService'
import { signOut } from '../../services/local/authService'

export function WeekView({ selectedDate, onSelectDate, onBackToDay }: { selectedDate: string; onSelectDate: (date: string) => void; onBackToDay: () => void }) {
  const [dates] = useState(() => getWeekDates(getBusinessDateKey()))
  const [plans, setPlans] = useState<DayPlan[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void listDayPlans(dates).then(setPlans).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '读取失败。')) }, [dates])
  const byDate = new Map(plans.map((plan) => [plan.plan_date, plan]))
  const today = getBusinessDateKey()
  return <main className="page"><header className="topbar"><div><p className="eyebrow">幸福小Molly</p><h1>本周</h1></div><button className="secondary" type="button" onClick={() => void signOut()}>退出登录</button></header><nav className="nav-tabs" aria-label="主导航"><button type="button" onClick={onBackToDay}>今日</button><button className="active" type="button">本周</button></nav><section className="panel stack"><div><p className="date-kicker">固定周视图</p><h2>{formatDateLabel(dates[0])} – {formatDateLabel(dates[6])}</h2><p className="muted">周一至周日 · {dates[0]} 至 {dates[6]}</p></div>{error && <p className="notice" role="alert">{error}</p>}<div className="week-grid">{dates.map((date, index) => { const relation = classifyDate(date, today); const plan = byDate.get(date); const mode = plan?.mode ?? defaultModeForDate(date); const status = relation === 'history' ? '历史仅查看' : plan ? relation === 'today' ? '执行中' : '待准备' : '未规划'; return <button key={date} className={`week-day ${date === selectedDate ? 'selected' : ''} ${relation === 'history' ? 'history' : ''}`} type="button" onClick={() => onSelectDate(date)}><span className="week-day-top">{WEEKDAY_LABELS[index]} <small>{date.slice(5)}</small></span><strong>{mode === 'work' ? '工作日' : '休息日'}</strong><span className="week-status">{status}</span></button> })}</div></section></main>
}
