import type { MealType } from '../../shared/types/dayPlan'

export const MEAL_NAMES: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
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
  body: '勾选下面的任意一项，或打开三餐、补剂、晨间、健身面板填写内容，就算开始准备这一天了。不填也没关系。',
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

// ---------------------------------------------------------------- 编辑面板

export const PANEL_TITLE = {
  meals: '编辑三餐',
  supplements: '编辑补剂',
  morning: '编辑晨间事项',
  exercise: '编辑健身安排',
  task: '编辑事项',
} as const

export const PANEL_ADD_TASK_TITLE = '添加事项'

/** 候选项来自本地库，是异步读的；读出来之前不要先渲染一个「还没有候选」的空态骗人。 */
export const PANEL_LOADING_TEXT = '正在读取候选项…'
export const PANEL_OPTIONS_ERROR = '候选项读取失败：'

/** 选择器在没有候选时的引导：问题出在选项页，不在当前面板。 */
export const PICKER_EMPTY = {
  food: '还没有可用的常用食物，先到「选项」页添加。',
  exercise: '还没有可用的健身项目，先到「选项」页添加。',
} as const

/**
 * 旧记录与已停用选项的说明。
 * 这些内容按当时的名称快照展示，取消勾选（或点移除）就是真的把它从这一天去掉。
 */
export const PICKER_LEGACY_NOTE = '以下内容来自旧记录或已经停用的选项，名称按当时保存：'
export const PICKER_REMOVE_LABEL = '移除'

export const MEAL_NOTE_LABEL = '备注'

/** 补剂面板文案。模板来源的行不给删除，只能「今天不吃」，否则下次打开会被模板补回来。 */
export const SUPPLEMENT_PANEL = {
  hint: '这里的清单属于这一天。之后在「选项」页改动模板，不会回头改已经生成过的日期。',
  planned: '今天吃',
  periodLabel: '时段',
  remove: '移除',
  templateNote: '模板来源的项不能删除；今天不吃请取消勾选。',
  customNote: '自己加的项可以改名称或移除。',
  add: '＋ 添加补剂',
  empty: '这一天还没有补剂，点下面的按钮加一条。',
  namePlaceholder: '补剂名称',
  readonly: '历史日期的补剂仅供查看。',
} as const

export const EXERCISE_PANEL = {
  decisionLabel: '安排',
  decisionOptions: { undecided: '未决定', exercise: '健身', rest: '不健身' },
  noteLabel: '备注',
  itemsLabel: '健身项目',
} as const

// ---------------------------------------------------------------- 执行区

export const EXECUTE_TITLE = '今日计划'
export const EXECUTE_SUPPLEMENT_TITLE = '早中晚补剂'
export const EXECUTE_EMPTY = '这一天还没有安排内容，先去「准备明天」填一填。'
export const EXECUTE_MORNING_LABEL = '晨间专注 5:00-6:30'
export const EXECUTE_MEAL_EMPTY = '未安排'
export const EXECUTE_EXERCISE_LABEL = { exercise: '健身', rest: '不健身' } as const
export const EXECUTE_EXERCISE_DECIDED = '已决定'
