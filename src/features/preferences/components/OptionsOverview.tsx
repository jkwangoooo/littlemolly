import { useSyncExternalStore } from 'react'
import type { OptionKind } from '../../../shared/types/options'
import { getStorageSnapshot, subscribeStorage } from '../../../shared/storage/storageStatus'
import {
  OPTIONS_GROUP_ACCOUNT,
  OPTIONS_GROUP_LISTS,
  OPTIONS_GROUP_SYSTEM,
  OPTION_KIND_TITLE,
  STORAGE_MODE_TEXT,
  STORAGE_PERSIST_TEXT,
  STORAGE_USAGE_UNKNOWN,
} from '../preferencesLabels'

export type OptionsSection = 'food' | 'supplement' | 'exercise' | 'backup' | 'storage'

/**
 * 选项页的概览（docs/17 §4.1）。
 *
 * 这一页只放**带状态摘要的入口行**，不展开任何清单：
 * - 用户一进来就能看到三类清单各有多少项可用，以及这台设备的数据与账号状态；
 * - 需要维护哪一类，再进对应的子屏。这样概览稳定在一屏内，
 *   而不是把三份清单和两张系统卡片平铺成 4 屏（改前的实测值）。
 *
 * 分组标题不是装饰：清单类与系统类的用途完全不同（一个会反复维护，一个装完就不管），
 * 用标题分开是 Android Settings 模式里明确要求的 containment 做法。
 */
export function OptionsOverview({
  counts,
  selectable,
  total,
  busy,
  email,
  onOpen,
  onSeed,
  onSignOut,
}: {
  counts: Record<OptionKind, number>
  selectable: Record<OptionKind, number>
  total: number
  busy: boolean
  email: string
  onOpen: (section: OptionsSection) => void
  onSeed: () => void
  onSignOut: () => void
}) {
  const storage = useSyncExternalStore(subscribeStorage, getStorageSnapshot, getStorageSnapshot)

  const persistText = !storage.persistSupported
    ? STORAGE_PERSIST_TEXT.unsupported
    : storage.persisted === null
      ? STORAGE_USAGE_UNKNOWN
      : storage.persisted
        ? STORAGE_PERSIST_TEXT.granted
        : STORAGE_PERSIST_TEXT.denied
  const modeText = storage.standalone ? STORAGE_MODE_TEXT.standalone : STORAGE_MODE_TEXT.browser

  const listSubtitle = (kind: OptionKind) =>
    counts[kind] === 0 ? '还没有选项' : `启用 ${selectable[kind]} 项`

  return (
    <>
      {total === 0 ? (
        <div className="empty-day">
          <strong>还没有任何选项</strong>
          <p className="muted">可以先载入一组示例食物、补剂和健身项目，再按自己的习惯改。</p>
          <div className="actions">
            <button className="secondary" type="button" disabled={busy} onClick={onSeed}>
              载入示例选项
            </button>
          </div>
        </div>
      ) : null}

      <p className="option-group-label">{OPTIONS_GROUP_LISTS}</p>
      <div className="nav-list">
        {(['food', 'supplement', 'exercise'] as OptionKind[]).map((kind) => (
          <button
            key={kind}
            className="nav-row"
            type="button"
            data-option-entry={kind}
            onClick={() => onOpen(kind)}
          >
            <span>
              <strong>{OPTION_KIND_TITLE[kind]}</strong>
              <small>{listSubtitle(kind)}</small>
            </span>
            <span className="arrow" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </div>

      <p className="option-group-label">{OPTIONS_GROUP_SYSTEM}</p>
      <div className="nav-list">
        <button className="nav-row" type="button" data-option-entry="backup" onClick={() => onOpen('backup')}>
          <span>
            <strong>本地数据备份</strong>
            <small>导出 / 导入 JSON 备份</small>
          </span>
          <span className="arrow" aria-hidden="true">
            ›
          </span>
        </button>
        <button className="nav-row" type="button" data-option-entry="storage" onClick={() => onOpen('storage')}>
          <span>
            <strong>存储与安装</strong>
            <small>{`${modeText} · ${persistText}`}</small>
          </span>
          <span className="arrow" aria-hidden="true">
            ›
          </span>
        </button>
      </div>

      <p className="option-group-label">{OPTIONS_GROUP_ACCOUNT}</p>
      <div className="nav-list">
        <div className="nav-row static">
          <span>
            <strong>当前登录</strong>
            <small>{email || '未登录'}</small>
          </span>
        </div>
      </div>
      <div className="actions">
        <button className="secondary" type="button" onClick={onSignOut}>
          退出登录
        </button>
      </div>
    </>
  )
}
