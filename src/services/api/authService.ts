import { passwordProblem, usernameProblem } from '../../shared/authRules'
import { cloudSyncConfigured } from '../capabilities'
import { describeDataError } from '../../shared/errors'
import { beginAuthTransition, getAuthState, lockAuthRestore, publishAuthState, readAuthLock } from '../session'

export { currentUser } from '../local/authService'
export {
  captureAuthContext, getAuthState, isAuthContextCurrent, subscribeAuth,
} from '../session'
export type { AuthContext, AuthState } from '../session'

const configurationError = '账号服务未配置，请配置 Supabase 后重新构建应用。'

/** Tokens stay in the SDK; the facade exposes only application state. */
export async function initializeAuth(): Promise<void> {
  if (!cloudSyncConfigured) {
    publishAuthState({ ...getAuthState(), phase: 'error', error: configurationError })
    return
  }
  const generation = getAuthState().generation
  try {
    const module = await import('../sync/authSession')
    return await module.initializeAuth()
  } catch (reason) {
    if (getAuthState().generation !== generation) return
    publishAuthState({
      phase: 'error', session: null, generation, verified: false, error: describeDataError(reason),
    })
  }
}

export async function retryAuth(): Promise<void> {
  if (!cloudSyncConfigured) throw new Error(configurationError)
  if (readAuthLock()) throw new Error('请重新输入账号和密码登录。')
  const state = getAuthState()
  const sameWorkspace = state.session !== null
    && (state.phase === 'ready' || state.phase === 'offline-cached')
  const generation = sameWorkspace ? state.generation : beginAuthTransition('checking')
  if (sameWorkspace) publishAuthState({ ...state, verified: false, error: null })
  try {
    const module = await import('../sync/authSession')
    await module.retryAuth(generation)
  } catch (reason) {
    if (getAuthState().generation === generation && getAuthState().phase === 'checking' && !readAuthLock()) {
      publishAuthState({
        phase: 'error', session: null, generation, verified: false, error: describeDataError(reason),
      })
    }
    throw reason
  }
}

export async function signIn(username: string, password: string): Promise<void> {
  const problem = usernameProblem(username) ?? passwordProblem(password)
  if (problem) throw new Error(problem)
  if (!cloudSyncConfigured) throw new Error(configurationError)
  const expectedLock = readAuthLock()
  const generation = beginAuthTransition('preparing')
  try {
    const module = await import('../sync/authSession')
    await module.signIn(username, password, generation, expectedLock)
  } catch (reason) {
    if (getAuthState().generation === generation && getAuthState().phase === 'preparing') {
      publishAuthState({
        phase: 'error', session: null, generation, verified: false, error: describeDataError(reason),
      })
    }
    throw reason
  }
}

/** Close the workspace immediately, including before lazy code has loaded. */
export async function signOut(): Promise<void> {
  const generation = beginAuthTransition('signed-out')
  let markerError: unknown
  try { lockAuthRestore() } catch (reason) { markerError = reason }
  try {
    if (cloudSyncConfigured) {
      const module = await import('../sync/authSession')
      await module.signOut(generation)
    }
    if (markerError) throw markerError
  } catch (reason) {
    if (getAuthState().generation === generation) {
      publishAuthState({
        phase: 'signed-out', session: null, generation, verified: false,
        error: `本机工作区已关闭，退出请求未完成：${describeDataError(reason)}`,
      })
    }
    throw reason
  }
}
