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
}
