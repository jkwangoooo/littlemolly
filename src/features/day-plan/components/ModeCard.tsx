import type { DayMode } from '../../../shared/types/dayPlan'
import { MODE_LABEL } from '../dayPlanLabels'

/**
 * 日期类型卡片。点击按钮只打开二次确认，不直接改数据；取消不产生任何写入。
 * 历史日期不显示切换与恢复默认入口。
 */
export function ModeCard({
  mode,
  modeOverride,
  writable,
  onRequestSwitch,
  onRestoreDefault,
}: {
  mode: DayMode
  modeOverride: boolean
  writable: boolean
  onRequestSwitch: () => void
  onRestoreDefault: () => void
}) {
  return (
    <div className="mode-card">
      <div>
        <p className="muted">日期类型</p>
        <strong>{MODE_LABEL[mode]}</strong>
        <p className="mode-detail">{modeOverride ? '人工覆盖默认模式' : '按星期自动判断'}</p>
      </div>
      {writable ? (
        <div className="actions">
          <button type="button" onClick={onRequestSwitch}>
            改为{mode === 'work' ? '休息日' : '工作日'}
          </button>
          {modeOverride ? (
            <button className="secondary" type="button" onClick={onRestoreDefault}>
              恢复默认
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
