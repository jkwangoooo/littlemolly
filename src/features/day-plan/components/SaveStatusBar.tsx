import type { SaveStatus } from '../../../shared/types/save'
import { SAVE_STATUS_TEXT } from '../dayPlanLabels'

/**
 * 保存状态条。本地保存成功只显示「已保存」，不伪装成云端同步成功。
 * 读取失败与保存失败分开提示：读取失败没有可重试的写入请求，因此不显示重试按钮。
 */
export function SaveStatusBar({
  status,
  saveError,
  loadError,
  canRetry,
  onRetry,
}: {
  status: SaveStatus
  saveError: string | null
  loadError: string | null
  canRetry: boolean
  onRetry: () => void
}) {
  return (
    <>
      <p className={`status ${status}`} aria-live="polite">
        本地保存状态：{SAVE_STATUS_TEXT[status]}
      </p>
      {saveError ? (
        <p className="notice" role="alert">
          保存失败：{saveError}
          <button className="secondary retry" type="button" disabled={status === 'saving' || !canRetry} onClick={onRetry}>
            重试
          </button>
        </p>
      ) : null}
      {!saveError && loadError ? (
        <p className="notice" role="alert">
          读取失败：{loadError}
        </p>
      ) : null}
    </>
  )
}
