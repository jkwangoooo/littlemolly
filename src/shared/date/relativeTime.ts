/**
 * 相对时间格式化（S4）——纯函数，`check:sync` 直接回归。
 *
 * ## 为什么单独成文件，而不是写在 `SyncCard.tsx` 里
 *
 * 「最后上传：3 分钟前」这句话是**关于同步的事实陈述**，说错了就是在骗人
 * （`docs/19 §6`：任何「上传 / 同步」文案先问一句「这句话是事实吗」）。
 * 而它算起来有一堆边界：未来时间戳（两台机器的钟不同步）、刚好 0 秒、
 * 59 秒与 61 秒、跨天、跨 7 天。
 *
 * 写在组件里就只能靠人工点，写在这里就能被脚本钉住——
 * 与 `local/outboxRules.ts`、`sync/bindingRules.ts` 是同一条理由：
 * **能回归的规则才算规则**。
 *
 * ## 超过 7 天为什么返回 `null` 而不是「8 天前」
 *
 * 「12 天前」不比「2026-09-07 21:30」更有用，反而更难核对。
 * 返回 `null` 表示「这件事不该用相对说法」，由调用方改用绝对时间显示——
 * 边界判断留在本函数里，调用方只负责两分支渲染，不重复实现一遍阈值。
 *
 * ## 未来时间戳为什么归到「刚刚」
 *
 * `last_push_at` 是**本机自己写的**（`sync/outbox.ts` 推送成功后写），
 * 正常不会出现在未来。真出现只有一种可能：系统时间被往前调过、
 * 或者用户手动改过时钟。这种情况下显示「-3 分钟前」是荒谬的，
 * 显示「刚刚」至少不撒谎——它确实刚刚被记录过。
 */

/** 秒 / 分 / 小时 / 天的毫秒数。 */
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 超过这个跨度就不再用相对说法（见文件头）。 */
const RELATIVE_LIMIT = 7 * DAY

/**
 * 把 ISO 时间戳转成相对说法。
 *
 * 返回 `null` 的两种情况：时间戳解析不出来、或者已经超过 7 天。
 * 两种情况都由调用方决定显示什么，本函数不猜。
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string | null {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null

  const elapsed = now.getTime() - then.getTime()
  // 未来时间戳（时钟被调整过）：说「刚刚」而不是负数。
  if (elapsed < MINUTE) return '刚刚'
  if (elapsed >= RELATIVE_LIMIT) return null

  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} 小时前`
  return `${Math.floor(elapsed / DAY)} 天前`
}
