#!/usr/bin/env node
// 同步规则回归（S2 起，S3 / S4 陆续扩项）：
// 入队范围、压缩规则、依赖层级排序、设备仓库不进备份、绑定情形判定（S3）、
// 推送批次上限与事件名、相对时间边界、同步文案口径（S4）。
//
// 用法：npm run check:sync
//
// 全部是**纯函数**断言：直接导入 `src/services/local/outboxRules.ts` 与 `recordSchemas.ts`，
// 不碰 IndexedDB、不碰网络、不需要浏览器，因此可以在 Node 里秒级跑完。
//
// 为什么需要它：S2 之后每一次本地写入都会顺手往 outbox 记一笔，队列规则一旦错了
// （比如压缩把「已在途」的条目删掉、层级排序把子表排在父表前面、设备状态混进备份），
// 症状要到 S3 真正开始推送时才会暴露，而且表现为云端数据错乱，很难倒查。
// 这里把规则本身钉死，S3 只需要对「推送」负责。
//
// 分工：`check:local-data` 守数据库结构与迁移，本脚本守队列语义，两者不重叠。

import './ts-resolve.mjs'

const failures = []
let passed = 0

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed += 1
  else failures.push({ name, actual, expected })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`}`)
}

const {
  ALL_STORES,
  DEVICE_STORES,
  META_STORES,
  SCHEMA_STORES,
  USER_DATA_STORES,
  isSyncableStore,
  validateRecord,
} = await import('../src/services/local/recordSchemas.ts')
const { DB_VERSION, LOCAL_SCHEMA } = await import('../src/services/local/localDb.ts')
const {
  BATCH_LIMIT,
  OUTBOX_CHANGE_EVENT,
  SYNC_LAYERS,
  changeKey,
  compactionVictims,
  createSeqGenerator,
  dedupeChanges,
  entriesOfOwner,
  layerOf,
  sortChangesForPush,
} = await import('../src/services/local/outboxRules.ts')
const { BACKUP_META_STORES, BACKUP_STORES, BACKUP_STORE_COUNT, parseBackup } = await import(
  '../src/services/local/backupFormat.ts'
)

const TS = '2026-09-19T10:00:00.000Z'

// ---------------------------------------------------------------- 1. 入队范围

// 只有用户数据仓库进队列。`users` 是 Supabase UID 的本地资料缓存，
// 七张设备仓库是本机迁移、工作区与同步状态——任何一张混进来都会造成
// 「自己同步自己」或「把本机队列推给云端」这类无解状态。
const syncable = ALL_STORES.filter((store) => isSyncableStore(store))
check('可入队的仓库正好是 10 张用户数据表', syncable, USER_DATA_STORES)
check('users 不入队（仅作当前 Auth UID 的资料缓存）', isSyncableStore('users'), false)
check('sync_outbox 不入队（否则自激循环）', isSyncableStore('sync_outbox'), false)
check('sync_state 不入队', isSyncableStore('sync_state'), false)
check('七张设备状态表全部不入队', DEVICE_STORES.filter((store) => isSyncableStore(store)), [])
check('设备仓库清单包含同步、隔离区和工作区状态',
  [...DEVICE_STORES].sort(),
  ['sync_outbox', 'sync_state', 'legacy_users', 'legacy_sync_state', 'legacy_outbox',
    'workspace_state', 'workspace_migrations'].sort())
check('三分类合起来等于全部 18 张表', ALL_STORES.length, 18)
check('设备状态表不在备份仓库里', BACKUP_STORES.filter((store) => DEVICE_STORES.includes(store)), [])
check('设备状态表不进备份也不进同步',
  DEVICE_STORES.every((store) => !isSyncableStore(store) && !BACKUP_STORES.includes(store)), true)
check(
  '备份仓库 = 用户数据 + 元数据（集合口径）',
  [...BACKUP_STORES].sort(),
  [...USER_DATA_STORES, ...META_STORES].sort(),
)
check('备份仓库仍是 11 张（10 张业务表 + users 资料）', BACKUP_STORE_COUNT, 11)

// ---------------------------------------------------------------- 2. 压缩规则

const put = (store, record_id) => ({ store, record_id, op: 'upsert' })
const del = (store, record_id) => ({ store, record_id, op: 'delete' })

check('压缩键由仓库与记录 id 共同决定', changeKey({ store: 'day_plans', record_id: 'p1' }), 'day_plans\u0000p1')

