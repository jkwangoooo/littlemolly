import { useServiceWorkerUpdate } from '../hooks/useServiceWorkerUpdate'

/**
 * 新版本提示条。
 *
 * 只在真的有 waiting worker 时出现，且**不会自动刷新页面**：
 * 用户可能正在编辑一份计划，静默换版本等于让他的输入凭空消失。
 * 文案刻意写成「已下载，刷新后生效」——不是「已更新」，因为此刻页面跑的还是旧版本。
 */
export function UpdateNotice() {
  const { available, apply } = useServiceWorkerUpdate()
  if (!available) return null

  return (
    <div className="update-notice" role="status" data-update-notice>
      <span>新版本已下载，刷新后生效。</span>
      <button className="secondary mini" type="button" onClick={apply}>
        刷新
      </button>
    </div>
  )
}
