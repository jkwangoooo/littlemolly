/**
 * 云端账号名的映射规则（S3 提取）。
 *
 * 这条规则从 L6 的 `cloud/authService.ts` 里抽出来（**那个文件已在 S4-T7 删除**，
 * 见 `docs/23` §2.6）。抽它的理由至今有效：当时有两个消费者，而它们对
 * 「登录成功后干什么」的**行为要求相反**——
 *
 * - L6 的 `cloud/authService.ts` 是「云端后端」实现：登录成功后会把会话写进
 *   `services/session.ts` 的镜像（那时云端账号就是应用身份）。
 * - `sync/accountLink.ts` 是 S3 的「绑定」流程：本地账号才是应用身份，
 *   云端账号侧挂绑定，**绝不能碰本地会话**（碰了就等于把用户从本地账号挤出去）。
 *
 * 两者对「登录成功后干什么」的要求相反，但「账号名怎么变成 Supabase 认识的邮箱」
 * 必须完全一致——否则同一个账号在两条路径下会指向两个不同的云端身份。
 * 所以只把这一个规则提出来共用，剩下的各做各的。如今只剩 `sync/accountLink.ts`
 * 一个消费者，但规则继续住在这里：它是**两侧共用的约定**，不是某个模块的实现细节。
 *
 * ---
 *
 * 关于「账号 + 密码」：Supabase Auth 只认邮箱或手机号，**没有原生的账号登录**。
 * 这里把账号映射成一个本项目专用的合成邮箱 `<账号>@molly.local`，真实账号名写进
 * `user_metadata.username`。三点后果都写在这里，免得以后踩：
 *
 * - `.local` 是保留给 mDNS 的顶级域，永远不会真的投递邮件，所以不会有人因为
 *   一个错打的地址收到别人的注册确认信；
 * - 域名一旦定下就**不能改**：改掉等于把已注册的云端账号全变成「查无此邮箱」；
 * - 老账号（v5 之前从邮箱迁过来的，形如 `molly@example.com`）在云端侧会变成
 *   `molly@example.com@molly.local`。云端尚未在真实项目执行过（见 README），
 *   因此这是迁移前的既定状态，不是线上问题；真要上线前先把这批账号在云端重建一次。
 */

/** 合成邮箱的域名。改它等于让所有已注册的云端账号登不进来，见上面的注释。 */
export const CLOUD_EMAIL_DOMAIN = 'molly.local'

/** 账号 → Supabase 认识的邮箱。 */
export function emailForUsername(username: string): string {
  return `${username}@${CLOUD_EMAIL_DOMAIN}`
}
