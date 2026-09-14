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

  return (
    <div className="date-heading">
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
