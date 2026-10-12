/**
 * 数据后端能力声明（S1）。
 *
 * 取代了原 `backend.ts`。区别是**语义变了**，不只是改个名字：
 *
 * - 旧模型：后端由构建模式二选一（`--mode cloud` 走 Supabase，其余走 IndexedDB），
 *   同一份产物里只有一个后端，「本地构建不含 supabase」因此是可检索的事实。
 * - 现行模型：**本地 IndexedDB 恒为业务唯一写入落点**，Supabase Auth 负责认证，
 *   云端业务数据用于上传和恢复。页面业务读写只经过本地实现。
 *
 * 为什么 `DATA_BACKEND` 要写成常量而不是删掉：调用方问的其实是「我这笔数据写到哪」，
 * 答案从 S1 起永远是「本地」。留一个具名常量比让每个调用点各自硬编码 'local' 更好读，
 * 也让以后真出现第二个落点时有一个明确的收口位置。
 *
 * 认证和同步编排经 `await import()` 懒加载。未配置 Auth 时不下载 SDK，
 * 界面如实显示配置错误并封闭业务；`verify:local` 覆盖此状态下零跨域请求。
 */

/**
 * 业务数据的落点。恒为本地。
 *
 * 已认证并准备好的工作区可以暂时离线编辑。首次登录和重新输入密码仍需 Auth，
 * 本地持久化资料不能代替认证。
 */
export const DATA_BACKEND = 'local' as const

export type DataBackend = typeof DATA_BACKEND

/**
 * Supabase 项目的构建期配置。
 *
 * 这里是**唯一**读这两个环境变量的地方（`cloud/supabase.ts` 从本模块取），
 * 避免两处各写一遍变量名、改一处漏一处。
 *
 * 只读构建期环境变量，不提供「运行时填个输入框就能连上」的路径：
 * Vite 的 `import.meta.env.*` 是构建期内联的字面量，运行时填也读不到。
 * 因此「配置好了没」是一个**构建期事实**，可以直接拿来做界面分支。
 *
 * 取值失败时退化为空字符串而不是抛错：这两个变量在本地开发、本地构建、
 * 以及所有 check 脚本直接 import 源码的场景下都不存在，读不到是正常状态。
 */
const ENV = (import.meta.env ?? {}) as Record<string, string | undefined>

export const SUPABASE_URL = ENV.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * Auth 和云端传输所需的构建期配置是否齐备。
 *
 * 为 `false` 时，界面上的同步入口应显示为不可用并说明原因，
 * 而不是给一个点了必然报错的按钮——与「不把失败伪装成成功」是同一条原则。
 */
export const cloudSyncConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/**
 * 本地数据备份（导出 / 导入）是否可用。
 *
 * 恒为 `true`：备份操作的对象是浏览器 IndexedDB，而 IndexedDB 从 S1 起
 * 永远是业务的落点。旧模型下云端构建要把它显示成「不可用」，
 * 那是「后端二选一」的副产物，不是这个功能本身的属性。
 *
 * 保留成具名常量而不是让界面直接写 `true`：界面问的是「这个能力有没有」，
 * 以后若出现「本地库还没建立」这类前置条件，收口点仍然只有一个。
 */
export const supportsLocalBackup = true

/** 后端名称，用于界面文案。 */
export const BACKEND_LABEL = '本地'
