/** 服务层统一错误：保留后端或驱动返回的结构化元信息，便于界面展示与排错。 */
export interface DataError extends Error {
  code?: string
  details?: string
  hint?: string
  status?: number
}

/**
 * 把任意抛出物标准化为 DataError。
 * 已是 Error 的原样返回；普通对象则提取 message 与可选的 code/details/hint/status。
 * 本地实现不会丢元信息，未来云端适配器可直接复用同一函数。
 */
export function normalizeDataError(error: unknown): DataError {
  if (error instanceof Error) return error as DataError

  const value = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const rawMessage =
    typeof value.message === 'string' ? value.message : typeof error === 'string' ? error : '发生未知错误。'

  const normalized = new Error(rawMessage) as DataError
  if (typeof value.code === 'string') normalized.code = value.code
  if (typeof value.details === 'string') normalized.details = value.details
  if (typeof value.hint === 'string') normalized.hint = value.hint
  if (typeof value.status === 'number') normalized.status = value.status
  return normalized
}

/** 把 DataError 拼成一行可读文案，供界面直接展示。 */
export function describeDataError(error: unknown): string {
  const normalized = normalizeDataError(error)
  const metadata = [
    normalized.code && `错误码 ${normalized.code}`,
    normalized.details,
    normalized.hint && `提示：${normalized.hint}`,
  ].filter(Boolean)
  return [normalized.message, ...metadata].join('；')
}
