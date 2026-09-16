import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * `@backend/*` 指向的数据后端由**构建模式**决定：
 * 默认（development / production）指向 `src/services/local`，
 * `--mode cloud` 指向 `src/services/cloud`。
 *
 * 替换值写成相对路径是刻意的：绝对路径要靠 `node:path` 才能算出来，
 * 而本项目的 vite.config.ts 跑在没有 `@types/node` 的类型环境里。
 * 相对路径的解析基准是**引用方所在目录**，因此 `@backend/` 只允许出现在
 * `src/services/api/` 下的门面文件中（见该目录里的注释）。
 *
 * 顺带的好处：两个后端永远只有一个进产物。本地构建里搜不到 `supabase`，
 * 云端构建里也不会把 IndexedDB 那一整套打进去。
 */
/**
 * Service worker 的构建戳：取构建开始时的时间。
 * 页面注册 SW 时把它拼在地址后面（`/sw.js?build=...`），SW 用它命名缓存。
 * 这样每次构建都是「一次新的安装」，activate 里按前缀清掉上一版缓存——
 * 不需要任何人记得手动改版本号。dev 模式不注册 SW，这个值只影响生产构建。
 */
const BUILD_STAMP = String(Date.now())

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  resolve: {
    alias: [{ find: /^@backend\//, replacement: mode === 'cloud' ? '../cloud/' : '../local/' }],
  },
}))
