/**
 * 账号与密码的输入规则（服务层与界面共用一份）。
 *
 * 为什么单独放一个文件：同一份输入必须在**服务层与界面**给出同样的拒绝理由——
 * 界面在提交前用这套规则拦住明显不合法的输入，认证门面在请求前再拦一次，
 * 两处若各写一份，就会出现「界面放过去了、服务层报错」或者反过来。
 * 规则写两遍迟早会分叉，所以只写一遍，都从这里取。
 */

/** 账号长度区间。 */
export const USERNAME_MIN_LENGTH = 1
export const USERNAME_MAX_LENGTH = 20

/**
 * 账号允许的字符：小写字母、数字、下划线。
 * 判断发生在 `normalizeUsername` **之后**，因此大写字母是放行的（会被归一成小写）。
 */
export const USERNAME_PATTERN = /^[a-z0-9_]+$/

/** 输入侧密码最短长度；真实 Auth 密码策略由可信管理入口配置。 */
export const PASSWORD_MIN_LENGTH = 6

/** 账号格式说明，界面提示与报错共用同一句话。 */
export const USERNAME_RULE = '请输入账号 W。'
export const ACCOUNT_USERNAME = 'W'

/** 密码格式说明。 */
export const PASSWORD_RULE = `密码至少 ${PASSWORD_MIN_LENGTH} 位。`

/**
 * 账号归一化：去掉首尾空白并转小写。
 *
 * 归一化只在输入侧做，因此 `W` 与 `w` 映射到同一个 Auth 登录标识。
 */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * 校验当前开放的登录账号；合法返回 `null`，否则返回给用户看的原因。
 * 历史账号仅作隔离迁移线索，不再通过本地资料认证。
 */
export function usernameProblem(raw: string): string | null {
  const username = normalizeUsername(raw)
  if (!username) return '请输入账号。'
  if (username !== 'w') return '账号或密码不正确。'
  return null
}

/** 校验密码；合法返回 `null`，否则返回给用户看的原因。 */
export function passwordProblem(password: string): string | null {
  if (!password) return '请输入密码。'
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_RULE
  return null
}
