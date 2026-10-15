import { useSyncExternalStore } from 'react'
import { getAuthState, subscribeAuth } from '../services/api/authService'
import { AuthScreen } from '../features/auth/AuthScreen'
import { DayPlanScreen } from '../features/day-plan/DayPlanScreen'

export function App() {
  const state = useSyncExternalStore(subscribeAuth, getAuthState, getAuthState)
  if (state.phase === 'checking' || state.phase === 'preparing') {
    return (
      <main className="page">
        <section className="panel" role="status">
          <p>{state.phase === 'checking' ? '正在验证账号...' : '正在准备账号数据...'}</p>
        </section>
      </main>
    )
  }

  if (!state.session || (state.phase !== 'ready' && state.phase !== 'offline-cached')) {
    return <AuthScreen notice={state.error} canRetry={state.phase === 'error'} />
  }
  return <DayPlanScreen key={`${state.session.user.id}:${state.generation}`} />
}
