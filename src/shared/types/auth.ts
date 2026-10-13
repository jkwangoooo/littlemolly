export interface AppUser {
  id: string
<<<<<<< HEAD
  username: string
  created_at: string
=======
  email: string
>>>>>>> origin/main
}

export interface AppSession {
  user: AppUser
}
<<<<<<< HEAD

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
=======
>>>>>>> origin/main
