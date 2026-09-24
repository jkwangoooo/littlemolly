/**
 * 同步状态（`sync_state`）与本机身份的读写（S3）。
 *
 * ## 为什么单独成文件，而不是塞进 `accountLink.ts`
 *
 * `docs/19` 把「`sync_state` 读写」记在 `accountLink.ts` 名下，实现时拆了出来，
 * 因为两者的**依赖方向相反**：
 *
 * - `accountLink.ts` 要连云端（`supabase.auth` + 只读探测），属于「需要网络」的那一半；
 * - `status.ts` 只读本机状态给界面显示，**一个请求都不该发**。
 *
 * 若 `sync_state` 的读写留在 `accountLink.ts`，`status.ts` 就不得不 import 它，
 * 于是「打开设置页」这条路径会把 supabase 拖进依赖图——而
 * 「未绑定云端账号时整轮交互零跨域请求」正是 `docs/19` 里那条不能破的判据
 * （`verify:local` 用 CDP 监听网络来验）。拆开之后这条边界是结构性成立的，
 * 不依赖谁记得住。
 *
 * ## 一行一个**本地账号**（v7 起，S4 补丁 ②）
 *
 * 表的主键 `id` 就是本地账号 id。在这之前它是**设备级单行**（`id` 恒为 `'singleton'`），
 * 于是换本地账号（退出后用另一个账号登录）时，新账号会读到上一任的云端绑定，
 * 把**自己的数据推到别人的云端账号里**——静默的数据事故。
 *
 * 绑定关系本来就是「某个本地账号 ↔ 某个云端账号」，不是「设备 ↔ 云端」，
 * 所以归属必须写进主键：`readSyncState` 只可能读到**当前登录账号**那一行，
 * 「读到别人的绑定」在结构上就不成立，不依赖调用方记得先判断归属。
 *
 * 老库里的 `'singleton'` 行由 `localDb.ts` 的 v7 迁移重新归属（见 `rekeySyncStateRows`）。
 * 一个账号的绑定会一直留着：A 退出、B 登录再切回 A 时，A 仍然是已连接状态。
 *
 * ## `device_id` 为什么存在 localStorage 而不是这张表里
 *
 * 方案写的是「首次启动生成」。但「断开连接」按 §5.3 会**清掉这一行**，
 * 若 `device_id` 存在那一行里，用户每断一次、连一次就换一个设备身份，
 * 云端诊断表（S4 的 `device_sync_state`）里就会出现一堆来历不明的「新设备」。
 *
 * 因此 `device_id` 存 localStorage（与 `services/session.ts` 同一套载体），
 * 写 `sync_state` 时带一份副本供上报——清状态不影响它。它是**设备**的属性，
 * 与「这行属于哪个本地账号」无关，所以不受这次改造影响。
 */

import { readSession } from '../session'
import { getOne, newId, put } from '../local/localDb'

/**
 * 当前本地账号 id，也就是同步状态的归属人。
 *
 * 与 `local/authService.ts` 的 `currentUser()` 同一份数据（`services/session.ts` 的会话镜像），
 * 但**不走那个函数**：`authService` 会拖进 `optionSeed` 等一整套本地播种逻辑，
 * 而这里只需要一个 id。没有登录会话时返回 `null`。
 */
export function currentLocalUserId(): string | null {
  return readSession()?.user.id ?? null
}

/** 与 `RECORD_SCHEMAS.sync_state` 一一对应。 */
export type SyncState = {
  /** = 本地账号 id。**一行一个本地账号**，见文件头。 */
  id: string
  enabled: boolean
  cloud_user_id: string | null
  cloud_email: string | null
  device_id: string
  bound_at: string | null
  last_push_at: string | null
  last_restore_at: string | null
  last_error_message: string | null
  last_error_at: string | null
  updated_at: string
}

const DEVICE_ID_KEY = 'happy-little-molly.device'

/**
 * 本机身份。首次调用时生成并持久化，之后每次返回同一个值。
 *
 * localStorage 不可用时（隐私模式、被策略禁用）退化成一次性 id：
 * 它只用于云端诊断，退化不会影响同步本身的正确性，因此这里不抛错打断用户操作。
 */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
    const created = newId()
    localStorage.setItem(DEVICE_ID_KEY, created)
    return created
  } catch {
    return newId()
  }
}

/**
 * 一个本地账号的空白状态。
 * `enabled: false` —— 没绑定时不存在「同步开着但没账号」这种状态。
 */
export function emptySyncState(localUserId: string, now: string = new Date().toISOString()): SyncState {
  return {
    id: localUserId,
    enabled: false,
    cloud_user_id: null,
    cloud_email: null,
    device_id: deviceId(),
    bound_at: null,
    last_push_at: null,
    last_restore_at: null,
    last_error_message: null,
    last_error_at: null,
    updated_at: now,
  }
}

/**
 * 读**当前本地账号**的状态。缺行返回 `null` —— 调用方据此判断「还没绑定」，
 * 而不是拿一个 `enabled: false` 的空对象去猜。
 *
 * 没有登录会话时也返回 `null`：没有账号就没有「这个账号绑没绑云端」可言。
 */
export async function readSyncState(): Promise<SyncState | null> {
  const owner = currentLocalUserId()
  if (!owner) return null
  return getOne<SyncState>('sync_state', owner)
}

/**
 * 局部更新当前本地账号的状态。没有行时以 `emptySyncState()` 为底。
 *
 * 写入一律 `{ track: false }`：`sync_state` 是设备仓库，本来就不进队列
 * （`isSyncableStore` 返回 false），显式写出来是为了让「同步状态自己的变更不回推云端」
 * 这件事在代码里看得见，而不是依赖读者记得设备仓库的定义。
 *
 * 没有登录会话时**返回 `null` 且不写**：无处可写（这一行属于某个账号）。
 * 之所以不抛错，是因为推送路径可能正好在用户退出的瞬间收尾，
 * 为一个已经没有归属可言的写入把整轮推送打成失败，只会让设置页的错误提示更失真。
 */
export async function writeSyncState(patch: Partial<Omit<SyncState, 'id'>>): Promise<SyncState | null> {
  const owner = currentLocalUserId()
  if (!owner) return null
  const base = (await readSyncState()) ?? emptySyncState(owner)
  const next: SyncState = {
    ...base,
    ...patch,
    id: owner,
    updated_at: new Date().toISOString(),
  }
  await put('sync_state', next, { track: false })
  return next
}
