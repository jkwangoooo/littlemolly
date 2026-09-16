import type { DataError } from '../../shared/errors'
import { BACKUP_STORE_COUNT, parseBackup, type BackupFile, type BackupSummary, type ValidatedBackup } from '../local/backupFormat'

/**
 * 本地数据备份（云端后端的占位实现，L6 阶段一）。
 *
 * **本地导出 / 导入是本地后端专属能力**：它操作的是浏览器 IndexedDB，
 * 云端模式下数据在 Supabase，做「导出本地库」既没有对象、也没有意义。
 *
 * 这里刻意不静默返回空结果，而是**先按同一套格式严格解析、再明确拒绝**，理由有两条：
 *
 * 1. 界面上必须看得出来「这个功能在当前后端不可用」。假装成功就是另一种
 *    「把本地保存伪装成云端同步」。
 * 2. 先解析一遍能让报错更有用：文件本身格式不对时，用户看到的是
 *    「文件格式不对」，而不是笼统的「云端不支持」。
 *
 * 上行迁移（把本地备份导入云端账号）属于 L6 阶段二，方案见
 * `docs/13-L6-cloud-migration-and-conflict-plan.md`。届时这个模块会被真正的实现替换，
 * 导出的名字与签名保持不变。
 */

export interface BackupExport {
  file: BackupFile
  text: string
  summary: BackupSummary
}

const UNSUPPORTED_CODE = 'cloud_backup_unsupported'

function unsupported(detail: string): DataError {
  const error = new Error(
    '云端后端不提供本地数据备份：本地导出 / 导入只操作浏览器本地库。' +
      '云端数据由 Supabase 项目自身负责备份。',
  ) as DataError
  error.code = UNSUPPORTED_CODE
  error.details = detail
  return error
}

export async function exportBackup(): Promise<BackupExport> {
  throw unsupported('当前后端是云端，没有可导出的本地库。')
}

/** 先按备份格式严格校验，再拒绝——格式错误与「后端不支持」是两回事，要分开报。 */
export function inspectBackup(text: string): ValidatedBackup {
  const parsed = parseBackup(text)
  throw unsupported(`这份备份包含 ${parsed.summary.total} 条记录，但云端导入尚未开放。`)
}

export async function importBackup(text: string): Promise<BackupSummary> {
  const parsed = parseBackup(text)
  throw unsupported(`这份备份包含 ${parsed.summary.total} 条记录，云端导入尚未开放，已取消导入。`)
}

/** 仓库总数口径，界面与脚本共用；与本地实现同源。 */
export const BACKUP_TOTAL_STORES = BACKUP_STORE_COUNT
