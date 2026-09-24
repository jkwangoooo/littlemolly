import { useSyncExternalStore } from 'react'
import { applyServiceWorkerUpdate, isUpdateReady, subscribeUpdateReady } from '../pwa/serviceWorker'

/**
 * 读取「新版本是否已就绪」。
 *
 * 用 `useSyncExternalStore` 而不是 useState + useEffect：状态在模块级（SW 事件是异步来的），
 * 订阅必须在 React 之外，否则 StrictMode 的重复挂载会漏掉事件。
 * 第三个参数给的是服务端快照（这里永远是 false）——本项目没有 SSR，但 React 要求传。
 */
export function useServiceWorkerUpdate(): { available: boolean; apply: () => void } {
  const available = useSyncExternalStore(subscribeUpdateReady, isUpdateReady, () => false)
  return { available, apply: applyServiceWorkerUpdate }
}
