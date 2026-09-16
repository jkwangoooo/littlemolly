import type { DataError } from '../../shared/errors'

/**
 * 云端适配层的错误标准化（L6）。
 *
 * Supabase 抛出的不是 `Error`，而是 `{ message, details, hint, code }` 这样的普通对象。
 * 界面统一按 `DataError` 展示（`shared/errors.ts` 的 `describeDataError`），
 * 所以这里把两种形状收敛成同一个结构，与本地后端抛出的错误长得一样——
 * 「同一种失败在两种后端下显示不同文案」同样属于后端不等价。
 *
 * 单独成文件是因为选项、日计划、认证三处适配器都要用它，放在任一服务模块里
 * 都会让另外两个反向依赖那个模块。
 */
export type SupabaseDataError = DataError

export function normalizeSupabaseError(error: unknown): SupabaseDataError {
  if (error instanceof Error) return error as SupabaseDataError
  const value = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const message = typeof value.message === 'string' ? value.message : '发生未知错误。'
  const normalized = new Error(message) as SupabaseDataError
  if (typeof value.code === 'string') normalized.code = value.code
  if (typeof value.details === 'string') normalized.details = value.details
  if (typeof value.hint === 'string') normalized.hint = value.hint
  if (typeof value.status === 'number') normalized.status = value.status
  return normalized
}

/** 统一的失败出口：任何一次 PostgREST / GoTrue 返回都从这里抛出。 */
export function throwSupabaseError(error: unknown): never {
  throw normalizeSupabaseError(error)
}
