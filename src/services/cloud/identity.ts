import { normalizeUsername } from '../../shared/authRules'

export const ACCOUNT_USERNAME = 'W'

/** The product-facing identity is a username; Auth's transport identifier stays internal. */
export function authIdentifierForUsername(username: string): string {
  if (normalizeUsername(username) !== 'w') throw new Error('账号或密码不正确。')
  return 'w@molly.local'
}
