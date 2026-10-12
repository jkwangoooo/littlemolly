/**
 * 本地上传云端：整体替换（S5）。
 *
 * ```
 * 捕获认证上下文 → 读本地全量 → 前置检查
 *   → RPC import_local_backup（云端单事务替换）
 *   → 成功：只退役本次快照捕获的队列 + 记一次上传时间
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
 * ## 队列退役的时机
 *
 * **上传成功之后**才退役。顺序反了的话，一旦上传失败，
 * 队列里那批「相对云端关系算出来的增量」就凭空消失了，
 * 而云端还是旧的——用户以为传上去了，实际什么都没有。
 *
 * 整体替换与增量推送共用 `withSyncLock`。上传期间新产生的编辑
 * 不属于本次快照，不能被成功回调无条件清掉。
 */

import { callRpc, readCloudSummary, type CloudSummary } from '../cloud/rpc'
import { BACKUP_META_STORES, BACKUP_STORES } from '../local/backupFormat'
import { exportBackup } from '../local/backupService'
import type { LocalStore } from '../local/localDb'
import { assertAuthContextCurrent, captureAuthContext } from '../session'
import {
  assertVerifiedCloudContext, invalidateRejectedCloudContext, retireOwnOutbox, withSyncLock,
} from './outbox'
import { nonUuidValues, replaceCloudProblem } from './replaceRules'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 页面只经同步门面读摘要；请求前后仍固定 UID、认证代次与服务端授权。 */
export async function readVerifiedCloudSummary(): Promise<CloudSummary> {
  const context = captureAuthContext()
  try {
    await assertVerifiedCloudContext(context)
    const summary = await readCloudSummary()
    await assertVerifiedCloudContext(context)
    const known = new Set<string>(BACKUP_STORES.filter((store) => !BACKUP_META_STORES.includes(store)))
    if (!isRecord(summary.counts) || !Number.isInteger(summary.total) || summary.total < 0) {
      throw new Error('云端没有返回有效的条数摘要，无法确认替换范围。')
    }
    let counted = 0
    for (const [store, count] of Object.entries(summary.counts)) {
      if (!known.has(store) || typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        throw new Error('云端条数摘要包含无效的仓库或计数，无法确认替换范围。')
      }
      counted += count
    }
    if (counted !== summary.total) {
      throw new Error('云端条数摘要的合计不一致，无法确认替换范围。')
    }
    return summary
  } catch (reason) {
    invalidateRejectedCloudContext(context, reason)
    throw reason
  }
}

/**
 * RPC 的条数摘要是这次替换能否「确认成功」的唯一依据。
 *
 * 不能只看 `total` 是不是数字：如果服务端漏插了一张表，
 * 仍然把队列退役会把本地数据与云端数据永久拉开。这里同时校验
 * 分表计数、总数和本地快照的预期值。
 */
function assertImportResult(
  value: unknown,
  expected: { counts: Partial<Record<LocalStore, number>>; total: number },
): asserts value is ImportCloudResult {
  if (
    !isRecord(value)
    || !isRecord(value.imported)
    || typeof value.total !== 'number'
    || !Number.isInteger(value.total)
    || value.total < 0
  ) {
    throw new Error('云端没有返回有效的写入摘要，无法确认这次上传的结果。请刷新后重新查看同步状态。')
  }

  const imported = value.imported
  const total = value.total
  let counted = 0
  const stores = new Set([...Object.keys(expected.counts), ...Object.keys(imported)])
  for (const store of stores) {
    const actual = imported[store]
    const wanted = expected.counts[store as LocalStore] ?? 0
    if (typeof actual !== 'number' || !Number.isInteger(actual) || actual < 0 || actual !== wanted) {
      throw new Error(`云端写入条数与本地快照不一致（${store}：本地 ${wanted}，云端 ${String(actual)}）。本次上传未确认成功。`)
    }
    counted += actual
  }
  if (counted !== total || total !== expected.total) {
    throw new Error(`云端写入总数与本地快照不一致（本地 ${expected.total}，云端 ${total}）。本次上传未确认成功。`)
  }
}

/**
 * 用本地当前账号的数据整体替换云端账号的数据。
 *
 * 调用前界面必须先拿到用户的二次确认：这一步**不可撤销**，
 * 云端账号原有的全部业务数据会被删掉。本地数据不受影响。
 */
export async function uploadLocalToCloud(): Promise<UploadResult> {
  const context = captureAuthContext()
  return withSyncLock(async () => {
    // 只允许已经完成 Supabase 会话验证的账号上传。
    await assertVerifiedCloudContext(context)

    // 1. 在同一认证代次下读取业务快照与队列条目。
    const { file, summary, outboxIds } = await exportBackup({
      owner: context.owner,
      guard: () => assertAuthContextCurrent(context),
    })

    // 2. 前置检查。放在发请求之前，为的是把「必然失败的请求」变成一句能照着做的说明。
    const problem = replaceCloudProblem({
      localTotal: summary.total,
      badIds: nonUuidValues(file.records),
    })
    if (problem) throw new Error(problem)

    // 3. 云端单事务替换。RPC 前后都确认 UID 和认证代次没有变化。
    await assertVerifiedCloudContext(context)
    let result: unknown
    try {
      result = await callRpc<unknown>('import_local_backup', { payload: file })
    } catch (reason) {
      invalidateRejectedCloudContext(context, reason)
      throw reason
    }
    await assertVerifiedCloudContext(context)
    assertAuthContextCurrent(context)
    assertImportResult(result, summary)

    // 4. 只退役本轮快照捕获的队列项。上传期间产生的新编辑仍须保留并继续推送。
    await retireOwnOutbox(context, outboxIds, {
      last_push_at: new Date().toISOString(),
      last_error_message: null,
      last_error_at: null,
    })

    return {
      counts: result.imported,
      total: result.total,
      sourceTotal: summary.total,
    }
  })
}
