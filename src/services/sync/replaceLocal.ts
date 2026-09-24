/**
 * 云端恢复到本地：整体替换（S5）。
 *
 * ```
 * RPC export_cloud_snapshot → 前置检查 → 本地单事务整体替换
 *   （内部先全量校验再写，track: false，user_id 重映射到当前本地账号）
 *   → 清空本账号队列 + 记一次恢复时间
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
 * 也正因为如此，这里**不再单独调一次 `inspectBackup`**——
 * `importBackup` 内部就是「`parseBackup` 全量校验 → 单事务写入」，
 * 在外面再校验一遍只是把同一份文件解析两次。
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

import { countRecords, type BackupRecord } from '../local/backupFormat'
import type { LocalStore } from '../local/localDb'
import { importBackup } from '../local/backupService'
import { callRpc } from '../cloud/rpc'
import { clearOwnOutbox } from './outbox'
import { replaceLocalProblem } from './replaceRules'
import { writeSyncState } from './syncState'

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
  // 1. 取快照。失败如实抛错，不降级成「当作云端是空的」——
  //    那会让一次网络故障变成「把本地清空」。
  const snapshot = await callRpc<unknown>('export_cloud_snapshot')

  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('云端没有返回快照内容，已取消恢复。')
  }

  // 2. 先看条数，好在「云端本来就是空的」时给一句说得通的拒绝。
  //    复用 `countRecords` 而不是自己数数组：口径必须与备份摘要一致
  //    （元数据仓库不计入），写第二遍必然分叉。
  const records = (snapshot as { records?: Partial<Record<LocalStore, BackupRecord[]>> }).records
  const cloudTotal = records && typeof records === 'object' ? countRecords(records).total : 0
  const problem = replaceLocalProblem({ cloudTotal })
  if (problem) throw new Error(problem)

  // 3. 单事务整体替换：内部先 `parseBackup` 全量校验（一条都没写），
  //    再删旧写新；任一步失败整体回滚。
  //    `track: false` 的理由见文件头；`user_id` 由 `importBackup` 重映射到当前本地账号。
  const summary = await importBackup(JSON.stringify(snapshot), { track: false })

  // 4. 本地现在就是云端的副本，队列里那批「相对旧内容算出来的增量」不再成立。
  await clearOwnOutbox()
  await writeSyncState({
    last_restore_at: new Date().toISOString(),
    last_error_message: null,
    last_error_at: null,
  })

  return { counts: summary.counts, total: summary.total, sourceTotal: cloudTotal }
}
