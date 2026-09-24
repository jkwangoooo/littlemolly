import { useState } from 'react'
import { USERNAME_RULE } from '../../shared/authRules'
import { signIn, signUp, type AuthResult } from '../../services/api/authService'

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误。'
}

function successMessage(mode: 'sign-in' | 'sign-up', result: AuthResult): string {
  const action = mode === 'sign-in' ? '登录' : '注册'
  if (result.cloud === 'connected') return `${action}成功，本地数据已可用，云端账号也已连接。`
  if (result.cloud === 'unavailable') return `${action}成功，本地数据已可用；当前未配置云端服务。`
  return `${action}成功，本地数据已可用；云端账号暂未连接，请在设置页重试。`
}

/**
 * 登录 / 注册表单。
 * 会话状态由 App 持有：登录或注册成功会写入本地会话并派发 auth-change 事件，
 * 由 App 监听后切换到日计划页，因此这里不持有 session。
 *
 * 凭据是「账号 + 密码」，不是邮箱：账号规则见 `shared/authRules.ts`（提示文案也从那里取，
 * 与本地 / 云端两侧的校验共用同一句话）。
 */
export function AuthScreen({ notice }: { notice?: string | null }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(notice ?? null)

  async function submit(mode: 'sign-in' | 'sign-up') {
    setBusy(true)
    setMessage(null)
    try {
      const result = mode === 'sign-in' ? await signIn(username, password) : await signUp(username, password)
      setMessage(successMessage(mode, result))
    } catch (error) {
      setMessage(messageFrom(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <section className="panel stack">
        <div>
          <p className="eyebrow">幸福小Molly · 统一账号</p>
          <h1>登录</h1>
          <p className="muted">一个账号同时管理本地数据与云端数据；本地缓存优先，离线也能继续使用。</p>
        </div>

        <label className="field">
          账号
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        </label>
        {/* 注册才需要满足格式；登录不校验，因为 v5 之前注册的老账号是从邮箱迁过来的。 */}
        <p className="muted">{USERNAME_RULE}已有账号直接填原账号即可，不区分大小写。</p>

        <label className="field">
          密码
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            minLength={6}
            required
          />
        </label>

        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void submit('sign-in')}>
            登录
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={() => void submit('sign-up')}>
            注册
          </button>
        </div>

        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </section>
    </main>
  )
}
