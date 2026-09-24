/**
 * 账号与密码的输入规则（服务层与界面共用一份）。
 *
 * 为什么单独放一个文件：同一份输入必须在**服务层与界面**给出同样的拒绝理由——
 * 界面在提交前用这套规则拦住明显不合法的输入，服务层在写入前再拦一次，
 * 两处若各写一份，就会出现「界面放过去了、服务层报错」或者反过来。
 * 规则写两遍迟早会分叉，所以只写一遍，都从这里取。
 *
 * （L6 时还有第三个消费者——`cloud/authService.ts` 要与本地后端给出同样的拒绝理由；
 * 该文件已在 S4-T7 删除，见 `docs/23` §2.6。）
 */

/** 账号长度区间。 */
export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20

/**
 * 账号允许的字符：小写字母、数字、下划线。
 * 判断发生在 `normalizeUsername` **之后**，因此大写字母是放行的（会被归一成小写）。
 */
export const USERNAME_PATTERN = /^[a-z0-9_]+$/

/** 密码最短长度。本地哈希与 Supabase Auth 用的是同一个下限。 */
export const PASSWORD_MIN_LENGTH = 6

/** 账号格式说明，界面提示与报错共用同一句话。 */
export const USERNAME_RULE = `账号需 ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 位，只能用字母、数字和下划线。`

/** 密码格式说明。 */
export const PASSWORD_RULE = `密码至少 ${PASSWORD_MIN_LENGTH} 位。`

/**
 * 账号归一化：去掉首尾空白并转小写。
 *
 * 归一化只在**输入侧**做，库里存的已经是归一化结果，因此 `Molly` 与 `molly` 是同一个账号，
 * 登录时大小写写错也能进去。
 */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * 校验一个新注册的账号；合法返回 `null`，否则返回给用户看的原因。
 *
 * **只在注册时调用。** 登录时不做格式校验，原因见下面 `legacy` 的说明：
 * 老库里的历史账号是从邮箱原样迁过来的，形如 `molly@example.com`，本身就不符合新规则，
 * 若登录也校验，这批用户会被自己的账号挡在门外。
 */
export function usernameProblem(raw: string): string | null {
  const username = normalizeUsername(raw)
  if (!username) return '请输入账号。'
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) return USERNAME_RULE
  if (!USERNAME_PATTERN.test(username)) return USERNAME_RULE
  return null
}

/** 校验密码；合法返回 `null`，否则返回给用户看的原因。 */
export function passwordProblem(password: string): string | null {
  if (!password) return '请输入密码。'
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_RULE
  return null
}
