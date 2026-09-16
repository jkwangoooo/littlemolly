import type { BackupStore } from '../../services/api/backupFormat'
import { isCloudBackend } from '../../services/backend'
import type { OptionKind } from '../../shared/types/options'

/** 三个选项分区的标题，与 docs/02 选项页一致。 */
export const OPTION_KIND_TITLE: Record<OptionKind, string> = {
  food: '常用食物',
  supplement: '固定补剂',
  exercise: '健身项目与动作',
}

/** 补剂时段文案由 shared 统一提供（日计划页也要用同一套），这里只做转出。 */
export { SUPPLEMENT_PERIOD_LABEL } from '../../shared/periodLabels'

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

/**
 * 后端说明文案。两种后端下都**不显示任何同步时间或同步状态**：
 * 说得出「上次同步时间」就等于暗示同步已经成功，local 后端没有这个事实（docs/05 规则 6）。
 */
export const ACCOUNT_TEXT = isCloudBackend
  ? {
      mode: '云端模式',
      body: '数据保存在云端账号中，换设备登录同一账号即可看到相同的计划；浏览器本地不再保存业务数据。',
    }
  : {
      mode: '本地模式',
      body: '数据保存在当前浏览器中，账号与计划都未上传，也没有同步时间可显示。',
    }

// ---------------------------------------------------------------- 本地备份（L5）

export const BACKUP_TITLE = '本地数据备份'

export const BACKUP_HINT =
  '备份只包含当前账号的数据，保存成一个 JSON 文件。清理浏览器数据、换电脑或换浏览器之前，先导出一份。'

/** 仓库中文名，用于把「共 N 条（日计划 3 · 常用食物 6）」翻译成人能读的摘要。 */
export const BACKUP_STORE_LABEL: Record<BackupStore, string> = {
  users: '账号',
  day_plans: '日计划',
  daily_meals: '三餐',
  daily_meal_items: '餐次内容',
  custom_tasks: '自定义事项',
  food_options: '常用食物',
  supplement_templates: '固定补剂',
  exercise_options: '健身项目',
  daily_supplements: '补剂执行',
  daily_exercise_items: '健身执行',
  routine_tasks: '家务',
}

export const BACKUP_EMPTY_NOTE = '当前账号还没有任何数据，导出的备份会没有内容可恢复。'

export const BACKUP_EXPORT_ACTION = '生成备份'
export const BACKUP_DOWNLOAD_ACTION = '下载备份文件'
export const BACKUP_COPY_ACTION = '复制备份内容'
export const BACKUP_COPIED_NOTE = '已复制到剪贴板，可以粘贴到别处保存。'
export const BACKUP_COPY_FAILED_NOTE = '浏览器不允许自动复制，请手动全选文本域内容。'

export const BACKUP_FILE_LABEL = '选择备份文件'
export const BACKUP_PASTE_LABEL = '或直接粘贴备份内容'
export const BACKUP_PASTE_PLACEHOLDER = '把备份 JSON 粘贴到这里，再点「检查这份备份」。'
export const BACKUP_INSPECT_ACTION = '检查这份备份'
export const BACKUP_CLEAR_ACTION = '清空输入'

/** 导入前确认：说清「替换」而不是「合并」，这是全流程里唯一会造成数据丢失的一步。 */
export const BACKUP_IMPORT_CONFIRM = {
  title: '导入这份备份？',
  body: '导入会用备份内容替换当前账号的全部数据，当前账号已有的计划与选项都会被清空，且无法撤销。其他本地账号不受影响。',
  confirmLabel: '确认导入并替换',
} as const

export const BACKUP_IMPORT_HINT =
  '导入的是「替换」而不是「合并」：当前账号的数据会被备份内容整体覆盖。备份文件格式不对时不会写入任何内容。'

export const BACKUP_INVALID_CHANNEL = '请选择文件或粘贴备份内容。'

/**
 * 云端模式下的说明。不是「暂时不可用」，而是**这个功能在后端层面不成立**：
 * 它操作的是浏览器 IndexedDB，云端模式下数据在 Supabase。
 * 所以这里直接讲清楚去哪儿找备份，而不是让用户点一个必然报错的按钮。
 */
export const BACKUP_UNAVAILABLE_NOTE =
  '当前是云端模式，业务数据保存在云端账号里，没有可导出的本地库：这里的导出 / 导入只在本地模式下可用。云端数据请使用云端数据库自身的备份能力。'
