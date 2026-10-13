<<<<<<< HEAD
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
=======
// 服务门面：页面只认这一层，不关心底下是本地库还是 Supabase。
//
// `@backend` 由构建模式决定指向（见 vite.config.ts 的 resolve.alias）：
// 默认 -> src/services/local，--mode cloud -> src/services/cloud。
// 之所以用相对替换（'../local/' 而不是绝对路径），是为了不引入 node:path 这类
// 构建期依赖；代价是 `@backend/` 只允许出现在本目录下（相对解析的基准是引用方所在目录）。
//
// 这两行把该后端的**值导出**与**类型导出**各放行一次：
// 值导出给运行时用，类型导出让 `MealInput` 这类类型仍然可以从服务路径导入。

export * from '@backend/authService'
export type * from '@backend/authService'
>>>>>>> origin/main
