/**
 * 云端恢复到本地：整体替换（S5）。
 *
 * ```
 * 捕获认证上下文 → RPC export_cloud_snapshot → 前置检查
 *   → 本地单事务整体替换（业务、工作区状态、同步状态和队列一起提交）
 *   （内部先全量校验再写，track: false，user_id 归属当前 Supabase UID）
 * ```
 *
 * ## 为什么这里几乎没有新代码
 *
 * 云端的 `export_cloud_snapshot()` 吐出的是**与本地备份完全相同的文件形状**
 * （含一条合成 `users` 行，否则 `parseBackup` 的外键校验会整份拒绝）。
 * 于是本地这一侧只要把返回值序列化之后喂给现有的 `importBackup` 就够了——
 * **一条新的写入路径都不用写**（`docs/18 §5.5`）。
 *
 * 这不是巧合，是刻意的：快照与备份走同一条校验路径、同一条写入路径，
 * 就不存在「备份能导入、快照导不进来」这种只在某个方向上出现的问题。
 * 也正因为如此，这里只对快照做一次预检（用于确认 UID 与空数据），
 * 正式写入时仍由 `importBackup` 再做一次全量校验。
 *
 * ## 两个必须显式处理的地方
 *
 * 1. **`track: false`**。恢复的数据来源就是云端，回推没有意义。
 *    不传的话会立刻产生上百条队列条目并被推回云端，一旦失败，
 *    界面会在一次成功的恢复之后显示「上传失败」。
 * 2. **空云端要拦住**。`parseBackup` 对空内容也会拒绝，但它报的是
 *    「备份里没有任何数据」——听起来像用户操作错了，
 *    而事实是云端本来就是空的，正确的动作是先用「上传本地数据到云端」。
 */

import { countRecords } from '../local/backupFormat'
import type { LocalStore } from '../local/localDb'
import { assertWorkspaceGraph } from '../local/workspaceRecords'
import { importBackup, inspectBackup } from '../local/backupService'
import { callRpc } from '../cloud/rpc'
import { assertAuthContextCurrent, captureAuthContext } from '../session'
import { assertVerifiedCloudContext, invalidateRejectedCloudContext, withSyncLock } from './outbox'
import { replaceLocalProblem } from './replaceRules'

/** 与 `replaceCloud` 的 `ReplaceCounts` 同形状，界面可以共用一套描述函数。 */
export type RestoreResult = {
  counts: Partial<Record<LocalStore, number>>
  /** 实际写进本地的条数。 */
  total: number
  /** 云端快照里有多少条。与 `total` 不一致说明有记录没落进本地。 */
  sourceTotal: number
}

/**
 * 从云端取回快照，整体替换本地当前账号的数据。
 *
 * 调用前界面必须先拿到用户的二次确认：这一步**不可撤销**，
 * 本地当前账号原有的全部数据会被删掉。云端数据不受影响。
 */
export async function restoreCloudToLocal(): Promise<RestoreResult> {
  const context = captureAuthContext()
  return withSyncLock(async () => {
    // 只有已验证的 Supabase 会话才能读取云端快照。
    await assertVerifiedCloudContext(context)

    // 1. 取快照。失败如实抛错，不降级成「当作云端是空的」——
    //    那会让一次网络故障变成「把本地清空」。
    let snapshot: unknown
    try {
      snapshot = await callRpc<unknown>('export_cloud_snapshot')
    } catch (reason) {
      invalidateRejectedCloudContext(context, reason)
      throw reason
    }
    await assertVerifiedCloudContext(context)
    assertAuthContextCurrent(context)

    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('云端没有返回快照内容，已取消恢复。')
    }

    // 2. 先走与本地备份完全相同的全量校验，再检查快照确实属于当前 UID。
    const text = JSON.stringify(snapshot)
    const validated = inspectBackup(text, { allowEmpty: true })
    const sourceUser = validated.records.users?.[0]
    if (!sourceUser || sourceUser.id !== context.owner) {
      throw new Error('云端快照不属于当前登录账号，已取消恢复。')
    }
    assertWorkspaceGraph(validated.records, context.owner)

    // 3. 云端是空的时给一句说得通的拒绝；不能把它误报成「备份内容无效」。
    const cloudTotal = countRecords(validated.records).total
    const problem = replaceLocalProblem({ cloudTotal })
    if (problem) throw new Error(problem)

    // 4. 单事务整体替换：内部再次解析并校验，随后连同队列与同步状态一起提交。
    //    `track: false` 的理由见文件头；`user_id` 由 `importBackup` 重映射到当前 Auth UID。
    const now = new Date().toISOString()
    const summary = await importBackup(text, {
      owner: context.owner,
      guard: () => assertAuthContextCurrent(context),
      track: false,
      clearOutbox: true,
      workspaceState: {
        id: context.owner,
        initialized: true,
        initialized_at: now,
        initialized_from: 'cloud',
        updated_at: now,
      },
      syncStatePatch: {
        last_restore_at: now,
        last_error_message: null,
        last_error_at: null,
      },
    })
    assertAuthContextCurrent(context)

    return { counts: summary.counts, total: summary.total, sourceTotal: cloudTotal }
  })
}
