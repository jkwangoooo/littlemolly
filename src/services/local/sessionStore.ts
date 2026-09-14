import type { AppSession } from '../../shared/types/auth'

const SESSION_KEY = 'happy-little-molly.session'

/** 会话变化事件名。App 监听它在登录 / 退出后重新读取会话，无需手动传回调。 */
export const AUTH_CHANGE_EVENT = 'molly-auth-change'

export function readSession(): AppSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as AppSession) : null
  } catch {
    return null
  }
}

export function writeSession(session: AppSession | null): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  else localStorage.removeItem(SESSION_KEY)
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
}
