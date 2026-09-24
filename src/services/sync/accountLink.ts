/**
 * 云端账号的绑定与解绑（S3）。
 *
 * ## 一句话说清这一层的立场
 *
 * **本地账号是应用身份，云端账号是侧挂绑定**（决策 D5）。这意味着绑定流程
 * 与「登录」是两件不同的事：用户在设置页里点「连接云端账号」，
 * 输入的是**云端**那一侧的账号密码，成功后应用**仍然是本地账号登录的状态**。
 *
 * 正因为如此，这里绝不能复用「登录成功就 `writeSession(...)`」那类实现——
 * 它们会把云端用户写进本地会话镜像，于是用户会发现自己的本地账号被顶掉了
 * （本地数据还在，但「当前登录」变成了云端账号，所有按 `user_id` 过滤的查询立刻全部落空）。
 * L6 的 `cloud/authService.ts` 正是那种实现，**已在 S4-T7 删除**（见 `docs/23` §2.6）；
 * 这条纪律留着，是因为将来若有人重新引入一个「云端登录」，踩的还是同一个坑。
 * 与云端账号唯一共用的是「账号名 → 合成邮箱」这条规则，它住在 `cloud/identity.ts`。
 *
 * ## 三种绑定情形（`docs/18 §5.3`）
 *
 * | 情形 | 云端 | 本地 | 含义 |
 * | --- | --- | --- | --- |
 * | `cloud-empty` | 0 条 | 任意 | 云端是干净的，没有覆盖风险 |
 * | `both-sides` | 有 | 有 | **两边都有数据，必须由用户选一边**，不能替他决定 |
 * | `local-empty` | 有 | 0 条 | 本地是空账号，适合从云端取回 |
 *
 * 判定本身住在 `./bindingRules.ts`（纯函数，`check:sync` 直接回归它），
 * 拆出去的理由见那个文件：本模块拖着 `@supabase/supabase-js`，在纯 Node 下 import 会失败。
 *
 * ## S3 到 S5 的边界
 *
 * 确认绑定做两件事：写 `sync_state`（记住云端账号是谁）、清空 `sync_outbox`。
 * **不上传也不恢复**——那是 S5 的两个整体替换（`replaceCloud` / `replaceLocal`）。
 *
 * 清空队列的理由见 `bindCloudAccount` 的注释：队列是**增量**不是全量，
 * 绑定后直接推上去会得到一份「看起来成功、实际残缺」的云端数据。
 * 所以绑定后的界面会如实显示「本地共 M 条 · 待上传 0 条」，
 * 并说明「连接之前已有的记录不会自动上传」——不替用户决定，也不假装已经对齐。
 */

import { normalizeUsername, passwordProblem, usernameProblem } from '../../shared/authRules'
import { normalizeSupabaseError } from '../cloud/errors'
import { emailForUsername } from '../cloud/identity'
import { readCloudSummary } from '../cloud/rpc'
import { requireSupabase } from '../cloud/supabase'
import { getAll, runTransaction } from '../local/localDb'
import type { LocalStore } from '../local/localDb'
import type { OutboxEntry } from '../local/outboxRules'
import { judgeBindingCase, type CloudBindingCase } from './bindingRules'
import { clearOwnOutbox, ownOutboxIds } from './outbox'
import { countLocalRows } from './status'
import { currentLocalUserId, writeSyncState } from './syncState'

/** `signUp` 表示「用这个账号名新建一个云端账号」，`signIn` 表示「连接已有的」。 */
export type CloudAccountMode = 'signIn' | 'signUp'

/** 统一账号注册：只创建云端身份，业务数据仍由本地账号初始化。 */
export async function provisionCloudAccount(username: string, password: string): Promise<void> {
  const normalized = normalizeUsername(username)
  const problem = usernameProblem(normalized) ?? passwordProblem(password)
  if (problem) throw new Error(problem)
  const { data, error } = await requireSupabase().auth.signUp({
    email: emailForUsername(normalized),
    password,
    options: { data: { username: normalized } },
  })
  if (error) throw normalizeSupabaseError(error)
  if (!data.session || !data.user) {
    throw new Error('账号已创建，但云端要求邮箱验证后才能登录。请关闭邮箱验证或完成验证后重试。')
  }
}

