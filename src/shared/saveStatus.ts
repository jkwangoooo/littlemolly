import { isCloudBackend } from '../services/backend'
import type { SaveStatus } from './types/save'

/**
 * 保存状态文案。日计划页与选项页共用同一套措辞。
 *
 * 前缀必须与**当前后端**一致：本地后端写「本地保存状态」，云端后端写「云端保存状态」。
 * 说错方向的文案与说错事实一样糟——「本地保存」出现在云端后端上，
 * 就是「把本地保存伪装成云端同步成功」的镜像错误（docs/05 规则 6）。
 *
 * 依赖方向说明：这里从 `services/backend` 取一个**构建期常量**，
 * `backend.ts` 自身不 import 任何模块，因此不引入任何数据层依赖。
 */
export const SAVE_STATUS_PREFIX = isCloudBackend ? '云端保存状态：' : '本地保存状态：'

export const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '尚未修改',
  saving: '正在保存',
  saved: '已保存',
  error: '保存失败',
}