const compressed = dedupeChanges([put('day_plans', 'p1'), put('day_plans', 'p1'), put('day_plans', 'p1')])
check('同一条记录连续写三次只留一条', compressed.length, 1)
check('留下的是最后一次写入', compressed[0].op, 'upsert')

// 「导入备份替换当前账号数据」就是这个形状：先删掉本账号旧记录，再写回备份里的记录。
// 同 id 的记录最终存在，队列里就该是 upsert——顺序反了会让云端把它删掉。
check(
  '同一次调用里「先删后写」收敛成 upsert',
  dedupeChanges([del('daily_meals', 'm1'), put('daily_meals', 'm1')]),
  [put('daily_meals', 'm1')],
)
check(
  '同一次调用里「先写后删」收敛成 delete',
  dedupeChanges([put('daily_meals', 'm1'), del('daily_meals', 'm1')]),
  [del('daily_meals', 'm1')],
)
check(
  '不同记录不会被误合并',
  dedupeChanges([put('day_plans', 'p1'), put('day_plans', 'p2')]).length,
  2,
)
check(
  '同一记录 id 但不同仓库不会被误合并',
  dedupeChanges([put('day_plans', 'x'), put('daily_meals', 'x')]).length,
  2,
)
check(
  '去重保持首次出现的顺序',
  dedupeChanges([put('day_plans', 'p1'), put('food_options', 'f1'), put('day_plans', 'p1')]).map(
    (change) => change.store,
  ),
  ['day_plans', 'food_options'],
)

const entry = (id, attempts) => ({
  id,
  seq: 1,
  store: 'day_plans',
  record_id: 'p1',
  op: 'upsert',
  local_user_id: null,
  created_at: TS,
  attempts,
  last_error: attempts ? '上传失败' : null,
})
check('压缩会删掉尚未尝试过的旧条目', compactionVictims([entry('a', 0), entry('b', 0)]), ['a', 'b'])
// 已在途的条目不动：删掉它会丢掉失败原因，还可能把「已经发出去的删除」悄悄抵消。
check('压缩不碰 attempts > 0 的条目', compactionVictims([entry('a', 0), entry('b', 2)]), ['a'])
check('全部都在途时压缩不删任何条目', compactionVictims([entry('a', 1), entry('b', 3)]), [])

// ---------------------------------------------------------------- 3. 依赖层级排序

check(
  '层级表覆盖全部 10 张用户数据表',
  SYNC_LAYERS.flat().slice().sort(),
  [...USER_DATA_STORES].sort(),
)
check('层级表没有重复项', SYNC_LAYERS.flat().length, new Set(SYNC_LAYERS.flat()).size)
check('选项表在 L0', layerOf('food_options'), 0)
check('day_plans 在 L1', layerOf('day_plans'), 1)
check('挂在计划下的记录在 L2', layerOf('routine_tasks'), 2)
check('daily_meal_items 在 L3（唯一挂在三餐而非计划下的表）', layerOf('daily_meal_items'), 3)
check('不在同步范围的仓库层级为 -1', [layerOf('users'), layerOf('sync_outbox'), layerOf('sync_state')], [-1, -1, -1])
check('七张设备仓库都没有上传层级', DEVICE_STORES.map((store) => layerOf(store)), DEVICE_STORES.map(() => -1))

// 写入按层级正序：父表先上，子表的外键才有得指。
const upserts = [put('daily_meal_items', 'i1'), put('day_plans', 'p1'), put('food_options', 'f1')]
check(
  '写入按层级正序（选项 → 计划 → 餐次内容）',
  sortChangesForPush(upserts).map((change) => change.store),
  ['food_options', 'day_plans', 'daily_meal_items'],
)
// 删除按层级倒序：子表先走，不会留下悬空引用。
const deletes = [del('food_options', 'f1'), del('daily_meal_items', 'i1'), del('day_plans', 'p1')]
check(
  '删除按层级倒序（餐次内容 → 计划 → 选项）',
  sortChangesForPush(deletes).map((change) => change.store),
  ['daily_meal_items', 'day_plans', 'food_options'],
)
check(
  '同一批次里删除排在写入之前',
  sortChangesForPush([put('food_options', 'f1'), del('day_plans', 'p1')]).map((change) => change.op),
  ['delete', 'upsert'],
)
check(
  '同层内按 seq 保持写入顺序',
  sortChangesForPush([put('food_options', 'f1'), put('exercise_options', 'e1')], (change) =>
    change.record_id === 'e1' ? 1 : 2,
  ).map((change) => change.record_id),
  ['e1', 'f1'],
)
const original = [put('daily_meal_items', 'i1'), put('day_plans', 'p1')]
sortChangesForPush(original)
check('排序返回新数组，不改动入参', original.map((change) => change.store), ['daily_meal_items', 'day_plans'])

