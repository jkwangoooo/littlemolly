<<<<<<< HEAD
// 服务门面：页面只认这一层，不关心底下是谁。
//
// S1 起门面**直接指向本地实现**，不再经 `@backend` 别名按构建模式切换。
// 原因见 `services/capabilities.ts`：本地 IndexedDB 是唯一的写入落点，
// 云端退化为可选的上行通道（`services/sync/`），不再参与页面读写路径。
//
// 备份是这条规则最直接的受益者：导出 / 导入操作的对象是浏览器 IndexedDB，
// 而 IndexedDB 从 S1 起永远是业务的落点，所以本地备份**恒为可用**。
// 旧模型下云端构建要把它显示成「不可用」，那是「后端二选一」的副产物。
//
// 两行分别放行**值导出**与**类型导出**：值导出给运行时用，
// 类型导出让 `MealInput` 这类类型仍然可以从服务路径导入。

export * from '../local/backupService'
export type * from '../local/backupService'
=======
// 服务门面：页面只认这一层，不关心底下是本地库还是 Supabase。
//
// `@backend` 由构建模式决定指向（见 vite.config.ts 的 resolve.alias）：
// 默认 -> src/services/local，--mode cloud -> src/services/cloud。
// 之所以用相对替换（'../local/' 而不是绝对路径），是为了不引入 node:path 这类
// 构建期依赖；代价是 `@backend/` 只允许出现在本目录下（相对解析的基准是引用方所在目录）。
//
// 这两行把该后端的**值导出**与**类型导出**各放行一次：
// 值导出给运行时用，类型导出让 `MealInput` 这类类型仍然可以从服务路径导入。

export * from '@backend/backupService'
export type * from '@backend/backupService'
>>>>>>> origin/main
