import type { Session, User } from '@supabase/supabase-js'
import { ACCOUNT_USERNAME, passwordProblem, usernameProblem } from '../../shared/authRules'
import { describeDataError } from '../../shared/errors'
import type { AppSession } from '../../shared/types/auth'
import { normalizeSupabaseError } from '../cloud/errors'
import { emailForUsername } from '../cloud/identity'
import { callRpc } from '../cloud/rpc'
import { requireSupabase } from '../cloud/supabase'
import { initializeCloudWorkspace, inspectBackup } from '../local/backupService'
import { getOne } from '../local/localDb'
import { getWorkspaceState, prepareEmptyWorkspace } from '../local/workspaceService'
import {
  AUTH_LOCK_KEY, beginAuthTransition, getAuthState, lockAuthRestore, publishAuthState, readAuthLock, unlockAuthRestore,
} from '../session'
import { deviceId } from './syncState'
import { isRejectedAuthFailure, isTransientAuthFailure, rejectedAccount } from './authErrors'

let initialized: Promise<void> | null = null
let installed = false
let explicitOperations = 0
let operations: Promise<void> = Promise.resolve()
let revision = 0
let sdkRevision = 0
let timer: ReturnType<typeof setTimeout> | null = null
const OFFLINE_OWNER_KEY = 'happy-little-molly.offline-owner.v1'
let preparedOwner: string | null = null
let offlineRestoreRequiresVerification = readAuthLock() !== null

function assertTransition(generation: number, currentRevision: number, expectedLock: string | null = null): void {
  if (getAuthState().generation !== generation || revision !== currentRevision || readAuthLock() !== expectedLock) {
    throw new Error('登录状态已变化，请重新操作。')
  }
}

function blockCachedRestore(message: string): string {
  offlineRestoreRequiresVerification = true
  try { lockAuthRestore() } catch (reason) { return `${message} ${describeDataError(reason)}` }
  return message
}

function reportFailure(reason: unknown, generation: number, currentRevision: number): void {
  if (getAuthState().generation !== generation || revision !== currentRevision || readAuthLock()) return
  const rejected = isRejectedAuthFailure(reason)
  const phase = rejected ? 'reauth-required' : 'error'
  if (getAuthState().session) generation = beginAuthTransition(phase)
  const message = rejected ? blockCachedRestore(describeDataError(reason)) : describeDataError(reason)
  publishAuthState({ phase, session: null, generation, verified: false, error: message })
}

function appSession(user: User): AppSession {
  return { user: { id: user.id, username: ACCOUNT_USERNAME, created_at: user.created_at } }
}

function rememberPreparedOwner(owner: string, guard: () => void): void {
  guard()
  preparedOwner = owner
  try { localStorage.setItem(OFFLINE_OWNER_KEY, owner) } catch { /* Offline restoration remains optional. */ }
}

/** This pointer identifies an already prepared workspace; it never authenticates or enables uploads. */
function offlineOwner(cached: Session | null): string | null {
  if (cached?.user) {
    return cached.user.email?.toLowerCase() === emailForUsername(ACCOUNT_USERNAME) ? cached.user.id : null
  }
  const current = getAuthState().session?.user.id
  if (current) return current
  try { return localStorage.getItem(OFFLINE_OWNER_KEY) ?? preparedOwner } catch { return preparedOwner }
}

async function verifyAccountAccess(user: User, guard: () => void): Promise<void> {
  guard()
  if (user.email?.toLowerCase() !== emailForUsername(ACCOUNT_USERNAME)) {
    throw rejectedAccount('当前认证身份不是账号 W，请重新登录。')
  }
  const access = await callRpc<{ allowed: boolean; uid: string | null }>('account_access')
  guard()
  if (access?.allowed === false || (access?.allowed === true && access.uid !== user.id)) {
    throw rejectedAccount('此账号未获准访问，请联系管理员确认账号权限。')
  }
  if (access?.allowed !== true || access.uid !== user.id) {
    throw new Error('云端没有返回有效的账号授权结果，请重试或联系管理员检查数据库配置。')
  }
}

