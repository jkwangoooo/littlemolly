/**
 * 把「可视视口」的尺寸同步成 CSS 变量，供软键盘场景使用。
 *
 * ## 为什么必须有这个
 *
 * iOS 弹出软键盘时**只缩小可视视口（visualViewport），不改布局视口**：
 * `window.innerHeight` 仍然是 844，而实际能看到的只有上面 508。
 * 底部抽屉如果按 `90vh` 算高度、又贴着布局视口的底边，它下面那截（含输入框与「保存」按钮）
 * 就正好落在键盘底下——而抽屉打开时 body 滚动是锁住的，用户连滚都滚不出来。
 * 真机上表现为「抽屉显示不全、点不到保存」，看起来像功能坏了。
 *
 * 所以这里把两个值写到 `:root` 上，由 CSS 消费：
 * - `--vv-height`：可视视口高度 → 抽屉的 max-height 上限；
 * - `--vv-keyboard-inset`：布局视口比可视视口多出来的部分 → 抽屉整体上移，让开键盘。
 *
 * 没有 `visualViewport` 的浏览器（老内核）直接不装：CSS 里的 `var(..., 100vh)` 兜底，
 * 行为与加这段之前一致。
 */

const HEIGHT_VAR = '--vv-height'
const KEYBOARD_INSET_VAR = '--vv-keyboard-inset'

export function installVisualViewportVars(): void {
  if (typeof window === 'undefined') return
  const initial = window.visualViewport
  if (!initial) return

  const root = document.documentElement

  const sync = () => {
    // 每次重新取，而不是用安装时捕获的那个引用：对象在个别内核上会被更换，
    // 而且这样验收脚本能用替身（fake visualViewport）驱动这段逻辑做断言，见 verify-pwa。
    const viewport = window.visualViewport
    if (!viewport) return
    const height = Math.round(viewport.height)
    // 键盘盖住的高度。减去 offsetTop 是因为键盘弹出时 iOS 可能同时把可视视口往上推，
    // 那部分不算「被盖住」。缩放会人为放大这个差值，但缩放已被 viewportGuards 挡住。
    const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
    root.style.setProperty(HEIGHT_VAR, `${height}px`)
    root.style.setProperty(KEYBOARD_INSET_VAR, `${inset}px`)
  }

  // resize 管键盘弹收，scroll 管可视视口被推移，orientationchange 管横竖屏切换。
  initial.addEventListener('resize', sync)
  initial.addEventListener('scroll', sync)
  window.addEventListener('orientationchange', sync)
  sync()
}
