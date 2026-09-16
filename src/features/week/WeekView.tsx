import { useEffect, useState } from 'react'
import type { DayPlan } from '../../shared/types/dayPlan'
import {
  classifyDate,
  defaultModeForDate,
  dayOfWeekMondayFirst,
  formatDateLabel,
  getBusinessDateKey,
  getWeekDates,
  WEEKDAY_LABELS,
} from '../../shared/date/dateUtils'
import { describeDataError } from '../../shared/errors'
import { listDayPlans } from '../../services/api/dayPlanService'
import { signOut } from '../../services/api/authService'
import { resolveWeekDayStatus, WEEK_DAY_STATUS_TEXT } from './weekStatus'
import { BottomNav } from '../../shared/components/BottomNav'
import type { View } from '../../shared/types/view'

function WeekDayCell({
  date,
  today,
  plan,
  isSelected,
  onSelect,
}: {
  date: string
  today: string
  plan: DayPlan | null
  isSelected: boolean
  onSelect: (date: string) => void
}) {
  const relation = classifyDate(date, today)
  const mode = plan?.mode ?? defaultModeForDate(date)
  const status = resolveWeekDayStatus(relation, plan)
  const className = ['week-day', isSelected ? 'selected' : '', relation === 'history' ? 'history' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <button className={className} type="button" onClick={() => onSelect(date)}>
      <span className="week-day-top">
        {WEEKDAY_LABELS[dayOfWeekMondayFirst(date)]} <small>{date.slice(5)}</small>
      </span>
      <strong>{mode === 'work' ? '工作日' : '休息日'}</strong>
      <span className="week-status">{WEEK_DAY_STATUS_TEXT[status]}</span>
    </button>
  )
}

/** 固定周一至周日的周视图。点击任意一天回到该日完整页面，历史日期在那边只读。 */
export function WeekView({
  selectedDate,
  onSelectDate,
  onNavigate,
}: {
  selectedDate: string
  onSelectDate: (date: string) => void
  onNavigate: (view: View) => void
}) {
  const [dates] = useState(() => getWeekDates(getBusinessDateKey()))
  const [plans, setPlans] = useState<DayPlan[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void listDayPlans(dates)
      .then((next) => {
        if (active) setPlans(next)
      })
      .catch((reason: unknown) => {
        if (active) setError(describeDataError(reason))
      })
    return () => {
      active = false
    }
  }, [dates])

  const today = getBusinessDateKey()
  const planByDate = new Map(plans.map((plan) => [plan.plan_date, plan]))

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">幸福小Molly</p>
          <h1>本周</h1>
        </div>
        <button className="secondary" type="button" onClick={() => void signOut()}>
          退出登录
        </button>
      </header>

      <section className="panel stack">
        <div>
          <p className="date-kicker">固定周视图</p>
          <h2>
            {formatDateLabel(dates[0])} – {formatDateLabel(dates[6])}
          </h2>
          <p className="muted">
            周一至周日 · {dates[0]} 至 {dates[6]}
          </p>
        </div>

        {error ? (
          <p className="notice" role="alert">
            {error}
          </p>
        ) : null}

        <div className="week-grid">
          {dates.map((date) => (
            <WeekDayCell
              key={date}
              date={date}
              today={today}
              plan={planByDate.get(date) ?? null}
              isSelected={date === selectedDate}
              onSelect={onSelectDate}
            />
          ))}
        </div>
      </section>

      <BottomNav current="week" onNavigate={onNavigate} />
    </main>
  )
}
