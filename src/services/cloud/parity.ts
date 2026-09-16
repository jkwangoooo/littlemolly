import type { AuthApi, BackupApi, DayPlanApi, OptionApi } from '../contracts'
import * as cloudAuth from './authService'
import * as cloudBackup from './backupService'
import * as cloudDayPlan from './dayPlanService'
import * as cloudOptions from './optionService'

/**
 * 云端适配器的等价性断言（L6）。
 *
 * 这个文件不参与运行时，只做一件事：把四个云端模块分别赋给
 * `services/contracts.ts` 里那份「从本地实现取签名」的契约。
 * 任何一个函数在云端缺失、参数个数或类型对不上、返回值形状不同，
 * `npm run typecheck` 就会在这里报错——这是「等价」唯一可靠的判据，
 * 靠人逐个比对两个文件迟早会漏。
 *
 * 为什么用 `import *` 而不是 `export * from`：需要整个模块对象去做类型比对，
 * 而不是把它的导出再散出去一份。
 *
 * 断言结果导出为值，是为了让这些模块引用不被 linter 当成死代码删掉。
 */

export const AUTH_PARITY: AuthApi = cloudAuth
export const DAY_PLAN_PARITY: DayPlanApi = cloudDayPlan
export const OPTION_PARITY: OptionApi = cloudOptions
export const BACKUP_PARITY: BackupApi = cloudBackup
