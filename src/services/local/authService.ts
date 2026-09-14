import type { AppSession, AppUser } from '../../shared/types/auth'
import { getAll, newId, put } from './localDb'
import { seedExampleOptions } from './optionSeed'
import { readSession, writeSession } from './sessionStore'

/** users 仓库的落库结构。密码只存哈希，绝不存明文。 */
export interface LocalUser {
  id: string
  email: string
  password_hash: string
  created_at: string
}

/** 简单的确定性哈希：本项目为本地单人使用，不承担公网安全职责。 */
export function hashPassword(password: string): string {
  let hash = 5381
  for (let index = 0; index < password.length; index += 1) {
    hash = ((hash << 5) + hash + password.charCodeAt(index)) | 0
  }
  return `local-${hash >>> 0}`
}

function toSession(user: LocalUser): AppSession {
  return { user: { id: user.id, email: user.email } }
}

/** 读取当前会话；若会话指向的用户已被删除，则顺带清理会话。 */
export async function getSession(): Promise<AppSession | null> {
  const session = readSession()
  if (!session) return null
  const users = await getAll<LocalUser>('users')
  const user = users.find((item) => item.id === session.user.id)
  if (!user) {
    writeSession(null)
    return null
  }
  return toSession(user)
}

export async function signIn(email: string, password: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()
  const passwordHash = hashPassword(password)
  const users = await getAll<LocalUser>('users')
  const user = users.find((item) => item.email === normalizedEmail)
  if (!user || user.password_hash !== passwordHash) throw new Error('邮箱或密码不正确。')
  writeSession(toSession(user))
}

export async function signUp(email: string, password: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || password.length < 6) throw new Error('请输入邮箱，且密码至少 6 位。')
  const users = await getAll<LocalUser>('users')
  if (users.some((item) => item.email === normalizedEmail)) throw new Error('该邮箱已注册，请直接登录。')
  const user: LocalUser = {
    id: newId(),
    email: normalizedEmail,
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
  }
  await put('users', user)
  // 新账号预置少量示例选项：让选项页和（L2 的）选择器一开始就有内容可用。
  // 只依赖 optionSeed，不经 optionService，避免与 currentUser 形成循环依赖。
  await seedExampleOptions(user.id)
  writeSession(toSession(user))
}

export async function signOut(): Promise<void> {
  writeSession(null)
}

export function currentUser(): AppUser | null {
  return readSession()?.user ?? null
}
