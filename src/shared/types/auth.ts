export interface AppUser {
  id: string
  email: string
}

export interface AppSession {
  user: AppUser
}
