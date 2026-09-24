import { normalizeUsername, passwordProblem, usernameProblem } from '../../shared/authRules'
import type { AppSession, AppUser } from '../../shared/types/auth'
import { readSession, writeSession } from '../session'
import { getAll, newId, put } from './localDb'
import { seedExampleOptions } from './optionSeed'

/**
 * 本地账号的落库结构。密码只存哈希，绝不存明文。
 *
 * 字段名是 `username` 而不是 `email`：登录凭据从「邮箱 + 密码」换成了「账号 + 密码」。
 * 老库里的历史记录由 `localDb.ts` 的 v5 迁移把 `email` 原样改名过来，
 * 因此**历史账号里可能带 `@`**（例如 `molly@example.com`）——那批用户继续用原字符串登录即可。
 */
export interface LocalUser {
  id: string
  username: string
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
  return { user: { id: user.id, username: user.username } }
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

/**
 * 登录。**有意不校验账号格式**：v5 之前注册的账号是从邮箱迁过来的，
 * 形如 `molly@example.com`，不符合现在的账号规则，若在这里校验，老用户会被自己的账号挡在门外。
 * 查不到账号与密码不对返回同一句话，不区分是哪一个错了。
 */
export async function signIn(username: string, password: string): Promise<void> {
  const normalized = normalizeUsername(username)
  const passwordHash = hashPassword(password)
  const users = await getAll<LocalUser>('users')
  const user = users.find((item) => item.username === normalized)
  if (!user || user.password_hash !== passwordHash) throw new Error('账号或密码不正确。')
  writeSession(toSession(user))
}

export async function signUp(username: string, password: string): Promise<void> {
  const normalized = normalizeUsername(username)
  const problem = usernameProblem(normalized) ?? passwordProblem(password)
  if (problem) throw new Error(problem)

  const users = await getAll<LocalUser>('users')
  if (users.some((item) => item.username === normalized)) throw new Error('该账号已注册，请直接登录。')

  const user: LocalUser = {
    id: newId(),
    username: normalized,
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
