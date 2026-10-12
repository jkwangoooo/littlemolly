export interface AppUser {
  id: string
  username: string
  created_at: string
}

export interface AppSession {
  user: AppUser
}

export type AuthContext = { owner: string; generation: number }

export type AuthPhase =
  | 'checking'
  | 'signed-out'
  | 'preparing'
  | 'ready'
  | 'offline-cached'
  | 'reauth-required'
  | 'error'

export type AuthState = {
  phase: AuthPhase
  session: AppSession | null
  generation: number
  verified: boolean
  error: string | null
}
