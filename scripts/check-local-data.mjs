#!/usr/bin/env node
<<<<<<< HEAD
// 本地数据结构回归：迁移表「只追加」、仓库定义与迁移表一一对应、仓库三分类不交叉、
// 写入口共享原子校验与入队、旧身份隔离保留业务记录、示例选项不写死在界面层。
//
// 用法：npm run check:local-data
//
// 直接导入 src/services/local/localDb.ts 与 recordSchemas.ts（Node 22.18+ / 24 原生支持剥离类型），
=======
// 本地数据结构回归：迁移表「只追加」、仓库定义与迁移表一一对应、示例选项不写死在界面层。
//
// 用法：npm run check:local-data
//
// 直接导入 src/services/local/localDb.ts 与 optionSeed.ts（Node 22.18+ / 24 原生支持剥离类型），
>>>>>>> origin/main
// 不引入测试框架、不产生构建产物。
//
// 为什么需要它：docs/01 把「数据库迁移只追加，不改写旧迁移」列为硬性规则。
// 真实浏览器只能验证「新装出来是多少张表」，无法验证「旧版本升级时旧表没被动过」，
// 所以这里对着迁移表本身做静态断言，与 npm run verify:local 的运行时检查互补。
<<<<<<< HEAD
// 队列规则（压缩、层级排序、入队与否）在 `npm run check:sync` 里，与本脚本互补。
=======
>>>>>>> origin/main

// 必须先注册扩展名补全钩子，再动态导入源码（源码用的是不带 .ts 的相对导入）。
import './ts-resolve.mjs'

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const failures = []
let passed = 0

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed += 1
  else failures.push({ name, actual, expected })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`}`)
}

<<<<<<< HEAD
const { LOCAL_SCHEMA, rekeySyncStateRows } = await import('../src/services/local/localDb.ts')
const { ALL_STORES, DEVICE_STORES, META_STORES, SCHEMA_STORES, USER_DATA_STORES } = await import(
  '../src/services/local/recordSchemas.ts'
)
=======
const { LOCAL_SCHEMA } = await import('../src/services/local/localDb.ts')
>>>>>>> origin/main

const { version, stores, migrations } = LOCAL_SCHEMA
const storeNames = stores.map((store) => store.name).sort()
const migrationVersions = Object.keys(migrations).map(Number).sort((left, right) => left - right)
const storesOf = (key) => migrations[key].stores ?? []
const migratedNames = migrationVersions.flatMap((key) => storesOf(key))

// ---- 版本号与迁移表必须自洽 ----
check('DB_VERSION 等于迁移表的最大版本号', version, migrationVersions[migrationVersions.length - 1])
check(
  '迁移版本号从 1 起连续无缺口',
  migrationVersions,
  Array.from({ length: version }, (_, index) => index + 1),
)

// ---- 迁移只追加：v1 的四个仓库是历史事实，任何改写都会让老用户的库升不上来 ----
check('v1 迁移保持历史四张表不变', [...storesOf(1)].sort(), ['custom_tasks', 'daily_meals', 'day_plans', 'users'])
check('v2 迁移只新增三张选项表', [...storesOf(2)].sort(), ['exercise_options', 'food_options', 'supplement_templates'])
check(
  'v3 迁移新增三张每日内容表',
  [...storesOf(3)].sort(),
  ['daily_exercise_items', 'daily_meal_items', 'daily_supplements'],
)
check('v4 迁移新增休息日家务表', [...storesOf(4)].sort(), ['routine_tasks'])
<<<<<<< HEAD
check('v5 不新增仓库（只把登录名从 email 换成 username）', [...storesOf(5)].sort(), [])
check('v6 只新增两张设备状态表（同步队列与同步状态）', [...storesOf(6)].sort(), ['sync_outbox', 'sync_state'])
// v7 不动结构：`sync_state` 的 `keyPath` 一直是 `id`、本来就没有索引，只是**含义**从
// 「设备级单行」变成了「本地账号 id」。所以这一版只有搬迁函数，没有新仓库。
check('v7 不新增仓库（只把 sync_state 的归属从设备改成本地账号）', [...storesOf(7)].sort(), [])
check(
  'v8 只新增五张旧身份隔离与工作区状态仓库',
  [...storesOf(8)].sort(),
  ['legacy_outbox', 'legacy_sync_state', 'legacy_users', 'workspace_migrations', 'workspace_state'],
)
=======
>>>>>>> origin/main

