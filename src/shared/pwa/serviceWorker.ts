/**
 * Service worker 注册与「有新版本」状态。
 *
 * ## 只在生产构建注册
 *
 * `import.meta.env.DEV` 时**不注册**，这不是为了省事，而是既有验收的硬前提：
 * `scripts/verify-local.mjs` 跑的是 Vite dev server，其中两个用例依赖「请求真的发到服务器」——
 * 冷升级用例用 CDP 把 `/src/main.tsx` 的响应换成空模块，先在同源页面上造一个 v1 老库；
 * 清空站点数据用例用 `Storage.clearDataForOrigin`。
 * 一旦 dev 下也有 SW，这两招都会被缓存挡住而失效。
 * 所以正确的做法是让 dev 干净，另加一个跑生产产物的 `verify:pwa`，
 * 而不是回头去改那些已经验收过的用例。
 *
 * ## 更新策略保守
 *
 * 不 `skipWaiting`、不 `clients.claim`：新版本装好后停在 waiting，当前页面继续用旧版本。
 * 用户可能正在编辑一份计划，静默换版本等于让他的输入凭空消失。
 * 这里只把「新版本已就绪」记下来，由界面提示，用户点刷新才让新版本接管。
 */

type Listener = () => void

const listeners = new Set<Listener>()
let waitingWorker: ServiceWorker | null = null
let started = false

function notify(): void {
  for (const listener of listeners) listener()
}

/** 供 `useSyncExternalStore` 读取：是否有新版本正在等待接管。 */
export function isUpdateReady(): boolean {
  return waitingWorker !== null
}

/** 订阅「新版本就绪」的变化；返回退订函数。 */
export function subscribeUpdateReady(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function markWaiting(worker: ServiceWorker): void {
  if (waitingWorker === worker) return
  waitingWorker = worker
  notify()
}

function watchForUpdate(registration: ServiceWorkerRegistration): void {
  // 页面刚打开时可能已经有上一轮留下的 waiting worker。
  if (registration.waiting && navigator.serviceWorker.controller) markWaiting(registration.waiting)

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    if (!installing) return
    installing.addEventListener('statechange', () => {
      // 只有「已经有一个 SW 在管着这个页面」才算更新。
      // 首次安装（controller 为空）不该弹出「有新版本」——那时用户本来就在用最新版。
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        markWaiting(registration.waiting ?? installing)
      }
    })
  })
}

async function register(): Promise<void> {
  // 构建戳拼在地址里：每次构建都是一个新的脚本地址，浏览器因此会走一次新的安装，
  // activate 里按前缀清掉上一版缓存。见 vite.config.ts 的 BUILD_STAMP。
  const url = `${import.meta.env.BASE_URL}sw.js?build=${__BUILD_STAMP__}`
  const registration = await navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL })
  watchForUpdate(registration)
}

/** 应用启动时调用一次。不支持、非生产构建、注册失败都不影响应用运行。 */
export function registerAppServiceWorker(): void {
  if (started) return
  started = true
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  const start = () => {
    // 注册失败只意味着「没有离线壳」，本地数据不受影响，因此不打扰用户。
    void register().catch(() => {})
  }
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

/** 用户确认后让新版本接管并刷新。没有 waiting worker 时退化为普通刷新。 */
export function applyServiceWorkerUpdate(): void {
  const worker = waitingWorker
  if (!worker) {
    window.location.reload()
    return
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  worker.postMessage({ type: 'SKIP_WAITING' })
}