async function prepareSession(user: User, guard: () => void): Promise<AppSession> {
  const session = appSession(user)
  const state = await getWorkspaceState(user.id, guard)
  guard()
  const syncStatePatch = {
    enabled: true,
    cloud_email: user.email ?? null,
    device_id: deviceId(),
    bound_at: new Date().toISOString(),
    last_error_message: null,
    last_error_at: null,
  }
  if (state?.initialized) {
    await prepareEmptyWorkspace(session.user, guard, syncStatePatch)
  } else {
    const snapshot = await callRpc<unknown>('export_cloud_snapshot')
    guard()
    const text = JSON.stringify(snapshot)
    const backup = inspectBackup(text, { allowEmpty: true })
    if (backup.records.users?.[0]?.id !== user.id) {
      throw new Error('云端快照归属与当前认证账号不一致，已停止准备数据。')
    }
    if (backup.summary.total > 0) {
      await initializeCloudWorkspace({ snapshot, profile: session.user, guard, syncStatePatch })
    } else {
      await prepareEmptyWorkspace(session.user, guard, syncStatePatch)
    }
  }
  guard()
  rememberPreparedOwner(user.id, guard)
  return session
}

async function publishVerifiedSession(
  user: User, session: AppSession, generation: number, guard: () => void,
): Promise<void> {
  while (true) {
    guard()
    const startedSdkRevision = sdkRevision
    const { data, error } = await requireSupabase().auth.getSession()
    guard()
    if (sdkRevision !== startedSdkRevision) continue
    if (error) throw normalizeSupabaseError(error)
    if (data.session?.user.id !== user.id) {
      throw rejectedAccount('账号会话已变化，请重新登录。')
    }
    offlineRestoreRequiresVerification = false
    publishAuthState({ phase: 'ready', session, generation, verified: true, error: null })
    return
  }
}

async function openOfflineWorkspace(
  owner: string | null, generation: number, currentRevision: number,
): Promise<boolean> {
  if (!owner) return false
  const guard = () => assertTransition(generation, currentRevision)
  const [workspace, profile] = await Promise.all([
    getWorkspaceState(owner, guard),
    getOne<AppSession['user']>('users', owner),
  ])
  guard()
  if (!workspace?.initialized || profile?.id !== owner || profile.username !== ACCOUNT_USERNAME) return false
  publishAuthState({
    phase: 'offline-cached', session: { user: profile }, generation, verified: false,
    error: '暂时无法验证账号，当前使用这台设备的缓存；变更将在联网验证后上传。',
  })
  return true
}

async function recoverSessionFailure(
  reason: unknown, cached: Session | null, generation: number, currentRevision: number,
): Promise<void> {
  if (getAuthState().generation !== generation || revision !== currentRevision || readAuthLock()) throw reason
  let failure = reason
  if (!offlineRestoreRequiresVerification && isTransientAuthFailure(failure)) {
    try {
      if (await openOfflineWorkspace(offlineOwner(cached), generation, currentRevision)) return
    } catch (offlineError) {
      if (getAuthState().generation !== generation || revision !== currentRevision || readAuthLock()) throw reason
      failure = offlineError
    }
  }
  reportFailure(failure, generation, currentRevision)
  throw failure
}

async function reconcile(cached: Session | null, generation: number, currentRevision: number): Promise<void> {
  const guard = () => assertTransition(generation, currentRevision)
  try {
    guard()
    if (readAuthLock()) {
      publishAuthState({ phase: 'signed-out', session: null, generation, verified: false, error: null })
      return
    }
    if (!cached) {
      publishAuthState({ phase: 'signed-out', session: null, generation, verified: false, error: null })
      return
    }
    const { data, error } = await requireSupabase().auth.getUser()
    guard()
    if (error) throw normalizeSupabaseError(error)
    if (!data.user || data.user.id !== cached.user.id) throw rejectedAccount('账号会话不一致，请重新登录。')
    await verifyAccountAccess(data.user, guard)
    const session = await prepareSession(data.user, guard)
    await publishVerifiedSession(data.user, session, generation, guard)
  } catch (reason) {
    if (getAuthState().generation !== generation || revision !== currentRevision) return
    if (readAuthLock()) return
    await recoverSessionFailure(reason, cached, generation, currentRevision)
  }
}

