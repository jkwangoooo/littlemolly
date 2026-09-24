import { useCallback, useEffect, useState } from 'react'
import {
  abandonCloudSession,
  bindCloudAccount,
  connectCloudAccount,
  disconnectCloudAccount,
  readCloudSummary,
  readSyncStatus,
  restoreCloudToLocal,
  uploadLocalToCloud,
  type CloudAccountMode,
  type CloudConnectionProbe,
  type SyncStatus,
} from '../../../services/api/syncService'
import { describeBackupSummary, type BackupStore } from '../../../services/api/backupFormat'
import { cloudSyncConfigured } from '../../../services/capabilities'
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog'
import { formatRelativeTime } from '../../../shared/date'
import { describeDataError } from '../../../shared/errors'
import {
  BACKUP_STORE_LABEL,
  SYNC_BINDING_CASE_TEXT,
  SYNC_BOUND_TEXT,
  SYNC_CONNECT_TEXT,
  SYNC_DISCONNECT_CONFIRM,
  SYNC_ERROR_TEXT,
  SYNC_REPLACE_TEXT,
  SYNC_TITLE,
  SYNC_UNAVAILABLE_TEXT,
} from '../preferencesLabels'

/**
 * 云端同步卡片（S3）。
 *
 * ## 为什么这里有一道「未配置」的早返回
 *
 * `cloudSyncConfigured` 是**构建期常量**（`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
 * 有没有配）。为假时整张卡片只显示一句说明，**连 `SyncPanel` 都不挂载**——
 * 于是 `services/api/syncService` 里那些 `await import()` 一次都不会触发，
 * supabase 那个 chunk 从头到尾不会被下载。
 *
 * 这比「渲染出来再隐藏」强的地方在于：后者会让「未配置时零跨域请求」变成
 * 一个靠组件内部判断维持的性质，改一处条件就可能悄悄破掉；
 * 前者是结构性的——不挂载就没有副作用。
 *
 * ## 状态显示的三条纪律
 *
 * 1. **待上传条数与最后上传时间同时显示**，只要前者不为 0，就不出现「已同步」这类说法。
 * 2. **待上传 = 0 也不说「已同步」**：那只证明本机的变更都发出去了，
 *    不证明云端与本地一致（`SYNC_BOUND_TEXT.drainedNote`）。
 * 3. **上传失败必须显示，且带原因与时间**。失败时若只显示「待上传 3 条」，
 *    看起来和正在慢慢传一模一样——用户会一直等一个不会发生的结果。
 *    成功推送会清掉失败原因（`sync/outbox.ts` 的 `recordSuccess`），
 *    所以这一行不会在恢复之后还挂着过期信息。
 *
 * S3 期间那句「当前版本只记录变更，还没有开始上传」在 S4 已删除：
 * 现在真的在上传，留着它就从诚实变成撒谎。
 */

/** 仓库名 → 中文名，供整体替换的条数摘要展示（与备份卡同一套名字）。 */
function storeLabel(store: BackupStore): string {
  return BACKUP_STORE_LABEL[store]
}