// ---------------------------------------------------------------- 4. 序号

const fixed = createSeqGenerator(() => 1000)
check('序号在同一毫秒内仍然递增', [fixed(), fixed(), fixed()], [1000001, 1000002, 1000003])
let clock = 5000
const advancing = createSeqGenerator(() => (clock += 1))
const series = [advancing(), advancing(), advancing()]
check('时间前进时序号严格递增', series[0] < series[1] && series[1] < series[2], true)
check('序号是有限数字', series.every((value) => Number.isFinite(value)), true)

// ---------------------------------------------------------------- 5. 设备仓库进不了备份

check('元数据仓库只有 users', BACKUP_META_STORES, ['users'])
// 手改过的备份把设备状态塞进来时必须被拒——否则「备份里混进本机队列」会一路走到导入。
const backupFile = {
  app: 'happy-little-molly',
  format: 'local-backup',
  version: 3,
  db_version: DB_VERSION,
  exported_at: TS,
  source_user: { username: 'W' },
  counts: { users: 1 },
  records: { users: [{ id: 'u1', username: 'W', created_at: TS }] },
}
function rejects(file, label) {
  try {
    parseBackup(JSON.stringify(file), DB_VERSION)
    return `${label} 未被拒绝`
  } catch (reason) {
    return reason instanceof Error ? reason.message : String(reason)
  }
}
check(
  '备份里出现 sync_outbox 会被整份拒绝',
  rejects({ ...backupFile, records: { ...backupFile.records, sync_outbox: [] } }, '含设备仓库的备份').includes(
    '不认识的仓库',
  ),
  true,
)
check(
  '备份里出现 sync_state 会被整份拒绝',
  rejects({ ...backupFile, records: { ...backupFile.records, sync_state: [] } }, '含同步状态的备份').includes(
    '不认识的仓库',
  ),
  true,
)
for (const store of DEVICE_STORES.filter((store) => !['sync_outbox', 'sync_state'].includes(store))) {
  const message = rejects({ ...backupFile, records: { ...backupFile.records, [store]: [] } }, `含 ${store} 的备份`)
  check(`备份里出现 ${store} 会被整份拒绝`,
    message.includes(store === 'legacy_users' ? '不得包含任何身份凭据' : '不认识的仓库'), true)
}
check('正常的自洽备份仍可解析（对照）', rejects(backupFile, '对照备份').includes('没有任何数据'), true)

// ---------------------------------------------------------------- 6. 两个新仓库的字段契约

const outboxRow = {
  id: 'o1',
  seq: 1000001,
  store: 'day_plans',
  record_id: 'p1',
  op: 'upsert',
  local_user_id: 'local-a',
  created_at: TS,
  attempts: 0,
  last_error: null,
}
check('sync_outbox 契约接受一条正常队列记录', validateRecord('sync_outbox', outboxRow), [])
// 归属账号允许为 null：迁移期与 Node 脚本里读不到会话，这类条目会被 `entriesOfOwner`
// 过滤掉（永不被推送），但契约上必须是合法的，否则老库升级时会直接写不进去。
check('sync_outbox 契约接受「无归属」的条目', validateRecord('sync_outbox', { ...outboxRow, local_user_id: null }), [])
check(
  'sync_outbox 契约拒绝把 users 放进队列',
  validateRecord('sync_outbox', { ...outboxRow, store: 'users' }).some((issue) => issue.includes('store')),
  true,
)
// 契约只认标量字段，所以队列记录里存不了数据副本——这条断言同时守住「不存 payload」这个设计。
check(
  'sync_outbox 契约拒绝 payload 这类数据副本',
  validateRecord('sync_outbox', { ...outboxRow, payload: { a: 1 } }).includes('出现未定义字段 payload'),
  true,
)
check(
  'sync_outbox 契约拒绝缺字段的记录',
  validateRecord('sync_outbox', { id: 'o1', seq: 1, store: 'day_plans', record_id: 'p1', op: 'upsert' }).includes(
    '缺少字段 attempts',
  ),
  true,
)
check(
  'sync_outbox 契约只认 upsert / delete 两种操作',
  validateRecord('sync_outbox', { ...outboxRow, op: 'update' }).some((issue) => issue.includes('op')),
  true,
)