function queueReconcile(cached: Session | null): void {
  if (explicitOperations || readAuthLock()) return
  if (timer !== null) clearTimeout(timer)
  const currentRevision = ++revision
  const state = getAuthState()
  const sameWorkspace = Boolean(cached && state.session?.user.id === cached.user.id
    && (state.phase === 'ready' || state.phase === 'offline-cached'))
  const generation = sameWorkspace
    ? state.generation
    : beginAuthTransition(cached ? 'preparing' : 'signed-out')
  if (sameWorkspace) publishAuthState({ ...state, verified: false })
  // Return from SDK callbacks before another SDK operation acquires its lock.
  timer = setTimeout(() => {
    timer = null
    void reconcile(cached, generation, currentRevision).catch(() => {})
  }, 0)
}

function queueSignedOutCheck(): void {
  const generation = getAuthState().generation
  const currentRevision = revision
  const currentSdkRevision = sdkRevision
  const isCurrent = () => getAuthState().generation === generation
    && revision === currentRevision && sdkRevision === currentSdkRevision && !readAuthLock()
  // A cross-tab SIGNED_OUT may arrive after a newer login; inspect the SDK after its callback returns.
  setTimeout(() => {
    if (!isCurrent()) return
    void requireSupabase().auth.getSession().then(({ data, error }) => {
      if (!isCurrent()) return
      if (error) {
        if (!explicitOperations) void recoverSessionFailure(error, data.session, generation, currentRevision).catch(() => {})
        return
      }
      if (data.session) {
        queueReconcile(data.session)
        return
      }
      ++revision
      if (timer !== null) clearTimeout(timer)
      timer = null
      const nextGeneration = beginAuthTransition('signed-out')
      const message = blockCachedRestore('账号会话已结束，请重新登录。')
      publishAuthState({ ...getAuthState(), generation: nextGeneration, error: message })
    }).catch((reason: unknown) => {
      if (!isCurrent() || explicitOperations) return
      void recoverSessionFailure(reason, null, generation, currentRevision).catch(() => {})
    })
  }, 0)
}

function installLifecycle(): void {
  if (installed) return
  const client = requireSupabase()
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return
    ++sdkRevision
    if (event === 'SIGNED_OUT') {
      queueSignedOutCheck()
      return
    }
    queueReconcile(session)
  })
  const revalidate = (afterUnlock = false) => {
    if (explicitOperations || readAuthLock() || (!afterUnlock && getAuthState().phase === 'signed-out')) return
    const generation = getAuthState().generation
    const startedRevision = revision
    void client.auth.getSession().then(({ data, error }) => {
      if (getAuthState().generation !== generation || revision !== startedRevision || explicitOperations || readAuthLock()) return
      if (error) {
        const currentRevision = ++revision
        void recoverSessionFailure(error, data.session, generation, currentRevision).catch(() => {})
      } else queueReconcile(data.session)
    }).catch((reason: unknown) => {
      if (getAuthState().generation !== generation || revision !== startedRevision || explicitOperations || readAuthLock()) return
      const currentRevision = ++revision
      void recoverSessionFailure(reason, null, generation, currentRevision).catch(() => {})
    })
  }
  window.addEventListener('online', () => { revalidate() })
  window.addEventListener('storage', (event) => {
    if (event.key !== AUTH_LOCK_KEY) return
    offlineRestoreRequiresVerification = true
    if (event.oldValue !== null && event.newValue === null) revalidate(true)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revalidate()
  })
  window.addEventListener('offline', () => {
    const state = getAuthState()
    if (state.phase === 'ready') {
      publishAuthState({
        ...state, phase: 'offline-cached', verified: false,
        error: '当前离线，变更保存在本机，联网验证后会继续上传。',
      })
    }
  })
  installed = true
}