/** 时间展示。`null` 是「还没发生过」，不是「未知」——两种说法不能混。 */
function formatTime(iso: string | null, fallback: string): string {
  if (!iso) return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 一个时间点的显示：先试相对说法（「3 分钟前」），超过 7 天或解析不出来时退回绝对时间。
 *
 * 阈值判断在 `shared/date/relativeTime.ts` 里，那边有回归；这里只负责两分支渲染。
 */
function formatMoment(iso: string | null, fallback: string): string {
  if (!iso) return fallback
  return formatRelativeTime(iso) ?? formatTime(iso, fallback)
}

export function SyncCard({ username }: { username: string }) {
  if (!cloudSyncConfigured) {
    return (
      <section className="option-section account-card sync-card">
        <div className="timeline-head">
          <h3>{SYNC_TITLE}</h3>
        </div>
        <p className="account-line">
          <strong>{SYNC_UNAVAILABLE_TEXT.reason}</strong>
        </p>
        <p className="muted account-body">{SYNC_UNAVAILABLE_TEXT.body}</p>
      </section>
    )
  }

  return <SyncPanel username={username} />
}

/** 已配置云端时的同步卡片。挂在设置页的「账号与同步」子屏里。 */
function SyncPanel({ username }: { username: string }) {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  /** 探测结果。非空时弹确认框——此时云端会话已建立，但本地一个字都还没写。 */
  const [probe, setProbe] = useState<CloudConnectionProbe | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  /** 待确认的整体替换。非空时弹确认框；`cloudTotal` 是点按钮那一刻问到的云端条数。 */
  const [replace, setReplace] = useState<{ kind: 'upload' | 'restore'; cloudTotal: number } | null>(null)
  /**
   * 整体替换的进行状态。带着 `kind` 是为了让按钮文案只变在**被点的那个**按钮上——
   * 两个按钮同时显示「正在…」会让用户不知道哪一步在跑。
   */
  const [replaceBusy, setReplaceBusy] = useState<{ phase: 'prepare' | 'run'; kind: 'upload' | 'restore' } | null>(
    null,
  )
  const [replaceNote, setReplaceNote] = useState<string | null>(null)
  const [replaceError, setReplaceError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await readSyncStatus())
      setStatusError(null)
    } catch (cause) {
      setStatusError(`${SYNC_ERROR_TEXT.statusFailed}${describeDataError(cause)}`)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 连接：只建立云端会话并探测两边条数，**不写本地状态**。 */
  async function connect(mode: CloudAccountMode) {
    setBusy(true)
    setFormError(null)
    try {
      setProbe(await connectCloudAccount({ username, password, mode }))
      // 探测成功说明凭据已经用完了，立刻从组件状态里清掉，不留在内存里等确认框关闭。
      setPassword('')
    } catch (cause) {
      setFormError(`${SYNC_ERROR_TEXT.connectFailed}${describeDataError(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 用户看了确认框决定不连了。清掉云端会话，但**不动 `sync_outbox`**。 */
  async function cancelProbe() {
    setProbe(null)
    try {
      await abandonCloudSession()
    } catch {
      // 这里不打断用户：本地从头到尾没被改过，云端会话残留最多让下次连接多一次覆盖。
    }
  }

  /** 确认绑定：只写 `sync_state`。S3 期间不执行上传也不执行恢复。 */
  async function confirmProbe() {
    if (!probe) return
    setBusy(true)
    setFormError(null)
    try {
      await bindCloudAccount(probe)
      setProbe(null)
      await refresh()
    } catch (cause) {
      setFormError(`${SYNC_ERROR_TEXT.connectFailed}${describeDataError(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setConfirmDisconnect(false)
    setBusy(true)
    try {
      await disconnectCloudAccount()
      await refresh()
    } catch (cause) {
      setStatusError(`${SYNC_ERROR_TEXT.disconnectFailed}${describeDataError(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 点下「上传 / 恢复」之后的第一步：**去云端问一次条数**，再把确认框弹出来。
   *
   * 为什么要多一次请求：用户唯一能据此判断覆盖方向的信息就是「哪边有多少条」。
   * 不问他一声就弹「将用本地数据替换云端」，他没法判断这次会不会把云端的东西删光。
   *
   * 这一步失败就不往下走了——拿不到云端条数就弹确认框，
   * 等于让用户在一个自己也不了解后果的对话框上点「确认」。
   */
  async function openReplace(kind: 'upload' | 'restore') {
    setReplaceBusy({ phase: 'prepare', kind })
    setReplaceError(null)
    setReplaceNote(null)
    try {
      const cloud = await readCloudSummary()
      setReplace({ kind, cloudTotal: cloud.total })
    } catch (cause) {
      setReplaceError(`${SYNC_REPLACE_TEXT.summaryFailed}${describeDataError(cause)}`)
    } finally {
      setReplaceBusy(null)
    }
  }

  /** 确认框里点了确认：执行整体替换。不可撤销，且失败要如实说。 */
  async function runReplace() {
    if (!replace) return
    const { kind } = replace
    setReplaceBusy({ phase: 'run', kind })
    setReplaceError(null)
    try {
      const result = kind === 'upload' ? await uploadLocalToCloud() : await restoreCloudToLocal()
      const done = kind === 'upload' ? SYNC_REPLACE_TEXT.uploadDone : SYNC_REPLACE_TEXT.restoreDone
      const detail = describeBackupSummary(result, storeLabel)
      // 源条数与写入条数对不上时如实追加一句，不用「已完成」把它盖过去。
      const mismatch = result.total === result.sourceTotal ? '' : ` ${SYNC_REPLACE_TEXT.mismatchNote}`
      setReplaceNote(`${done}：${detail}。${mismatch}`)
      setReplace(null)
      await refresh()
    } catch (cause) {
      const failed = kind === 'upload' ? SYNC_REPLACE_TEXT.uploadFailed : SYNC_REPLACE_TEXT.restoreFailed
      setReplaceError(`${failed}${describeDataError(cause)}`)
      // 确认框留着：用户可能想再试一次，重开一次还要再等一次云端条数。
    } finally {
      setReplaceBusy(null)
    }
  }

  /** 按钮上的文案：只有被点的那个按钮会变成进行中。 */
  function replaceButtonLabel(kind: 'upload' | 'restore', idle: string): string {
    if (replaceBusy?.kind !== kind) return idle
    if (replaceBusy.phase === 'prepare') return SYNC_REPLACE_TEXT.preparing
    return kind === 'upload' ? SYNC_REPLACE_TEXT.uploadRunning : SYNC_REPLACE_TEXT.restoreRunning
  }

  const bound = status?.bound ?? false

  return (
    <section className="option-section account-card sync-card">
      <div className="timeline-head">
        <h3>{SYNC_TITLE}</h3>
        {bound ? (
          <button className="secondary" type="button" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
            {SYNC_BOUND_TEXT.disconnectAction}
          </button>
        ) : null}
      </div>

      {statusError ? <p className="error account-body">{statusError}</p> : null}

      {!status ? (
        <p className="muted account-body">正在读取同步状态…</p>
      ) : bound ? (
        <>
          <p className="account-line">
            <strong>已连接：{status.cloudEmail}</strong>
          </p>
          <p className="account-line">
            <strong>
              {SYNC_BOUND_TEXT.pendingPrefix} {status.pendingCount} {SYNC_BOUND_TEXT.unit}
            </strong>
            {' · '}
            {SYNC_BOUND_TEXT.localPrefix} {status.localCount} {SYNC_BOUND_TEXT.unit}
          </p>
          <p className="muted account-body">
            {SYNC_BOUND_TEXT.lastPushPrefix}：
            {formatMoment(status.lastPushAt, SYNC_BOUND_TEXT.neverPushed)}
          </p>
          {status.lastError ? (
            <p className="error account-body">
              {SYNC_BOUND_TEXT.lastErrorPrefix}：{status.lastError.message}
              {status.lastError.at ? `（${formatMoment(status.lastError.at, '')}）` : ''}
            </p>
          ) : null}
          <p className="muted account-body">
            {status.pendingCount > 0 ? SYNC_BOUND_TEXT.pendingNote : SYNC_BOUND_TEXT.drainedNote}
          </p>

          {/*
            整体替换（S5）。放在「待上传 / 最后上传」之后，因为它是**手动**动作：
            上面的自动上传是日常路径，这两个按钮是换设备与灾难恢复时才用的。
            两个按钮都不带 `danger` 样式——样式表里没有这一档，而确认框已经
            把「不可撤销」和「哪一边会丢」写清楚了，按钮上再叠一层红只会让人不敢用。
          */}
          <div className="sync-replace">
            <h4 className="sync-replace-head">{SYNC_REPLACE_TEXT.sectionTitle}</h4>
            <p className="muted account-body">{SYNC_REPLACE_TEXT.body}</p>
            {replaceError ? <p className="error account-body">{replaceError}</p> : null}
            {replaceNote ? <p className="account-body">{replaceNote}</p> : null}
            <div className="actions">
              <button
                type="button"
                disabled={replaceBusy !== null}
                onClick={() => void openReplace('upload')}
              >
                {replaceButtonLabel('upload', SYNC_REPLACE_TEXT.uploadAction)}
              </button>
              <button
                className="secondary"
                type="button"
                disabled={replaceBusy !== null}
                onClick={() => void openReplace('restore')}
              >
                {replaceButtonLabel('restore', SYNC_REPLACE_TEXT.restoreAction)}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="account-line">
            <strong>{SYNC_CONNECT_TEXT.unbound}</strong>
          </p>
          <p className="muted account-body">{SYNC_CONNECT_TEXT.body}</p>

          <label className="field">
            <span>{SYNC_CONNECT_TEXT.usernameLabel}</span>
            <input
              value={username}
              autoComplete="username"
              readOnly
            />
          </label>
          <label className="field">
            <span>{SYNC_CONNECT_TEXT.passwordLabel}</span>
            <input
              type="password"
              value={password}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {formError ? <p className="error account-body">{formError}</p> : null}

          <div className="actions">
            <button type="button" disabled={busy} onClick={() => void connect('signIn')}>
              {busy ? SYNC_CONNECT_TEXT.probing : SYNC_CONNECT_TEXT.signInAction}
            </button>
            <button className="secondary" type="button" disabled={busy} onClick={() => void connect('signUp')}>
              {SYNC_CONNECT_TEXT.signUpAction}
            </button>
          </div>
        </>
      )}

      {probe ? (
        <ConfirmDialog
          title={SYNC_CONNECT_TEXT.confirmAction}
          description={SYNC_BINDING_CASE_TEXT[probe.case]}
          confirmLabel={SYNC_CONNECT_TEXT.confirmAction}
          onConfirm={() => void confirmProbe()}
          onCancel={() => void cancelProbe()}
        >
          <p className="muted">
            云端 {probe.cloudCount} {SYNC_BOUND_TEXT.unit} · 本地 {probe.localCount} {SYNC_BOUND_TEXT.unit}
          </p>
          <p className="muted">{SYNC_CONNECT_TEXT.confirmNote}</p>
        </ConfirmDialog>
      ) : null}

      {confirmDisconnect ? (
        <ConfirmDialog
          title={SYNC_DISCONNECT_CONFIRM.title}
          description={SYNC_DISCONNECT_CONFIRM.body}
          confirmLabel={SYNC_DISCONNECT_CONFIRM.confirmLabel}
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirmDisconnect(false)}
        >
          <p className="muted">
            {SYNC_BOUND_TEXT.pendingPrefix} {status?.pendingCount ?? 0} {SYNC_BOUND_TEXT.unit}
          </p>
        </ConfirmDialog>
      ) : null}

      {replace ? (
        <ConfirmDialog
          title={
            replace.kind === 'upload' ? SYNC_REPLACE_TEXT.uploadConfirm.title : SYNC_REPLACE_TEXT.restoreConfirm.title
          }
          description={
            replace.kind === 'upload' ? SYNC_REPLACE_TEXT.uploadConfirm.body : SYNC_REPLACE_TEXT.restoreConfirm.body
          }
          confirmLabel={
            replace.kind === 'upload'
              ? SYNC_REPLACE_TEXT.uploadConfirm.confirmLabel
              : SYNC_REPLACE_TEXT.restoreConfirm.confirmLabel
          }
          onConfirm={() => void runReplace()}
          onCancel={() => setReplace(null)}
        >
          {/*
            一行数字对比。两个方向共用同一句句式，只是把「源」与「目标」调过来——
            这句话是用户唯一能据此判断覆盖方向的信息，两个方向各写一遍很容易写反。
          */}
          <p className="muted">
            {SYNC_REPLACE_TEXT.countComparePrefix}
            {replace.kind === 'upload'
              ? `本地 ${status?.localCount ?? 0} ${SYNC_BOUND_TEXT.unit}`
              : `云端 ${replace.cloudTotal} ${SYNC_BOUND_TEXT.unit}`}
            {SYNC_REPLACE_TEXT.countCompareMiddle}
            {replace.kind === 'upload'
              ? `云端 ${replace.cloudTotal} ${SYNC_BOUND_TEXT.unit}`
              : `本地 ${status?.localCount ?? 0} ${SYNC_BOUND_TEXT.unit}`}
            {SYNC_REPLACE_TEXT.countCompareSuffix}
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  )
}
