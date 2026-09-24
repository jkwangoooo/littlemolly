import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Service worker 的构建戳：取构建开始时的时间。
 * 页面注册 SW 时把它拼在地址后面（`/sw.js?build=...`），SW 用它命名缓存。
 * 这样每次构建都是「一次新的安装」，activate 里按前缀清掉上一版缓存——
 * 不需要任何人记得手动改版本号。dev 模式不注册 SW，这个值只影响生产构建。
 */
const BUILD_STAMP = String(Date.now())

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
  plugins: [react()],
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
})
