import type { AppSession, AppUser } from '../../shared/types/auth'
import { getAll, hashPassword, newId, readSession, put, type LocalUser, writeSession } from './localDb'

function toSession(user: LocalUser): AppSession { return { user: { id: user.id, email: user.email } } }

export async function getSession(): Promise<AppSession | null> {
  const session = readSession()
  if (!session) return null
  const user = (await getAll<LocalUser>('users')).find((item) => item.id === session.user.id)
  if (!user) { writeSession(null); return null }
  return toSession(user)
}

export async function signIn(email: string, password: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()
  const passwordHash = await hashPassword(password)
  const user = (await getAll<LocalUser>('users')).find((item) => item.email === normalizedEmail)
  if (!user || user.password_hash !== passwordHash) throw new Error('邮箱或密码不正确。')
  writeSession(toSession(user))
}

export async function signUp(email: string, password: string): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || password.length < 6) throw new Error('请输入邮箱，且密码至少 6 位。')
  const users = await getAll<LocalUser>('users')
  if (users.some((item) => item.email === normalizedEmail)) throw new Error('该邮箱已注册，请直接登录。')
  const user: LocalUser = { id: newId(), email: normalizedEmail, password_hash: await hashPassword(password), created_at: new Date().toISOString() }
  await put('users', user)
  writeSession(toSession(user))
  return null
}

export async function signOut(): Promise<void> { writeSession(null) }

export function currentUser(): AppUser | null { return readSession()?.user ?? null }
