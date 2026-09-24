/**
 * 视口守卫：把页面锁成「应用」而不是「网页」。
 *
 * 三件事，缺一件就会在真机上露出网页相：
 *
 * 1. **双指缩放**。`index.html` 的 viewport 写了 `user-scalable=no, maximum-scale=1`，
 *    Android 上就够了；但 **iOS Safari 从 iOS 10 起会忽略 `user-scalable=no`**，
 *    只能拦它自己的非标准 `gesturestart / gesturechange / gestureend` 事件。
 * 2. **双指触摸兜底**。个别内核不发上面那组事件，两指以上一律不处理，避免漏网。
 * 3. **双击缩放**由 CSS 的 `touch-action: manipulation` 负责（见 styles.css）。
 *
 * 代价要说清楚：禁用缩放会牺牲「放大看小字」这条无障碍能力。这是刻意的取舍——
 * 本应用的目标形态是装到主屏幕的应用外壳，不是可自由缩放的文档页。
 *
 * 缩放被挡住之后，页面也不会再因为「放大后可以四处平移」而显得像网页；
 * 剩下的平移风险来自内容溢出，由固定外壳布局解决（见 styles.css 的 app-shell 段）。
 */

/** iOS 的捏合手势事件：DOM 类型库里没有，用最小形状声明。 */
const IOS_GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend']

export function installViewportGuards(): void {
  if (typeof document === 'undefined') return

  for (const type of IOS_GESTURE_EVENTS) {
    document.addEventListener(
      type,
      (event) => {
        event.preventDefault()
      },
      // 必须显式 passive: false，否则浏览器会把 preventDefault 忽略掉。
      { passive: false },
    )
  }

  document.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length > 1) event.preventDefault()
    },
    { passive: false },
  )
}
