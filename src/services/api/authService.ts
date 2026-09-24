// 服务门面：页面只认这一层，不关心底下是谁。
//
// S1 起门面**直接指向本地实现**，不再经 `@backend` 别名按构建模式切换。
// 原因见 `services/capabilities.ts`：本地 IndexedDB 是唯一的写入落点，
// 云端退化为可选的上行通道（`services/sync/`），不再参与页面读写路径。
// 既然只有一条路径，就没有分支，也不需要分支。
//
// 保留门面这一层、而不是让页面直接 import `services/local/*`：
// 这条边界是「页面不认识数据层」这句话的落点，`check:cloud-parity` 会静态守住它。
//
// 两行分别放行**值导出**与**类型导出**：值导出给运行时用，
// 类型导出让 `MealInput` 这类类型仍然可以从服务路径导入。

export * from '../local/authService'
export type * from '../local/authService'

import { cloudSyncConfigured } from '../capabilities'
import { signIn as localSignIn, signUp as localSignUp } from '../local/authService'
import { autoBindCloudAccount, provisionCloudAccount } from './syncService'

export type AuthCloudStatus = 'connected' | 'unavailable' | 'failed'

export type AuthResult = {
  /** 本地会话已经建立；这是业务能否继续使用的唯一必要条件。 */
  local: 'ready'
  /** 云端绑定的真实结果，避免把本地成功说成云端成功。 */
  cloud: AuthCloudStatus
}

/** 本地会话建立后，登录页会立即卸载；用事件把云端结果交给应用首屏展示。 */
export const AUTH_RESULT_EVENT = 'molly-auth-result'

function finishAuth(cloud: AuthCloudStatus): AuthResult {
  const result: AuthResult = { local: 'ready', cloud }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<AuthResult>(AUTH_RESULT_EVENT, { detail: result }))
  }
  return result
}

/** 统一账号登录：先完成本地登录，再尽力绑定云端。 */
export async function signIn(username: string, password: string): Promise<AuthResult> {
  await localSignIn(username, password)
  if (!cloudSyncConfigured) return finishAuth('unavailable')
  try {
    const bound = await autoBindCloudAccount(username, password)
    return finishAuth(bound ? 'connected' : 'failed')
  } catch {
    // 本地登录已经完成；用户可在设置页重试云端连接。
    return finishAuth('failed')
  }
}

/** 统一账号注册：先落本地镜像，再尽力创建并绑定云端身份。 */
export async function signUp(username: string, password: string): Promise<AuthResult> {
  await localSignUp(username, password)
  if (!cloudSyncConfigured) return finishAuth('unavailable')
  try {
    await provisionCloudAccount(username, password)
    const bound = await autoBindCloudAccount(username, password)
    return finishAuth(bound ? 'connected' : 'failed')
  } catch {
    // 本地账号已经完成；设置页可以重试云端连接，不阻断离线使用。
    return finishAuth('failed')
  }
}
