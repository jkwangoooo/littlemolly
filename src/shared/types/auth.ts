export interface AppUser {
  id: string
  /** 账号（登录名）。老库里的历史账号是从邮箱原样迁过来的，因此**可能带 `@`**。 */
  username: string
}

export interface AppSession {
  user: AppUser
}
