<<<<<<< HEAD
import { useRef } from 'react'
=======
>>>>>>> origin/main
import type { DateRelation } from '../../../shared/date/dateUtils'
import { dayOfWeekMondayFirst, formatDateLabel, WEEKDAY_LABELS } from '../../../shared/date/dateUtils'

const RELATION_KICKER: Record<DateRelation, string> = {
  today: '今天',
  tomorrow: '明天',
  history: '历史日期',
  future: '未来日期',
}

/** 日期标题与前后一天切换。星期用统一的周一优先换算，避免各页面各算一套。 */
export function DateHeading({
  relation,
  selectedDate,
  onPrev,
  onNext,
}: {
  relation: DateRelation
  selectedDate: string
  onPrev: () => void
  onNext: () => void
}) {
  const weekday = WEEKDAY_LABELS[dayOfWeekMondayFirst(selectedDate)]
<<<<<<< HEAD
  const pointerStart = useRef<{ id: number; x: number; y: number } | null>(null)

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || event.target instanceof Element && event.target.closest('button')) return
    pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current
    pointerStart.current = null
    if (!start || start.id !== event.pointerId || event.target instanceof Element && event.target.closest('button')) return

    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.5) return
    if (deltaX < 0) onNext()
    else onPrev()
  }

  return (
    <div
      className="date-heading"
      data-date-swipe="true"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStart.current = null }}
    >
=======

  return (
    <div className="date-heading">
>>>>>>> origin/main
      <button className="icon-button" type="button" aria-label="前一天" onClick={onPrev}>
        ‹
      </button>
      <div>
        <p className="date-kicker">{RELATION_KICKER[relation]}</p>
        <h2>
          {formatDateLabel(selectedDate)} · {weekday}
        </h2>
        <p className="muted">{selectedDate}</p>
      </div>
      <button className="icon-button" type="button" aria-label="后一天" onClick={onNext}>
        ›
      </button>
    </div>
  )
}
