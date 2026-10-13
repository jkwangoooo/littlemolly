<<<<<<< HEAD
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
=======
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
>>>>>>> origin/main
 * Service worker 的构建戳：取构建开始时的时间。
 * 页面注册 SW 时把它拼在地址后面（`/sw.js?build=...`），SW 用它命名缓存。
 * 这样每次构建都是「一次新的安装」，activate 里按前缀清掉上一版缓存——
 * 不需要任何人记得手动改版本号。dev 模式不注册 SW，这个值只影响生产构建。
 */
const BUILD_STAMP = String(Date.now())

<<<<<<< HEAD
function offlineShellManifest(): Plugin {
  return {
    name: 'molly-offline-shell-manifest',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const needsCloud = (fileName: string, visited = new Set<string>()): boolean => {
        if (visited.has(fileName)) return false
        visited.add(fileName)
        const item = bundle[fileName]
        if (!item || item.type !== 'chunk') return false
        return Object.keys(item.modules).some((id) =>
          /\/(?:src\/services\/cloud|node_modules\/@supabase)\//.test(id.replaceAll('\\', '/')),
        ) || item.imports.some((dependency) => needsCloud(dependency, visited))
      }
      // Use this build's graph: build:no-empty can leave obsolete chunks in dist.
      const authenticated = Object.keys(bundle).filter((name) => !name.endsWith('.map')).sort()
      const local = authenticated.filter((name) => !needsCloud(name))
      this.emitFile({
        type: 'asset',
        fileName: `assets/shell-assets-${BUILD_STAMP}.json`,
        source: JSON.stringify({ build: BUILD_STAMP, local, authenticated }),
      })
    },
  }
}

/**
 * S1 起这里**不再有 `@backend` 别名**。
 *
 * 旧模型用 `resolve.alias` 按构建模式把 `@backend/*` 指到 `../local/` 或 `../cloud/`，
 * 让同一份产物里只进一个后端。代价是别名只能出现在 `src/services/api/` 下
 * （相对路径的解析基准是引用方所在目录），换一处引用就会指错，需要一条
 * 专门的静态断言去守。
 *
 * 现在门面直接写 `../local/xxx`，只有一个后端可选，别名和那条断言一起没了。
 * 少一层间接：想知道页面写到哪里，看门面文件本身就够了。
 */
export default defineConfig({
  plugins: [react(), offlineShellManifest()],
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  server: { host: '127.0.0.1', port: 8800, strictPort: true },
  preview: { host: '127.0.0.1', port: 8800, strictPort: true },
})
=======
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  resolve: {
    alias: [{ find: /^@backend\//, replacement: mode === 'cloud' ? '../cloud/' : '../local/' }],
  },
}))
>>>>>>> origin/main