const stateRow = {
  id: '11111111-1111-4111-8111-111111111111',
  enabled: false,
  cloud_email: null,
  device_id: 'device-1',
  bound_at: null,
  last_push_at: null,
  last_restore_at: null,
  last_error_message: null,
  last_error_at: null,
  updated_at: TS,
}
// `id` 就是当前可信 Auth UID：契约要求它是文本，
// 语义上的约束在 `syncState.ts`（读只按捕获的当前账号取）。
check('sync_state 契约接受一条 Auth UID 状态', validateRecord('sync_state', stateRow), [])
check(
  'sync_state 的 last_error 摊平成 message + at 两列',
  validateRecord('sync_state', { ...stateRow, last_error: { message: 'x', at: TS } }).includes(
    '出现未定义字段 last_error',
  ),
  true,
)
check('sync_state 不再存 cloud_user_id',
  validateRecord('sync_state', { ...stateRow, cloud_user_id: null }).includes('出现未定义字段 cloud_user_id'), true)
check('sync_state 契约要求全部字段齐备（缺少 9 个字段）',
  validateRecord('sync_state', { id: stateRow.id }).length, 9)

// ---------------------------------------------------------------- 7. 与数据库结构对齐

check('每张仓库都有字段契约', [...SCHEMA_STORES].sort(), [...ALL_STORES].sort())
check('数据库版本已升到 8', DB_VERSION, 8)
check('LOCAL_SCHEMA 的仓库数也是 18', LOCAL_SCHEMA.stores.length, 18)
// v7 不动结构，只把 `sync_state` 的归属从设备改成本地账号（见 check:local-data 的搬迁规则回归）。
check('v7 不新增仓库', LOCAL_SCHEMA.migrations[7]?.stores ?? [], [])
check('v7 带搬迁函数', typeof LOCAL_SCHEMA.migrations[7]?.migrate, 'function')
check(
  'v8 新建五张身份隔离与工作区仓库',
  LOCAL_SCHEMA.migrations[8]?.stores ?? [],
  ['legacy_users', 'legacy_sync_state', 'legacy_outbox', 'workspace_state', 'workspace_migrations'],
)
check('v8 带旧身份隔离函数', typeof LOCAL_SCHEMA.migrations[8]?.migrate, 'function')

// ---------------------------------------------------------------- 7b. 队列条目的归属账号（S4 补丁 ②）

// 这条规则守的是**跨 UID 串数据**：队列 owner 必须是写入时捕获的
// Supabase Auth UID。换账号后若不加区分地推，旧 UID 的改动会被写进新 UID
// 的云端账号里，而且界面上一点痕迹都没有——只能在这里钉死。
const owner = (id, localUserId) => ({ ...entry(id, 0), local_user_id: localUserId })
check(
  '只取属于当前 Auth UID 的条目',
  entriesOfOwner([
    owner('a', '11111111-1111-4111-8111-111111111111'),
    owner('b', '22222222-2222-4222-8222-222222222222'),
  ], '11111111-1111-4111-8111-111111111111').map((row) => row.id),
  ['a'],
)
check('没有登录会话时一条都不取（宁可什么都不推）', entriesOfOwner([owner('a', 'local-a')], null), [])
check(
  '归属为 null 的老条目永不被推送（迁移期留下的）',
  entriesOfOwner([owner('a', null), owner('b', 'local-a')], 'local-a').map((row) => row.id),
  ['b'],
)
check('空队列取出来还是空', entriesOfOwner([], '11111111-1111-4111-8111-111111111111'), [])

// ---------------------------------------------------------------- 7c. 同步状态的归属（S4 补丁 ②）

// `sync_state` 的主键就是当前可信 Auth UID，所以「读到别人的绑定」在结构上不成立——
// 这一条比任何运行期判断都可靠，因此直接对着模块本身断言。
// 这些调用不碰 IndexedDB（没有会话时 `readSyncState` 在读库之前就返回 null），
// 与上面那批纯函数断言一样是秒级的。
const { currentLocalUserId, emptySyncState, readSyncState } = await import('../src/services/sync/syncState.ts')
check('没有登录会话时没有归属人', currentLocalUserId(), null)
check('没有登录会话时读不到同步状态（也就读不到别人的）', await readSyncState(), null)
check('空白状态的主键就是可信 Auth UID',
  emptySyncState('11111111-1111-4111-8111-111111111111').id,
  '11111111-1111-4111-8111-111111111111')
