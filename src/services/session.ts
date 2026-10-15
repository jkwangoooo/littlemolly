import type { AppSession, AuthContext, AuthPhase, AuthState } from '../shared/types/auth'

export type { AuthContext, AuthState } from '../shared/types/auth'

const LEGACY_SESSION_KEY = 'happy-little-molly.session'
export const AUTH_LOCK_KEY = 'happy-little-molly.auth-lock.v1'
export const AUTH_CHANGE_EVENT = 'molly-auth-change'
let volatileAuthLock: string | null = null
let state: AuthState = { phase: 'checking', session: null, generation: 0, verified: false, error: null }
const listeners = new Set<() => void>()

export function getAuthState(): AuthState { return state }

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notify(): void {
  for (const listener of listeners) listener()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
}

/** The SDK owns tokens. Only the verified runtime identity lives here. */
export function publishAuthState(next: AuthState): void {
  if (next.generation !== state.generation) return
  state = next
  notify()
}

export function beginAuthTransition(phase: AuthPhase, session: AppSession | null = null): number {
  state = { phase, session, generation: state.generation + 1, verified: false, error: null }
  notify()
  return state.generation
}

export function readSession(): AppSession | null {
  if (readAuthLock()) return null
  return state.phase === 'ready' || state.phase === 'offline-cached' ? state.session : null
}

/** No credentials: this marker prevents cached SDK sessions from undoing logout or rejection. */
export function readAuthLock(): string | null {
  try { return localStorage.getItem(AUTH_LOCK_KEY) ?? volatileAuthLock } catch { return volatileAuthLock }
}

export function lockAuthRestore(): void {
  volatileAuthLock = crypto.randomUUID()
  try { localStorage.setItem(AUTH_LOCK_KEY, volatileAuthLock) } catch {
    throw new Error('工作区已关闭，但浏览器未能保存退出状态，请关闭此页面。')
  }
}

export function unlockAuthRestore(expected: string | null): void {
  if (readAuthLock() !== expected) throw new Error('登录期间账号状态已变化，请重新登录。')
  localStorage.removeItem(AUTH_LOCK_KEY)
  volatileAuthLock = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === AUTH_LOCK_KEY && event.newValue !== null) {
      volatileAuthLock = event.newValue
      beginAuthTransition('signed-out')
    } else if (event.key === AUTH_LOCK_KEY) {
      volatileAuthLock = null
    }
  })
}

/** 当前已完成认证并准备好的 Supabase UID。 */
export function getCurrentUserId(): string | null {
  return readSession()?.user.id ?? null
}

/** Historical JSON is a migration clue, never a login credential. */
export function readLegacySession(): AppSession | null {
  try {
    const raw = localStorage.getItem(LEGACY_SESSION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as AppSession
    return typeof value?.user?.id === 'string' ? value : null
  } catch { return null }
}

export function captureAuthContext(): AuthContext {
  const session = readSession()
  if (!session) throw new Error('请先登录并完成账号数据准备。')
  return { owner: session.user.id, generation: state.generation }
}

export function isAuthContextCurrent(context: AuthContext): boolean {
  return readSession()?.user.id === context.owner && state.generation === context.generation
}

export function assertAuthContextCurrent(context: AuthContext): void {
  if (!isAuthContextCurrent(context)) throw new Error('登录状态已变化，请重新操作。')
}

export function isCloudSessionVerified(): boolean {
  return !readAuthLock() && state.phase === 'ready' && state.verified && state.session !== null
}

export function invalidateAuthContext(context: AuthContext, message: string): void {
  if (!isAuthContextCurrent(context)) return
  const generation = beginAuthTransition('reauth-required')
  let error = message
  try { lockAuthRestore() } catch (reason) {
    error += ` ${reason instanceof Error ? reason.message : '退出状态保存失败。'}`
  }
  publishAuthState({ ...state, generation, error })
}
