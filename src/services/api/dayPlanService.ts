<<<<<<< HEAD
// 服务门面：页面只认这一层，不关心底下是谁。
//
// S1 起门面**直接指向本地实现**，不再经 `@backend` 别名按构建模式切换。
// 原因见 `services/capabilities.ts`：本地 IndexedDB 是唯一的写入落点，
// 云端退化为可选的上行通道（`services/sync/`），不再参与页面读写路径。
// 既然只有一条路径，就没有分支，也不需要分支。
//
// 保留门面这一层、而不是让页面直接 import `services/local/*`：
// 这条边界是「页面不认识数据层」这句话的落点，`check:cloud-parity` 会静态守住它。
//
// 两行分别放行**值导出**与**类型导出**：值导出给运行时用，
// 类型导出让 `MealInput` 这类类型仍然可以从服务路径导入。

export * from '../local/dayPlanService'
export type * from '../local/dayPlanService'
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

export * from '@backend/dayPlanService'
export type * from '@backend/dayPlanService'
>>>>>>> origin/main
