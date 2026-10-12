import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  captureAuthContext, getAuthState, isAuthContextCurrent, subscribeAuth, type AuthContext,
} from '../../../services/api/authService'
import {
  readCloudSummary, readSyncStatus, restoreCloudToLocal, uploadLocalToCloud, type SyncStatus,
} from '../../../services/api/syncService'
import { describeBackupSummary, type BackupStore } from '../../../services/api/backupFormat'
import { cloudSyncConfigured } from '../../../services/capabilities'
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog'
import { formatRelativeTime } from '../../../shared/date'
import { describeDataError } from '../../../shared/errors'
import {
  BACKUP_STORE_LABEL, SYNC_BOUND_TEXT, SYNC_ERROR_TEXT, SYNC_REPLACE_TEXT, SYNC_TITLE,
  SYNC_UNAVAILABLE_TEXT,
} from '../preferencesLabels'

function storeLabel(store: BackupStore): string { return BACKUP_STORE_LABEL[store] }

function formatMoment(iso: string | null, fallback: string): string {
  if (!iso) return fallback
  const relative = formatRelativeTime(iso)
  if (relative) return relative
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

export function SyncCard({ username }: { username: string }) {
  if (!cloudSyncConfigured) {
    return (
      <section className="option-section account-card sync-card">
        <h3>{SYNC_TITLE}</h3>
        <p className="account-line"><strong>{SYNC_UNAVAILABLE_TEXT.reason}</strong></p>
        <p className="muted account-body">{SYNC_UNAVAILABLE_TEXT.body}</p>
      </section>
    )
  }
  return <SyncPanel username={username} />
}

function SyncPanel({ username }: { username: string }) {
  const auth = useSyncExternalStore(subscribeAuth, getAuthState, getAuthState)
  const mounted = useRef(false)
  const operation = useRef(false)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [replace, setReplace] = useState<{
    kind: 'upload' | 'restore'; cloudTotal: number; localTotal: number; context: AuthContext,
  } | null>(null)
  const [replaceBusy, setReplaceBusy] = useState<{
    phase: 'prepare' | 'run'; kind: 'upload' | 'restore',
  } | null>(null)
  const [replaceNote, setReplaceNote] = useState<string | null>(null)
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const verified = auth.phase === 'ready' && auth.verified

  const refresh = useCallback(async () => {
    if (!mounted.current) return
    let context: AuthContext | null = null
    try {
      context = captureAuthContext()
      const next = await readSyncStatus()
      if (!context || !mounted.current || !isAuthContextCurrent(context)) return
      setStatus(next)
      setStatusError(null)
    } catch (reason) {
      if (!context || !mounted.current || !isAuthContextCurrent(context)) return
      setStatusError(`${SYNC_ERROR_TEXT.statusFailed}${describeDataError(reason)}`)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    // Only local facts are refreshed; cloud counts are requested on explicit replacement.
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
    }
  }, [refresh])

  async function openReplace(kind: 'upload' | 'restore') {
    if (operation.current || !verified) return
    let context: AuthContext
    try { context = captureAuthContext() } catch { return }
    operation.current = true
    const current = () => mounted.current && isAuthContextCurrent(context)
    setReplaceBusy({ phase: 'prepare', kind })
    setReplaceError(null)
    setReplaceNote(null)
    try {
      const [cloud, local] = await Promise.all([readCloudSummary(), readSyncStatus()])
      if (!current()) return
      setStatus(local)
      setReplace({ kind, cloudTotal: cloud.total, localTotal: local.localCount, context })
    } catch (reason) {
      if (current()) setReplaceError(`${SYNC_REPLACE_TEXT.summaryFailed}${describeDataError(reason)}`)
    } finally {
      operation.current = false
      if (current()) setReplaceBusy(null)
    }
  }

  async function runReplace() {
    if (!replace || operation.current || !verified || !isAuthContextCurrent(replace.context)) return
    operation.current = true
    const { kind, context } = replace
    const current = () => mounted.current && isAuthContextCurrent(context)
    setReplaceBusy({ phase: 'run', kind })
    setReplaceError(null)
    try {
      const result = kind === 'upload' ? await uploadLocalToCloud() : await restoreCloudToLocal()
      if (!current()) return
      const done = kind === 'upload' ? SYNC_REPLACE_TEXT.uploadDone : SYNC_REPLACE_TEXT.restoreDone
      const detail = describeBackupSummary(result, storeLabel)
      const mismatch = result.total === result.sourceTotal ? '' : ` ${SYNC_REPLACE_TEXT.mismatchNote}`
      setReplaceNote(`${done}：${detail}。${mismatch}`)
      setReplace(null)
      await refresh()
    } catch (reason) {
      if (!current()) return
      const failed = kind === 'upload' ? SYNC_REPLACE_TEXT.uploadFailed : SYNC_REPLACE_TEXT.restoreFailed
      setReplaceError(`${failed}${describeDataError(reason)}`)
    } finally {
      operation.current = false
      if (current()) setReplaceBusy(null)
    }
  }

  function buttonLabel(kind: 'upload' | 'restore', idle: string): string {
    if (replaceBusy?.kind !== kind) return idle
    if (replaceBusy.phase === 'prepare') return SYNC_REPLACE_TEXT.preparing
    return kind === 'upload' ? SYNC_REPLACE_TEXT.uploadRunning : SYNC_REPLACE_TEXT.restoreRunning
  }

  return (
    <section className="option-section account-card sync-card">
      <div className="timeline-head"><h3>{SYNC_TITLE}</h3></div>
      <p className="account-line"><strong>当前账号：{username}</strong></p>
      {statusError ? <p className="error account-body" role="alert">{statusError}</p> : null}
      {!status ? <p className="muted account-body">正在读取上传状态...</p> : (
        <>
          <p className="account-line">
            <strong>{SYNC_BOUND_TEXT.pendingPrefix} {status.pendingCount} {SYNC_BOUND_TEXT.unit}</strong>
            {' · '}{SYNC_BOUND_TEXT.localPrefix} {status.localCount} {SYNC_BOUND_TEXT.unit}
          </p>
          <p className="muted account-body">
            {SYNC_BOUND_TEXT.lastPushPrefix}：{formatMoment(status.lastPushAt, SYNC_BOUND_TEXT.neverPushed)}
          </p>
          <p className="muted account-body">
            {SYNC_BOUND_TEXT.lastRestorePrefix}：{formatMoment(status.lastRestoreAt, '还没有恢复过')}
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
          {!verified ? <p className="notice account-body">账号验证恢复后，才能继续上传或整体替换。</p> : null}
          <div className="sync-replace">
            <h4 className="sync-replace-head">{SYNC_REPLACE_TEXT.sectionTitle}</h4>
            <p className="muted account-body">{SYNC_REPLACE_TEXT.body}</p>
            {replaceError ? <p className="error account-body" role="alert">{replaceError}</p> : null}
            {replaceNote ? <p className="account-body" role="status">{replaceNote}</p> : null}
            <div className="actions">
              <button type="button" disabled={!verified || replaceBusy !== null} onClick={() => void openReplace('upload')}>
                {buttonLabel('upload', SYNC_REPLACE_TEXT.uploadAction)}
              </button>
              <button className="secondary" type="button" disabled={!verified || replaceBusy !== null} onClick={() => void openReplace('restore')}>
                {buttonLabel('restore', SYNC_REPLACE_TEXT.restoreAction)}
              </button>
            </div>
          </div>
        </>
      )}
      {replace ? (
        <ConfirmDialog
          title={replace.kind === 'upload' ? SYNC_REPLACE_TEXT.uploadConfirm.title : SYNC_REPLACE_TEXT.restoreConfirm.title}
          description={replace.kind === 'upload' ? SYNC_REPLACE_TEXT.uploadConfirm.body : SYNC_REPLACE_TEXT.restoreConfirm.body}
          confirmLabel={replaceBusy ? '正在替换...' : replace.kind === 'upload' ? SYNC_REPLACE_TEXT.uploadConfirm.confirmLabel : SYNC_REPLACE_TEXT.restoreConfirm.confirmLabel}
          confirmDisabled={!verified || replaceBusy !== null}
          cancelDisabled={replaceBusy !== null}
          onConfirm={() => void runReplace()}
          onCancel={() => { if (!operation.current) setReplace(null) }}
        >
          <p className="muted">
            {SYNC_REPLACE_TEXT.countComparePrefix}
            {replace.kind === 'upload' ? `本地 ${replace.localTotal} 条` : `云端 ${replace.cloudTotal} 条`}
            {SYNC_REPLACE_TEXT.countCompareMiddle}
            {replace.kind === 'upload' ? `云端 ${replace.cloudTotal} 条` : `本地 ${replace.localTotal} 条`}
            {SYNC_REPLACE_TEXT.countCompareSuffix}
          </p>
          {replaceError ? <p className="error" role="alert">{replaceError}</p> : null}
        </ConfirmDialog>
      ) : null}
    </section>
  )
}
