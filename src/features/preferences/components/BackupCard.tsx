import { useRef, useState, type ChangeEvent } from 'react'
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog'
import { describeDataError } from '../../../shared/errors'
import { backupFileName, describeBackupSummary, type BackupStore, type BackupSummary } from '../../../services/api/backupFormat'
import { exportBackup, importBackup, inspectBackup } from '../../../services/api/backupService'
import {
  BACKUP_CLEAR_ACTION,
  BACKUP_COPIED_NOTE,
  BACKUP_COPY_ACTION,
  BACKUP_COPY_FAILED_NOTE,
  BACKUP_DOWNLOAD_ACTION,
  BACKUP_EMPTY_NOTE,
  BACKUP_EXPORT_ACTION,
  BACKUP_FILE_LABEL,
  BACKUP_HINT,
  BACKUP_IMPORT_CONFIRM,
  BACKUP_IMPORT_HINT,
  BACKUP_INSPECT_ACTION,
  BACKUP_INVALID_CHANNEL,
  BACKUP_PASTE_LABEL,
  BACKUP_PASTE_PLACEHOLDER,
  BACKUP_STORE_LABEL,
  BACKUP_TITLE,
  BACKUP_UNAVAILABLE_NOTE,
} from '../preferencesLabels'

/** 仓库名 → 中文名，供摘要展示。 */
function labelOf(store: BackupStore): string {
  return BACKUP_STORE_LABEL[store]
}

/**
 * 本地数据备份卡片（L5）。
 *
 * 编排四步：生成备份 → 检查（只校验，不写库） → 二次确认 → 导入后重新读取。
 *
 * 两条硬约束落在实现里：
 * 1. **格式错误不得覆盖现有数据**——`inspectBackup` 不过关时连确认框都不出现，更不会有写入；
 *    真正的写入在服务层，先全量校验、后单事务替换，失败时零写入（docs/05 L5）。
 * 2. **确认框必须说清是「替换」**——这是全流程里唯一会丢数据的一步，文案不能含糊。
 *
 * 保存状态不在这里重复显示：备份导入与选项写入共用页面顶部那条
 * 「本地保存状态：」，避免同一页出现两行状态、说法还可能不一致。
 *
 * 云端模式下整张卡片换成一句说明（`available` 为 false）：导出 / 导入操作的对象是
 * 浏览器本地库，云端模式下它根本不存在，给一个必然报错的按钮比不给更糟。
 */
export function BackupCard({
  available,
  busy,
  runSave,
  onImported,
}: {
  /** 本地后端专属能力；云端构建下为 false。 */
  available: boolean
  busy: boolean
  runSave: (action: () => Promise<void>) => Promise<void>
  /** 导入成功后由页面重新读取清单，让界面立刻反映备份内容。 */
  onImported: () => Promise<void>
}) {
  if (!available) {
    return (
      <section className="option-section backup-card">
        <div className="timeline-head">
          <h3>{BACKUP_TITLE}</h3>
        </div>
        <p className="muted account-body" data-backup-unavailable>
          {BACKUP_UNAVAILABLE_NOTE}
        </p>
      </section>
    )
  }
  return <LocalBackupCard busy={busy} runSave={runSave} onImported={onImported} />
}

