// 服务门面：页面只认这一层，不关心底下是本地库还是 Supabase。
//
// `@backend` 由构建模式决定指向（见 vite.config.ts 的 resolve.alias）：
// 默认 -> src/services/local，--mode cloud -> src/services/cloud。
// 之所以用相对替换（'../local/' 而不是绝对路径），是为了不引入 node:path 这类
// 构建期依赖；代价是 `@backend/` 只允许出现在本目录下（相对解析的基准是引用方所在目录）。
//
// 这两行把该后端的**值导出**与**类型导出**各放行一次：
// 值导出给运行时用，类型导出让 `MealInput` 这类类型仍然可以从服务路径导入。

export * from '@backend/authService'
export type * from '@backend/authService'