// ---- 已有数据的版本必须带搬迁函数：只建表不搬数据，老用户的自由文本会被静默丢掉 ----
check('v3 迁移带数据搬迁函数', typeof migrations[3].migrate, 'function')
check('v1 / v2 只建表、不做数据搬迁', migrationVersions.slice(0, 2).map((key) => migrations[key].migrate ?? null), [null, null])
check('v4 只建表、不做数据搬迁', migrations[4].migrate ?? null, null)
<<<<<<< HEAD
check('v5 迁移带数据搬迁函数', typeof migrations[5].migrate, 'function')
// v6 建的是两张空表，从空开始就是正确状态（见 localDb.ts 的 MIGRATIONS[6] 注释）：
// 老用户升级后不该凭空多出待上传项——历史数据要上云必须由人点「本地上传云端」。
check('v6 只建表、不做数据搬迁', migrations[6].migrate ?? null, null)
check('v7 迁移带数据搬迁函数（sync_state 重新归属）', typeof migrations[7].migrate, 'function')
check('v8 迁移带旧身份隔离函数', typeof migrations[8].migrate, 'function')

// ---- v7 搬迁规则本身（纯函数，S4 补丁 ②）----
// 为什么要在这里逐条钉死：这条规则错了的症状是「换个账号登录就看到别人的云端绑定」，
// 只有真机上换账号才会暴露——而那时数据已经被推到别人的云端账号里了。
// 规则写成纯函数（`rekeySyncStateRows`）就是为了能在 Node 里把四种情形全覆盖。
check(
  'v7 把 sync_state 的行重新归属到登录中的本地账号，并删掉旧主键那一行',
  rekeySyncStateRows([{ id: 'singleton', enabled: true, cloud_email: 'a@b.c' }], 'local-a'),
  { put: [{ id: 'local-a', enabled: true, cloud_email: 'a@b.c' }], remove: ['singleton'] },
)
check(
  'v7 对已经归属正确的行不做任何改动（幂等，升级中途被打断后重跑也安全）',
  rekeySyncStateRows([{ id: 'local-a', enabled: true }], 'local-a'),
  { put: [], remove: [] },
)
check(
  'v7 升级时没人登录就删掉那一行（无归属的绑定不可用，留着会被下一个账号读到）',
  rekeySyncStateRows([{ id: 'singleton', enabled: true }], null),
  { put: [], remove: ['singleton'] },
)
check('v7 空表搬迁是空操作', rekeySyncStateRows([], 'local-a'), { put: [], remove: [] })

