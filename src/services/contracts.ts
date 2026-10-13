/**
<<<<<<< HEAD
 * 页面接口清单（S4-T7 起）。
 *
 * ## 这份文件现在是什么
 *
 * 它列出**页面允许调用的全部服务函数名**，按四个模块分组。仅此而已。
 *
 * ## 它曾经是什么，以及为什么变了
 *
 * 旧定位（L6）：契约是「两种后端二选一」的等价性判据。做法是**函数名只写一遍**，
 * 用 `Pick<typeof import('./local/xxx'), 键名>` 从本地实现取签名，再要求
 * `cloud/parity.ts` 把四个云端适配器赋给同一份类型——云端少一个函数、
 * 或者参数 / 返回值不一样，`npm run typecheck` 直接失败。
 *
 * S1 起页面只走本地，云端适配器不再有页面消费者；S4-T7 把那批 L6 遗留适配器
 * （`cloud/` 下的 `authService` / `dayPlanService` / `optionService` /
 * `backupService` / `optionSeed` / `types` / `syncTestRecordService` / `parity`）
 * 整批删掉，只留下同步传输层要用的四个模块（`errors` / `identity` / `rpc` / `supabase`）。
 * 「云端有没有等价实现」这个问题从此没有意义——**云端不再是后端，而是上行通道**。
 *
 * ## 那还留着这份清单做什么
 *
 * 两件事仍然值得守住，而且各自都有一条机器判据：
 *
 * 1. **编译期**：`Pick<typeof import('./local/xxx'), 键名>` 这一层没变——
 *    清单里的名字只要在本地实现里不存在，`npm run typecheck` 当场失败。
 *    所以清单不会慢慢漂成一个不存在的接口。
 * 2. **静态**：`scripts/check-cloud-parity.mjs` 第 1 组直接导入 `CONTRACT_KEYS`，
 *    断言每个名字在本地实现与四个门面里都真的导出——**清单只有一份**，
 *    既当类型来源又当断言输入，不存在「脚本里另抄一份」的分叉。
 *
 * 一句话：它现在守的是**页面接口的稳定性**，不再是**后端的可替换性**。
 *
 * ## 只列页面真正用得到的那部分
 *
 * 本地模块里还有些内部导出（例如 `hashPassword`、`LocalUser`），它们不是页面接口，
 * 不进清单。门面是 `export * from '../local/xxx'`，技术上会把它们一起透出来——
 * 这是有意的（门面不做裁剪，少一层需要维护的名单），
 * 但「页面该用哪些」这件事以本清单为准。
 */

/** 认证由 Supabase 验证，业务读写继续走本地服务。 */
export const AUTH_KEYS = ['initializeAuth', 'getAuthState', 'subscribeAuth', 'signIn', 'signOut', 'currentUser'] as const
=======
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
>>>>>>> origin/main

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

<<<<<<< HEAD
/**
 * 清单的**编译期**一半：从本地实现取签名。
 *
 * `Pick` 的键来自上面的数组，所以「清单里的名字在本地实现里不存在」
 * 会在 `npm run typecheck` 直接报错。签名不重写一遍，
 * 也就不会出现「契约和实现各写一遍、慢慢分叉」。
 */
export type AuthApi = Pick<typeof import('./api/authService'), (typeof AUTH_KEYS)[number]>
=======
export type AuthApi = Pick<typeof import('./local/authService'), (typeof AUTH_KEYS)[number]>
>>>>>>> origin/main
export type DayPlanApi = Pick<typeof import('./local/dayPlanService'), (typeof DAY_PLAN_KEYS)[number]>
export type OptionApi = Pick<typeof import('./local/optionService'), (typeof OPTION_KEYS)[number]>
export type BackupApi = Pick<typeof import('./local/backupService'), (typeof BACKUP_KEYS)[number]>

<<<<<<< HEAD
/** 清单的**运行时**一半：供回归脚本断言「本地实现与门面一个都没漏」。 */
=======
/** 契约清单，供回归脚本断言「云端一个都没漏」。 */
>>>>>>> origin/main
export const CONTRACT_KEYS = {
  auth: AUTH_KEYS,
  dayPlan: DAY_PLAN_KEYS,
  option: OPTION_KEYS,
  backup: BACKUP_KEYS,
} as const
