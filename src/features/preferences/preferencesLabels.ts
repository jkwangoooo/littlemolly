import type { OptionKind, SupplementPeriod } from '../../shared/types/options'

/** 三个选项分区的标题，与 docs/02 选项页一致。 */
export const OPTION_KIND_TITLE: Record<OptionKind, string> = {
  food: '常用食物',
  supplement: '固定补剂',
  exercise: '健身项目与动作',
}

/** 补剂时段标签。 */
export const SUPPLEMENT_PERIOD_LABEL: Record<SupplementPeriod, string> = {
  morning: '早',
  noon: '中',
  evening: '晚',
}

/** 新增按钮文案，按分区微调以便无障碍文案也能区分。 */
export const OPTION_ADD_LABEL: Record<OptionKind, string> = {
  food: '＋ 添加食物',
  supplement: '＋ 添加补剂',
  exercise: '＋ 添加项目',
}

/** 新增面板标题，说明正在往哪个分区添加，避免三个分区共用一句「添加选项」。 */
export const OPTION_CREATE_TITLE: Record<OptionKind, string> = {
  food: '添加食物',
  supplement: '添加补剂',
  exercise: '添加项目',
}

export const OPTION_EMPTY_TEXT: Record<OptionKind, string> = {
  food: '还没有常用食物。先添加几样常吃的，之后安排三餐时可以直接勾选。',
  supplement: '还没有固定补剂。按早 / 中 / 晚添加，之后每天会自动带出对应时段的补剂。',
  exercise: '还没有健身项目。添加常做的项目或动作，之后安排健身时可以直接勾选。',
}

/** 停用语义说明，放在页面顶部一次讲清，避免每行都重复。 */
export const OPTION_PAGE_HINT =
  '这里维护的是候选项清单。停用只影响以后的新计划，已经保存过的历史计划不会被改写。'

export const DISABLE_CONFIRM = {
  title: '停用这个选项？',
  body: '停用后它不会再出现在新计划的选择器中，但会保留在这个列表里，随时可以重新启用。',
  confirmLabel: '确认停用',
} as const

export const DELETE_CONFIRM = {
  title: '删除这个选项？',
  body: '删除后它不再出现在候选清单里，也无法恢复；历史计划里的内容不受影响。',
  confirmLabel: '确认删除',
} as const

export const ACCOUNT_TITLE = '账号与同步'

/** 本地模式说明：不显示任何云端同步时间，避免伪装成同步成功。 */
export const ACCOUNT_TEXT = {
  mode: '本地模式',
  body: '数据保存在当前浏览器中，账号与计划都未上传。云端同步在 L6 迁移阶段才做，当前没有同步时间可显示。',
} as const
