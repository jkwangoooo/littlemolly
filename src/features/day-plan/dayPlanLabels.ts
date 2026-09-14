import type { MealType } from '../../shared/types/dayPlan'
import type { SaveStatus } from '../../shared/types/save'

/** 三餐固定顺序，界面与保存都以它为准。 */
export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner']

export const MEAL_NAMES: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
}

export const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '尚未修改',
  saving: '正在保存',
  saved: '已保存',
  error: '保存失败',
}

/** 五项准备全部完成时的反馈文案。 */
export const PREPARE_COMPLETE_TEXT = '美好的一天结束啦，迎接下一天！'

export const HISTORY_READONLY_TEXT = '历史计划仅供查看'

/** 读取当天计划时的占位文案。 */
export const LOADING_TEXT = '正在读取这一天的计划…'

/**
 * 未来空日期的引导文案（docs/02：引导用户「准备这一天」，但不强制填写）。
 * 只做说明，不代替用户创建计划——用户勾选任意一项或编辑任一面板时才真正落库。
 */
export const EMPTY_DAY_TEXT = {
  title: '这一天还没有计划',
  body: '勾选下面的任意一项，或打开三餐、晨间、健身面板填写内容，就算开始准备这一天了。不填也没关系。',
} as const

/** 自定义事项的空状态文案，可写与只读分开，避免在只读日期提示用户去添加。 */
export const EMPTY_TASKS_TEXT = {
  writable: '这一天还没有自定义事项。',
  readonly: '这一天没有留下自定义事项。',
} as const

/** 模式切换二次确认文案，与 docs/00 产品范围一致。 */
export const MODE_SWITCH_MESSAGE = {
  toRest: '恭喜幸福小Molly，今天不上班',
  toWork: '幸福小Molly，今天要上班哦',
} as const

export const MODE_LABEL = { work: '工作日', rest: '休息日' } as const
