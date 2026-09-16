/**
 * 当前数据后端（L6）。
 *
 * 值由**构建模式**决定：`vite build --mode cloud` / `vite dev --mode cloud` 走云端，
 * 其余（默认的 `development` / `production`）走本地。同一个 `mode` 同时驱动
 * `vite.config.ts` 里 `@backend` 的指向与这里的常量，因此两者不可能不一致。
 *
 * 为什么不按环境变量在运行时切换：那会让两个后端都进同一份产物——
 * 本地用户的包里白白多出 Supabase 的几十 KB，冻结层隔离也就名存实亡。
 * 构建期决定，才能让「本地构建不含 supabase」继续成为一条可检查的硬性事实。
 *
 * 默认必须是本地：L0–L5 的行为基线完全建立在本地后端上，
 * 任何「默认变成云端」的改动都会让既有验收全部失去意义。
 */

export type DataBackend = 'local' | 'cloud'

export const DATA_BACKEND: DataBackend = import.meta.env.MODE === 'cloud' ? 'cloud' : 'local'

export const isCloudBackend = DATA_BACKEND === 'cloud'

/**
 * 本地数据备份（导出 / 导入）只在本地后端成立：它操作的是浏览器 IndexedDB。
 * 云端模式下该卡片应显示「不可用」，而不是给一个点了会报错的按钮。
 */
export const supportsLocalBackup = !isCloudBackend

/** 后端名称，用于界面文案。 */
export const BACKEND_LABEL = isCloudBackend ? '云端' : '本地'
