import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  canPromptInstall,
  promptInstall,
  subscribeInstallPrompt,
} from '../../../shared/storage/installPrompt'
import {
  getStorageSnapshot,
  refreshStorageSnapshot,
  subscribeStorage,
} from '../../../shared/storage/storageStatus'
import {
  STORAGE_HINT,
  STORAGE_INSTALL_ACCEPTED_NOTE,
  STORAGE_INSTALL_ACTION,
  STORAGE_INSTALL_DISMISSED_NOTE,
  STORAGE_INSTALLED_NOTE,
  STORAGE_IOS_HINT,
  STORAGE_MODE_LABEL,
  STORAGE_MODE_TEXT,
  STORAGE_NO_PROMPT_HINT,
  STORAGE_PERSIST_LABEL,
  STORAGE_PERSIST_TEXT,
  STORAGE_REFRESH_ACTION,
  STORAGE_TITLE,
  STORAGE_USAGE_LABEL,
  STORAGE_USAGE_UNKNOWN,
  STORAGE_WHY,
} from '../preferencesLabels'

/** 把字节数写成人能读的量级；读不到时如实说读不到，不显示 0 B。 */
function formatSize(bytes: number | null): string {
  if (bytes === null) return STORAGE_USAGE_UNKNOWN
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

/**
 * 是不是 iOS / iPadOS。
 * iPadOS 13 起 Safari 把自己报成 macOS，只能再用「Mac + 多点触控」把它认出来——
 * 漏判的后果是给 iPad 用户显示一个永远不会出现的安装按钮。
 */
function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1
}

/**
 * 存储与安装卡片。
 *
 * 三行事实（用量 / 是否持久化 / 是否独立窗口）全部来自浏览器自己的回答，
 * 不做任何推断，也不把「请求了持久化」写成「数据已安全」。
 * 安装入口按平台分三种情况：已安装 / 系统不支持程序化安装（iOS）/ 浏览器给了安装事件。
 */
export function StorageCard() {
  const snapshot = useSyncExternalStore(subscribeStorage, getStorageSnapshot, getStorageSnapshot)
  const canInstall = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, () => false)
  const [ios] = useState(isIosDevice)
  const [installNote, setInstallNote] = useState<string | null>(null)

  // 卡片出现时读一次真实状态。启动时已经请求过一次持久化，这里只是取最新结果。
  useEffect(() => {
    void refreshStorageSnapshot()
  }, [])

  const handleInstall = useCallback(async () => {
    const outcome = await promptInstall()
    if (outcome === 'accepted') setInstallNote(STORAGE_INSTALL_ACCEPTED_NOTE)
    else if (outcome === 'dismissed') setInstallNote(STORAGE_INSTALL_DISMISSED_NOTE)
    else setInstallNote(STORAGE_NO_PROMPT_HINT)
  }, [])

  const persistText = !snapshot.persistSupported
    ? STORAGE_PERSIST_TEXT.unsupported
    : snapshot.persisted
      ? STORAGE_PERSIST_TEXT.granted
      : STORAGE_PERSIST_TEXT.denied

  const usageText =
    snapshot.quotaBytes === null
      ? formatSize(snapshot.usageBytes)
      : `${formatSize(snapshot.usageBytes)} / 可用 ${formatSize(snapshot.quotaBytes)}`

  return (
    <section className="option-section storage-card" data-storage-card>
      <div className="timeline-head">
        <h3>{STORAGE_TITLE}</h3>
      </div>

      <p className="muted account-body">{STORAGE_HINT}</p>

      <dl className="storage-facts">
        <div className="storage-fact">
          <dt>{STORAGE_USAGE_LABEL}</dt>
          <dd data-storage-usage>{usageText}</dd>
        </div>
        <div className="storage-fact">
          <dt>{STORAGE_PERSIST_LABEL}</dt>
          <dd data-storage-persisted>{persistText}</dd>
        </div>
        <div className="storage-fact">
          <dt>{STORAGE_MODE_LABEL}</dt>
          <dd data-storage-standalone>{snapshot.standalone ? STORAGE_MODE_TEXT.standalone : STORAGE_MODE_TEXT.browser}</dd>
        </div>
      </dl>

      {snapshot.standalone ? (
        <p className="muted account-body" data-storage-installed>
          {STORAGE_INSTALLED_NOTE}
        </p>
      ) : null}

      {!snapshot.standalone && ios ? (
        <p className="muted account-body" data-storage-ios-hint>
          {STORAGE_IOS_HINT}
        </p>
      ) : null}

      {installNote ? (
        <p className="muted account-body" role="status" data-storage-install-note>
          {installNote}
        </p>
      ) : null}

      <div className="actions">
        <button className="secondary" type="button" onClick={() => void refreshStorageSnapshot()}>
          {STORAGE_REFRESH_ACTION}
        </button>
        {canInstall && !snapshot.standalone ? (
          <button type="button" onClick={() => void handleInstall()}>
            {STORAGE_INSTALL_ACTION}
          </button>
        ) : null}
      </div>

      <p className="muted account-body">{STORAGE_WHY}</p>
    </section>
  )
}
