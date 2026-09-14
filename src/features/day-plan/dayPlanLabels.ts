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

/** 模式切换二次确认文案，与 docs/00 产品范围一致。 */
export const MODE_SWITCH_MESSAGE = {
  toRest: '恭喜幸福小Molly，今天不上班',
  toWork: '幸福小Molly，今天要上班哦',
} as const

export const MODE_LABEL = { work: '工作日', rest: '休息日' } as const
