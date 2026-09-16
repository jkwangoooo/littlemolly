/// <reference types="vite/client" />

/**
 * 构建戳（构建开始时间），由 vite.config.ts 的 define 注入。
 * 用途：注册 service worker 时拼在地址后面，让每次构建都成为一次新安装，
 * 从而触发 activate 清理上一版的应用壳缓存。见 src/shared/pwa/serviceWorker.ts。
 */
declare const __BUILD_STAMP__: string
