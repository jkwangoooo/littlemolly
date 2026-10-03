import { ACCOUNT_TEXT, ACCOUNT_TITLE } from '../preferencesLabels'

/**
 * 本地账号卡片。
 *
 * 只负责展示当前登录的是哪个本地账号。
 * 云端连接状态、待上传条数和上传时间由 `SyncCard` 负责。
 * 本卡片**不显示任何上传 / 同步状态**（`docs/05` 规则 6）：那是 `SyncCard` 的职责。
 * 两边都显示，迟早会出现「一张说待上传 3 条、另一张说已保存」这种自相矛盾的画面。
 */
export function AccountCard({ username }: { username: string }) {
  return (
    <section className="option-section account-card">
      <div className="timeline-head">
        <h3>{ACCOUNT_TITLE}</h3>
      </div>

      <p className="account-line">
        <strong>{ACCOUNT_TEXT.mode}</strong> · 当前登录：{username}
      </p>
      <p className="muted account-body">{ACCOUNT_TEXT.body}</p>
    </section>
  )
}
