import type { AppSession, AppUser } from '../../shared/types/auth'
import { readSession, writeSession } from '../session'
import { throwSupabaseError } from './errors'
import { seedExampleOptions } from './optionSeed'
import { requireSupabase } from './supabase'

/**
 * 认证（Supabase Auth 实现，L6）。
 *
 * 与 `local/authService.ts` 的接口完全一致，但有三点必须说清楚：
 *
 * 1. **会话以 Supabase 为权威，本地只存镜像。** `currentUser()` 是同步接口，
 *    而 `auth.getSession()` 是异步的，所以把会话镜像到 `services/session.ts`
 *    的同一把 localStorage 钥匙里；页面拿到的 `AppUser.id` 就是 `auth.users.id`，
 *    与 `day_plans.user_id` 等列的外键完全一致，不需要再做 id 映射。
 * 2. **注册要在拿到会话之后才播种示例选项**：三条选项表的 RLS 依赖 `auth.uid()`，
 *    没有会话时写不进去。
 * 3. **邮箱验证开着就不放行。** 若项目开启了邮箱确认，`signUp` 不会返回会话，
 *    此时直接报错说明，而不是写一个空会话假装登录成功——
 *    与「本地保存不得伪装成云端同步成功」是同一条原则。
 */

let listenerReady = false

/**
 * 把 Supabase 的认证状态变化镜像到本地会话。
 * 只在云端模式下会被调用（本模块仅在云端构建里被引入）。
 */
function ensureAuthListener(): void {
  if (listenerReady) return
  listenerReady = true
  requireSupabase().auth.onAuthStateChange((_event, session) => {
    writeSession(toSession(session?.user ?? null))
  })
}

function toSession(user: { id: string; email?: string | null } | null): AppSession | null {
  if (!user?.email) return null
  return { user: { id: user.id, email: user.email } }
}

/** 读取当前会话。以 Supabase 的结果为准，并顺带刷新本地镜像。 */
export async function getSession(): Promise<AppSession | null> {
  ensureAuthListener()
  const { data, error } = await requireSupabase().auth.getSession()
  if (error) throwSupabaseError(error)
  const session = toSession(data.session?.user ?? null)
  writeSession(session)
  return session
}

export async function signIn(email: string, password: string): Promise<void> {
  ensureAuthListener()
  const normalizedEmail = email.trim().toLowerCase()
  const { data, error } = await requireSupabase().auth.signInWithPassword({
    email: normalizedEmail,
    password,
  })
  if (error) throwSupabaseError(error)
  const session = toSession(data.user)
  if (!session) throw new Error('登录成功但未能取得账号信息，请稍后重试。')
  writeSession(session)
}

export async function signUp(email: string, password: string): Promise<void> {
  ensureAuthListener()
  const normalizedEmail = email.trim().toLowerCase()
  // 与本地后端同样的前置校验，保证两种后端对同一份输入给出同样的拒绝理由。
  if (!normalizedEmail || password.length < 6) throw new Error('请输入邮箱，且密码至少 6 位。')

  const { data, error } = await requireSupabase().auth.signUp({
    email: normalizedEmail,
    password,
  })
  if (error) throwSupabaseError(error)

  const session = toSession(data.user)
  if (!data.session || !session) {
    throw new Error('注册已提交，但项目开启了邮箱验证：请先完成验证再登录，或关闭邮箱验证后重试。')
  }

  await seedExampleOptions(session.user.id)
  writeSession(session)
}

export async function signOut(): Promise<void> {
  const { error } = await requireSupabase().auth.signOut()
  if (error) throwSupabaseError(error)
  writeSession(null)
}

export function currentUser(): AppUser | null {
  return readSession()?.user ?? null
}
