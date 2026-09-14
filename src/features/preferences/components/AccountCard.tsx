import { ACCOUNT_TEXT, ACCOUNT_TITLE } from '../preferencesLabels'

/**
 * 账号与同步说明。
 * 本地模式下没有云端同步通道，因此这里只说明「本地模式」，不显示任何同步时间或同步状态，
 * 避免让用户以为数据已经上云（docs/05 规则 6）。
 */
export function AccountCard({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <section className="option-section account-card">
      <div className="timeline-head">
        <h3>{ACCOUNT_TITLE}</h3>
        <button className="secondary" type="button" onClick={onSignOut}>
          退出登录
        </button>
      </div>

      <p className="account-line">
        <strong>{ACCOUNT_TEXT.mode}</strong> · 当前登录：{email}
      </p>
      <p className="muted account-body">{ACCOUNT_TEXT.body}</p>
    </section>
  )
}
