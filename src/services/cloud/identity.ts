import { normalizeUsername } from '../../shared/authRules'

export const CLOUD_EMAIL_DOMAIN = 'molly.local'
export const ACCOUNT_EMAIL = `w@${CLOUD_EMAIL_DOMAIN}`

/** Must match the existing account prepared through the trusted Auth console. */
export function emailForUsername(username: string): string {
  if (normalizeUsername(username) !== 'w') throw new Error('账号或密码不正确。')
  return ACCOUNT_EMAIL
}
