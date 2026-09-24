/**
 * 本地上传云端：整体替换（S5）。
 *
 * ```
 * 读本地全量 → 前置检查 → RPC import_local_backup（云端单事务替换）
 *   → 成功：清空本账号队列 + 记一次上传时间
 * ```
 *
 * ## 为什么复用 `exportBackup()` 而不是自己取数
 *
 * 上传的输入就是**一份本地备份**：同样的文件形状、同样的字段清洗、
 * 同样带一条合成 `users` 行。`exportBackup` 已经把这三件事做完了，
 * 再写一遍取数逻辑必然分叉（子表归属要沿父键逐级推导，是最容易写错的一段）。
 *
 * 于是「导出备份」与「上传到云端」在数据层面**是同一个动作**，
 * 区别只落在哪一边：前者写进一个文件，后者写进云端账号。
 * 这也让「备份里的内容」与「云端的内容」不可能不一致。
 *
 * ## 为什么不能逐表写
 *
 * 客户端逐表写入做不到「全成或全不成」：中途失败会在云端留下删了一半的账号，
 * 而界面上看起来像成功了。`import_local_backup` 是一个事务，
 * 要么整体替换完，要么一条都没动——失败时如实抛错，不伪装成功。
 *
 * ## 清空队列的时机
 *
 * **上传成功之后**才清。顺序反了的话，一旦上传失败，
 * 队列里那批「相对云端关系算出来的增量」就凭空消失了，
 * 而云端还是旧的——用户以为传上去了，实际什么都没有。
 */

import { callRpc } from '../cloud/rpc'
import { exportBackup } from '../local/backupService'
import type { LocalStore } from '../local/localDb'
import { clearOwnOutbox } from './outbox'
import { nonUuidValues, replaceCloudProblem } from './replaceRules'
import { writeSyncState } from './syncState'

/** 云端 `import_local_backup` 的返回值。 */
export type ImportCloudResult = {
  /** 每张表实际写入的条数，只列非空表。 */
  imported: Partial<Record<LocalStore, number>>
  /** 写入总条数。 */
  total: number
}

/**
 * 一次整体替换的条数摘要。形状与 `BackupSummary` 的 `counts` / `total` 一致，
 * 界面因此可以复用同一套描述函数（`describeBackupSummary`）。
 */
export type ReplaceCounts = {
  counts: Partial<Record<LocalStore, number>>
  /** 落到目标那一侧的条数（云端写入 / 本地写入）。 */
  total: number
  /**
   * 源那一侧发出去多少条。
   *
   * 正常情况下与 `total` 相等。不相等就意味着**有一批记录没落到对面**——
   * 可能是服务端漏插、也可能是本地取数时漏了某个仓库。
   * 界面据此如实提示，而不是拿一个对得上的数字说「已替换」。
   */
  sourceTotal: number
}

export type UploadResult = ReplaceCounts

/**
 * 用本地当前账号的数据整体替换云端账号的数据。
 *
 * 调用前界面必须先拿到用户的二次确认：这一步**不可撤销**，
 * 云端账号原有的全部业务数据会被删掉。本地数据不受影响。
 */
export async function uploadLocalToCloud(): Promise<UploadResult> {
  // 1. 读本地全量。没有登录会话会在这里抛「请先登录。」。
  const { file, summary } = await exportBackup()

  // 2. 前置检查。放在发请求之前，为的是把「必然失败的请求」变成一句能照着做的说明。
  const problem = replaceCloudProblem({
    localTotal: summary.total,
    badIds: nonUuidValues(file.records),
  })
  if (problem) throw new Error(problem)

  // 3. 云端单事务替换。`payload` 就是那个备份对象——服务端只认形状，不认来源。
  //
  // 这里不再包一层 try/catch：`callRpc` 已经把任何 PostgREST 返回标准化成
  // `DataError` 再抛（`cloud/rpc.ts` + `cloud/errors.ts`），
  // 再包一次只是把同一个对象换个壳，反而多出一处需要维护的分支。
  const result = await callRpc<ImportCloudResult>('import_local_backup', { payload: file })

  if (!result || typeof result.total !== 'number') {
    // 传输层刻意不替调用方判断「本该有返回值却是 null」（见 `cloud/rpc.ts`），
    // 到了这里就是本模块的语义判断：没有条数摘要，就不能说这次替换成功了。
    // 这一条防的是「RPC 成功返回但形状不对」——此时**不能**去清队列，
    // 否则两边是否对齐就成了一个没有依据的断言。
    throw new Error('云端没有返回写入摘要，无法确认这次上传的结果。请刷新后重新查看同步状态。')
  }

  // 4. 两边已经对齐（本地就是云端现在的全部内容），队列里那批增量不再成立。
  await clearOwnOutbox()
  await writeSyncState({
    last_push_at: new Date().toISOString(),
    last_error_message: null,
    last_error_at: null,
  })

  return {
    counts: result.imported ?? {},
    total: result.total,
    sourceTotal: summary.total,
  }
}
