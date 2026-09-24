/**
 * 出站队列的读取、分批与推送执行（S4）。
 *
 * ## 一次推送的完整流程
 *
 * ```
 * 读队列 → 按依赖层级排序 → 截一个批次(≤100)
 *   → 逐条准备：upsert 的**回主表读当前行**并映射；delete 的只需 id
 *   → 按表分组发请求（先全部 delete，再全部 upsert）
 *   → 成功：出队 + 写 last_push_at
 *     失败：整批写回 attempts + last_error，并把原因写进 sync_state
 * ```
 *
 * 最后一行的两笔写入是**分开的**：`sync_outbox` 记「这批条目怎么样了」，
 * `sync_state` 记「整个同步通道现在什么状况」。设置页显示的是后者，
 * 推送重试看的是前者——两者口径不同，不能合并成一份账。
 *
 * ## 四条硬约束
 *
 * 1. **推送前必须回主表读当前行**。队列里只有 `store` / `record_id` / `op`，没有数据副本
 *    （S2 的决定）。读到 `null` 说明记录已经被删了——跳过它，
 *    对应的删除会以 `delete` 的形式单独在队列里（写入钩子记过）。
 *    若在这里把队列当成数据源，推上去的会是**一个过期副本**。
 *
 * 2. **删除一律先于写入**。这是 `sortChangesForPush` 保证的，本模块**不能打乱它**：
 *    所以先发完全部 delete 请求，再发全部 upsert 请求。反过来会让
 *    「删父表行（级联删子表行）」与「插子表行」撞在一起，留下悬空引用。
 *
 * 3. **失败就是整批失败**。任何一个请求报错，整批条目的 `attempts` 都加一。
 *    不做「部分成功」的精细账：推送本身是幂等的（upsert 按主键、delete 按 id），
 *    整批重试无害；而维护一份「哪些成功了」的账反而会引入新的错位可能。
 *
 * 4. **成功才出队**。失败时条目留在队列里（`attempts > 0`），
 *    而 S2 的压缩规则规定 `attempts > 0` 的条目不参与压缩——所以重试的账本不会被后续写入吃掉。
 *
 * ## 与 `outboxRules.ts` 的分工
 *
 * 规则（排序、层级、批次上限）在那边，是纯函数、`check:sync` 直接回归。
 * 这里只做 I/O：读 IndexedDB、发请求、写回结果。
 */

import { describeDataError } from '../../shared/errors'
import { normalizeSupabaseError } from '../cloud/errors'
import { requireSupabase } from '../cloud/supabase'
import type { LocalStore, UserDataStore } from '../local/localDb'
import { getAll, getOne, runTransaction } from '../local/localDb'
import { BATCH_LIMIT, changeKey, entriesOfOwner, sortChangesForPush, type OutboxEntry } from '../local/outboxRules'
import { toCloudRow, type CloudRow } from './mapper'
import { currentLocalUserId, writeSyncState } from './syncState'

export type PushOnceResult =
  /** 队列是空的，没什么可推。 */
  | { kind: 'idle' }
  /** 一批推完了。`skipped` 是「回主表读不到、直接作废」的条数。 */
  | { kind: 'pushed'; pushed: number; skipped: number }
  /** 这一批失败了，条目已写回 `attempts`，下次重试。 */
  | { kind: 'failed'; attempted: number; error: string }

/** 把条目按依赖层级排好：删除倒序在前，写入正序在后，同层按 `seq`。 */
function sortEntries(entries: OutboxEntry[]): OutboxEntry[] {
  const byKey = new Map(entries.map((entry) => [changeKey(entry), entry]))
  const sorted = sortChangesForPush(
    entries.map((entry) => ({ store: entry.store, record_id: entry.record_id, op: entry.op })),
    (change) => byKey.get(changeKey(change))?.seq ?? 0,
  )
  return sorted
    .map((change) => byKey.get(changeKey(change)))
    .filter((entry): entry is OutboxEntry => Boolean(entry))
}

/**
 * 取一个批次——**只取属于当前本地账号的条目**（S4 补丁 ②）。
 *
 * 归属过滤不是可选项：队列是设备级的，而绑定是「本地账号 ↔ 云端账号」的。
 * 换过账号之后，队列里可能还留着上一个账号的条目；不加区分地推上去，
 * 就会把 A 的数据写进 B 绑定的云端账号。过滤规则本身在 `entriesOfOwner` 里
 * （纯函数，`check:sync` 直接回归），这里只负责把当前账号传进去。
 *
 * 没有登录会话时 `entriesOfOwner` 返回空数组：宁可什么都不推。
 *
 * **先排序、再截断**。直接 `slice(0, 100)` 会把「删除在前、写入在后」的层级顺序切碎——
 * 例如队列前 100 条恰好全是某张子表的写入，而它的父表删除排在第 101 条，
 * 这一批推上去就会在云端留下悬空引用。
 *
 * 代价是要把整个队列读进内存。可以接受：队列的条目数 = **不同记录数**（S2 压缩过），
 * 单机应用量级在千条以内；真要更大时再改成按层级分段取，规则不变。
 */
async function readBatch(): Promise<OutboxEntry[]> {
  const mine = entriesOfOwner(await getAll<OutboxEntry>('sync_outbox'), currentLocalUserId())
  if (mine.length <= BATCH_LIMIT) return sortEntries(mine)
  return sortEntries(mine).slice(0, BATCH_LIMIT)
}

