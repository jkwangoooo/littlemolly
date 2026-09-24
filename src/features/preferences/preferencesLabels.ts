import type { BackupStore } from '../../services/api/backupFormat'
import type { CloudBindingCase } from '../../services/api/syncService'
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

/** 停用语义说明，放在清单子屏顶部一次讲清，避免每行都重复。 */
export const OPTION_PAGE_HINT =
  '这里维护的是候选项清单。停用只影响以后的新计划，已经保存过的历史计划不会被改写。'

// ---------------------------------------------------------------- 概览与子屏（选项页信息架构）

/** 概览页顶部一句话，说明这一页是干什么的（刻意压到一行：概览要留出字体差异的余量）。 */
export const OPTIONS_OVERVIEW_HINT = '管理候选项清单与这台设备的数据。'

/** 概览页的分组标题。清单类与系统类用途不同，用标题分开而不是平铺（docs/17 §2.2）。 */
export const OPTIONS_GROUP_LISTS = '候选项清单'
export const OPTIONS_GROUP_SYSTEM = '数据与设备'
export const OPTIONS_GROUP_ACCOUNT = '账号与同步'

/** 返回上一级（概览）的无障碍文案。 */
export const OPTIONS_BACK_LABEL = '返回选项'

/** 清单里「已停用」的标记文案，与行内状态共用。 */
export const OPTION_INACTIVE_BADGE = '已停用'

// 行内溢出菜单。行内只留拖拽手柄与这一个入口，动作按「可逆 → 破坏性」排序（docs/17 §4.2）。
export const OPTION_MENU_LABEL = '更多操作'
export const OPTION_MENU_RENAME = '改名'
export const OPTION_MENU_MOVE_UP = '上移'
export const OPTION_MENU_MOVE_DOWN = '下移'
export const OPTION_MENU_ACTIVATE = '启用'
export const OPTION_MENU_DEACTIVATE = '停用'
export const OPTION_MENU_DELETE = '删除'

/**
 * 拖拽手柄的无障碍文案。拖拽是「补充性」交互，菜单里的上移 / 下移才是必须保留的替代路径
 * （Cloudscape：拖拽必须提供不用拖拽也能完成同一动作的方式）。
 */
export const OPTION_DRAG_HANDLE_LABEL = '拖动排序'

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
 * 后端说明文案。**不显示任何同步时间或同步状态**：
 * 说得出「上次同步时间」就等于暗示同步已经成功（docs/05 规则 6）。
 *
 * S1 起不再是「按后端二选一」的文案：数据落点恒为当前浏览器，
 * 云端同步是后续阶段才加的可选上行通道，加进来之前这里不该预告它。
 */
export const ACCOUNT_TEXT = {
  mode: '统一账号',
  body: '同一个账号同时对应本地数据与云端数据。本地写入优先保证响应速度，云端在后台上传；断网时仍可继续使用。',
}

// ---------------------------------------------------------------- 云端同步（S3 起，S4 补上传状态）

/**
 * 云端同步的文案。
 *
 * 四条口径（`docs/19 §6`）：
 *
 * 1. **未配置云端时直说不可用**，不给一个点了必然报错的按钮。
 * 2. **「待上传 N 条」与「最后上传时间」分开说**：只要还有待上传的，就不出现「已同步」
 *    这种说法——那是把一件没发生的事说成发生了。
 * 3. **上传失败要说出来**，且带原因。失败了却只显示「待上传 3 条」，
 *    用户会以为它在慢慢传，实际是卡住了。
 * 4. **S3 期间那句「只记录变更、还没开始上传」在 S4 必须删掉**。S4 起真的在上传，
 *    留着它就从诚实变成了撒谎——而且方向相反：用户会以为自己手动做了什么才能上传。
 */
export const SYNC_TITLE = '云端同步'

export const SYNC_UNAVAILABLE_TEXT = {
  reason: '这个版本没有配置云端服务，云端同步不可用。',
  body: '数据仍然保存在当前浏览器中，本地备份不受影响。',
}

export const SYNC_CONNECT_TEXT = {
  unbound: '统一账号尚未连接云端',
  body: '使用当前登录账号连接云端。连接后仍由本地数据库优先响应，变更会在后台等待上传。',
  usernameLabel: '当前账号',
  passwordLabel: '账号密码',
  signInAction: '连接云端',
  signUpAction: '补建云端身份',
  confirmAction: '确认连接',
  probing: '正在连接…',
  /** 确认框里的关键一句：让用户知道点下去不会丢数据。 */
  confirmNote: '连接只建立账号与数据的关系，不会改动任何一边的数据。',
}