export function initializeAuth(): Promise<void> {
  initialized ??= (async () => {
    const generation = getAuthState().generation
    const currentRevision = ++revision
    let cached: Session | null = null
    try {
      installLifecycle()
      if (readAuthLock()) {
        publishAuthState({ phase: 'signed-out', session: null, generation, verified: false, error: null })
        return
      }
      const { data, error } = await requireSupabase().auth.getSession()
      cached = data.session
      assertTransition(generation, currentRevision)
      if (error) throw normalizeSupabaseError(error)
      await reconcile(cached, generation, currentRevision)
    } catch (reason) {
      if (getAuthState().generation !== generation || revision !== currentRevision) return
      await recoverSessionFailure(reason, cached, generation, currentRevision).catch(() => {})
    }
  })()
  return initialized
}

function exclusive(action: () => Promise<void>): Promise<void> {
  ++explicitOperations
  ++revision
  if (timer !== null) clearTimeout(timer)
  const result = operations.then(action).finally(() => { --explicitOperations })
  operations = result.catch(() => {})
  return result
}

export function retryAuth(generation: number): Promise<void> {
  return exclusive(async () => {
    const currentRevision = revision
    let cached: Session | null = null
    try {
      assertTransition(generation, currentRevision)
      installLifecycle()
      const { data, error } = await requireSupabase().auth.getSession()
      cached = data.session
      assertTransition(generation, currentRevision)
      if (error) throw normalizeSupabaseError(error)
      await reconcile(cached, generation, currentRevision)
    } catch (reason) {
      await recoverSessionFailure(reason, cached, generation, currentRevision)
    }
  })
}

export function signIn(username: string, password: string, generation: number, expectedLock: string | null): Promise<void> {
  const problem = usernameProblem(username) ?? passwordProblem(password)
  if (problem) return Promise.reject(new Error(problem))
  return exclusive(async () => {
    offlineRestoreRequiresVerification = true
    const currentRevision = revision
    let currentLock = expectedLock
    const guard = () => {
      assertTransition(generation, currentRevision, currentLock)
    }
    try {
      guard()
      installLifecycle()
      const client = requireSupabase()
      const { data, error } = await client.auth.signInWithPassword({
        email: emailForUsername(username), password,
      })
      guard()
      if (error) throw normalizeSupabaseError(error)
      if (!data.session || !data.user) throw rejectedAccount('未取得账号会话，请重新登录。')
      const verified = await client.auth.getUser()
      guard()
      if (verified.error) throw normalizeSupabaseError(verified.error)
      if (!verified.data.user || verified.data.user.id !== data.user.id) {
        throw rejectedAccount('账号验证结果不一致，请重新登录。')
      }
      await verifyAccountAccess(verified.data.user, guard)
      guard()
      unlockAuthRestore(currentLock)
      currentLock = null
      const session = await prepareSession(verified.data.user, guard)
      await publishVerifiedSession(verified.data.user, session, generation, guard)
    } catch (reason) {
      if (getAuthState().generation === generation && revision === currentRevision) {
        const rejected = isRejectedAuthFailure(reason)
        publishAuthState({
          phase: rejected ? 'reauth-required' : 'error', session: null, generation, verified: false,
          error: rejected ? blockCachedRestore(describeDataError(reason)) : describeDataError(reason),
        })
      }
      throw reason
    }
  })
}

export function signOut(generation: number): Promise<void> {
  return exclusive(async () => {
    offlineRestoreRequiresVerification = true
    installLifecycle()
    const { error } = await requireSupabase().auth.signOut({ scope: 'local' })
    if (error) {
      const reason = normalizeSupabaseError(error)
      if (getAuthState().generation === generation) {
        publishAuthState({
          phase: 'signed-out', session: null, generation, verified: false,
          error: `本机工作区已关闭，但退出账号请求失败：${reason.message}`,
        })
      }
      throw reason
    }
  })
}
