/**
 * 同步状态聚合：只读本机记录，不发网络请求。
 *
 * `sync_state` 保存当前 Auth UID 的工作区上传状态与时间，
 * `sync_outbox` 提供该 UID 的待上传条数，业务记录提供本机数据条数。
 * 这些数字只描述本机事实；云端身份与访问授权由认证准备和上传流程另行验证。
 *
 * `lastPushAt` 表示最后成功上传的时间，`pendingCount` 表示尚待处理的条目数。
 * 队列排空仍不足以证明云端与本机全量一致，界面不能据此显示「已同步」。
 */

import { countRecords } from '../local/backupFormat'
import { collectUserRecords } from '../local/backupService'
import { getAll } from '../local/localDb'
import { entriesOfOwner, type OutboxEntry } from '../local/outboxRules'
import { assertAuthContextCurrent, captureAuthContext, type AuthContext } from '../session'
import { currentLocalUserId, readSyncState } from './syncState'

export type SyncStatus = {
  /** 已准备当前 UID 的工作区，允许在联网验证后上传。 */
  bound: boolean
  cloudEmail: string | null
  boundAt: string | null
  /** 当前 UID 在本机尚待上传的条目数。 */
  pendingCount: number
  /** 当前 Auth UID 的本机数据条数，与备份摘要的 `total` 同一口径。 */
  localCount: number
  lastPushAt: string | null
  lastRestoreAt: string | null
  lastError: { message: string; at: string | null } | null
}

/**
 * 当前 Auth UID 的本机数据条数。
 *
 * 复用 `collectUserRecords` 而不是自己数表：那个函数是「当前账号有哪些数据」的
 * 唯一取数口（子表归属要沿父键逐级推导，写第二遍必然分叉）。
 *
 * 计数前会清洗记录；若需要优化，仍须复用同一份工作区筛选规则。
 */
export async function countLocalRows(context: AuthContext = captureAuthContext()): Promise<number> {
  assertAuthContextCurrent(context)
  const { records } = await collectUserRecords({
    owner: context.owner,
    guard: () => assertAuthContextCurrent(context),
  })
  assertAuthContextCurrent(context)
  return countRecords(records).total
}

/**
 * 读当前 Auth UID 的本机同步状态；缺 `sync_state` 行时各字段返回空值。
 *
 * `pendingCount` 与推送流程使用同一份 UID 过滤规则，不能计入其他工作区的队列。
 * `bound` 是保留的接口字段，表示已启用当前 UID 工作区的上传，不表示独立身份绑定。
 */
export async function readSyncStatus(): Promise<SyncStatus> {
  if (!currentLocalUserId()) {
    return {
      bound: false,
      cloudEmail: null,
      boundAt: null,
      pendingCount: 0,
      localCount: 0,
      lastPushAt: null,
      lastRestoreAt: null,
      lastError: null,
    }
  }
  const context = captureAuthContext()
  const [state, outboxRows, localCount] = await Promise.all([
    readSyncState(context),
    getAll<OutboxEntry>('sync_outbox'),
    countLocalRows(context),
  ])
  assertAuthContextCurrent(context)

  return {
    bound: Boolean(state?.enabled && state.id === context.owner),
    cloudEmail: state?.cloud_email ?? null,
    boundAt: state?.bound_at ?? null,
    pendingCount: entriesOfOwner(outboxRows, context.owner).length,
    localCount,
    lastPushAt: state?.last_push_at ?? null,
    lastRestoreAt: state?.last_restore_at ?? null,
    lastError: state?.last_error_message
      ? { message: state.last_error_message, at: state.last_error_at }
      : null,
  }
}
