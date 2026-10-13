import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
<<<<<<< HEAD
import { MotionLabScreen } from './features/motion-lab/MotionLabScreen'
import { startPushScheduler } from './services/api/syncService'
import { initializeAuth } from './services/api/authService'
import { cloudSyncConfigured } from './services/capabilities'
=======
>>>>>>> origin/main
import { UpdateNotice } from './shared/components/UpdateNotice'
import { installViewportGuards } from './shared/appShell/viewportGuards'
import { installVisualViewportVars } from './shared/appShell/visualViewport'
import { registerAppServiceWorker } from './shared/pwa/serviceWorker'
import { initInstallPrompt } from './shared/storage/installPrompt'
import { requestStoragePersistence } from './shared/storage/storageStatus'
import './app/styles.css'
<<<<<<< HEAD
import './app/responsive-layout.css'
import './app/viewport-layout-fixes.css'
import './app/density-tuning.css'

const isMotionLab =
  window.location.pathname === '/motion-lab' ||
  window.location.pathname === '/motion-lab/'

if (!isMotionLab) {
  // 安装事件（beforeinstallprompt）只在页面加载早期发一次，早于 React 挂载，
  // 因此必须在渲染之前就挂上监听，否则「选项」页永远拿不到安装入口。
  initInstallPrompt()

  // 视口守卫：锁掉双指缩放与双击缩放，让页面像一个应用而不是可缩放的网页。
  installViewportGuards()

  // 把可视视口尺寸同步成 CSS 变量：软键盘弹出时底部抽屉才知道要让开多少空间。
  installVisualViewportVars()

  // service worker 只在生产构建注册；dev 不注册的原因见该模块注释（既有验收用例依赖这一点）。
  registerAppServiceWorker()

  // 推送调度器（S4）：与上面几个「装一次」的东西同一类，所以放在引导处而不是 App 的 effect 里。
  //
  // 它是个**全局单例**（`pushQueue.ts` 里的模块级 `started`），生命周期等于整个文档，
  // 不需要也不应该跟着组件挂载 / 卸载起停。放进 `useEffect` 会撞上 StrictMode 的
  // 「挂载 → 卸载 → 再挂载」：清理函数与动态 `import()` 的完成顺序不保证，
  // 可能出现「第二次挂载刚拿到停止函数，就被第一次挂载的清理函数把监听器摘掉」——
  // 调度器静默失效，而界面一切正常，属于最难查的一类 bug。
  //
  // 队列只有在账号验证及工作区准备完成后才会继续上传。
  //
  // `cloudSyncConfigured` 这道判断**不能省**：`startPushScheduler` 是同步门面里
  // 唯一会加载 `sync/outbox` → `cloud/supabase`（约 222 kB）的入口，未配置云端时调它
  // 等于在启动阶段把 supabase 下载下来，「未配置时该 chunk 根本不下载」这条判据就破了。
  if (cloudSyncConfigured) void startPushScheduler()
  void initializeAuth()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isMotionLab ? <MotionLabScreen /> : <><App /><UpdateNotice /></>}
=======

// 安装事件（beforeinstallprompt）只在页面加载早期发一次，早于 React 挂载，
// 因此必须在渲染之前就挂上监听，否则「选项」页永远拿不到安装入口。
initInstallPrompt()

// 视口守卫：锁掉双指缩放与双击缩放，让页面像一个应用而不是可缩放的网页。
installViewportGuards()

// 把可视视口尺寸同步成 CSS 变量：软键盘弹出时底部抽屉才知道要让开多少空间。
installVisualViewportVars()

// service worker 只在生产构建注册；dev 不注册的原因见该模块注释（既有验收用例依赖这一点）。
registerAppServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateNotice />
>>>>>>> origin/main
  </StrictMode>,
)

// 首屏渲染完成后请求一次持久化存储（先 feature-detect，幂等，只发一次）。
<<<<<<< HEAD
if (!isMotionLab) void requestStoragePersistence()
=======
void requestStoragePersistence()
>>>>>>> origin/main