/** 本地账号登录后恢复同名云端会话，并绑定到当前本地账号。 */
export async function autoBindCloudAccount(username: string, password: string): Promise<boolean> {
  const normalized = normalizeUsername(username)
  const { data, error } = await requireSupabase().auth.signInWithPassword({
    email: emailForUsername(normalized),
    password,
  })
  if (error || !data.user) return false
  const summary = await readCloudSummary()
  const localCount = await countLocalRows()
  await writeSyncState({
    enabled: true,
    cloud_user_id: data.user.id,
    cloud_email: data.user.email ?? emailForUsername(normalized),
    bound_at: new Date().toISOString(),
    last_error_message: null,
    last_error_at: null,
  })
  void summary
  void localCount
  return true
}

// 类型与判定函数都从纯规则文件转出：调用方（`api/syncService.ts`）不必知道它们住哪，
// 而 `check:sync` 可以绕过本模块直接 import 那个文件，不被 supabase 拖住。
export { judgeBindingCase }
export type { CloudBindingCase }

export type CloudConnectionProbe = {
  cloudUserId: string
  cloudEmail: string
  /**
   * 云端账号现有的业务数据条数（10 张用户数据表之和，受 RLS 限制只看得到自己的）。
   *
   * S5 起由 `cloud_sync_summary()` 给出，与 `localCount` **同一口径**（都含子表）。
   * S3 期间这里是四张根表的 head 计数，与本地那个数字含义不同——
   * 两个口径不同的数字被摆在一起比较并显示给用户，是会误导人的。
   */
  cloudCount: number
  /** 本地当前账号的业务数据条数，与备份摘要同一口径。 */
  localCount: number
  case: CloudBindingCase
}

/**
 * 连接云端账号并探测两边的情况。**只建立会话与读取条数，不写任何本地状态。**
 *
 * 之所以和「确认绑定」分成两步：`docs/18 §5.3` 要求先拿到「云端现有 N 条」
 * 再给用户看确认文案，此时用户可能反悔。分成两步后，反悔只需调
 * `disconnectCloudAccount()` 清掉云端会话，本地这边从头到尾没被改过。
 *
 * 条数读取失败（网络断、RLS 拒绝）会让整次连接失败并抛错——
 * 不吞掉错误降级成「假设云端是空的」：那会让一个非空云端账号被判成可安全覆盖。
 */
export async function connectCloudAccount(input: {
  username: string
  password: string
  mode: CloudAccountMode
}): Promise<CloudConnectionProbe> {
  const normalized = normalizeUsername(input.username)

  if (input.mode === 'signUp') {
    // 与本地注册共用同一份规则与文案，两种入口对同一份输入给出同样的拒绝理由。
    const problem = usernameProblem(normalized) ?? passwordProblem(input.password)
    if (problem) throw new Error(problem)
  }

  const client = requireSupabase()
  const credentials = { email: emailForUsername(normalized), password: input.password }
  const { data, error } =
    input.mode === 'signUp'
      ? await client.auth.signUp({ ...credentials, options: { data: { username: normalized } } })
      : await client.auth.signInWithPassword(credentials)

  if (error) throw normalizeSupabaseError(error)

  // 开了邮箱验证就不放行，而不是写一个空会话假装连上了。
  // （L6 的 `cloud/authService.signUp` 同一条原则，那个文件已在 S4-T7 删除。）
  if (input.mode === 'signUp' && !data.session) {
    throw new Error('云端账号已创建，但项目开启了邮箱验证：请先完成验证再连接，或关闭邮箱验证后重试。')
  }
  if (!data.user) throw new Error('已连接但未能取得云端账号信息，请稍后重试。')

  const [cloudSummary, localCount] = await Promise.all([readCloudSummary(), countLocalRows()])
  const cloudCount = cloudSummary.total

  return {
    cloudUserId: data.user.id,
    cloudEmail: data.user.email ?? emailForUsername(normalized),
    cloudCount,
    localCount,
    case: judgeBindingCase(cloudCount, localCount),
  }
}

