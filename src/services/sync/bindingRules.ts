/**
 * 绑定情形的判定规则（S3）——**纯函数，不碰网络、不碰 IndexedDB**。
 *
 * 为什么单独成文件，与 `local/outboxRules.ts` 是同一个理由：
 * `scripts/check-sync.mjs` 要在 Node 里直接 import 它做回归，而它原本住的
 * `accountLink.ts` 拖着 `@supabase/supabase-js`——那个包的子模块
 * （`@supabase/functions-js`）在纯 Node 下解析不了，import 会直接抛 `MODULE_NOT_FOUND`。
 *
 * 这条规则值得单独钉死，是因为判错的后果**不是报错，而是让用户选错覆盖方向**：
 * 云端明明有数据却被判成 `cloud-empty`，界面就会建议「直接上传」，
 * 而用户真正需要的是先决定保留哪一边。
 */

/** 三种绑定情形（`docs/18 §5.3`）。 */
export type CloudBindingCase = 'cloud-empty' | 'both-sides' | 'local-empty'

/**
 * 按两边现有条数判定属于哪一种情形。
 *
 * 两边都是空的时候归到 `cloud-empty`：此时没有任何一边会被覆盖，
 * 按「云端是干净的、可以放心连」处理最安全。若归到 `local-empty`，
 * 界面会建议用户「从云端恢复到本地」，而云端同样没有数据可恢复。
 *
 * `<= 0` 而不是 `=== 0`：条数来自两个不同的来源（PostgREST 的 count 与本地表的计数），
 * 这里不做「输入一定是非负整数」的假设，异常值一律按空处理，宁可少提示也不要误判成有数据。
 */
export function judgeBindingCase(cloudCount: number, localCount: number): CloudBindingCase {
  if (cloudCount <= 0) return 'cloud-empty'
  if (localCount <= 0) return 'local-empty'
  return 'both-sides'
}
