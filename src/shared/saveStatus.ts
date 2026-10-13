<<<<<<< HEAD
=======
import { isCloudBackend } from '../services/backend'
>>>>>>> origin/main
import type { SaveStatus } from './types/save'

/**
 * 保存状态文案。日计划页与选项页共用同一套措辞。
 *
<<<<<<< HEAD
 * 前缀从 S1 起**恒为「本地保存状态」**：页面写的每一笔都落在 IndexedDB，
 * 云端是后台的可选上行通道，不参与这笔写入的成败判定。
 *
 * 因此这里不再有「按后端切换前缀」的分支。旧模型下云端构建写「云端保存状态」，
 * 那是「后端二选一」的副产物；两个后端不再互斥之后，跟着后端走只会制造
 * 一个随时可能说错方向的文案。
 *
 * 上传状态另有一套措辞，显示在「选项 → 账号与同步」里，与这里**刻意分开**：
 * 「本地保存成功」与「云端上传成功」是两件事，混成一句就是
 * 「把本地保存伪装成云端同步成功」（docs/05 规则 6）。
 */
export const SAVE_STATUS_PREFIX = '本地保存状态：'
=======
 * 前缀必须与**当前后端**一致：本地后端写「本地保存状态」，云端后端写「云端保存状态」。
 * 说错方向的文案与说错事实一样糟——「本地保存」出现在云端后端上，
 * 就是「把本地保存伪装成云端同步成功」的镜像错误（docs/05 规则 6）。
 *
 * 依赖方向说明：这里从 `services/backend` 取一个**构建期常量**，
 * `backend.ts` 自身不 import 任何模块，因此不引入任何数据层依赖。
 */
export const SAVE_STATUS_PREFIX = isCloudBackend ? '云端保存状态：' : '本地保存状态：'
>>>>>>> origin/main

export const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '尚未修改',
  saving: '正在保存',
  saved: '已保存',
  error: '保存失败',
}
