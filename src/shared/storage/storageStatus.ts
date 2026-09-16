/**
 * 浏览器存储状态：是否已获得「持久化」、占用了多少空间、是否跑在独立窗口里。
 *
 * ## 为什么值得做
 *
 * iOS Safari 对**没有安装到主屏幕**的站点有一条规则：7 天没有交互就清空可写存储
 * （IndexedDB / localStorage / Cache / Service Worker 注册）。
 * 而这个应用的业务数据全在浏览器 IndexedDB 里——被清掉就是真的没了。
 * 添加到主屏幕的 Web App 使用独立存储分区，不计入那个计时。
 * 所以「申请持久化 + 引导安装」不是体验优化，是数据能不能留住的问题。
 *
 * ## 事实边界（文案不许越过这条线）
 *
 * `persist()` 只是「请求」，浏览器可以拒绝（Firefox 会弹权限框，Chrome 按站点参与度自动决定，
 * iOS Safari 干脆没有这个 API）。返回值 false 是**正常结果**，不是错误，
 * 因此这里如实记录，界面也如实显示，不写成「已保护」。
 * 即使拿到 true，也只是降低被清理的概率——用户手动清数据、卸载浏览器一样会丢。
 * 真正能兜住的只有「选项」页里的导出备份。
 *
 * ## 调用时机
 *
 * 应用启动、首屏渲染完成后请求一次（`main.tsx`）。放在渲染之后而不是模块加载时，
 * 是为了不和应用启动抢同一个 tick：本地后端这时刚开始打开数据库，
 * 而 `persist()` 对「这个源有没有在用存储」本身不敏感，早一点晚一点结果一样。
 * 函数自身幂等（`persistenceRequest` 缓存），界面上的「刷新存储状态」只重读快照，
 * 不会再发一次请求。
 */

export type StorageSnapshot = {
  /** 浏览器是否提供 StorageManager。 */
  supported: boolean
  /** 浏览器是否提供 persist()。iOS Safari 不提供。 */
  persistSupported: boolean
  usageBytes: number | null
  quotaBytes: number | null
  /** null 表示还没问过、或浏览器不支持。 */
  persisted: boolean | null
  /** 是否以独立窗口运行（已安装到主屏幕 / 桌面）。 */
  standalone: boolean
}

type Listener = () => void

const listeners = new Set<Listener>()

function initialSnapshot(): StorageSnapshot {
  return {
    supported: false,
    persistSupported: false,
    usageBytes: null,
    quotaBytes: null,
    persisted: null,
    standalone: false,
  }
}

let snapshot: StorageSnapshot = initialSnapshot()
let persistenceRequest: Promise<void> | null = null

function notify(): void {
  for (const listener of listeners) listener()
}

function sameSnapshot(left: StorageSnapshot, right: StorageSnapshot): boolean {
  return (
    left.supported === right.supported &&
    left.persistSupported === right.persistSupported &&
    left.usageBytes === right.usageBytes &&
    left.quotaBytes === right.quotaBytes &&
    left.persisted === right.persisted &&
    left.standalone === right.standalone
  )
}

function apply(next: StorageSnapshot): void {
  if (sameSnapshot(snapshot, next)) return
  snapshot = next
  notify()
}

function manager(): StorageManager | null {
  if (typeof navigator === 'undefined') return null
  return typeof navigator.storage === 'object' && navigator.storage !== null ? navigator.storage : null
}

/**
 * 是否以独立窗口运行。
 *
 * 两个判据缺一不可：标准做法是 `display-mode: standalone` 媒体查询；
 * 而 iOS Safari 在较老版本上不支持这个取值，只能读它自己的 `navigator.standalone`。
 */
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  const legacy = navigator as Navigator & { standalone?: boolean }
  return legacy.standalone === true
}

/** 读当前快照（`useSyncExternalStore` 用，必须返回稳定引用）。 */
export function getStorageSnapshot(): StorageSnapshot {
  return snapshot
}

/** 订阅快照变化；返回退订函数。 */
export function subscribeStorage(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 重新读一次用量 / 持久化状态 / 是否独立窗口。 */
export async function refreshStorageSnapshot(): Promise<StorageSnapshot> {
  const storage = manager()
  const standalone = detectStandalone()
  if (!storage) {
    apply({ ...snapshot, standalone })
    return snapshot
  }

  let usageBytes: number | null = null
  let quotaBytes: number | null = null
  if (typeof storage.estimate === 'function') {
    try {
      const estimate = await storage.estimate()
      usageBytes = typeof estimate.usage === 'number' ? estimate.usage : null
      quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : null
    } catch {
      // 读不到用量不影响其它信息，保持 null 并在界面上如实留空。
    }
  }

  let persisted: boolean | null = snapshot.persisted
  const persistSupported = typeof storage.persist === 'function'
  if (typeof storage.persisted === 'function') {
    try {
      persisted = await storage.persisted()
    } catch {
      persisted = null
    }
  }

  apply({ supported: true, persistSupported, usageBytes, quotaBytes, persisted, standalone })
  return snapshot
}

async function runPersistenceRequest(): Promise<void> {
  const storage = manager()
  if (!storage || typeof storage.persist !== 'function') {
    // iOS Safari 走这里：没有 persist()，只能靠「添加到主屏幕」。
    await refreshStorageSnapshot()
    return
  }

  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) {
      // 已经拿到过，不必再问。
    } else {
      await storage.persist()
    }
  } catch {
    // 有的浏览器在没有用户交互时直接抛错；拒绝也是正常结果，交给下面的读取如实反映。
  }
  await refreshStorageSnapshot()
}

/** 请求持久化存储。幂等：无论调用多少次，实际只发一次请求。 */
export function requestStoragePersistence(): Promise<void> {
  persistenceRequest ??= runPersistenceRequest()
  return persistenceRequest
}
