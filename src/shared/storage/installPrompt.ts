/**
 * 安装提示（`beforeinstallprompt`）的捕获与状态。
 *
 * 为什么要单独一个模块：`beforeinstallprompt` 在页面加载早期就可能触发，
 * 早于 React 挂载。事件只发一次，错过就再也没有——所以必须在 `main.tsx` 里、
 * 渲染之前就把监听挂上，把事件存下来，等「选项」页的卡片需要时再消费。
 *
 * 边界：这个事件只有 Chromium 系（Android Chrome / 桌面 Chrome）会发。
 * iOS Safari 从不发它——系统不支持程序化安装，只能由文案引导用户
 * 「点分享 → 添加到主屏幕」。所以 `canPromptInstall()` 为 false 是常态，
 * 界面不能因此认为「这个应用不能安装」。
 */

type Listener = () => void

/** Chromium 的非标准事件，DOM 类型库里没有，只能自己声明用到的两个成员。 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const listeners = new Set<Listener>()
let deferredEvent: BeforeInstallPromptEvent | null = null
let initialized = false

function notify(): void {
  for (const listener of listeners) listener()
}

/** 在应用启动最早期调用一次。重复调用无副作用。 */
export function initInstallPrompt(onInstalled?: () => void): void {
  if (initialized) return
  initialized = true
  if (typeof window === 'undefined') return

  window.addEventListener('beforeinstallprompt', (event) => {
    // 拦掉浏览器自带的迷你提示条，改由「选项」页的按钮在用户看得到上下文的地方触发。
    event.preventDefault()
    deferredEvent = event as BeforeInstallPromptEvent
    notify()
  })

  window.addEventListener('appinstalled', () => {
    // 已经装上了，再留着这个事件只会给出一个点了没反应的按钮。
    deferredEvent = null
    notify()
    onInstalled?.()
  })
}

/** 当前浏览器是否给出了可用的安装入口。 */
export function canPromptInstall(): boolean {
  return deferredEvent !== null
}

export function subscribeInstallPrompt(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 触发浏览器自己的安装流程。没有可用事件时如实返回 `unavailable`，不假装成功。 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredEvent
  if (!event) return 'unavailable'

  // 同一个事件只能 prompt 一次，先清掉引用：用户拒绝后不该还能再点第二次。
  deferredEvent = null
  notify()

  try {
    await event.prompt()
    const choice = await event.userChoice
    return choice.outcome
  } catch {
    return 'unavailable'
  }
}
