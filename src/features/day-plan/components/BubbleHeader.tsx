import type { DateRelation } from '../../../shared/date/dateUtils'
import { dayOfWeekMondayFirst, formatDateLabel, WEEKDAY_LABELS } from '../../../shared/date/dateUtils'

export function BubbleHeader({ relation, selectedDate, mode, modeOverride, writable, onPrev, onNext, onSwitchMode, onRestoreDefault }: {
  relation: DateRelation; selectedDate: string; mode: 'work' | 'rest'; modeOverride: boolean; writable: boolean
  onPrev: () => void; onNext: () => void; onSwitchMode: () => void; onRestoreDefault: () => void
}) {
  const weekday = WEEKDAY_LABELS[dayOfWeekMondayFirst(selectedDate)]
  return <div className="bubble-page-header">
    <button className="bubble-date-button" type="button" aria-label="前一天" onClick={onPrev}>‹</button>
    <div className="bubble-page-heading"><div><span>{relation === 'today' ? '今天' : relation === 'tomorrow' ? '明天' : relation === 'history' ? '历史日期' : '未来日期'}</span><strong>{formatDateLabel(selectedDate)} · {weekday}</strong></div><small>{selectedDate} · {mode === 'work' ? '工作日' : '休息日'}{modeOverride ? ' · 已调整' : ''}</small></div>
    <button className="bubble-date-button" type="button" aria-label="后一天" onClick={onNext}>›</button>
    {writable ? <button className="bubble-mode-link" type="button" onClick={onSwitchMode}>改为{mode === 'work' ? '休息日' : '工作日'}</button> : null}{writable && modeOverride ? <button className="bubble-reset-link" type="button" onClick={onRestoreDefault}>恢复默认</button> : null}
  </div>
}
