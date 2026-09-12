import { useEffect, useState } from 'react'
import type { AppSession } from '../../shared/types/auth'
import { getSession, signIn, signUp } from '../../services/authService'
import { DayPlanScreen } from '../day-plan/DayPlanScreen'

function messageFrom(error: unknown): string { return error instanceof Error ? error.message : '发生未知错误。' }

export function AuthSyncScreen() {
  const [session, setSession] = useState<AppSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getSession().then((next) => active && setSession(next)).catch((error: unknown) => active && setAuthMessage(messageFrom(error))).finally(() => active && setLoading(false))
    const handleAuthChange = () => { void getSession().then((next) => active && setSession(next)) }
    window.addEventListener('molly-auth-change', handleAuthChange)
    return () => { active = false; window.removeEventListener('molly-auth-change', handleAuthChange) }
  }, [])

  async function submitAuth(mode: 'sign-in' | 'sign-up') {
    setAuthBusy(true); setAuthMessage(null)
    try {
      const signUpMessage = mode === 'sign-in' ? (await signIn(email, password), null) : await signUp(email, password)
      setAuthMessage(signUpMessage ?? (mode === 'sign-in' ? '登录成功。' : '注册成功。'))
    } catch (error) { setAuthMessage(messageFrom(error)) } finally { setAuthBusy(false) }
  }

  if (loading) return <main className="page"><section className="panel"><p>正在恢复会话...</p></section></main>
  if (!session) return <main className="page"><section className="panel stack"><div><p className="eyebrow">幸福小Molly · 本地模式</p><h1>登录</h1><p className="muted">数据保存在当前浏览器中，暂不连接云端。</p></div><label className="field">邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label className="field">密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={6} required /></label><div className="actions"><button type="button" disabled={authBusy} onClick={() => void submitAuth('sign-in')}>登录</button><button className="secondary" type="button" disabled={authBusy} onClick={() => void submitAuth('sign-up')}>注册</button></div>{authMessage && <p className="notice" role="status">{authMessage}</p>}</section></main>
  return <DayPlanScreen session={session} />
}
