import { useEffect, useRef, useState } from 'react'
import { retryAuth, signIn } from '../../services/api/authService'

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误。'
}

export function AuthScreen({ notice, canRetry = false }: { notice?: string | null; canRetry?: boolean }) {
  const [username, setUsername] = useState('W')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const mounted = useRef(false)
  const submitting = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  async function submit() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setMessage(null)
    try {
      await signIn(username, password)
      if (!mounted.current) return
      setPassword('')
    } catch (error) {
      if (!mounted.current) return
      setMessage(messageFrom(error))
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function retry() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setMessage(null)
    try {
      await retryAuth()
    } catch (error) {
      if (mounted.current) setMessage(messageFrom(error))
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <main className="page">
      <form className="panel stack" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <div>
          <p className="eyebrow">幸福小Molly</p>
          <h1>登录</h1>
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
            disabled={busy}
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
            disabled={busy}
            required
          />
        </label>

        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? '正在登录...' : '登录'}
          </button>
          {canRetry ? (
            <button className="secondary" type="button" disabled={busy} onClick={() => void retry()}>
              重新验证
            </button>
          ) : null}
        </div>

        {(message || notice) && (
          <p className="notice" role="alert">
            {message ?? notice}
          </p>
        )}
      </form>
    </main>
  )
}