// ---- v8 真正调用搬迁函数：归档旧身份与上传意图，不接触业务 owner ----
const migrationTime = '2026-10-11T00:00:00.000Z'
const oldUser = { id: 'local-a', username: 'old-name', password_hash: 'old-hash', created_at: migrationTime }
const oldState = { id: 'local-a', enabled: true, cloud_user_id: 'old-cloud', device_id: 'old-device', updated_at: migrationTime }
const oldOutbox = { id: 'outbox-a', seq: 1, store: 'day_plans', record_id: 'plan-a', op: 'upsert', local_user_id: 'local-a', created_at: migrationTime, attempts: 0, last_error: null }
const migrationData = new Map([
  ['users', [{ ...oldUser }]],
  ['sync_state', [{ ...oldState }]],
  ['sync_outbox', [{ ...oldOutbox }]],
  ['legacy_users', []],
  ['legacy_sync_state', []],
  ['legacy_outbox', []],
])
const migrationRequests = []
const migrationStoresRead = new Set()
const deletedUserIndexes = []
const clearedStores = []
migrations[8].migrate({
  objectStore(name) {
    migrationStoresRead.add(name)
    return {
      indexNames: { contains: (index) => name === 'users' && ['username', 'email'].includes(index) },
      deleteIndex: (index) => deletedUserIndexes.push(index),
      getAll() {
        const request = { result: migrationData.get(name).map((row) => ({ ...row })), onsuccess: null }
        migrationRequests.push(request)
        return request
      },
      put: (row) => migrationData.get(name).push(row),
      clear() {
        clearedStores.push(name)
        migrationData.set(name, [])
      },
    }
  },
})
for (const request of migrationRequests) request.onsuccess()
check('v8 删除 users 的两种旧登录索引', deletedUserIndexes.sort(), ['email', 'username'])
check('v8 清空三个活跃旧身份与上传状态仓库', clearedStores.sort(), ['sync_outbox', 'sync_state', 'users'])
const archivedUser = migrationData.get('legacy_users')[0]
check('v8 旧账号资料已归档且保留旧 owner', [archivedUser.id, archivedUser.username, archivedUser.created_at], [oldUser.id, oldUser.username, oldUser.created_at])
check('v8 旧账号归档不保留密码字段', Object.keys(archivedUser).sort(), ['created_at', 'id', 'isolated_at', 'username'])
check('v8 旧云端绑定与队列归属仅进入隔离仓库', [
  migrationData.get('legacy_sync_state')[0].cloud_user_id,
  migrationData.get('legacy_outbox')[0].local_user_id,
], ['old-cloud', 'local-a'])
check('v8 三种归档共用有效隔离时间', [
  archivedUser.isolated_at,
  migrationData.get('legacy_sync_state')[0].isolated_at,
  migrationData.get('legacy_outbox')[0].isolated_at,
].every((value) => value === archivedUser.isolated_at && Number.isFinite(Date.parse(value))), true)
check(
  'v8 搬迁不访问业务数据或自动归属工作区',
  [...migrationStoresRead].sort(),
  ['legacy_outbox', 'legacy_sync_state', 'legacy_users', 'sync_outbox', 'sync_state', 'users'],
)

// ---- 仓库三分类（S2）：用户数据 / 元数据 / 设备状态，三者互不交叉且合起来就是全部仓库 ----
// 拆开的动机是 `sync_outbox` / `sync_state` 不能混进备份与同步队列；漏分类一张表，
// 要么它悄悄进了备份文件，要么它悄悄进了推送队列，两种都是数据事故。
check('数据库共 18 张对象仓库', storeNames.length, 18)
check('用户数据仓库 10 张（进备份、进同步）', USER_DATA_STORES.length, 10)
check('元数据仓库只有 users', META_STORES, ['users'])
check('设备状态仓库七张', [...DEVICE_STORES].sort(), [
  'legacy_outbox', 'legacy_sync_state', 'legacy_users', 'sync_outbox', 'sync_state', 'workspace_migrations', 'workspace_state',
])
check(
  '三分类互不交叉',
  [
    ...USER_DATA_STORES.filter((store) => META_STORES.includes(store)),
    ...USER_DATA_STORES.filter((store) => DEVICE_STORES.includes(store)),
    ...META_STORES.filter((store) => DEVICE_STORES.includes(store)),
  ],
  [],
)
check(
  '三分类合起来覆盖全部仓库',
  [...USER_DATA_STORES, ...META_STORES, ...DEVICE_STORES].sort(),
  storeNames,
)
check('三分类清单与数据库仓库清单同源', [...ALL_STORES].sort(), storeNames)
check('每张仓库都有字段契约（含设备状态表）', [...SCHEMA_STORES].sort(), storeNames)

