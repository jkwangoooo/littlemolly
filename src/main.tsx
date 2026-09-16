import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { UpdateNotice } from './shared/components/UpdateNotice'
import { installViewportGuards } from './shared/appShell/viewportGuards'
import { installVisualViewportVars } from './shared/appShell/visualViewport'
import { registerAppServiceWorker } from './shared/pwa/serviceWorker'
import { initInstallPrompt } from './shared/storage/installPrompt'
import { requestStoragePersistence } from './shared/storage/storageStatus'
import './app/styles.css'

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
  </StrictMode>,
)

// 首屏渲染完成后请求一次持久化存储（先 feature-detect，幂等，只发一次）。
void requestStoragePersistence()