check('空白状态默认不上传（工作区准备完成前不能推送）', emptySyncState('local-a').enabled, false)
check('空白状态不包含另一份云端身份', 'cloud_user_id' in emptySyncState('local-a'), false)

// ---------------------------------------------------------------- 8. 两侧数据的覆盖方向判定（S3 历史纯规则）

// 这条规则**原本住在 `sync/accountLink.ts`**，第一次写回归时才发现 import 不了：
// 那个模块拖着 `@supabase/supabase-js`，而它的子包 `@supabase/functions-js`
// 在纯 Node 下解析失败（`MODULE_NOT_FOUND`）。于是按 `local/outboxRules.ts` 的同一套做法
// 把规则拆成纯文件——**能回归的规则才算规则**，留在那里就只能靠人工看。
//
// 三种情形判错的后果不是报错，而是**用户会选错覆盖方向**（提示「直接上传」而云端其实有数据），
// 所以边界必须钉死，尤其是「两边都空」这一格：三种情形里没有它。
const { judgeBindingCase } = await import('../src/services/sync/bindingRules.ts')

check('云端为空 → cloud-empty（没有覆盖风险）', judgeBindingCase(0, 12), 'cloud-empty')
check('两边都有数据 → both-sides（必须由用户选一边）', judgeBindingCase(30, 12), 'both-sides')
check('本地为空、云端有数据 → local-empty（适合从云端取回）', judgeBindingCase(30, 0), 'local-empty')
check('两边都空归到 cloud-empty，而不是 local-empty', judgeBindingCase(0, 0), 'cloud-empty')
check('负数按空处理，不会漏出第四种情形', judgeBindingCase(-1, 5), 'cloud-empty')

// ---------------------------------------------------------------- 9. 推送常量（S4）

// 批次上限存在的理由不是请求体大小，而是**失败时的重试粒度**：一次失败会把整批的
// attempts 都加一，批次越大，一条坏数据牵连的无辜记录越多。所以它是个有语义的常量，
// 不是随手写个 100。
check('一个推送批次最多 100 条', BATCH_LIMIT, 100)

// 写入钩子广播、调度器监听，靠的就是这个名字。写错一个字两边都编译得过、
// 跑起来也不报错，只是推送永远不触发——只能靠这条断言拦。
check('队列变更事件名固定', OUTBOX_CHANGE_EVENT, 'molly-outbox-change')
check('事件名非空（防止有人把它改成空串）', OUTBOX_CHANGE_EVENT.length > 0, true)

// ---------------------------------------------------------------- 10. 相对时间（S4）

// 「最后上传：3 分钟前」是关于同步的事实陈述，说错了就是在骗人（docs/19 §6）。
// 这里的每一条都是实际会出现在设置页上的说法，边界必须钉死。
const { formatRelativeTime } = await import('../src/shared/date/relativeTime.ts')
const NOW = new Date('2026-09-20T12:00:00.000Z')
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString()

check('不足一分钟说「刚刚」', formatRelativeTime(ago(10_000), NOW), '刚刚')
check('刚好 60 秒进位成 1 分钟', formatRelativeTime(ago(60_000), NOW), '1 分钟前')
check('90 秒是 1 分钟（向下取整，不四舍五入）', formatRelativeTime(ago(90_000), NOW), '1 分钟前')
check('59 分钟仍是分钟', formatRelativeTime(ago(59 * 60_000), NOW), '59 分钟前')
check('满 60 分钟进位成小时', formatRelativeTime(ago(60 * 60_000), NOW), '1 小时前')
check('23 小时仍是小时', formatRelativeTime(ago(23 * 3_600_000), NOW), '23 小时前')
check('满 24 小时进位成天', formatRelativeTime(ago(24 * 3_600_000), NOW), '1 天前')
check('6 天仍在相对区间内', formatRelativeTime(ago(6 * 86_400_000), NOW), '6 天前')
// 超过 7 天返回 null，由调用方改用绝对时间：「12 天前」不比一个日期更好核对。
check('满 7 天不再用相对说法', formatRelativeTime(ago(7 * 86_400_000), NOW), null)
check('解析不出来的时间戳返回 null（不编一个说法）', formatRelativeTime('不是时间', NOW), null)
// 系统时钟被往前调过时，elapsed 为负。显示「-3 分钟前」是荒谬的，
// 显示「刚刚」至少不撒谎——它确实刚刚被记录过。
check('未来时间戳说「刚刚」而不是负数', formatRelativeTime(ago(-5_000), NOW), '刚刚')

