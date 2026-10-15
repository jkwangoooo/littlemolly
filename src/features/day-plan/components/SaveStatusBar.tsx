import type { SaveStatus } from '../../../shared/types/save'

const LOCAL_STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '尚未修改',
  saving: '正在保存到本地',
  saved: '已保存到本地',
  error: '本地保存失败',
}

/**
 * 本地保存状态与选项页的云端上传状态分开呈现。
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
      <p className={`status local-status ${status}`} aria-live="polite">
        {LOCAL_STATUS_TEXT[status]}
      </p>
      {saveError ? (
        <p className="notice" role="alert">
          保存失败：{saveError}
          <button className="secondary retry" type="button" disabled={status === 'saving' || !canRetry} onClick={onRetry}>
            重试
          </button>
        </p>
      ) : null}
      {loadError ? (
        <p className="notice" role="alert">
          读取失败：{loadError}
        </p>
      ) : null}
    </>
  )
}
