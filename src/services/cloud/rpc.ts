/**
 * 云端传输层：RPC 调用与条数摘要（S3 建、S5 收口）。
 *
 * 这一层只做两件事——发请求、把错误标准化。**不含任何业务语义**：
 * 不知道什么叫「绑定」、不知道 outbox 是什么、也不决定失败之后怎么办。
 *
 * ## `countCloudRows()` → `readCloudSummary()`（S5 的口径修正）
 *
 * S3 期间这里用 PostgREST 的 `head: true` 数**四张根表**的行数，
 * 拼出一个「云端有多少条」。当时不新增 SQL 是有意的——S3 只需要一个布尔，
 * 为一个布尔提前建 RPC 会破坏「每阶段只做本阶段范围」。
 *
 * S5 把它换成 `cloud_sync_summary()`，原因是那个数字**口径不对**：
 *
 * - 本地那一侧 `countLocalRows()` 数的是 10 张用户数据表的全部行数（含子表）；
 * - 云端那一侧只数 4 张根表，子表一行都没算。
 *
 * 两个数字被摆在一起做比较（`judgeBindingCase(cloudCount, localCount)`）
 * 并显示在绑定确认框里（「云端 3 条 · 本地 47 条」）。口径不同的两个数字
 * 放在一起，小则误导，大则让人选错覆盖方向——一个刚建了一份计划的账号
 * 在云端显示「1 条」、本地显示「10 条」，看起来像云端只存进去了十分之一。
 *
 * 现在两边都由同一个函数算：本地 `countRecords(collectUserRecords())`，
 * 云端 `cloud_sync_summary()`，都是 10 张表、都含子表。
 *
 * 顺带的好处是请求数从 4 降到 1，而且 RLS 仍然全程有效
 * （`cloud_sync_summary` 是 `security invoker`，只数得到调用者自己的行）。
 *
 * **部署前提**：绑定流程现在依赖 `stage6` 迁移。
 * 没执行那一批 SQL 的项目上，连接云端账号会以
 * 「找不到函数 cloud_sync_summary」失败——如实报错，不会退化成「当作云端是空的」。
 */

import { normalizeSupabaseError } from './errors'
import { requireSupabase } from './supabase'

/**
 * 云端账号的条数摘要，与本地 `countRecords` 同一口径（10 张用户数据表、含子表）。
 *
 * `total === 0` 就是「云端是空的」，绑定流程据此走情形①「直接上传」。
 * 读取失败（网络断、RLS 拒绝、迁移没跑）会让整次连接失败并抛错——
 * **不吞掉错误降级成「假设云端是空的」**：那会让一个非空云端账号被判成可安全覆盖。
 */
export type CloudSummary = {
  /** 每张表的条数，只列非空表。键是仓库名。 */
  counts: Record<string, number>
  total: number
}

/**
 * 调用一个 Postgres 函数（RPC）。
 *
 * `data` 为 `null` 时不在这里报错：RPC 返回 `void` 是合法的，
 * 「本该有返回值却是 null」属于调用方的语义判断，传输层替它决定反而会掩盖问题。
 */
export async function callRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await requireSupabase().rpc(name, args)
  if (error) throw normalizeSupabaseError(error)
  return data as T
}

/** 读云端账号的条数摘要。受 RLS 限制，只看得到调用者自己的行。 */
export async function readCloudSummary(): Promise<CloudSummary> {
  const data = await callRpc<CloudSummary | null>('cloud_sync_summary')
  if (!data || typeof data.total !== 'number') {
    throw new Error('云端没有返回条数摘要，无法判断两边的情况。请确认数据库迁移已执行到 stage6。')
  }
  return { counts: data.counts ?? {}, total: data.total }
}