// ---------------------------------------------------------------- 11. 同步文案口径（S4）

// 这几条守的是**话是不是真的**，不是代码能不能跑。S3 期间界面固定显示
// 「当前版本只记录变更，还没有开始上传」；S4 起真的在上传，留着它就从诚实变成撒谎。
const { SYNC_BOUND_TEXT } = await import('../src/features/preferences/preferencesLabels.ts')

check('S3 那句过渡说明已经删掉', SYNC_BOUND_TEXT.pendingOnlyNote, undefined)
check('失败前缀直说「上传失败」', SYNC_BOUND_TEXT.lastErrorPrefix, '上传失败')
check('没有上传过就说「还没有上传过」', SYNC_BOUND_TEXT.neverPushed, '还没有上传过')

// 最重要的一条：待上传归零时**不能**说「已同步」。
// 「本机没有待上传的变更」是能证明的，「云端与本地一致」证明不了。
check('队列排空时的说明不提「已同步」', SYNC_BOUND_TEXT.drainedNote.includes('已同步'), false)
check('队列排空时的说明主动否认「一致」', SYNC_BOUND_TEXT.drainedNote.includes('完全一致'), true)
check('有待上传时承诺的是「继续自动上传」而不是「正在上传」', SYNC_BOUND_TEXT.pendingNote.includes('继续自动上传'), true)

// ---------------------------------------------------------------- 12. 本地行 → 云端行映射（S4）

// 映射错了的后果很隐蔽：**云端收到一条形状不对的行，PostgREST 报错、推送失败、
// 队列堆积，而本地一切正常**。所以这三条规则必须在 Node 里钉死，不能靠人工点。
const { ROW_MAPPERS, USER_SCOPED_STORES, isUserScoped, toCloudRow } = await import(
  '../src/services/sync/mapper.ts'
)

const AUTH_UID = '11111111-1111-4111-8111-111111111111'
const planRow = {
  id: 'p1',
  user_id: AUTH_UID,
  plan_date: '2026-09-20',
  mode: 'work',
  mode_override: false,
  created_at: TS,
  updated_at: TS,
  outfit_ready: false,
  meals_ready: false,
  supplements_ready: false,
  morning_ready: false,
  exercise_ready: false,
  morning_focus: '',
  morning_completed: false,
  exercise_decision: 'exercise',
  exercise_note: '',
  exercise_completed: false,
  // v3 迁移有意留在老记录上的云端遗留列（见 localDb.ts 的 backfillSnapshots）：
  // 本地契约里没有它，推送时绝不能发出去。
  exercise_content: '旧的自由文本健身内容',
}

check('映射表覆盖全部 10 张用户数据表', Object.keys(ROW_MAPPERS).sort(), [...USER_DATA_STORES].sort())
check(
  '带 user_id 的表正好是四张',
  [...USER_SCOPED_STORES].sort(),
  ['day_plans', 'exercise_options', 'food_options', 'supplement_templates'].sort(),
)
check(
  'isUserScoped 与清单一致（每张表逐个核对）',
  USER_DATA_STORES.map((store) => isUserScoped(store)),
  USER_DATA_STORES.map((store) => USER_SCOPED_STORES.includes(store)),
)

const mappedPlan = toCloudRow('day_plans', planRow, AUTH_UID)
check('映射保留与当前可信 Auth UID 一致的 user_id', mappedPlan.user_id, AUTH_UID)
check('映射沿用同一归属，不制造另一个账号 id', mappedPlan.user_id === planRow.user_id, true)
// 这条是映射存在的头号理由：发出去等于把一份可能已经过期的副本又写回云端。
check('映射剔除云端遗留列 exercise_content', 'exercise_content' in mappedPlan, false)
check('映射保留本地形状里的字段', mappedPlan.morning_focus === '' && mappedPlan.plan_date === '2026-09-20', true)