// ---- 设备状态表的索引：seq 给批次稳定排序，store_record 是压缩用的复合键 ----
const outboxDefinition = stores.find((store) => store.name === 'sync_outbox')
check(
  'sync_outbox 有 seq 与 store_record 两个索引',
  (outboxDefinition?.indexes ?? []).map((index) => index.name).sort(),
  ['seq', 'store_record'],
)
check(
  'sync_outbox 的 store_record 是 [store, record_id] 复合索引',
  outboxDefinition?.indexes?.find((index) => index.name === 'store_record')?.keyPath,
  ['store', 'record_id'],
)
check(
  'sync_state 按统一 Auth UID 分行（主键 id，无索引）',
  [stores.find((store) => store.name === 'sync_state')?.keyPath, (stores.find((store) => store.name === 'sync_state')?.indexes ?? []).length],
  ['id', 0],
)
=======
>>>>>>> origin/main

// ---- 定义与迁移必须一一对应，防止「加了 STORES 忘了 MIGRATIONS」这类漏项 ----
check('迁移表覆盖的仓库与 STORES 清单完全一致', [...new Set(migratedNames)].sort(), storeNames)
check('每个仓库只在一个版本里引入', migratedNames.length, new Set(migratedNames).size)
check('所有仓库的主键都是 id', [...new Set(stores.map((store) => store.keyPath))], ['id'])

<<<<<<< HEAD
// ---- users 只存经 Auth 验证的资料，不再有本地登录名索引 ----
const usersStore = stores.find((store) => store.name === 'users')
check('users 不再保留 email / username 登录索引', usersStore?.indexes ?? [], [])

=======
>>>>>>> origin/main
// ---- 按 user_id 隔离的三张选项表必须带 user_id 索引，否则靠 getAll 全表扫 ----
for (const name of storesOf(2)) {
  const definition = stores.find((store) => store.name === name)
  const indexNames = (definition?.indexes ?? []).map((index) => index.name)
  check(`${name} 带有 user_id 索引`, indexNames.includes('user_id'), true)
}

// ---- 三张每日内容表按父记录查，必须带父键索引，否则每读一天都要全表扫 ----
for (const [name, index] of [
  ['daily_meal_items', 'daily_meal_id'],
  ['daily_supplements', 'day_plan_id'],
  ['daily_exercise_items', 'day_plan_id'],
  ['routine_tasks', 'day_plan_id'],
]) {
  const definition = stores.find((store) => store.name === name)
  const indexNames = (definition?.indexes ?? []).map((item) => item.name)
  check(`${name} 带有 ${index} 索引`, indexNames.includes(index), true)
}

// ---- 写入必须先过字段契约（L5 加固）：绕过 localDb 的 put / runTransaction，坏数据就再也拦不住 ----
const localDbSource = readFileSync(join(PROJECT_ROOT, 'src/services/local/localDb.ts'), 'utf8')
<<<<<<< HEAD
function functionBody(source, name) {
  const declaration = new RegExp(`(?:^|\\n)(?:export )?(?:async )?function ${name}\\b`)
  const match = declaration.exec(source)
  if (!match) return ''
  const start = match.index + (source[match.index] === '\n' ? 1 : 0)
  const rest = source.slice(start)
  const next = /\n(?:export )?(?:async )?function \w+\b/.exec(rest)
  return next ? rest.slice(0, next.index) : rest
}
const atomicBody = functionBody(localDbSource, 'atomicReadWrite')
check(
  'put 将单条记录交给共享事务入口校验',
  /await runTransaction\(\{ put: \[\{ store: storeName, value \}\] \}, options\)/.test(functionBody(localDbSource, 'put')),
  true,
)
check(
  '共享原子事务对每条待写记录先 assertRecord',
  /for \(const item of work\.put \?\? \[\]\) assertRecord\(item\.store, item\.value\)/.test(atomicBody),
  true,
)

