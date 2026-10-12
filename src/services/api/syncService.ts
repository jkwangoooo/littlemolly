/** 页面同步门面。实现动态加载，未配置 Auth 的构建不会请求 SDK。 */
import { assertAuthContextCurrent, captureAuthContext } from '../session'
import type { UploadResult } from '../sync/replaceCloud'
import type { RestoreResult } from '../sync/replaceLocal'
import type { SyncStatus } from '../sync/status'

export type { RestoreResult, SyncStatus, UploadResult }

/**
 * 读同步状态。**纯本地**——`sync/status.ts` 一个请求都不发，
 * 所以设置页打开时调它是安全的，即便同时开着断网检测。
 */
export async function readSyncStatus(): Promise<SyncStatus> {
  const module = await import('../sync/status')
  return module.readSyncStatus()
}

/** main.tsx 在配置齐备时启动全局单例；实际上传受认证及工作区门禁控制。 */
export async function startPushScheduler(): Promise<() => void> {
  const module = await import('../sync/pushQueue')
  return module.startPushScheduler()
}

/**
 * 用本地数据整体替换云端账号的数据（S5）。**不可撤销。**
 *
 * 与 `startPushScheduler` 一样走动态 `import()`：它拖着 `sync/replaceCloud`
 * → `local/backupService` → `cloud/rpc` → supabase。静态转发会把 supabase
 * 打进主 chunk，破坏未配置 Auth 时不下载云端 SDK 的边界。
 *
 * 调用前界面必须先拿到二次确认——这个函数自己**不做任何确认**，
 * 它被调用就意味着用户已经点过了。
 */
export async function uploadLocalToCloud(): Promise<UploadResult> {
  const context = captureAuthContext()
  const module = await import('../sync/replaceCloud')
  assertAuthContextCurrent(context)
  return module.uploadLocalToCloud()
}

/** 从云端快照整体替换本地当前账号的数据（S5）。**不可撤销。** 同样需要先二次确认。 */
export async function restoreCloudToLocal(): Promise<RestoreResult> {
  const context = captureAuthContext()
  const module = await import('../sync/replaceLocal')
  assertAuthContextCurrent(context)
  return module.restoreCloudToLocal()
}

/**
 * 读云端账号的条数摘要（S5）。
 *
 * 只给「整体替换」的确认框用：用户点下按钮之后才去问一次，
 * 好让确认框能写出「将用本地 47 条替换云端 3 条」这种具体的话。
 * **不要把它挂进 `readSyncStatus`**——那个函数必须是纯本地的，
 * 设置页常规刷新只读取本地状态。
 */
export async function readCloudSummary(): Promise<{ counts: Record<string, number>; total: number }> {
  const context = captureAuthContext()
  const module = await import('../sync/replaceCloud')
  assertAuthContextCurrent(context)
  return module.readVerifiedCloudSummary()
}