const mealRow = {
  id: 'm1',
  day_plan_id: 'p1',
  meal_type: 'breakfast',
  note: '温牛奶',
  completed: false,
  plan_content: '旧的自由文本三餐内容',
}
const mappedMeal = toCloudRow('daily_meals', mealRow, AUTH_UID)
check('映射剔除云端遗留列 plan_content', 'plan_content' in mappedMeal, false)
// 子表不带 user_id（docs/01 不变量 2），凭空加一列会让 PostgREST 报「列不存在」。
check('子表映射不凭空加 user_id', 'user_id' in mappedMeal, false)
check('子表映射保留自己的字段', mappedMeal.note === '温牛奶' && mappedMeal.completed === false, true)

// 纯函数：映射只清洗字段，不改 owner，也不修改本地记录。
toCloudRow('day_plans', planRow, AUTH_UID)
check('映射不改动入参', planRow.user_id === AUTH_UID && 'exercise_content' in planRow, true)

const optionRow = {
  id: 'option1', user_id: AUTH_UID, name: '选项', active: true, sort_order: 0,
  created_at: TS, updated_at: TS,
}
const ownerRows = {
  day_plans: planRow,
  food_options: optionRow,
  exercise_options: optionRow,
  supplement_templates: { ...optionRow, period: 'morning' },
}
function ownerRejection(store, row) {
  try {
    toCloudRow(store, row, AUTH_UID)
    return ''
  } catch (reason) {
    return reason instanceof Error ? reason.message : String(reason)
  }
}
for (const store of USER_SCOPED_STORES) {
  const row = ownerRows[store]
  check(`${store} 映射接受同一 Auth UID 并保持归属`, toCloudRow(store, row, AUTH_UID).user_id, AUTH_UID)
  const wrongRows = [
    ['旧随机本地 owner', { ...row, user_id: 'old-local-owner' }],
    ['其他 Auth UID', { ...row, user_id: '22222222-2222-4222-8222-222222222222' }],
    ['缺少 owner', Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'user_id'))],
  ]
  const before = JSON.stringify(wrongRows)
  for (const [label, candidate] of wrongRows) {
    check(`${store} 拒绝${label}，不改写成当前 UID`, ownerRejection(store, candidate).includes('不属于当前账号'), true)
  }
  check(`${store} 拒绝上传也不修改来源记录`, JSON.stringify(wrongRows), before)
}

// ---------------------------------------------------------------- 13. 整体替换的前置规则（S5）

const { isUuid, nonUuidValues, replaceCloudProblem, replaceLocalProblem } = await import(
  '../src/services/sync/replaceRules.ts'
)

check('标准 UUID 认得出', isUuid('0d000000-0000-4000-8000-000000000001'), true)
check('大小写都认', isUuid('0D000000-0000-4000-8000-000000000001'), true)
// `localDb.createId()` 的回退分支产出这种形状——它不是 UUID，插不进 uuid 主键。
check('时间戳回退 id 不认', isUuid('1758331234567-8f3a1c'), false)
check('空串不认', isUuid(''), false)

const CLEAN_RECORDS = {
  day_plans: [{ id: '0d000000-0000-4000-8000-000000000001', user_id: '0a000000-0000-4000-8000-000000000001' }],
  daily_meal_items: [
    { id: '0b000000-0000-4000-8000-000000000001', daily_meal_id: '0c000000-0000-4000-8000-000000000001', food_option_id: null },
  ],
}
check('全是 UUID 时没有问题', nonUuidValues(CLEAN_RECORDS), [])
// 外键为 null 是合法的（「没有来源选项」），不能因为 null 就报错。
check('可空外键为 null 不算问题', nonUuidValues({ daily_meal_items: [{ id: '0b000000-0000-4000-8000-000000000001', food_option_id: null }] }), [])
check(
  '找出非 UUID 的字段并去重排序',
  nonUuidValues({
    day_plans: [{ id: '1758331234567-8f3a1c', user_id: 'also-not-uuid' }],
    food_options: [{ id: '1758331234567-8f3a1c' }],
  }),
  ['day_plans.id', 'day_plans.user_id', 'food_options.id'],
)

// 空本地账号必须拦住：这个操作的语义是「替换」，用 0 条替换等于把云端清空。
check('空本地被拦住', typeof replaceCloudProblem({ localTotal: 0, badIds: [] }), 'string')
check('非 UUID 被拦住且指出字段', replaceCloudProblem({ localTotal: 5, badIds: ['day_plans.id'] })?.includes('day_plans.id'), true)
check('非 UUID 优先于空账号报出', replaceCloudProblem({ localTotal: 0, badIds: ['day_plans.id'] })?.includes('UUID'), true)
check('有数据且 id 干净时放行', replaceCloudProblem({ localTotal: 5, badIds: [] }), null)

