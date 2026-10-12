import type { DataError } from '../../shared/errors'
import { normalizeSupabaseError } from '../cloud/errors'

const REJECTED_AUTH_CODES = new Set([
  'bad_jwt', 'session_expired', 'session_not_found',
  'refresh_token_not_found', 'refresh_token_already_used',
  'user_not_found', 'user_banned', 'invalid_credentials',
  'email_not_confirmed', 'phone_not_confirmed',
  'PGRST301', 'PGRST302', 'PGRST303', 'APP_ACCOUNT_REJECTED',
])

export function rejectedAccount(message: string): DataError {
  const error = new Error(message) as DataError
  error.code = 'APP_ACCOUNT_REJECTED'
  return error
}

export function isRejectedAuthFailure(reason: unknown): boolean {
  const error = normalizeSupabaseError(reason)
  return REJECTED_AUTH_CODES.has(error.code ?? '')
    || error.name === 'AuthSessionMissingError'
    || (error.name === 'AuthApiError' && (error.status === 401 || error.status === 403))
    || (error.code === '42501' && error.message === '当前账号未获应用访问授权')
}

export function isTransientAuthFailure(reason: unknown): boolean {
  const error = normalizeSupabaseError(reason)
  if (isRejectedAuthFailure(error)) return false
  return error.name === 'AuthRetryableFetchError'
    || error.status === 0
    || error.status === 408
    || error.status === 429
    || (typeof error.status === 'number' && error.status >= 500 && error.status < 600)
    || /failed to fetch|fetch failed|network|load failed|timeout/i.test(error.message)
}
