/**
 * 推送调度器（S4）——决定「什么时候推」，不决定「怎么推」（那是 `outbox.ts`）。
 *
 * ## 四个触发点
 *
 * | 触发 | 延迟 | 为什么需要 |
 * | --- | --- | --- |
 * | 队列有变更 | 1.5s 防抖 | 主路径。连续几次写入攒成一批，别一条一发 |
 * | `online` 事件 | 立刻 | 断网期间推不了，网络回来要马上补 |
 * | 回到前台 | 立刻 | 移动端后台会冻结定时器，回来时可能已经过了很久 |
 * | 启动 | 立刻 | 上次关页面时队列里可能还有没推完的 |
 *
 * ## 跨标签页互斥
 *
 * 两个标签页同时推同一个队列会重复发送（幂等所以不致命），但会让 `attempts` 与出队
 * 互相打架。用 `navigator.locks` 做互斥：拿不到锁就等，而不是跳过——
 * 跳过会让「另一个标签页推完了」这件事变成「我这个标签页什么也没做」，
 * 而它可能正是那个该处理失败重试的实例。
 *
 * 不支持 Web Locks 的浏览器降级为**单飞标志**（`running`），
 * 那只保证同标签页内不并发，跨标签页不互斥——这是可接受的降级：
 * 幂等推送下最坏结果是一次重复请求。
 *
 * ## 退避
 *
 * 失败后 1s → 2s → 4s → … → 60s 封顶。成功（含「队列已空」）后**立刻清零**——
 * 否则一次偶发失败会让之后所有的推送都慢一拍。
 *
 * 退避计时器只活在内存里：关掉页面就重置。这是有意的，不做持久化——
 * 持久化一个「下次什么时候才能推」的时间戳，会让用户重启应用后
 * 仍然被一个几分钟前的失败挡住，而他明明已经换了网络。
 */

import { describeDataError } from '../../shared/errors'
import { OUTBOX_CHANGE_EVENT } from '../local/outboxRules'
import {
  AUTH_CHANGE_EVENT,
  assertAuthContextCurrent,
  captureAuthContext,
  isAuthContextCurrent,
  isCloudSessionVerified,
} from '../session'
import { pushOnce, withSyncLock } from './outbox'
import { readSyncState, writeSyncState } from './syncState'

/** 写入后等多久再推：把连续的几次写入攒成一批。 */
export const DEBOUNCE_MS = 1500
/** 失败后第一次重试的等待时间。 */
export const BACKOFF_BASE_MS = 1000
/** 退避上限。 */
export const BACKOFF_MAX_MS = 60_000
/** 一轮最多推几个批次，避免「一边写一边推」时无限循环。 */
export const MAX_ROUNDS = 20

let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let backoff = 0
let started = false
let wakePending = false

/** 下一次退避时长：第一次 1s，之后翻倍，60s 封顶。 */
function nextBackoff(current: number): number {
  if (current <= 0) return BACKOFF_BASE_MS
  return Math.min(current * 2, BACKOFF_MAX_MS)
}

/** 排一次推送。重复调用会重置计时器（防抖）。 */
function schedule(delay: number = DEBOUNCE_MS): void {
  if (!started) return
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void run()
  }, delay)
}

/**
 * 推一轮：在锁内循环取批次，直到队列空、失败、或达到轮数上限。
 *
 * 只有当前账号已在线验证且工作区准备完成时才读队列。
 * 离线缓存、退出及重新认证期间保留队列，验证恢复后再上传。
 */
async function run(): Promise<void> {
  if (!started || !isCloudSessionVerified()) return
  if (running) {
    wakePending = true
    return
  }
  const context = captureAuthContext()
  running = true
  try {
    const state = await readSyncState(context)
    assertAuthContextCurrent(context)
    if (!state?.enabled || !isCloudSessionVerified()) return

    // 离线时不推，等 `online` 事件把这一轮叫回来。
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) return

    await withSyncLock(async () => {
      assertAuthContextCurrent(context)
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        if (!started || !isCloudSessionVerified()) return
        assertAuthContextCurrent(context)
        const result = await pushOnce(context)
        assertAuthContextCurrent(context)

        if (result.kind === 'idle') {
          backoff = 0
          return
        }
        if (result.kind === 'failed') {
          backoff = nextBackoff(backoff)
          schedule(backoff)
          return
        }
        // 推完一批还有剩余，继续下一批。
      }
      // 达到轮数上限：剩下的等下一次触发（写入 / online / 回前台）。
      backoff = 0
      schedule(0)
    })
    assertAuthContextCurrent(context)
  } catch (cause) {
    if (started && isAuthContextCurrent(context) && isCloudSessionVerified()) {
      try {
        await writeSyncState(
          { last_error_message: describeDataError(cause), last_error_at: new Date().toISOString() },
          context,
        )
        assertAuthContextCurrent(context)
        backoff = nextBackoff(backoff)
        schedule(backoff)
      } catch {
        // 身份已关闭时保留队列，下一次成功认证会唤醒调度器。
      }
    }
  } finally {
    running = false
    if (wakePending) {
      wakePending = false
      if (started && isCloudSessionVerified()) schedule(0)
    }
  }
}

/**
 * 启动调度器，返回停止函数。
 *
 * 重复调用是安全的（第二次起返回一个空的停止函数）：React 的 StrictMode
 * 会故意把 effect 跑两遍，而注册两套监听会让每次写入排两次推送。
 */
export function startPushScheduler(): () => void {
  if (started) return () => {}
  started = true

  const onOutboxChange = () => schedule()
  const onOnline = () => schedule(0)
  const onVisible = () => {
    if (document.visibilityState === 'visible') schedule(0)
  }
  const onAuthChange = () => {
    if (isCloudSessionVerified()) {
      backoff = 0
      schedule(0)
      return
    }
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    backoff = 0
  }

  window.addEventListener(OUTBOX_CHANGE_EVENT, onOutboxChange)
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange)

  // 启动时立刻排一次：上次关页面时队列里可能还留着没推完的条目。
  schedule(0)

  return () => {
    started = false
    window.removeEventListener(OUTBOX_CHANGE_EVENT, onOutboxChange)
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange)
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}
