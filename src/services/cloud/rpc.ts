/**
 * 云端传输层负责 RPC 请求与错误标准化，不决定认证、队列或恢复策略。
 * 条数摘要与本地 countRecords 使用同一口径：10 张业务表，包含子表。
 * 部署需具备认证门禁与现行 RPC；缺失迁移、RLS 拒绝或网络失败均向调用方报错。
 */

import { normalizeSupabaseError } from './errors'
import { requireSupabase } from './supabase'

/**
 * 云端账号的条数摘要，与本地 `countRecords` 同一口径（10 张用户数据表、含子表）。
 *
 * total 为 0 仅表示当前 UID 没有可见业务记录。
 * 读取失败不能降级成空云端，以免错误放行整体替换。
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
  const { data, error, status } = await requireSupabase().rpc(name, args)
  if (error) {
    const reason = normalizeSupabaseError(error)
    reason.status ??= status
    throw reason
  }
  return data as T
}

/** 读云端账号的条数摘要。受 RLS 限制，只看得到调用者自己的行。 */
export async function readCloudSummary(): Promise<CloudSummary> {
  const data = await callRpc<CloudSummary | null>('cloud_sync_summary')
  if (!data || typeof data.total !== 'number') {
    throw new Error('云端没有返回条数摘要，无法判断两边的情况。请确认现行数据库迁移、账号门禁与 RPC 配置。')
  }
  return { counts: data.counts ?? {}, total: data.total }
}