/**
 * 清掉**当前本地账号**的待上传账本，返回清掉的条数。
 *
 * 与「清空整张表」的区别：`sync_outbox` 里可能有别的本地账号留下的条目
 * （见 `readBatch` 的归属过滤），它们不属于当前的绑定关系，
 * 不该被这次绑定 / 解绑牵连——那些条目会在那个账号自己回来时继续生效。
 *
 * 调用方在绑定 / 解绑流程里（`accountLink.ts`）：队列记的是「相对当时那个云端关系的增量」，
 * 关系变了，这份增量就不再成立，正确的动作是走 S5 的整体替换而不是补推旧增量。
 */
export async function clearOwnOutbox(): Promise<number> {
  const ids = ownOutboxIds(await getAll<OutboxEntry>('sync_outbox'), currentLocalUserId())
  if (!ids.length) return 0
  await runTransaction(
    { remove: ids.map((id) => ({ store: 'sync_outbox' as LocalStore, id })) },
    { track: false },
  )
  return ids.length
}

/**
 * 某人的队列条目 id。读与写分开暴露，是为了让解绑能把「状态行 + 队列」放进**同一个事务**
 * （分开清的话，中途失败会留下「队列空了但界面还显示已连接」这种自相矛盾的状态）。
 */
export function ownOutboxIds(rows: OutboxEntry[], owner: string | null): string[] {
  return entriesOfOwner(rows, owner).map((row) => row.id)
}

/** 分组累加：同一张表的行/删除合成一个请求。 */
function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** 成功（或作废）的条目出队。 */
async function retire(entries: OutboxEntry[]): Promise<void> {
  if (!entries.length) return
  await runTransaction(
    { remove: entries.map((entry) => ({ store: 'sync_outbox' as LocalStore, id: entry.id })) },
    { track: false },
  )
}

/** 失败：整批写回 `attempts` 与 `last_error`，条目留在队列里等下次重试。 */
async function recordFailure(entries: OutboxEntry[], message: string): Promise<void> {
  if (!entries.length) return
  await runTransaction(
    {
      put: entries.map((entry) => ({
        store: 'sync_outbox' as LocalStore,
        value: { ...entry, attempts: entry.attempts + 1, last_error: message },
      })),
    },
    { track: false },
  )
}

/**
 * 成功：记下这次上传的时间，并**清掉上一次的失败原因**。
 *
 * 清掉是必须的：不清的话「上传失败：网络错误」会在恢复之后一直挂在设置页上，
 * 变成一个已经过期却仍在陈述的假事实。两个字段一起写，不存在「有失败原因但时间是上次成功」的中间态。
 */
async function recordSuccess(at: string): Promise<void> {
  await writeSyncState({ last_push_at: at, last_error_message: null, last_error_at: null })
}

/** 失败：把原因与时间写进 `sync_state`，供设置页如实显示（不写 `last_push_at`）。 */
async function recordPushError(message: string, at: string): Promise<void> {
  await writeSyncState({ last_error_message: message, last_error_at: at })
}

/**
 * 推一个批次。
 *
 * `cloudUserId` 由调用方从 `sync_state` 取好传进来——本模块不自己去读，
 * 因为「有没有绑定云端账号」是调度器（`pushQueue.ts`）的判断，
 * 而未绑定时压根不该走到这里（`users` 不进队列，所以 `cloud_user_id` 也无处可推）。
 */
export async function pushOnce(cloudUserId: string): Promise<PushOnceResult> {
  const batch = await readBatch()
  if (!batch.length) return { kind: 'idle' }

  const upserts = new Map<UserDataStore, CloudRow[]>()
  const deletes = new Map<UserDataStore, string[]>()
  /** 这一批里可以出队的条目：推送成功的 + 判定作废的。 */
  const settled: OutboxEntry[] = []
  let skipped = 0

  for (const entry of batch) {
    if (entry.op === 'delete') {
      pushInto(deletes, entry.store, entry.record_id)
      settled.push(entry)
      continue
    }

    // 回主表读**当前**行——不是队列里的副本（队列里本来也没有副本）。
    const record = await getOne<CloudRow>(entry.store, entry.record_id)
    if (!record) {
      // 记录已经被删了：这条 upsert 已经没有意义，作废出队。
      // 它的删除会以 `delete` 的形式在队列里（写入钩子记过），下一批推上去。
      settled.push(entry)
      skipped += 1
      continue
    }

    pushInto(upserts, entry.store, toCloudRow(entry.store, record, cloudUserId))
    settled.push(entry)
  }

  try {
    const client = requireSupabase()

    // 先删后写：顺序由 `sortChangesForPush` 定，这里只是**保持**它，
    // 所以先跑完所有 delete 请求，再跑 upsert 请求。
    for (const [store, ids] of deletes) {
      const { error } = await client.from(store).delete().in('id', ids)
      if (error) throw normalizeSupabaseError(error)
    }

    for (const [store, rows] of upserts) {
      // 按主键 upsert：本地 id 就是 uuid v4，直接沿用，父子外键不需要重映射（docs/13 §5.2）。
      const { error } = await client.from(store).upsert(rows, { onConflict: 'id' })
      if (error) throw normalizeSupabaseError(error)
    }
  } catch (cause) {
    const message = describeDataError(cause)
    await recordFailure(batch, message)
    await recordPushError(message, new Date().toISOString())
    return { kind: 'failed', attempted: batch.length, error: message }
  }

  await retire(settled)
  await recordSuccess(new Date().toISOString())
  return { kind: 'pushed', pushed: settled.length, skipped }
}