/**
 * 确认绑定：把探测结果落进 `sync_state`。
 *
 * 只写状态，不动数据（S3 的边界，见文件头）。`last_push_at` / `last_restore_at`
 * 保持原值不清零：重连一个以前用过的账号时，那两个时间仍然是本机上真实发生过的事实。
 */
export async function bindCloudAccount(probe: CloudConnectionProbe): Promise<void> {
  await writeSyncState({
    enabled: true,
    cloud_user_id: probe.cloudUserId,
    cloud_email: probe.cloudEmail,
    bound_at: new Date().toISOString(),
    // 连接成功本身就说明上一次的失败原因已经不再适用，清掉免得界面一直挂着旧错误。
    last_error_message: null,
    last_error_at: null,
  })

  // S4 起：绑定后清空队列——补上方案 §5.3 流程的最后一步。
  //
  // 队列里积压的是**绑定之前**的本地变更，它们是相对一个当时并不存在的云端关系算出来的。
  // 为什么不能直接推上去：队列里只有「变更过的记录」，**不是全量**——
  // 从没改过的记录（例如老库迁移来的历史计划）压根不在队列里，
  // 推上去只会得到一份残缺的云端数据，而且看起来像成功。
  //
  // 两边如何对齐要由用户在 S5 的两个整体替换里明确决定（本地上传 / 云端恢复），
  // 而不是让一批来路不清的增量悄悄生效。
  //
  // 只清**当前本地账号**那一份（S4 补丁 ②）：队列里可能有别的账号留下的条目，
  // 它们不属于这次绑定关系，也不该被这次绑定牵连（那些条目在各自账号回来时仍然有效）。
  await clearOwnOutbox()
}

/**
 * 放弃一次还没确认的连接：**只断开云端会话，不碰本地任何状态**。
 *
 * 场景是「探测完了，用户看了确认框决定不连了」。此时 Supabase 那边已经建立了会话
 * （token 存在它自己的 localStorage 里），不清理的话会留下一个「云端连着、本地却没绑定」
 * 的悬空状态，下次打开设置页再点连接时行为会变得难以解释。
 *
 * 与 `disconnectCloudAccount()` 的区别是**它不清 `sync_outbox`**：
 * 用户只是放弃了这次连接，本机原有的待上传账本不该因此蒸发。
 */
export async function abandonCloudSession(): Promise<void> {
  const { error } = await requireSupabase().auth.signOut()
  if (error) throw normalizeSupabaseError(error)
}

/**
 * 断开连接：清掉**当前本地账号**的 `sync_state` 与待上传账本，
 * **不动本地数据，也不动云端数据**（`docs/18 §5.3`）。
 *
 * 两样东西在**同一个事务**里清：分开清的话，中途失败会留下
 * 「队列空了但界面还显示已连接」或者「已断开但队列里还堆着一批待上传」——
 * 两种自相矛盾的状态都会让用户以为数据已经上去了。
 *
 * 只清自己那一份（S4 补丁 ②）：`sync_state` 一行一个本地账号，
 * 队列条目也带归属，别的账号的绑定与账本不因为这次解绑而消失。
 *
 * 为什么断开要丢队列：队列里存的是「相对云端已有内容的增量」。断开之后
 * 本地还会继续记账（写入钩子与绑定状态无关），等用户重新连接时，
 * 两边是否还对得上已经无从判断，正确的动作是走 S5 的整体替换而不是补推旧增量。
 */
export async function disconnectCloudAccount(): Promise<void> {
  await abandonCloudSession()
  const owner = currentLocalUserId()
  if (!owner) return
  const mine = ownOutboxIds(await getAll<OutboxEntry>('sync_outbox'), owner)
  await runTransaction({
    remove: [
      { store: 'sync_state', id: owner },
      ...mine.map((id) => ({ store: 'sync_outbox' as LocalStore, id })),
    ],
  })
}
