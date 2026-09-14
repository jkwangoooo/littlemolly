import type { SaveStatus } from './types/save'

/**
 * 保存状态文案。日计划页与选项页共用同一套措辞，
 * 任何写入都必须显示「本地保存状态」前缀，不得表述成云端同步成功。
 */
export const SAVE_STATUS_PREFIX = '本地保存状态：'

export const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '尚未修改',
  saving: '正在保存',
  saved: '已保存',
  error: '保存失败',
}
