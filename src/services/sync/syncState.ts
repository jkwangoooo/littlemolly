import {
  assertAuthContextCurrent,
  captureAuthContext,
  getCurrentUserId,
  type AuthContext,
} from '../session'
import { atomicReadWrite, getOne, newId } from '../local/localDb'

/** 兼容现有调用名称；值始终是已经准备好的 Supabase UID。 */
export function currentLocalUserId(): string | null {
  return getCurrentUserId()
}

/** 与 `RECORD_SCHEMAS.sync_state` 一一对应。 */
export type SyncState = {
  /** Supabase UID，与业务根表和队列归属一致。 */
  id: string
  enabled: boolean
  cloud_email: string | null
  device_id: string
  bound_at: string | null
  last_push_at: string | null
  last_restore_at: string | null
  last_error_message: string | null
  last_error_at: string | null
  updated_at: string
}

const DEVICE_ID_KEY = 'happy-little-molly.device'

/** 设备身份不随账号退出、重新登录或工作区恢复改变。 */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
    const created = newId()
    localStorage.setItem(DEVICE_ID_KEY, created)
    return created
  } catch {
    return newId()
  }
}

export function emptySyncState(owner: string, now: string = new Date().toISOString()): SyncState {
  return {
    id: owner,
    enabled: false,
    cloud_email: null,
    device_id: deviceId(),
    bound_at: null,
    last_push_at: null,
    last_restore_at: null,
    last_error_message: null,
    last_error_at: null,
    updated_at: now,
  }
}

/** 所有异步读写使用同一份 owner 和认证代次。 */
export async function readSyncState(context?: AuthContext): Promise<SyncState | null> {
  if (!context && !currentLocalUserId()) return null
  const captured = context ?? captureAuthContext()
  assertAuthContextCurrent(captured)
  const state = await getOne<SyncState>('sync_state', captured.owner)
  assertAuthContextCurrent(captured)
  return state
}

export async function writeSyncState(
  patch: Partial<Omit<SyncState, 'id'>>,
  context?: AuthContext,
): Promise<SyncState | null> {
  if (!context && !currentLocalUserId()) return null
  const captured = context ?? captureAuthContext()
  const updatedAt = new Date().toISOString()
  const nextState = (base: SyncState): SyncState => ({
    ...base,
    ...patch,
    id: captured.owner,
    updated_at: updatedAt,
  })
  assertAuthContextCurrent(captured)
  const base = await atomicReadWrite({
    stores: ['sync_state'],
    read: async (reader) =>
      (await reader.get<SyncState>('sync_state', captured.owner)) ?? emptySyncState(captured.owner, updatedAt),
    build: (previous) => ({ put: [{ store: 'sync_state', value: nextState(previous) }] }),
    track: false,
    owner: captured.owner,
    guard: () => assertAuthContextCurrent(captured),
  })
  assertAuthContextCurrent(captured)
  return nextState(base)
}
