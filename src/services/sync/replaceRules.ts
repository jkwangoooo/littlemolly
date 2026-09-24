import type { BackupRecord } from '../local/backupFormat'
import type { LocalStore } from '../local/localDb'

/**
 * 两个整体替换的前置判断（S5）——**纯函数，不碰网络也不碰 IndexedDB**。
 *
 * 拆成单独文件是为了让 `scripts/check-sync.mjs` 能在纯 Node 下直接回归：
 * `replaceCloud.ts` / `replaceLocal.ts` 都拖着 `cloud/supabase`，
 * 在 Node 里 import 会 `MODULE_NOT_FOUND`（同 `bindingRules.ts` 的理由）。
 *
 * 这里只放「值得单独测」的两类判断：
 * 1. **本地 id 是不是标准 UUID**——不是的话上传必然失败，而且失败点在数据库深处；
 * 2. **空的一侧要不要拦住**——用空内容替换另一边，风险与收益完全不对称。
 */

/** 标准 UUID（任意版本）。`crypto.randomUUID()` 产出的是 v4，形状一致。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 映射到云端 `uuid` 列的全部字段。
 *
 * 这份清单不是「猜的」：逐条对着 `database/migrations/` 里的列定义。
 * `id` 是每张表的主键；`user_id` 是四张根表的归属列；
 * 其余四个是子表里的外键（`daily_meal_items.food_option_id` 这类允许为空，
 * 为空时不参与判断）。
 */
export const UUID_FIELDS = [
  'id',
  'user_id',
  'day_plan_id',
  'daily_meal_id',
  'food_option_id',
  'exercise_option_id',
] as const

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

/**
 * 找出所有**不是标准 UUID** 的 id 值，返回「仓库.字段」形式的清单（去重、稳定排序）。
 *
 * ## 为什么需要这一道
 *
 * 云端的每张表主键都是 `uuid`，而本地 id 由 `localDb.ts` 的 `createId()` 生成：
 *
 * ```ts
 * return typeof crypto.randomUUID === 'function'
 *   ? crypto.randomUUID()
 *   : `${Date.now()}-${Math.random().toString(16).slice(2)}`
 * ```
 *
 * 那条回退分支（非安全上下文 / 很老的浏览器）产出的**不是 UUID**。
 * `docs/13 §5.2` 当初的假设是「本地 id 本来就是 uuid v4，可直接复用」，
 * 这个假设在 https 或 localhost 下成立，但回退分支会让它不成立。
 *
 * 不加这一道的话，失败会发生在 `import_local_backup` 的
 * `jsonb_populate_recordset` 里，报 `invalid input syntax for type uuid: "1758…"`——
 * 一句用户完全无法据此行动的错误。这里提前拦下，并说清是哪些字段。
 *
 * 返回空数组表示可以上传。
 */
export function nonUuidValues(
  records: Partial<Record<LocalStore, BackupRecord[]>>,
): string[] {
  const bad = new Set<string>()
  for (const [store, rows] of Object.entries(records)) {
    for (const row of rows ?? []) {
      for (const field of UUID_FIELDS) {
        const value = row[field]
        // 只有非空字符串才需要是 UUID：外键为空（例如「没有来源选项」）是合法的。
        if (typeof value === 'string' && value && !isUuid(value)) bad.add(`${store}.${field}`)
      }
    }
  }
  return [...bad].sort()
}

/**
 * 「本地上传云端」的前置检查。返回 `null` 表示可以执行，否则是要展示给用户的拒绝理由。
 *
 * 空本地账号必须拦住：这个操作的语义是**替换**，
 * 用 0 条替换掉云端已有的 N 条等于一次「上传」把数据全删了。
 * 本地导入（`importBackup`）对空备份就是这么处理的（「这份备份没有可导入的内容」），
 * 两个方向保持同一条纪律。
 *
 * 本地是空的、云端有数据时，正确的动作是另一个按钮「从云端恢复到本地」——
 * 所以拒绝文案要把它指出来，而不是只说「不行」。
 */
export function replaceCloudProblem(input: { localTotal: number; badIds: string[] }): string | null {
  if (input.badIds.length) {
    return `有 ${input.badIds.length} 处记录的 id 不是标准 UUID，无法上传到云端（${input.badIds
      .slice(0, 3)
      .join('、')}${input.badIds.length > 3 ? ' 等' : ''}）。这通常发生在浏览器不支持 crypto.randomUUID 的环境里。`
  }
  if (input.localTotal <= 0) {
    return '本地这个账号还没有任何数据。用 0 条替换云端会把云端数据清空——如果云端有数据，请改用「从云端恢复到本地」。'
  }
  return null
}

/**
 * 「从云端恢复到本地」的前置检查。
 *
 * 云端是空的就没有可恢复的内容。本地那一侧其实也会拦（`parseBackup` 对
 * `total === 0` 报「备份里没有任何数据」），但那个说法对用户是误导的——
 * 他会以为是自己操作错了，而事实是云端本来就是空的。
 */
export function replaceLocalProblem(input: { cloudTotal: number }): string | null {
  if (input.cloudTotal <= 0) {
    return '云端这个账号还没有数据，没有可恢复的内容。'
  }
  return null
}