check('空云端被拦住', typeof replaceLocalProblem({ cloudTotal: 0 }), 'string')
check('云端有数据时放行', replaceLocalProblem({ cloudTotal: 3 }), null)

// ---------------------------------------------------------------- 14. 云端快照必须能过 parseBackup（S5）

// 这是 `export_cloud_snapshot()` 输出形状的**契约**：它必须与本地备份同形，
// 否则「从云端恢复到本地」会在 `parseBackup` 这一步整份被拒。
// 真实 SQL 的输出由 `verify:sql` 跑真实 PostgreSQL 验；这里先用一份手写的
// 同形样本钉住「形状对了就一定能过」，并反证「少了合成 users 行就一定过不了」。
const CLOUD_UID = '11111111-1111-4111-8111-111111111111'
const SNAPSHOT_FIXTURE = {
  app: 'happy-little-molly',
  format: 'local-backup',
  version: 3,
  db_version: DB_VERSION,
  exported_at: '2026-09-20T04:15:45.462Z',
  source_user: { username: 'W' },
  counts: { day_plans: 1 },
  records: {
    users: [{ id: CLOUD_UID, username: 'W', created_at: '1970-01-01T00:00:00.000Z' }],
    day_plans: [
      {
        id: '0d000000-0000-4000-8000-000000000001',
        user_id: CLOUD_UID,
        plan_date: '2026-01-05',
        mode: 'work',
        mode_override: false,
        created_at: '2026-01-05T00:00:00.000Z',
        updated_at: '2026-01-05T00:00:00.000Z',
        outfit_ready: true,
        meals_ready: false,
        supplements_ready: false,
        morning_ready: false,
        exercise_ready: false,
        morning_focus: '早起',
        morning_completed: true,
        exercise_decision: 'rest',
        exercise_note: '',
        exercise_completed: false,
      },
    ],
  },
}

const snapshotParsed = parseBackup(JSON.stringify(SNAPSHOT_FIXTURE), DB_VERSION)
check('云端快照能过 parseBackup', snapshotParsed.summary.total, 1)
check('快照来源账号被读出来（用于界面展示）', snapshotParsed.summary.sourceUsername, 'W')
check('当前快照格式为 v3', snapshotParsed.summary.formatVersion, 3)
check('当前快照结构为 v8', snapshotParsed.summary.dbVersion, 8)
check('当前快照 users 只包含同一 UID 的资料，无凭据',
  Object.keys(snapshotParsed.records.users[0]).sort(), ['id', 'username', 'created_at'].sort())

// 反证：去掉合成 users 行，`day_plans.user_id` 就找不到父记录，整份必须被拒。
// 这一条钉住的是「`export_cloud_snapshot()` 必须额外输出一条 users 行」这个
// 看起来多余、实则是硬要求的细节（`docs/18 §5.5`）。
const withoutUsers = { ...SNAPSHOT_FIXTURE, records: { ...SNAPSHOT_FIXTURE.records } }
delete withoutUsers.records.users
let usersRejection = ''
try {
  parseBackup(JSON.stringify(withoutUsers), DB_VERSION)
} catch (cause) {
  usersRejection = String(cause?.message ?? cause)
}
check('缺合成 users 行的快照被拒', usersRejection.includes('一个明确的来源账号'), true)

// 反证二：快照里混进云端独有列（`to_jsonb(t)` 那种写法会这样），必须被拒。
// 这条与 `check:cloud-parity` 第 10 组的静态断言是同一件事的两端。
const withLegacyColumn = JSON.parse(JSON.stringify(SNAPSHOT_FIXTURE))
withLegacyColumn.records.day_plans[0].exercise_content = '旧的自由文本健身内容'
let legacyRejection = ''
try {
  parseBackup(JSON.stringify(withLegacyColumn), DB_VERSION)
} catch (cause) {
  // 具体是哪几个字段写在 `details` 里（`fail()` 把 issues 放在那儿），
  // 只看 `message` 会漏掉——它只有「备份数据格式不正确（day_plans 第 1 条）。」。
  legacyRejection = `${cause?.message ?? cause} ${cause?.details ?? ''}`
}
check('混进云端独有列的快照被拒', legacyRejection.includes('未定义字段 exercise_content'), true)

console.log('')
console.log(`结果：${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  console.log('未通过：')
  failures.forEach((item) => console.log(`  - ${item.name}`))
  process.exitCode = 1
}
