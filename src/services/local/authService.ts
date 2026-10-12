import type { AppUser } from '../../shared/types/auth'
import { readSession } from '../session'

/** Local users are profile caches, with no local authentication methods. */
export type LocalUser = AppUser

export function currentUser(): AppUser | null {
  return readSession()?.user ?? null
}