export const SYNC_BOUND_TEXT = {
  pendingPrefix: '待上传',
  localPrefix: '本地共',
  lastPushPrefix: '最后上传',
  lastRestorePrefix: '最后恢复',
  /** 与「最后上传」并列但**不同时成立**：有失败原因时，上传时间停在更早的那次成功上。 */
  lastErrorPrefix: '上传失败',
  neverPushed: '还没有上传过',
  unit: '条',
  disconnectAction: '断开连接',
  /**
   * 待上传 > 0 时的说明。
   *
   * 说「会继续自动上传」而不是「正在上传中」：触发点是写入、`online`、回前台与启动，
   * 中间可能隔着一次 60 秒的退避，也可能一直断网。承诺「正在上传」会变成假事实。
   * 「关掉页面也不会丢」是能兑现的——队列在 IndexedDB 里，下次打开会接着推。
   */
  pendingNote: '这些变更会继续自动上传，关掉页面也不会丢，下次打开会接着传。',
  /**
   * 待上传 = 0 时的说明。
   *
   * **不能说「已同步」**：本机没有待上传的条目，只说明本机的变更都发出去了，
   * 不代表云端内容与本地一致（云端可能被别的设备改过，也可能有本地从未见过的新行）。
   * 「已同步」是一个更强的断言，而这里拿不出证据。
   */
  drainedNote: '本机没有待上传的变更。这不代表云端内容与本地完全一致。',
}

/**
 * 三种绑定情形的说明（`docs/18 §5.3`）。
 *
 * 只描述**现状**，不承诺动作：S3 还没有上传与恢复功能，
 * 这里若写成「将把本地数据上传到云端」，用户点完会发现什么也没发生。
 * 真正要执行替换的确认文案属于 S5。
 */
export const SYNC_BINDING_CASE_TEXT: Record<CloudBindingCase, string> = {
  'cloud-empty': '这个云端账号还没有数据。',
  'both-sides': '云端账号已有数据，本地也有数据。',
  'local-empty': '本地这个账号还没有数据，云端已有数据。',
}

export const SYNC_ERROR_TEXT = {
  statusFailed: '读取同步状态失败。',
  connectFailed: '连接云端账号失败。',
  disconnectFailed: '断开连接失败。',
  noAccount: '请先登录本地账号。',
}

/**
 * 断开连接的确认文案。
 *
 * 必须把「丢的是队列、不是数据」说清楚：这一步既不动本地数据也不动云端数据，
 * 唯一消失的是「尚未上传的记录」——不说清楚，用户会以为断开等于删数据。
 */
export const SYNC_DISCONNECT_CONFIRM = {
  title: '断开云端账号？',
  body: '本地数据与云端数据都不会被删除。但本机待上传的记录会被清空，断开期间的改动不会再上传。',
  confirmLabel: '断开连接',
}

// ---------------------------------------------------------------- 整体替换（S5）

/**
 * 两个整体替换操作的文案。
 *
 * ## 措辞上的三条纪律
 *
 * 1. **说「替换」，不说「同步」。** 这两个操作都是把一个方向的内容整体盖到另一边，
 *    另一端原有的数据会被删掉。写成「同步」会让用户以为两边合并。
 * 2. **「不可撤销」必须出现**，并且要说清哪一边会丢。
 *    只说「不可撤销」而不说丢什么，等于没说。
 * 3. **两边条数都写出来。** 用户唯一能据此判断覆盖方向的信息就是这个数字对比。
 *
 * 完成后那一句只说**已经发生的事**（哪一边被换成了什么、多少条），
 * 不说「已同步」「数据安全」这类拿不出证据的断言。
 */
export const SYNC_REPLACE_TEXT = {
  sectionTitle: '整体替换',
  body: '这两个操作会把一边的内容整体盖到另一边，用来换设备、搬家或灾难恢复。它们不会自动发生，只在下面点按钮时执行。',

  uploadAction: '上传本地数据到云端',
  restoreAction: '从云端恢复到本地',
  /** 点下按钮之后、确认框弹出来之前：去云端问一次条数。 */
  preparing: '正在读取云端条数…',
  uploadRunning: '正在替换云端数据…',
  restoreRunning: '正在替换本地数据…',

  uploadConfirm: {
    title: '用本地数据替换云端？',
    body: '云端账号里现有的全部数据会被删除，换成这份本地内容。云端原有的内容无法找回。本地数据不受影响。',
    confirmLabel: '替换云端数据',
  },
  restoreConfirm: {
    title: '用云端数据替换本地？',
    body: '本地这个账号现有的全部数据会被删除，换成云端的那份内容。本地原有的内容无法找回，除非你手上有导出的备份文件。云端数据不受影响。',
    confirmLabel: '替换本地数据',
  },

  /** 确认框里的一行数字对比，两处共用同一句。 */
  countComparePrefix: '将用',
  countCompareMiddle: '替换',
  countCompareSuffix: '。',

  uploadDone: '云端已替换为本地内容',
  restoreDone: '本地已替换为云端内容',
  /**
   * 两边条数对不上时的追加提示。
   *
   * 正常情况下不会出现。出现了就说明有一批记录没落到对面——
   * 与其用一句「已完成」盖过去，不如把这个事实摆出来。
   */
  mismatchNote: '注意：源内容与写入条数不一致，可能有记录没有传过去，建议核对一遍。',

  uploadFailed: '上传到云端失败。',
  restoreFailed: '从云端恢复失败。',
  summaryFailed: '读取云端条数失败。',
}

