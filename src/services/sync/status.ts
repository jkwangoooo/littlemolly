/**
 * 同步状态聚合（S3）——**纯本地，一个网络请求都不发**。
 *
 * 这是 S3 里最容易做错的一件事：设置页一打开就要显示「云端账号 / 待上传 N 条 /
 * 最后上传时间」，很自然会顺手去云端查一下「那边现在多少条」。
 * 一旦这么写，「未绑定云端账号时整轮交互零跨域请求」这条判据就废了，
 * 而且是在**用户什么都没点**的情况下悄悄废掉的。
 *
 * 因此这里只读三样本机的东西：`sync_state`（账号与时间）、`sync_outbox`（待上传条数）、
 * 本地用户数据（条数）。它们全都是「已经发生在本机的事实」，
 * 不需要联网就能诚实地回答。云端那一侧的数字只在用户**主动点了连接**时去问
 * （见 `accountLink.ts`）。
 *
 * ## 文案口径（`docs/19 §6`）
 *
 * 这里给出的 `lastPushAt` 只在推送**成功后**写入，所以「最后上传时间」是事实；
 * 但**有 `pendingCount > 0` 时绝不能显示「已同步」**——那是在暗示一件没发生的事。
 * 两个数字必须同时给到界面，让用户自己看到「还有 N 条没上传」。
 */

import { countRecords } from '../local/backupFormat'
import { collectUserRecords } from '../local/backupService'
import { getAll } from '../local/localDb'
import { entriesOfOwner, type OutboxEntry } from '../local/outboxRules'
import { currentLocalUserId, readSyncState } from './syncState'

export type SyncStatus = {
  /** 已绑定云端账号（`sync_state` 有行、`enabled` 为真且拿到了云端用户 id）。 */
  bound: boolean
  cloudEmail: string | null
  boundAt: string | null
  /** 本机待上传条数。**只增不减的账本**（S4 才出队）。 */
  pendingCount: number
  /** 当前本地账号的数据条数，与备份摘要的 `total` 同一口径。 */
  localCount: number
  lastPushAt: string | null
  lastRestoreAt: string | null
  lastError: { message: string; at: string | null } | null
}

/**
 * 当前本地账号的数据条数。
 *
 * 复用 `collectUserRecords` 而不是自己数表：那个函数是「当前账号有哪些数据」的
 * 唯一取数口（子表归属要沿父键逐级推导，写第二遍必然分叉）。
 *
 * 代价是它会 `sanitize` 全部记录，比纯计数重一些；S3 的数据量（几百条）下可以接受。
 * 若 S4 的推送循环也需要频繁调用，再考虑加一个只计数不取数的快路径——
 * 届时**必须复用同一份筛选规则**，不能另写一套。
 */
export async function countLocalRows(): Promise<number> {
  const { records } = await collectUserRecords()
  return countRecords(records).total
}

/**
 * 读同步状态。缺 `sync_state` 行 = 还没绑定过，各字段给空值而不是抛错。
 *
 * `pendingCount` 只数**属于当前本地账号**的条目（S4 补丁 ②）。
 * 早先它是 `count('sync_outbox')`——那张表是设备级的，换过账号之后
 * 会把上一个账号的条目也算进来，于是界面显示「待上传 30 条」而这个账号一条都没有，
 * 且永远不会减少。口径必须与推送口径一致：推送看什么，这里就数什么。
 */
export async function readSyncStatus(): Promise<SyncStatus> {
  const [state, outboxRows, localCount] = await Promise.all([
    readSyncState(),
    getAll<OutboxEntry>('sync_outbox'),
    countLocalRows(),
  ])

  return {
    // 三个条件都要满足才算「已绑定」：`enabled` 单独为真说明不了什么，
    // 而缺 `cloud_user_id` 时后续推送根本无处可写。
    bound: Boolean(state?.enabled && state.cloud_user_id),
    cloudEmail: state?.cloud_email ?? null,
    boundAt: state?.bound_at ?? null,
    pendingCount: entriesOfOwner(outboxRows, currentLocalUserId()).length,
    localCount,
    lastPushAt: state?.last_push_at ?? null,
    lastRestoreAt: state?.last_restore_at ?? null,
    lastError: state?.last_error_message
      ? { message: state.last_error_message, at: state.last_error_at }
      : null,
  }
}