// ---- 写入钩子（S2）：三个写入口都必须把变更记进 outbox ----
// 四个入口经共享 atomicReadWrite 入队；分别检查委托链，避免仅数 writeOutbox 字符串。
check('remove 将单条删除交给共享事务入口', /await runTransaction\(\{ remove: \[\{ store: storeName, id \}\] \}, options\)/.test(functionBody(localDbSource, 'remove')), true)
check('runTransaction 经 atomicReadWrite 保留完整事务工作', /await atomicReadWrite\(\{[\s\S]*read: async \(\) => work,[\s\S]*build: \(snapshot\) => snapshot/.test(functionBody(localDbSource, 'runTransaction')), true)
check('readModifyWrite 经 atomicReadWrite 返回同一记录写入', /await atomicReadWrite\(\{[\s\S]*stores: \[\.\.\.input\.stores, input\.writeStore\][\s\S]*const next = input\.build\(existing\)[\s\S]*return \{ put: \[\{ store: input\.writeStore, value: next \}\] \}/.test(functionBody(localDbSource, 'readModifyWrite')), true)
check('共享 readwrite 事务包含队列仓库并将同一事务传给 writeOutbox', atomicBody.includes("'sync_outbox'") && atomicBody.includes("db.transaction(names, 'readwrite')") && atomicBody.includes('writeOutbox(transaction, entries, input.guard)'), true)
// 校验必须发生在**写入请求发出之前**：事务中途抛错时事务会照常提交，
// 结果就是「数据写了、队列没记」——正是这个钩子要防的事。
// （S4 补丁 ① 之前这里写的是「事务外」；`readModifyWrite` 的读必须与写在同一个事务里，
//   所以判据从「在事务外」收紧成「在任何写入请求之前」，语义不变、约束更强。）
check(
  '队列记录先过 sync_outbox 字段契约，再发写入请求',
  /function buildOutboxEntries[\s\S]{0,700}?assertRecord\('sync_outbox', entry\)/.test(localDbSource),
  true,
)
check(
  'outbox 记录只带引用（store + record_id + op），不存数据副本',
  /const entry: OutboxEntry = \{[\s\S]{0,320}?op: change\.op/.test(localDbSource) &&
    !/payload/.test(localDbSource),
  true,
)
// `clear` 删的是整张表，语义上不属于「某条记录变了」。若按 track:true 放行，
// 云端永远收不到这批删除（本地表空了、队列里一条都没有），所以要求显式 track:false。
check(
  '清空用户数据仓库时必须显式 track:false（不静默漏记一批删除）',
  /if \(input\.track \?\? true\) \{[\s\S]*for \(const store of work\.clear \?\? \[\]\) \{\s*if \(isSyncableStore\(store\)\) throw new Error\(/.test(atomicBody),
  true,
)

// v5 的三条判据：老记录原样沿用老邮箱当账号（不截断）、旧索引真的删掉、新索引真的建上。
// 任何一条漏掉，老用户都会「升级完就登不进去」或者库结构和新代码对不上。
check('v5 迁移原样沿用老邮箱作为账号', localDbSource.includes("username: (row.email ?? '').trim()"), true)
check('v5 迁移删掉旧的 email 唯一索引', localDbSource.includes("deleteIndex('email')"), true)
check('v5 迁移建立 username 唯一索引', localDbSource.includes("createIndex('username', 'username', { unique: true })"), true)
check(
  'v7 历史迁移从旧会话读取归属，不误读新 Auth 会话',
  /function rekeySyncStateByLocalUser[\s\S]{0,600}?rekeySyncStateRows\([\s\S]{0,200}?readLegacySession\(\)\?\.user\.id \?\? null/.test(
    localDbSource,
  ),
  true,
)

// ---- 改造 ①：读-改-写必须在同一个事务里 ----
// 这是「休息日注册后报 Unable to add key to index 'user_date'」的根因：
// 读与写被拆成两次调用，两个并发调用同时读到「不存在」，各建一条、各生成一个 id，
// 第二条撞唯一索引。修法不是加锁，而是把读和写放进同一个 readwrite 事务——
// IndexedDB 会让同一对象仓库上的两个 readwrite 事务串行执行。
check(
  '共享事务先读、再算、再校验业务与队列，最后才发写入请求',
  /snapshot = await input\.read\(transactionReader\(transaction, input\.guard\)\)[\s\S]*const work = input\.build\(snapshot\)[\s\S]*assertRecord\(item\.store, item\.value\)[\s\S]*const entries = buildOutboxEntries\(tracked, owner\)[\s\S]*transaction\.objectStore\(store\)\.clear\(\)[\s\S]*transaction\.objectStore\(item\.store\)\.delete\(item\.id\)[\s\S]*transaction\.objectStore\(item\.store\)\.put\(item\.value\)[\s\S]*writeOutbox\(transaction, entries, input\.guard\)/.test(atomicBody),
  true,
)
check('共享事务的校验、身份或请求失败会显式 abort', /const abort = \(reason: unknown\) => \{[\s\S]*transaction\.abort\(\)/.test(atomicBody) && /\}\)\(\)\.catch\(abort\)/.test(atomicBody), true)
const dayPlanSource = readFileSync(join(PROJECT_ROOT, 'src/services/local/dayPlanService.ts'), 'utf8')
const upsertBody = functionBody(dayPlanSource, 'upsertDayPlan')
check('upsertDayPlan 的读-改-写走 readModifyWrite（同一个事务）', /readModifyWrite<DayPlan>\(\{/.test(upsertBody), true)
check(
  'upsertDayPlan 按 user_date 唯一索引读，不再先全表找再写',
  /getByIndex<DayPlan>\('day_plans', 'user_date', \[uid, planDate\]\)/.test(upsertBody) &&
    !upsertBody.includes('plansForUser'),
  true,
)
// 同一形状的第二个落点：`daily_meals` 的 `plan_type` 也是唯一索引，
// 「勾一下吃没吃」同样是读-改-写。只修一处等于把同一个坑留在隔壁。
check(
  'setMealCompleted 在 mutateDayPlan 的同一事务里读取餐次并复用已有主键',
  /return mutateDayPlan\(planDate, \['daily_meals'\], async \(reader, plan\) => \{[\s\S]*await mealsForPlan\(reader, plan\.id\)[\s\S]*const existing = rows\.find[\s\S]*id: existing\?\.id \?\? newId\(\)/.test(functionBody(dayPlanSource, 'setMealCompleted'))
    && /await atomicReadWrite\(\{[\s\S]*read: async \(reader\) => \{[\s\S]*await prepare\(reader, plan, context\.owner\)/.test(functionBody(dayPlanSource, 'mutateDayPlan')),
  true,
)

// ---- 账号规则只写一遍：服务层必须从共享模块取校验，不能各自手写一份 ----
// 门面与 Auth 会话都用同一套账号规则；本地资料服务不再参与认证。
const ruleSources = ['src/services/api/authService.ts', 'src/services/sync/authSession.ts']
check(
  '认证门面与 Auth 会话使用共享账号规则',
  ruleSources.filter((file) => readFileSync(join(PROJECT_ROOT, file), 'utf8').includes('shared/authRules')).length,
  ruleSources.length,
)

/**
 * 直接调 `objectStore().put/add/delete/clear` 的地方：这些写入既绕过 `assertRecord`，
 * 也绕过 S2 的入队钩子——写成功了却不在待上传队列里，云端永远不知道这条改动。
 * 所以四类写操作一起扫（`clear` 尤其危险：一次清掉整表却一条记录都不留）。
 */
const WRITE_CALL = /objectStore\([^)]*\)\s*\.\s*(put|add|delete|clear)\s*\(/
const directWrites = walk(join(PROJECT_ROOT, 'src'))
  .filter((file) => !file.endsWith('localDb.ts'))
  .filter((file) => WRITE_CALL.test(readFileSync(file, 'utf8')))
  .map((file) => relative(PROJECT_ROOT, file))
check('除 localDb.ts 外没有绕过契约校验与入队钩子的直接写库', directWrites, [])
=======
check(
  'put 在任何写入请求之前调用 assertRecord',
  /export async function put[\s\S]{0,240}?\n\s*assertRecord\(/.test(localDbSource),
  true,
)
check(
  'runTransaction 对每条待写记录先 assertRecord',
  /export async function runTransaction[\s\S]{0,1400}?for \(const item of work\.put \?\? \[\]\) assertRecord\(/.test(localDbSource),
  true,
)

/** 直接调 objectStore().put/add 的地方：这些写入绕过了 assertRecord。 */
const directWrites = walk(join(PROJECT_ROOT, 'src'))
  .filter((file) => !file.endsWith('localDb.ts'))
  .filter((file) => /objectStore\([^)]*\)\s*\.\s*(put|add)\s*\(/.test(readFileSync(file, 'utf8')))
  .map((file) => relative(PROJECT_ROOT, file))
check('除 localDb.ts 外没有绕过契约校验的直接写库', directWrites, [])
>>>>>>> origin/main

// ---- 界面层不得直接碰数据库：页面只能经 src/services/ ----
function walk(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full)
  }
  return found
}

const uiFiles = [...walk(join(PROJECT_ROOT, 'src/app')), ...walk(join(PROJECT_ROOT, 'src/features'))]
check('界面层存在可扫描的源文件', uiFiles.length > 0, true)

/**
 * 取出一份源码里所有「值导入」的模块路径。
 *
 * `import type ...` 编译后被完全擦除，不产生运行时耦合，所以先排除；剩下的才是真会执行的依赖。
 * 这里不能用逐行过滤：多行 type 导入的 `from '...'` 落在单独一行上，逐行过滤会漏掉它。
 */
function runtimeImportPaths(source) {
  return [...source.matchAll(/import\s+(?!type\b)[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
}

const dbLeaks = uiFiles
  .filter((file) => {
    const source = readFileSync(file, 'utf8')
    const hitsLocalDb = runtimeImportPaths(source).some((path) => /(^|\/)localDb$/.test(path))
    return hitsLocalDb || /\bindexedDB\b/.test(source)
  })
  .map((file) => relative(PROJECT_ROOT, file))
check('界面层没有直接引用 localDb / indexedDB', dbLeaks, [])

/**
 * 界面层不得直接引用云端 SDK。
 *
 * 判据是「真的引用了」而不是「提到过」：界面文案里出现产品名属于正常表达
 * （例如云端模式下解释备份为什么不可用），把它当违规只会逼着文案绕着写。
 * 真正要挡的是 import 云端 SDK、以及直接调用 `supabase.xxx()` 这类用法。
 */
const cloudLeaks = uiFiles
  .filter((file) => {
    const source = readFileSync(file, 'utf8')
    return (
      /from\s+['"]@supabase/.test(source) ||
      /\bsupabase\s*\./.test(source) ||
      /\brequireSupabase\b/.test(source) ||
      /\/services\/cloud\//.test(source)
    )
  })
  .map((file) => relative(PROJECT_ROOT, file))
check('界面层没有直接引用 supabase', cloudLeaks, [])

// ---- 示例选项属于服务层数据，不能写死在页面逻辑里（docs/05 L1 验收）----
<<<<<<< HEAD
// L6 起清单提到 `src/services/optionExamples.ts`，播种只读它；
// S4-T7 删掉云端适配器后，消费者只剩本地播种（`local/optionSeed.ts`）一处。
=======
// L6 起清单提到 `src/services/optionExamples.ts`，由本地与云端两套适配器共用；
// 本地播种（local/optionSeed.ts）与云端播种（cloud/optionSeed.ts）都只是读取它。
>>>>>>> origin/main
const seedSource = readFileSync(join(PROJECT_ROOT, 'src/services/optionExamples.ts'), 'utf8')
const seedNames = [...seedSource.matchAll(/'([^'\n]+)'/g)]
  .map((match) => match[1])
  .filter((value) => /[\u4e00-\u9fa5]/.test(value))
check('示例选项清单非空且可被扫描', seedNames.length >= 10, true)

const hardcoded = []
for (const file of uiFiles) {
  const source = readFileSync(file, 'utf8')
  for (const name of seedNames) {
    if (source.includes(name)) hardcoded.push(`${relative(PROJECT_ROOT, file)} → ${name}`)
  }
}
check('界面层没有写死任何示例选项名称', hardcoded, [])

console.log('')
console.log(`结果：${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  console.log('未通过：')
  failures.forEach((item) => console.log(`  - ${item.name}`))
  process.exitCode = 1
}
