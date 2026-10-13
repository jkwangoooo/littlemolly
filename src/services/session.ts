<<<<<<< HEAD
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
=======
import type { AppSession } from '../shared/types/auth'

/**
 * 会话存储（后端无关，L6 提到 services 顶层）。
 *
 * 为什么放在这里而不是 `local/` 或 `cloud/`：会话读写的**载体**与后端无关，
 * 两种后端用的都是浏览器 localStorage 里的同一把钥匙。差异只在「谁负责写入」——
 * 本地后端在登录 / 注册 / 退出时自己写，云端后端则由 Supabase 的认证状态变化回写镜像。
 *
 * 之所以要镜像：`currentUser()` 是同步接口（页面与选项 / 日计划服务都靠它拿当前用户），
 * 而 Supabase 的 `auth.getSession()` 是异步的。把会话镜像到 localStorage，
 * 同步读取就有了确定性来源，不需要把整条调用链改成异步。
 */

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

/**
 * 写入会话并广播变化。
 *
 * 值没变时**不广播**：云端后端的认证状态回调会先写镜像、再由事件驱动 App 重新读会话，
 * 若每次写入都广播，一条「读到空会话」的路径就会形成
 * `写入 → 广播 → 读取 → 写入` 的自激循环。
 */
export function writeSession(session: AppSession | null): void {
  const next = session ? JSON.stringify(session) : null
  const current = localStorage.getItem(SESSION_KEY)
  if (next === current) return

  if (next) localStorage.setItem(SESSION_KEY, next)
  else localStorage.removeItem(SESSION_KEY)
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
>>>>>>> origin/main
}
