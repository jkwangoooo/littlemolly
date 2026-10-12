import type { LocalStore, UserDataStore } from './localDb'

/**
 * 出站队列的**纯规则**（S2）——不碰 IndexedDB、不碰网络，因此
 * `scripts/check-sync.mjs` 可以在 Node 里直接导入做回归。
 *
 * 为什么单独成文件：写入钩子（`localDb.ts`）要在事务里执行压缩，
 * 推送引擎（S3 的 `sync/outbox.ts`）要按依赖层级排序，两处必须用同一套规则。
 * 规则写在本地层而不是同步层，是因为「哪些写入进队列、队列怎么压缩」是
 * **本地写入协议**的一部分：它和写入在同一个事务里生效，不是同步器可以自己决定的。
 */

/** 队列里只有两种操作：整体覆盖（按主键 upsert）与删除。 */
export type OutboxOp = 'upsert' | 'delete'

/** 一条待记录的变更，由写入钩子产生。 */
export type OutboxChange = { store: UserDataStore; record_id: string; op: OutboxOp }

/** 落库后的队列行，与 `RECORD_SCHEMAS.sync_outbox` 一一对应。 */
export type OutboxEntry = {
  id: string
  seq: number
  store: UserDataStore
  record_id: string
  op: OutboxOp
  /**
   * 这条变更所属的 Supabase Auth UID，在写入时由认证上下文确定。
   *
   * 字段名 `local_user_id` 为兼容现有队列而保留，值与业务 `user_id` 使用同一个 Auth UID。
   * 上传按 UID 过滤，防止把其他工作区的改动写进当前账号。过滤见 `entriesOfOwner`。
   *
   * `null` = 写入时读不到会话（迁移期、Node 脚本里会发生），这类条目**永不被推送**。
   */
  local_user_id: string | null
  created_at: string
  attempts: number
  last_error: string | null
}

/**
 * 队列里属于指定 Auth UID 的条目。
 *
 * 抽成纯函数是为了能被 `scripts/check-sync.mjs` 直接回归：这条规则错了的后果
 * 是**跨账号串数据**，而它在界面上完全没有痕迹，只能靠这里钉住。
 *
 * `owner` 为 `null`（没有登录会话）时返回空数组，而不是「全部」——
 * 宁可什么都不推，也不能把来路不明的条目推到某个账号的云端。
 */
export function entriesOfOwner(entries: OutboxEntry[], owner: string | null): OutboxEntry[] {
  if (!owner) return []
  return entries.filter((entry) => entry.local_user_id === owner)
}

/**
 * 单调递增序号。
 *
 * 取「毫秒时间戳 × 1000 + 会话内自增」，因此：同一会话内严格递增（同一毫秒也不会撞），
 * 跨会话按时间排序。序号只用来给批次一个稳定的全序——**真正的推送顺序由依赖层级决定**
 * （见 `SYNC_LAYERS`），所以这里不需要（也不该）为它做一次额外的读写往返。
 */
export function createSeqGenerator(now: () => number = Date.now): () => number {
  let counter = 0
  return () => {
    counter = (counter + 1) % 1000
    return now() * 1000 + counter
  }
}

/** 压缩用的键：同一张表的同一条记录。 */
export function changeKey(change: { store: LocalStore; record_id: string }): string {
  return `${change.store}\u0000${change.record_id}`
}

/**
 * 批内去重：同一次写入里同一条记录被操作多次时，只留**最后**一次。
 *
 * 顺序约定：调用方先放删除、再放写入，于是「同一事务里先删后写」自然收敛成 `upsert`
 * ——这正是「导入备份替换当前账号数据」的形状：先清掉旧记录，再写回备份里的记录，
 * 同 id 的记录最终是存在的，队列里就该是 `upsert`。
 */
export function dedupeChanges(changes: OutboxChange[]): OutboxChange[] {
  const last = new Map<string, OutboxChange>()
  for (const change of changes) last.set(changeKey(change), change)
  return [...last.values()]
}

