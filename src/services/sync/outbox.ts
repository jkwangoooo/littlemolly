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
 * 队列结算与状态更新在同一事务提交。每轮固定认证上下文，
 * 退出后不出队、不重建失败条目，也不写入后来登录的账号状态。
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
import { callRpc } from '../cloud/rpc'
import { requireSupabase } from '../cloud/supabase'
import type { LocalStore, UserDataStore } from '../local/localDb'
import { getAll, getOne, runTransaction } from '../local/localDb'
import { atomicReadWrite } from '../local/localDb'
import { BATCH_LIMIT, entriesOfOwner, layerOf, type OutboxEntry } from '../local/outboxRules'
import {
  assertAuthContextCurrent,
  captureAuthContext,
  invalidateAuthContext,
  isAuthContextCurrent,
  isCloudSessionVerified,
  type AuthContext,
} from '../session'
import { isUserScoped, toCloudRow, type CloudRow } from './mapper'
import { emptySyncState, type SyncState } from './syncState'
import { isRejectedAuthFailure } from './authErrors'

const SYNC_LOCK_NAME = 'molly-sync-push'
let localLockTail = Promise.resolve()

/** 增量上传和整体替换共用互斥；无 Web Locks 时仍保证本标签页串行。 */
export async function withSyncLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(SYNC_LOCK_NAME, work)
  }
  const previous = localLockTail
  let release = () => {}
  localLockTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await work()
  } finally {
    release()
  }
}

/** 只关闭明确被拒绝的身份；普通 RLS、迁移或网络错误仍按原错误保留重试。 */
export function invalidateRejectedCloudContext(context: AuthContext, reason: unknown): void {
  const error = normalizeSupabaseError(reason)
  const gateRejected = error.code === '42501' && error.message === '当前账号未获应用访问授权'
  if (isRejectedAuthFailure(error)) {
    invalidateAuthContext(context, gateRejected
      ? '当前账号未获应用访问授权，请联系管理员确认账号权限。'
      : '登录凭据已失效，请重新登录。')
  }
}

/** 不把 SDK 缓存当认证：重新验证用户与服务器访问门禁，防撤销授权后仍退役队列。 */
export async function assertVerifiedCloudContext(context: AuthContext): Promise<void> {
  assertAuthContextCurrent(context)
  if (!isCloudSessionVerified()) {
    throw new Error('当前账号尚未完成联网验证，已暂停上传。')
  }
  try {
    const client = requireSupabase()
    const session = await client.auth.getSession()
    assertAuthContextCurrent(context)
    if (session.error) throw normalizeSupabaseError(session.error)
    if (!session.data.session || session.data.session.user.id !== context.owner) {
      const message = '登录会话已变化，请重新登录后继续。'
      invalidateAuthContext(context, message)
      throw new Error(message)
    }

    const user = await client.auth.getUser()
    assertAuthContextCurrent(context)
    if (user.error) throw normalizeSupabaseError(user.error)
    if (!user.data.user || user.data.user.id !== context.owner) {
      const message = '账号验证结果已变化，请重新登录后继续。'
      invalidateAuthContext(context, message)
      throw new Error(message)
    }

    const access = await callRpc<{ allowed: boolean; uid: string | null }>('account_access')
    assertAuthContextCurrent(context)
    if (access?.allowed === false || (access?.allowed === true && access.uid !== context.owner)) {
      const message = '当前账号未获应用访问授权，请联系管理员确认账号权限。'
      invalidateAuthContext(context, message)
      throw new Error(message)
    }
    if (access?.allowed !== true || access.uid !== context.owner) {
      throw new Error('云端没有返回有效的账号授权结果，已暂停上传。')
    }
    if (!isCloudSessionVerified()) {
      throw new Error('当前账号尚未完成联网验证，已暂停上传。')
    }
  } catch (reason) {
    invalidateRejectedCloudContext(context, reason)
    throw reason
  }
}

export type PushOnceResult =
  /** 队列是空的，没什么可推。 */
  | { kind: 'idle' }
  /** 一批推完了。`skipped` 是「回主表读不到、直接作废」的条数。 */
  | { kind: 'pushed'; pushed: number; skipped: number }
  /** 这一批失败了，条目已写回 `attempts`，下次重试。 */
  | { kind: 'failed'; attempted: number; error: string }