// ---------------------------------------------------------------- 本地备份（L5）

export const BACKUP_TITLE = '本地数据备份'

export const BACKUP_HINT =
  '备份只包含当前账号的数据，保存成一个 JSON 文件。清理浏览器数据、换电脑或换浏览器之前，先导出一份。'

/**
 * 仓库中文名，用于把「共 N 条（日计划 3 · 常用食物 6）」翻译成人能读的摘要。
 *
 * 最后两项是设备状态表（S2）：它们**永远不会出现在备份摘要里**（备份不含设备仓库），
 * 但仓库名表要覆盖全部 13 张表，所以照样给它们一个说法，
 * 免得将来别处展示仓库名时出现英文表名。
 */
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
  sync_outbox: '待上传队列',
  sync_state: '同步状态',
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

// ---------------------------------------------------------------- 存储与安装（PWA）

export const STORAGE_TITLE = '存储与安装'

/**
 * 这一段是本页最容易写成营销腔的地方，所以先把事实写清楚：
 * `persist()` 只是「请求」，浏览器可以拒绝；拿到了也只是降低被清掉的概率。
 * 因此文案一律用「未获得 / 不支持」，不写「已保护」「已同步」这类不成立的结论。
 */
export const STORAGE_HINT =
  '这里显示的是这台设备上的浏览器存储状态，用来判断本地数据有没有被系统清理的风险。'

export const STORAGE_USAGE_LABEL = '本地存储用量'
export const STORAGE_PERSIST_LABEL = '持久化存储'
export const STORAGE_MODE_LABEL = '运行方式'

export const STORAGE_USAGE_UNKNOWN = '读不到'

/** 持久化的三种真实结果：拿到了 / 浏览器没批准 / 这个浏览器没有这个能力。 */
export const STORAGE_PERSIST_TEXT = {
  granted: '已获得',
  denied: '未获得（浏览器暂未批准）',
  unsupported: '这个浏览器不支持申请',
} as const

export const STORAGE_MODE_TEXT = {
  standalone: '独立窗口（已安装到主屏幕）',
  browser: '浏览器标签页',
} as const

export const STORAGE_REFRESH_ACTION = '刷新存储状态'
export const STORAGE_INSTALL_ACTION = '安装到主屏幕'
export const STORAGE_INSTALLED_NOTE = '已经安装，正以独立窗口运行。'

/** iOS 不支持程序化安装，只能给路径；这里写的是操作步骤，不是广告词。 */
export const STORAGE_IOS_HINT =
  'iPhone / iPad 上系统不允许网页自己安装：点浏览器底部的分享按钮，再选「添加到主屏幕」。'

/** 既不是 iOS、浏览器也没给安装入口时（例如桌面 Firefox），如实说明去哪儿找。 */
export const STORAGE_NO_PROMPT_HINT =
  '当前浏览器没有提供安装按钮。可以在浏览器菜单里找「安装应用」或「添加到主屏幕」。'

export const STORAGE_INSTALL_ACCEPTED_NOTE = '已开始安装，完成后从主屏幕打开即可。'
export const STORAGE_INSTALL_DISMISSED_NOTE = '这次没有安装。想装的时候再点一次即可。'

/**
 * 「为什么值得装」。事实只有一个版本：数据真的在这台设备的浏览器里。
 *
 * 旧的「云端模式」分支随 S1 一起去掉了——数据落点恒为本地，
 * 「本地只剩登录会话、装不装都不影响数据」这句话不再成立，留着就是错的。
 */
export const STORAGE_WHY =
  '这个应用的数据保存在这台设备的浏览器里。没有安装到主屏幕时，iOS 会在连续 7 天没有打开之后清掉本地数据；添加到主屏幕的 Web App 使用独立存储分区，不计入那个计时。安装也只是降低风险：手动清理浏览器数据、卸载浏览器一样会丢，重要数据请用上面的备份导出留一份。'