/**
 * 压缩：同一 `(store, record_id)` 只保留最后一条，返回**该删掉的旧行 id**。
 *
 * 安全边界：`attempts > 0` 的条目已经尝试推送过、可能正在途，删掉它会丢掉失败上下文，
 * 也可能让「已经发出去的删除」被后续写入悄悄抵消。这类条目一律不动，
 * 由推送引擎自己出队（见 docs/18 §5.2）。
 */
export function compactionVictims(existing: OutboxEntry[]): string[] {
  return existing.filter((row) => row.attempts <= 0).map((row) => row.id)
}

// ---------------------------------------------------------------- 依赖层级（S3 用）

/**
 * 推送层级：外键指向谁，谁就先上。
 *
 * - L0 选项表：没有任何外键，其余表都引用它们；
 * - L1 `day_plans`：`user_id` 指向账号；
 * - L2 挂在计划下的记录：三餐、自定义事项、补剂、健身项、家务；
 * - L3 `daily_meal_items`：唯一挂在「三餐」而非「计划」下的表。
 *
 * 删除按**倒序**（先 L3 再 L0）：子表先走，父表后走，不会留下悬空引用。
 */
export const SYNC_LAYERS: readonly (readonly UserDataStore[])[] = [
  ['food_options', 'supplement_templates', 'exercise_options'],
  ['day_plans'],
  ['daily_meals', 'custom_tasks', 'daily_supplements', 'daily_exercise_items', 'routine_tasks'],
  ['daily_meal_items'],
]

/** 某张表在第几层；不在同步范围内（元数据 / 设备状态）返回 -1。 */
export function layerOf(store: LocalStore): number {
  return SYNC_LAYERS.findIndex((layer) => (layer as readonly string[]).includes(store))
}

/**
 * 一个推送批次最多带多少条变更（S4）。
 *
 * 上限存在的理由不是「请求体太大」——100 条变更对应的 PostgREST 请求也就几十 KB——
 * 而是**失败时的重试粒度**：一次推送失败会把整批的 `attempts` 都加一，
 * 批次越大，一条坏数据牵连的无辜记录就越多。
 *
 * 放在这个文件而不是 `sync/outbox.ts`：`check:sync` 要在 Node 里断言它，
 * 而 `outbox.ts` 拖着 supabase（纯 Node 下 import 会失败，S3 已经踩过一次）。
 */
export const BATCH_LIMIT = 100

/**
 * 「队列有新内容」的广播事件名（S4）。
 *
 * 写入钩子（`localDb.ts`）在入队成功后派发它，推送调度器（`sync/pushQueue.ts`）监听它。
 * 用一个 DOM 事件而不是回调 / 订阅表，是为了**不让写入路径知道同步层的存在**：
 * `localDb.ts` 只广播「我这儿多了一条待上传记录」，谁来听、听了做什么都与它无关。
 * 这一点很重要——`localDb.ts` 在 `check:*` 脚本里被 Node 直接导入，
 * 它绝不能 import 任何拖着 supabase 的模块。
 *
 * 常量放在这个纯文件里，两侧都能安全 import。
 */
export const OUTBOX_CHANGE_EVENT = 'molly-outbox-change'

/**
 * 排成推送顺序：**先按倒序清删除（子表 → 父表），再按正序写覆盖（父表 → 子表）**。
 *
 * 同一层内按 `seq` 保持写入顺序。返回新数组，不改动入参。
 */
export function sortChangesForPush(
  changes: OutboxChange[],
  seqOf: (change: OutboxChange) => number = () => 0,
): OutboxChange[] {
  const rank = (change: OutboxChange): number => {
    const layer = layerOf(change.store)
    return change.op === 'delete' ? -layer : layer
  }
  return [...changes].sort((left, right) => {
    if (left.op !== right.op) return left.op === 'delete' ? -1 : 1
    return rank(left) - rank(right) || seqOf(left) - seqOf(right)
  })
}
