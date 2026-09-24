/**
 * 同步服务门面（S3）——页面唯一认的同步入口。
 *
 * ## 这个文件存在的唯一理由：把 supabase 挡在初始 chunk 之外
 *
 * 页面只 `import ... from '../../services/api/syncService'`，而这里**每一个函数**
 * 都通过 `await import()` 去取真正的实现。于是：
 *
 * - 门面本身是纯转发代码，不含 `@supabase/*`，可以安全地静态 import；
 * - `services/sync/*` 与它们拖着的 `services/cloud/*` 被 Vite 打成独立的 chunk，
 *   **只有真的点了「连接云端账号」才会下载**；
 * - 未配置 Supabase 时（`cloudSyncConfigured === false`），那条 chunk 从头到尾
 *   不会被请求，「未绑定云端账号时整轮交互零跨域请求」因此是结构性成立的，
 *   而不是靠调用方记得别乱调。
 *
 * 如果这里改成静态 `export * from '../sync/accountLink'`，上面三条会同时失效，
 * 而且失效得很安静——构建产物里多一个 supabase，`typecheck` 与 `lint` 都不会说话。
 * `verify:local` 用 CDP 监听网络来兜住这件事（S1-T5 / S3-T6）。
 *
 * ## 类型为什么可以用 `import type`
 *
 * `import type` 编译后被完全擦除，不产生运行时依赖，所以类型可以从实现文件直接引。
 * 这样「门面签名」与「实现签名」永远一致，不会出现门面各写一遍慢慢分叉。
 */

import type { CloudAccountMode, CloudConnectionProbe } from '../sync/accountLink'
import type { CloudBindingCase } from '../sync/bindingRules'
import type { UploadResult } from '../sync/replaceCloud'
import type { RestoreResult } from '../sync/replaceLocal'
import type { SyncStatus } from '../sync/status'

export type { CloudAccountMode, CloudBindingCase, CloudConnectionProbe, RestoreResult, SyncStatus, UploadResult }

export async function provisionCloudAccount(username: string, password: string): Promise<void> {
  const module = await import('../sync/accountLink')
  return module.provisionCloudAccount(username, password)
}

export async function autoBindCloudAccount(username: string, password: string): Promise<boolean> {
  const module = await import('../sync/accountLink')
  return module.autoBindCloudAccount(username, password)
}

/**
 * 读同步状态。**纯本地**——`sync/status.ts` 一个请求都不发，
 * 所以设置页打开时调它是安全的，即便同时开着断网检测。
 */
export async function readSyncStatus(): Promise<SyncStatus> {
  const module = await import('../sync/status')
  return module.readSyncStatus()
}

/** 连接云端账号并探测两边条数。只建立会话，不写本地状态。 */
export async function connectCloudAccount(input: {
  username: string
  password: string
  mode: CloudAccountMode
}): Promise<CloudConnectionProbe> {
  const module = await import('../sync/accountLink')
  return module.connectCloudAccount(input)
}

/** 确认绑定：把探测结果落进 `sync_state`。S3 期间不动数据。 */
export async function bindCloudAccount(probe: CloudConnectionProbe): Promise<void> {
  const module = await import('../sync/accountLink')
  return module.bindCloudAccount(probe)
}

/** 放弃一次还没确认的连接：只断开云端会话，不动本机状态（尤其不清 `sync_outbox`）。 */
export async function abandonCloudSession(): Promise<void> {
  const module = await import('../sync/accountLink')
  return module.abandonCloudSession()
}

/** 断开连接：清 `sync_state` 与 `sync_outbox`，不动本地数据、也不动云端数据。 */
export async function disconnectCloudAccount(): Promise<void> {
  const module = await import('../sync/accountLink')
  return module.disconnectCloudAccount()
}

/**
 * 启动推送调度器，返回停止函数（S4）。
 *
 * 这是门面里唯一一个会加载 `sync/outbox` → `cloud/supabase`（那个 222 kB chunk）的函数。
 * 调用方必须先确认 `cloudSyncConfigured` 为真再调它——否则未配置云端时
 * 应用会在启动阶段把 supabase 下载下来，「未配置时该 chunk 根本不下载」这条就破了。
 * 目前唯一的调用点是 `App.tsx` 的启动 effect，那里挡了这一道。
 */
export async function startPushScheduler(): Promise<() => void> {
  const module = await import('../sync/pushQueue')
  return module.startPushScheduler()
}

/**
 * 用本地数据整体替换云端账号的数据（S5）。**不可撤销。**
 *
 * 与 `startPushScheduler` 一样走动态 `import()`：它拖着 `sync/replaceCloud`
 * → `local/backupService` → `cloud/rpc` → supabase。静态转发会把 supabase
 * 打进主 chunk，`verify:local` 的「未配置云端时零跨域请求」当场失效。
 *
 * 调用前界面必须先拿到二次确认——这个函数自己**不做任何确认**，
 * 它被调用就意味着用户已经点过了。
 */
export async function uploadLocalToCloud(): Promise<UploadResult> {
  const module = await import('../sync/replaceCloud')
  return module.uploadLocalToCloud()
}

/** 从云端快照整体替换本地当前账号的数据（S5）。**不可撤销。** 同样需要先二次确认。 */
export async function restoreCloudToLocal(): Promise<RestoreResult> {
  const module = await import('../sync/replaceLocal')
  return module.restoreCloudToLocal()
}

/**
 * 读云端账号的条数摘要（S5）。
 *
 * 只给「整体替换」的确认框用：用户点下按钮之后才去问一次，
 * 好让确认框能写出「将用本地 47 条替换云端 3 条」这种具体的话。
 * **不要把它挂进 `readSyncStatus`**——那个函数必须是纯本地的，
 * 否则设置页一打开就联网，「未绑定云端账号时整轮交互零跨域请求」当场失效。
 */
export async function readCloudSummary(): Promise<{ counts: Record<string, number>; total: number }> {
  const module = await import('../cloud/rpc')
  return module.readCloudSummary()
}
