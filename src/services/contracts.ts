/**
 * 后端契约（L6）。
 *
 * 「为本地服务实现等价的 Supabase 适配器，不改页面业务接口」这句话需要一条能被机器检查的判据，
 * 否则「等价」只是口头承诺。这里的做法是：**函数名只写一遍**，
 * 用 `Pick<typeof import('./local/xxx'), 键名>` 从本地实现里取签名。
 *
 * 于是三件事自动成立：
 * - 契约不重写签名，永远不会出现「契约和实现各写一遍、慢慢分叉」；
 * - 本地实现改名或改签名，这里当场编译不过；
 * - 云端适配器在 `cloud/parity.ts` 被断言满足同一份契约，**云端少一个函数、
 *   或者参数 / 返回值不一样，`npm run typecheck` 直接失败**，不用等到上线才发现。
 *
 * 键名数组同时是运行时的值（`CONTRACT_KEYS`），
 * `scripts/check-cloud-parity.mjs` 直接导入它做静态断言——所以清单也**只有一份**。
 *
 * 只列页面真正用得到的那部分：本地模块里还有些内部导出（例如 `hashPassword`、`LocalUser`），
 * 它们不是页面接口，云端没必要为了凑数也导出同样的东西。
 *
 * `backupService` 是**有意例外**：本地导出 / 导入只操作 IndexedDB，属于本地后端专属能力。
 * 云端实现同样满足这份签名，但会明确拒绝并说明原因（见 `cloud/backupService.ts`），
 * 而不是假装成功。
 */

/** 认证：登录 / 注册 / 退出 / 恢复会话 / 同步取当前用户。 */
export const AUTH_KEYS = ['getSession', 'signIn', 'signUp', 'signOut', 'currentUser'] as const

/** 单日计划：主记录、三餐与内容项、补剂、健身、自定义事项、休息日家务、复制昨天。 */
export const DAY_PLAN_KEYS = [
  'getDayPlan',
  'listDayPlans',
  'upsertDayPlan',
  'restoreDefaultDayPlan',
  'listMeals',
  'listMealItems',
  'saveMeals',
  'setMealCompleted',
  'ensureDaySupplements',
  'listDaySupplements',
  'saveDaySupplements',
  'setSupplementCompleted',
  'listExerciseItems',
  'saveExercise',
  'listCustomTasks',
  'saveCustomTask',
  'deleteCustomTask',
  'listRoutineTasks',
  'ensureRestDayRoutines',
  'setRoutineCompleted',
  'copyYesterday',
] as const

/** 选项管理：三类选项的增删改、排序、启停与示例播种。 */
export const OPTION_KEYS = [
  'listOptions',
  'listSelectableOptions',
  'createOption',
  'renameOption',
  'setOptionActive',
  'moveOption',
  'deleteOption',
  'seedExampleOptionsForCurrentUser',
] as const

/** 本地数据备份：导出 / 校验 / 导入，以及仓库总数口径。 */
export const BACKUP_KEYS = ['exportBackup', 'inspectBackup', 'importBackup', 'BACKUP_TOTAL_STORES'] as const

export type AuthApi = Pick<typeof import('./local/authService'), (typeof AUTH_KEYS)[number]>
export type DayPlanApi = Pick<typeof import('./local/dayPlanService'), (typeof DAY_PLAN_KEYS)[number]>
export type OptionApi = Pick<typeof import('./local/optionService'), (typeof OPTION_KEYS)[number]>
export type BackupApi = Pick<typeof import('./local/backupService'), (typeof BACKUP_KEYS)[number]>

/** 契约清单，供回归脚本断言「云端一个都没漏」。 */
export const CONTRACT_KEYS = {
  auth: AUTH_KEYS,
  dayPlan: DAY_PLAN_KEYS,
  option: OPTION_KEYS,
  backup: BACKUP_KEYS,
} as const