/** 本地后端下的完整备份卡片。 */
function LocalBackupCard({
  busy,
  runSave,
  onImported,
}: {
  busy: boolean
  runSave: (action: () => Promise<void>) => Promise<void>
  /** 导入成功后由页面重新读取清单，让界面立刻反映备份内容。 */
  onImported: () => Promise<void>
}) {
  const [text, setText] = useState('')
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<{ summary: BackupSummary; text: string } | null>(null)
  const [importedNote, setImportedNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /** 生成备份：只读库并组装文本，不产生任何写入。 */
  async function handleExport() {
    setExportNote(null)
    setExportError(null)
    setImportedNote(null)
    try {
      const result = await exportBackup()
      setText(result.text)
      setExportNote(result.summary.total ? describeBackupSummary(result.summary, labelOf) : BACKUP_EMPTY_NOTE)
    } catch (reason) {
      setExportError(describeDataError(reason))
    }
  }

  function handleDownload() {
    if (!text) return
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = backupFileName(new Date().toISOString())
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleCopy() {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setExportNote(BACKUP_COPIED_NOTE)
    } catch {
      setExportNote(BACKUP_COPY_FAILED_NOTE)
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 先清掉 input 的值，否则连续选同一个文件不会再触发 change 事件。
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setImportError(null)
    setImportedNote(null)
    try {
      setText(await file.text())
    } catch {
      setImportError('这个文件读不出来，请确认它是一份导出的 JSON 备份。')
    }
  }

  /** 校验后再弹确认框；文件不过关时不会有任何写入。 */
  function handleInspect() {
    setImportError(null)
    setImportedNote(null)
    if (!text.trim()) {
      setImportError(BACKUP_INVALID_CHANNEL)
      return
    }
    try {
      const validated = inspectBackup(text)
      setPendingImport({ summary: validated.summary, text })
    } catch (reason) {
      setPendingImport(null)
      setImportError(describeDataError(reason))
    }
  }

  async function confirmImport() {
    const target = pendingImport
    setPendingImport(null)
    if (!target) return
    let summary: BackupSummary | null = null
    await runSave(async () => {
      summary = await importBackup(target.text)
      await onImported()
    })
    // 失败时 runSave 已把原因写进页面顶部的错误提示，这里只在成功时补一句结果。
    if (summary) setImportedNote(`已替换为备份内容：${describeBackupSummary(summary, labelOf)}`)
  }

  return (
    <section className="option-section backup-card">
      <div className="timeline-head">
        <h3>{BACKUP_TITLE}</h3>
      </div>

      <p className="muted account-body">{BACKUP_HINT}</p>

      <div className="actions">
        <button className="secondary" type="button" disabled={busy} onClick={() => void handleExport()}>
          {BACKUP_EXPORT_ACTION}
        </button>
        <button className="secondary" type="button" disabled={!text} onClick={handleDownload}>
          {BACKUP_DOWNLOAD_ACTION}
        </button>
        <button className="secondary" type="button" disabled={!text} onClick={() => void handleCopy()}>
          {BACKUP_COPY_ACTION}
        </button>
      </div>

      <label className="field">
        <span>{BACKUP_PASTE_LABEL}</span>
        <textarea
          className="backup-text"
          value={text}
          placeholder={BACKUP_PASTE_PLACEHOLDER}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
        />
      </label>

      {exportNote ? (
        <p className="muted account-body" data-backup-note>
          {exportNote}
        </p>
      ) : null}
      {exportError ? (
        <p className="notice" role="alert">
          导出失败：{exportError}
        </p>
      ) : null}

      <div className="actions">
        <label className="field backup-file">
          <span>{BACKUP_FILE_LABEL}</span>
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={(event) => void handleFile(event)} />
        </label>
        <button className="secondary" type="button" disabled={!text.trim()} onClick={handleInspect}>
          {BACKUP_INSPECT_ACTION}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={!text}
          onClick={() => {
            setText('')
            setExportNote(null)
            setExportError(null)
            setImportError(null)
            setImportedNote(null)
          }}
        >
          {BACKUP_CLEAR_ACTION}
        </button>
      </div>

      <p className="muted account-body">{BACKUP_IMPORT_HINT}</p>

      {importError ? (
        <p className="notice" role="alert" data-backup-error>
          这份备份不能导入：{importError}
        </p>
      ) : null}

      {importedNote ? (
        <p className="muted account-body" role="status" data-backup-imported>
          {importedNote}
        </p>
      ) : null}

      {pendingImport ? (
        <ConfirmDialog
          title={BACKUP_IMPORT_CONFIRM.title}
          description={BACKUP_IMPORT_CONFIRM.body}
          confirmLabel={BACKUP_IMPORT_CONFIRM.confirmLabel}
          onConfirm={() => void confirmImport()}
          onCancel={() => setPendingImport(null)}
        >
          <p className="muted">
            {describeBackupSummary(pendingImport.summary, labelOf)}
            {pendingImport.summary.sourceEmail ? ` · 来源账号 ${pendingImport.summary.sourceEmail}` : ''}
          </p>
          {pendingImport.summary.warnings.map((warning) => (
            <p className="muted" key={warning}>
              {warning}
            </p>
          ))}
        </ConfirmDialog>
      ) : null}
    </section>
  )
}