/** 把条目按依赖层级排好：删除倒序在前，写入正序在后，同层按 `seq`。 */
function sortEntries(entries: OutboxEntry[]): OutboxEntry[] {
  return [...entries].sort((left, right) => {
    if (left.op !== right.op) return left.op === 'delete' ? -1 : 1
    const leftRank = left.op === 'delete' ? -layerOf(left.store) : layerOf(left.store)
    const rightRank = right.op === 'delete' ? -layerOf(right.store) : layerOf(right.store)
    return leftRank - rightRank || left.seq - right.seq
  })
}

/**
 * 取一个批次：只取属于当前认证上下文的 Supabase Auth UID 的条目。
 *
 * 队列按 UID 过滤，不能把其他工作区的改动上传到当前账号。
 * 过滤规则在 `entriesOfOwner` 中；本轮捕获的 UID 和身份代次同时约束读取、请求与结算。
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
async function readBatch(context: AuthContext): Promise<OutboxEntry[]> {
  assertAuthContextCurrent(context)
  const rows = await getAll<OutboxEntry>('sync_outbox')
  assertAuthContextCurrent(context)
  const mine = entriesOfOwner(rows, context.owner)
  if (mine.length <= BATCH_LIMIT) return sortEntries(mine)
  return sortEntries(mine).slice(0, BATCH_LIMIT)
}

/**
 * 清掉当前 Auth UID 的待上传账本，返回清掉的条数。
 *
 * 只删除当前上下文所属的条目，其他 UID 的队列保持原样。
 * 整体上传成功后应使用 `retireOwnOutbox`，只退役上传快照捕获的条目。
 */
export async function clearOwnOutbox(context: AuthContext = captureAuthContext()): Promise<number> {
  assertAuthContextCurrent(context)
  const rows = await getAll<OutboxEntry>('sync_outbox')
  assertAuthContextCurrent(context)
  const ids = ownOutboxIds(rows, context.owner)
  if (!ids.length) return 0
  await runTransaction(
    { remove: ids.map((id) => ({ store: 'sync_outbox' as LocalStore, id })) },
    { track: false, owner: context.owner, guard: () => assertAuthContextCurrent(context) },
  )
  assertAuthContextCurrent(context)
  return ids.length
}

/**
 * 指定 Auth UID 的队列条目 ID。纯筛选结果可与工作区及同步状态放在同一事务提交。
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

/** 仅退役本轮捕获且仍存在的条目；新编辑生成的条目保持待上传。 */
export async function retireOwnOutbox(
  context: AuthContext,
  ids: readonly string[],
  patch: Partial<Omit<SyncState, 'id'>> = {},
): Promise<number> {
  assertAuthContextCurrent(context)
  const capturedIds = new Set(ids)
  const at = new Date().toISOString()
  const snapshot = await atomicReadWrite({
    stores: ['sync_outbox', 'sync_state'],
    read: async (reader) => {
      const rows = await reader.getAll<OutboxEntry>('sync_outbox')
      const state = await reader.get<SyncState>('sync_state', context.owner)
      return {
        entries: entriesOfOwner(rows, context.owner).filter((row) => capturedIds.has(row.id)),
        state: state ?? emptySyncState(context.owner, at),
      }
    },
    build: ({ entries, state }) => ({
      remove: entries.map((entry) => ({ store: 'sync_outbox' as LocalStore, id: entry.id })),
      put: [{ store: 'sync_state', value: { ...state, ...patch, id: context.owner, updated_at: at } }],
    }),
    track: false,
    owner: context.owner,
    guard: () => assertAuthContextCurrent(context),
  })
  assertAuthContextCurrent(context)
  return snapshot.entries.length
}

/** 原子更新存活条目，避免失败回调复活已被新编辑压缩掉的旧条目。 */
async function recordFailure(context: AuthContext, entries: OutboxEntry[], message: string): Promise<void> {
  assertAuthContextCurrent(context)
  const ids = new Set(entries.map((entry) => entry.id))
  const at = new Date().toISOString()
  await atomicReadWrite({
    stores: ['sync_outbox', 'sync_state'],
    read: async (reader) => {
      const rows = await reader.getAll<OutboxEntry>('sync_outbox')
      const state = await reader.get<SyncState>('sync_state', context.owner)
      return {
        entries: entriesOfOwner(rows, context.owner).filter((row) => ids.has(row.id)),
        state: state ?? emptySyncState(context.owner, at),
      }
    },
    build: (snapshot) => ({
      put: [
        ...snapshot.entries.map((entry) => ({
          store: 'sync_outbox' as LocalStore,
          value: { ...entry, attempts: entry.attempts + 1, last_error: message },
        })),
        {
          store: 'sync_state' as LocalStore,
          value: { ...snapshot.state, last_error_message: message, last_error_at: at, updated_at: at },
        },
      ],
    }),
    track: false,
    owner: context.owner,
    guard: () => assertAuthContextCurrent(context),
  })
  assertAuthContextCurrent(context)
}

