/**
 * 本地记录 ↔ 云端行的映射（S4）。
 *
 * ## 这个模块只做一件事：把本地记录变成能直接发给 PostgREST 的行
 *
 * 三条规则，全部来自两侧表结构的实际差异（不是猜的）：
 *
 * 1. **剔除云端遗留列**。云端的 `day_plans.exercise_content` 与
 *    `daily_meals.plan_content` 是 L6 之前的形状，本地契约里**没有**这两列
 *    （`docs/01` 不变量 2：内容项独立成表）。本地老记录上可能还留着它们
 *    （v3 迁移有意没删，见 `localDb.ts` 的 `backfillSnapshots`），
 *    这里必须**不发**——发了就等于把一份可能已经过期的副本又写回云端。
 *    实现上直接借 `sanitizeRecord`：它按字段契约清洗，契约里没有的字段自动丢弃。
 *
 * 2. **`user_id` 验证**。四张根表的 owner 必须已经是当前 Supabase UID。
 *    旧随机本地身份不能通过上传时改写 owner 混入新账号。
 *    子表不带 `user_id`，由上传器验证父链，云端仍由 RLS 检查。
 *
 * 3. **只发本地形状里存在的字段**。云端某些列本地没有（`created_at` / `updated_at`
 *    在 `day_plans` 上有、在三张子表上没有；`exercise_content` 反过来）。
 *    规则 1 已经顺带保证了这一点：清洗后剩下的就是本地契约认可的字段集。
 *
 * ## 为什么是纯函数
 *
 * 映射错了的后果很隐蔽：**云端收到一条形状不对的行，PostgREST 报错、推送失败、
 * 队列堆积，而本地一切正常**。所以这一层必须能被 `check:sync` 在 Node 里直接回归，
 * 不依赖浏览器、不依赖网络、也不依赖 `accountLink.ts` 那条会拖进 supabase 的路径。
 */

import type { UserDataStore } from '../local/localDb'
import { sanitizeRecord } from '../local/recordSchemas'

/** 清洗后的一行。字段值都是标量（契约只认标量）。 */
export type CloudRow = Record<string, unknown>

/** 一张表的映射函数：拿清洗过的本地行，产出云端行。 */
type RowMapper = (record: CloudRow, cloudUserId: string) => CloudRow

/**
 * 四张**带 `user_id`** 的表（`docs/18 §5.2`）。
 *
 * 其余六张（`daily_meals` / `daily_meal_items` / `daily_supplements` /
 * `daily_exercise_items` / `custom_tasks` / `routine_tasks`）都不带 `user_id`，
 * 云端 RLS 沿父记录推导归属。所以「要不要验证 user_id」这件事是**表级**的，
 * 不是「有就改」——多改一张表会让 PostgREST 报「列不存在」。
 */
export const USER_SCOPED_STORES: readonly UserDataStore[] = [
  'day_plans',
  'food_options',
  'exercise_options',
  'supplement_templates',
]

/** 所有权不一致时拒绝；映射不会替记录制造新归属。 */
function verifyUser(record: CloudRow, owner: string): CloudRow {
  if (record.user_id !== owner) {
    throw new Error('记录不属于当前账号，已停止上传。请先核对旧数据的归属。')
  }
  return { ...record }
}

/** 不带 `user_id` 的表：原样发。 */
function passthrough(record: CloudRow): CloudRow {
  return { ...record }
}

/**
 * 十张用户数据表各自的映射。**类型是 `Record<UserDataStore, RowMapper>`**——
 * 少写一张表 TypeScript 直接报错，所以「新增一张用户数据表却忘了加映射」
 * 这件事在编译期就拦住了。`check:cloud-parity` 另外做一次运行时断言。
 *
 * 导出是为了让那条断言能拿到清单：它要证明「每张用户数据表都有云端表 **且** 有映射」，
 * 后者只能从这里读。类型已经保证穷尽，导出只是把它变成可被机器看见的事实。
 */
export const ROW_MAPPERS: Record<UserDataStore, RowMapper> = {
  day_plans: verifyUser,
  food_options: verifyUser,
  exercise_options: verifyUser,
  supplement_templates: verifyUser,
  daily_meals: passthrough,
  daily_meal_items: passthrough,
  custom_tasks: passthrough,
  daily_supplements: passthrough,
  daily_exercise_items: passthrough,
  routine_tasks: passthrough,
}

/** 某张表是否直接记录账号归属。 */
export function isUserScoped(store: UserDataStore): boolean {
  return USER_SCOPED_STORES.includes(store)
}

/**
 * 本地记录 → 云端行。
 *
 * owner 来自本轮捕获的可信认证上下文，不能从队列或本地会话 JSON 推断。
 */
export function toCloudRow(store: UserDataStore, record: CloudRow, cloudUserId: string): CloudRow {
  // 清洗：按字段契约去掉契约里没有的字段（含 `exercise_content` / `plan_content`），
  // 同时顺手保证不会有 `undefined` 之类的值漏到请求体里。
  const { value } = sanitizeRecord(store, record as never)
  return ROW_MAPPERS[store](value as CloudRow, cloudUserId)
}
