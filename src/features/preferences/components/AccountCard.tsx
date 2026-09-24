import { ACCOUNT_TEXT, ACCOUNT_TITLE } from '../preferencesLabels'

/**
 * 本地账号卡片。
 *
 * 只负责「应用身份」这一半：当前登录的是哪个本地账号、以及退出登录。
 * 云端那一半（连接、待上传条数、最后上传时间）在 `SyncCard` 里，
 * 两张卡片并排放在「账号与同步」子屏。
 *
 * 为什么拆开而不是合成一张：本地账号与云端账号是两件事（决策 D5），
 * 用户完全可以一辈子不连云端；合成一张卡会让「退出登录」和「断开连接」
 * 这两个后果完全不同的动作长得像一对。
 *
 * 本卡片**不显示任何上传 / 同步状态**（`docs/05` 规则 6）：那是 `SyncCard` 的职责。
 * 两边都显示，迟早会出现「一张说待上传 3 条、另一张说已保存」这种自相矛盾的画面。
 */
export function AccountCard({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  return (
    <section className="option-section account-card">
      <div className="timeline-head">
        <h3>{ACCOUNT_TITLE}</h3>
        <button className="secondary" type="button" onClick={onSignOut}>
          退出登录
        </button>
      </div>

      <p className="account-line">
        <strong>{ACCOUNT_TEXT.mode}</strong> · 当前登录：{username}
      </p>
      <p className="muted account-body">{ACCOUNT_TEXT.body}</p>
    </section>
  )
}