async function assertRecordOwner(context: AuthContext, store: UserDataStore, record: CloudRow): Promise<void> {
  assertAuthContextCurrent(context)
  if (isUserScoped(store)) {
    if (record.user_id !== context.owner) throw new Error('记录不属于当前账号，已停止上传。')
    return
  }
  let planId = record.day_plan_id
  if (store === 'daily_meal_items') {
    const meal = await getOne<CloudRow>('daily_meals', String(record.daily_meal_id))
    assertAuthContextCurrent(context)
    planId = meal?.day_plan_id
  }
  const plan = typeof planId === 'string' ? await getOne<CloudRow>('day_plans', planId) : null
  assertAuthContextCurrent(context)
  if (!plan || plan.user_id !== context.owner) {
    throw new Error('记录的父级不属于当前账号，已停止上传。')
  }
}

/**
 * 推一个批次。
 *
 * context 必须来自已经准备好的工作区；所有 await 后和提交前再次验证。
 */
export async function pushOnce(context: AuthContext): Promise<PushOnceResult> {
  await assertVerifiedCloudContext(context)
  const batch = await readBatch(context)
  assertAuthContextCurrent(context)
  if (!batch.length) return { kind: 'idle' }

  const upserts = new Map<UserDataStore, CloudRow[]>()
  const deletes = new Map<UserDataStore, string[]>()
  /** 这一批里可以出队的条目：推送成功的 + 判定作废的。 */
  const settled: OutboxEntry[] = []
  let skipped = 0

  try {
    for (const entry of batch) {
      assertAuthContextCurrent(context)
      if (entry.op === 'delete') {
        pushInto(deletes, entry.store, entry.record_id)
        settled.push(entry)
        continue
      }

      const record = await getOne<CloudRow>(entry.store, entry.record_id)
      assertAuthContextCurrent(context)
      if (!record) {
        settled.push(entry)
        skipped += 1
        continue
      }
      await assertRecordOwner(context, entry.store, record)
      assertAuthContextCurrent(context)
      pushInto(upserts, entry.store, toCloudRow(entry.store, record, context.owner))
      settled.push(entry)
    }

    const client = requireSupabase()

    // 先删后写：顺序由 `sortChangesForPush` 定，这里只是**保持**它，
    // 所以先跑完所有 delete 请求，再跑 upsert 请求。
    for (const [store, ids] of deletes) {
      await assertVerifiedCloudContext(context)
      assertAuthContextCurrent(context)
      const { error } = await client.from(store).delete().in('id', ids)
      assertAuthContextCurrent(context)
      if (error) throw normalizeSupabaseError(error)
    }

    for (const [store, rows] of upserts) {
      await assertVerifiedCloudContext(context)
      assertAuthContextCurrent(context)
      // 按主键 upsert：本地 id 就是 uuid v4，直接沿用，父子外键不需要重映射（docs/13 §5.2）。
      const { error } = await client.from(store).upsert(rows, { onConflict: 'id' })
      assertAuthContextCurrent(context)
      if (error) throw normalizeSupabaseError(error)
    }
    await assertVerifiedCloudContext(context)
  } catch (cause) {
    invalidateRejectedCloudContext(context, cause)
    if (!isAuthContextCurrent(context)) throw cause
    const message = describeDataError(cause)
    await recordFailure(context, batch, message)
    assertAuthContextCurrent(context)
    return { kind: 'failed', attempted: batch.length, error: message }
  }

  await retireOwnOutbox(context, settled.map((entry) => entry.id), {
    last_push_at: new Date().toISOString(),
    last_error_message: null,
    last_error_at: null,
  })
  assertAuthContextCurrent(context)
  return { kind: 'pushed', pushed: settled.length, skipped }
}
