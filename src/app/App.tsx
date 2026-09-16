import { useEffect, useState } from 'react'
import type { AppSession } from '../shared/types/auth'
import { getSession } from '../services/api/authService'
import { AUTH_CHANGE_EVENT } from '../services/session'
import { AuthScreen } from '../features/auth/AuthScreen'
import { DayPlanScreen } from '../features/day-plan/DayPlanScreen'

/**
 * 应用入口：持有会话状态，并决定展示登录页还是日计划页。
 * 会话变化由本地会话写入时派发的 auth-change 事件驱动，登录与退出都不需要手动传回调。
 */
export function App() {
  const [session, setSession] = useState<AppSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void getSession()
      .then((next) => {
        if (active) setSession(next)
      })
      .catch((reason: unknown) => {
        if (active) setSessionError(reason instanceof Error ? reason.message : '无法恢复会话。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    const handleAuthChange = () => {
      void getSession().then((next) => {
        if (active) setSession(next)
      })
    }
    window.addEventListener(AUTH_CHANGE_EVENT, handleAuthChange)

    return () => {
      active = false
      window.removeEventListener(AUTH_CHANGE_EVENT, handleAuthChange)
    }
  }, [])

  if (loading) {
    return (
      <main className="page">
        <section className="panel">
          <p>正在恢复会话...</p>
        </section>
      </main>
    )
  }

  if (!session) return <AuthScreen notice={sessionError} />
  return <DayPlanScreen />
}
