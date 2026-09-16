import { useState } from 'react'
import { signIn, signUp } from '../../services/api/authService'

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误。'
}

/**
 * 登录 / 注册表单。
 * 会话状态由 App 持有：登录或注册成功会写入本地会话并派发 auth-change 事件，
 * 由 App 监听后切换到日计划页，因此这里不持有 session。
 */
export function AuthScreen({ notice }: { notice?: string | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(notice ?? null)

  async function submit(mode: 'sign-in' | 'sign-up') {
    setBusy(true)
    setMessage(null)
    try {
      if (mode === 'sign-in') await signIn(email, password)
      else await signUp(email, password)
      setMessage(mode === 'sign-in' ? '登录成功。' : '注册成功。')
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
          <p className="eyebrow">幸福小Molly · 本地模式</p>
          <h1>登录</h1>
          <p className="muted">数据保存在当前浏览器中，暂不连接云端。</p>
        </div>

        <label className="field">
          邮箱
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>

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
