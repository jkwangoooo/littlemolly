#!/usr/bin/env node
// 数据层一致性回归：门面 / 页面接口清单 / 同步传输层 / 云端 SQL 四者的对应关系。
//
// 用法：npm run check:cloud-parity
//
// **这个脚本守的东西换过两次。**
//
// 旧职责（L6）：守住「为本地服务实现等价的 Supabase 适配器，不改页面业务接口」——
// 门面按构建模式在两种后端之间机械切换，所以要断言 `@backend` 只出现在门面目录。
//
// 中间职责（S1–S4）：页面只走本地实现，云端是同步层的传输通道（S3 起），
// 但仍要求契约上的名字在 `cloud/` 下也有等价实现，用来守住那批适配器身上的字段映射。
//
// 现职责（S4-T7+）：那批 L6 适配器已整批删除——**云端不是后端，是上行通道**。
// 「云端有没有等价实现」从此不是个有意义的问题。断言分成九组：
//
//   1. 页面接口清单里的每个名字，本地实现与四个门面都真的导出；
//   2. 云端目录只剩同步传输层四个模块（L6 适配器不许悄悄长回来）；
//   3. 页面不绕过门面直连 `services/local`；
//   4. 门面**整份转发本地实现**，且 `@backend` 别名彻底消失；
//   5. Supabase 环境变量只有一处来源，旧 `backend.ts` 已删除；
//   6. 引用 `services/cloud` 的只允许是 `services/sync/`，且同步门面必须是动态
//      import（否则 supabase 会悄悄进主 chunk）；
//   7. 云端 SQL 覆盖全部本地对象仓库、RLS 与策略、历史日期触发器、外键策略、
//      以及每张表的服务端 `updated_at`（`docs/18 §5.4` 的 LWW 依据）；
//   8. 示例选项清单只有一份，播种只读它；
//   9. **列级对齐**（S4-T6）：本地字段契约 → 云端列。表名对得上不代表推得动，
//      「本地有一个字段、云端没有这一列」会让 PostgREST 直接 400，
//      而症状是「推送失败、队列堆积、本地一切正常」，极难倒查。
//  10. **双向整体替换的 SQL**（S5）：三个 RPC 都是 `security invoker`、
//      三处历史日期豁免**写在日期比较之前**、豁免用 `set local` 打开、
//      快照逐字段构造（不含云端独有列，否则 `parseBackup` 整份拒绝）。
//
// 全部是静态检查，不需要浏览器、不需要构建产物。

import './ts-resolve.mjs'

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

function read(path) {
  return readFileSync(join(PROJECT_ROOT, path), 'utf8')
}

function walk(dir) {
  const found = []
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full)
  }
  return found
}

const { CONTRACT_KEYS } = await import('../src/services/contracts.ts')
const { LOCAL_SCHEMA } = await import('../src/services/local/localDb.ts')
const { DEVICE_STORES, RECORD_SCHEMAS, SCHEMA_STORES, USER_DATA_STORES } = await import(
  '../src/services/local/recordSchemas.ts'
)
/** 数据库里的全部仓库（13 张），用来断言「三分类覆盖了每一张表」。 */
const allLocalStores = LOCAL_SCHEMA.stores.map((store) => store.name)

/** 云端目录与同步目录的绝对路径，第 2 / 6 组都要用，所以在这里取一次。 */
const cloudDir = join(PROJECT_ROOT, 'src/services/cloud')
const syncDir = join(PROJECT_ROOT, 'src/services/sync')

// ---- 1. 页面接口清单：每个名字本地实现与门面都必须真的导出 ----

/**
 * 清单分组名 → 模块文件名。本地实现（`local/`）与门面（`api/`）同名，
 * 这是「门面机械转发本地」这条约定的前提，第 4 组会断言转发本身。
 *
 * **S4-T7 起这里不再有云端一列。** 旧版要求同一批名字在 `cloud/` 下也有等价实现，
 * 那批 L6 适配器已经整批删除（见第 2 组）——云端不再是后端，而是上行通道。
 */
const BACKENDS = {
  auth: 'authService',
  dayPlan: 'dayPlanService',
  option: 'optionService',
  backup: 'backupService',
}

check('契约覆盖四个模块', Object.keys(CONTRACT_KEYS).sort(), Object.keys(BACKENDS).sort())

for (const [group, file] of Object.entries(BACKENDS)) {
  const localPath = `src/services/local/${file}.ts`
  const facadePath = `src/services/api/${file}.ts`
  check(`${file}：本地实现存在`, existsSync(join(PROJECT_ROOT, localPath)), true)
  check(`${file}：门面存在`, existsSync(join(PROJECT_ROOT, facadePath)), true)

  const localSource = read(localPath)
  const facadeSource = read(facadePath)
  const missingInLocal = CONTRACT_KEYS[group].filter(
    (name) => !new RegExp(`export\\s+(async\\s+)?(function\\s+|const\\s+|let\\s+)?${name}\\b`).test(localSource),
  )
  check(`${file}：清单里的每个名字本地都导出了`, missingInLocal, [])
  // 门面整份转发本地实现，「清单上的名字页面拿得到」才是结构性成立的。
  // 若有人把门面改成手写子集，这条会红——那正是 S1 之后的约定所禁止的写法。
  check(
    `${file}：门面整份转发本地实现`,
    /export\s+\*\s+from\s+'\.\.\/local\//.test(facadeSource),
    true,
  )
}

// ---- 2. 云端目录只剩同步传输层（S4-T7 的清理不能被悄悄回退）----
//
// L6 留下的那批页面后端适配器——`authService` / `dayPlanService` / `optionService` /
// `backupService` / `optionSeed` / `types` / `syncTestRecordService` / `parity`——
// 在 S4-T7 整批删除：页面只走本地，它们没有任何消费者，留着只会让
// 「云端是不是另一个后端」这件事继续含混，也让人以为改本地签名要同步改云端。
//
// 这一组把清理结果钉住：将来谁想加回一个「云端 xxxService」，必须同时改这条断言，
// 也就必须回答「它到底服务谁」。四个保留模块各自有明确消费者（都在 `services/sync/`）：
// `supabase.ts` 建客户端、`errors.ts` 归一错误、`identity.ts` 账号名→合成邮箱、
// `rpc.ts` 调 RPC 与计数。
const CLOUD_TRANSPORT_MODULES = ['errors.ts', 'identity.ts', 'rpc.ts', 'supabase.ts']
const CLOUD_LEGACY_ADAPTERS = [
  'authService.ts',
  'dayPlanService.ts',
  'optionService.ts',
  'backupService.ts',
  'optionSeed.ts',
  'types.ts',
  'syncTestRecordService.ts',
  'parity.ts',
]

check(
  '云端目录只剩同步传输层四个模块',
  readdirSync(cloudDir).filter((name) => name.endsWith('.ts')).sort(),
  CLOUD_TRANSPORT_MODULES,
)
check(
  'L6 遗留的页面后端适配器已删除',
  CLOUD_LEGACY_ADAPTERS.filter((name) => existsSync(join(cloudDir, name))),
  [],
)

// ---- 3. 页面只能经门面取数：界面层不得直接引用 services/local ----

const uiFiles = [...walk(join(PROJECT_ROOT, 'src/app')), ...walk(join(PROJECT_ROOT, 'src/features'))]
check('界面层存在可扫描的源文件', uiFiles.length > 0, true)

const bypass = uiFiles
  .filter((file) => /from\s+['"][^'"]*services\/local\//.test(readFileSync(file, 'utf8')))
  .map((file) => relative(PROJECT_ROOT, file))
check('界面层没有绕过门面直连 services/local', bypass, [])

// ---- 4. 门面直连本地实现，且 @backend 别名已彻底移除 ----
//
// 旧模型里门面写 `from '@backend/xxx'`，由 vite.config.ts 的相对替换决定指向。
// S1 起门面直接写 `../local/xxx`：只有一个后端可选，别名与它带来的
// 「引用位置一变就指错」的问题一起消失。这里断言它真的没了，
// 免得有人凭记忆又把别名加回去。

for (const file of Object.values(BACKENDS)) {
  const facadePath = `src/services/api/${file}.ts`
  check(`门面 ${file} 存在`, existsSync(join(PROJECT_ROOT, facadePath)), true)
  const facadeSource = read(facadePath)
  check(`门面 ${file} 直连本地实现`, new RegExp(`export \\* from '\\.\\./local/${file}'`).test(facadeSource), true)
  check(
    `门面 ${file} 同时放行值与类型导出`,
    new RegExp(`export type \\* from '\\.\\./local/${file}'`).test(facadeSource),
    true,
  )
}

// 注释里提到 `@backend` 是允许的（门面注释解释了为什么去掉它），
// 这里只挡真正的 import 说明符。
const aliasLeft = walk(join(PROJECT_ROOT, 'src'))
  .filter((file) => /from\s+['"]@backend\//.test(readFileSync(file, 'utf8')))
  .map((file) => relative(PROJECT_ROOT, file))
check('@backend 别名已彻底移除', aliasLeft, [])

check('vite.config.ts 不再配置 resolve.alias', /resolve\s*:\s*\{[\s\S]*?alias/.test(read('vite.config.ts')), false)

// ---- 5. 环境变量只有一处来源 ----
//
// 变量名写两遍就会改一处漏一处，而漏掉的那处会在真实部署时才暴露。
// `capabilities.ts` 是唯一允许读这两个变量的源码文件；`cloud/supabase.ts` 从它取值。
// 只看**真实读取**（`import.meta.env.XXX` 或经由 `ENV.` 前缀），
// 不把错误提示文案里出现的变量名算进来。

const SUPABASE_ENV_READ = /(?:import\.meta\.env|ENV)\.VITE_SUPABASE_(?:URL|ANON_KEY)/
const envReaders = walk(join(PROJECT_ROOT, 'src'))
  .filter((file) => SUPABASE_ENV_READ.test(readFileSync(file, 'utf8')))
  .map((file) => relative(PROJECT_ROOT, file))
check('只有 capabilities.ts 读 Supabase 环境变量', envReaders.filter((file) => !/capabilities\.ts$/.test(file)), [])
check('capabilities.ts 确实是读环境变量的那一处', envReaders.some((file) => /capabilities\.ts$/.test(file)), true)
check('云端客户端从能力声明取值，不自己再读一遍', /from\s+'\.\.\/capabilities'/.test(read('src/services/cloud/supabase.ts')), true)
check('能力声明模块存在', existsSync(join(PROJECT_ROOT, 'src/services/capabilities.ts')), true)
check('旧的 backend.ts 已删除', existsSync(join(PROJECT_ROOT, 'src/services/backend.ts')), false)

// ---- 6. 云端适配器只被同步层引用，且同步层是懒加载的 ----
//
// S1 时这条断言是「除云端目录自身，没有任何模块引用 services/cloud」——
// 那时云端是冻结的种子，没人碰它，所以本地产物里天然不含 supabase。
//
// S3 起云端适配器重新有了消费者：`services/sync/` 的绑定与探测要连云端。
// 于是判据换成**两层**：
//
//   a. 引用 `services/cloud` 的只允许是 `services/sync/`（界面层、本地层一律不许）；
//   b. `services/sync/` 本身经 `api/syncService.ts` 的 `await import()` 懒加载，
//      所以「未配置云端时不下载 supabase chunk」仍然成立——
//      只是从「没人引用」变成了「引用它的那条路径按需加载」。
//
// b 的产物侧证据由 `verify:local` 的零跨域请求断言兜底；这里守住
// 「门面没有退化成静态转发」这条结构约束。
//
// 产物形状（S4 实测）：supabase 现在是自己一个 chunk，`accountLink` 与
// `pushQueue` 共用它（S3 时它还整个打在 `accountLink` 里，因为那时只有那一个消费者）。
// 主 chunk 里只会出现它的**文件名**——那是 Vite 给动态 import 生成的预载表，
// 不是把库打了进去；判断时别看 `grep supabase`，要看有没有 `supabase-*.js` 之外的命中。

const cloudLeaks = walk(join(PROJECT_ROOT, 'src'))
  .filter((file) => !file.startsWith(cloudDir) && !file.startsWith(syncDir))
  .filter((file) => /from\s+['"][^'"]*\/cloud\//.test(readFileSync(file, 'utf8')))
  .map((file) => relative(PROJECT_ROOT, file))
check('除同步层与云端目录自身，没有模块引用 src/services/cloud', cloudLeaks, [])

const syncUsesCloud = walk(syncDir).filter((file) =>
  /from\s+['"][^'"]*\/cloud\//.test(readFileSync(file, 'utf8')),
)
check('同步层确实经由 cloud 目录访问云端', syncUsesCloud.length > 0, true)

// 门面一旦写成静态转发（`export * from '../sync/accountLink'`），supabase 就会被
// 打进主 chunk，而 typecheck / lint / 构建**都不会报错**——只有这条断言看得见。
//
// 先剥掉块注释再判断：这个文件自己的注释里就写着那个「反例」写法作为警示，
// 不剥的话断言会被注释喂成假失败（实际踩过一次）。
const syncFacade = read('src/services/api/syncService.ts').replace(/\/\*[\s\S]*?\*\//g, '')
check(
  '同步门面用动态 import 取实现，不静态转发',
  /await\s+import\(/.test(syncFacade) && !/export\s+\*\s+from\s+['"]\.\.\/sync\//.test(syncFacade),
  true,
)

// ---- 7. 云端 SQL 必须覆盖本地全部对象仓库 ----

const migrationDir = join(PROJECT_ROOT, 'database/migrations')
const migrationFiles = readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()
check('迁移文件都以 12 位时间前缀命名', migrationFiles.filter((name) => !/^\d{12}_/.test(name)), [])
check('迁移文件不少于四批（stage1-stage4）', migrationFiles.length >= 4, true)
const migrationSql = migrationFiles.map((name) => read(`database/migrations/${name}`)).join('\n')

/** 仓库名 → 云端表名。`users` 是本地概念，云端由 Supabase Auth 管理，档案落在 profiles。 */
const TABLE_OF_STORE = { users: 'profiles' }
/**
 * 只有**用户数据 + 元数据**仓库需要在云端有表。
 * `sync_outbox` / `sync_state` 是本机状态（S2 新增），云端没有、也不该有对应表——
 * 待上传队列属于某台设备，同步状态属于「这台设备与哪个云端账号绑定」，
 * 两者上传云端都没有意义。所以这里用 `SCHEMA_STORES` 去掉设备仓库，
 * 而不是 `LOCAL_SCHEMA.stores`（那是数据库里的全部 13 张表）。
 */
const stores = SCHEMA_STORES.filter((store) => !DEVICE_STORES.includes(store))
check('本地有 10 张用户数据表 + 1 张元数据表', stores.length, 11)
check(
  '云端覆盖的仓库 = 数据库全部仓库去掉设备状态',
  [...allLocalStores].filter((store) => !DEVICE_STORES.includes(store)).sort(),
  [...stores].sort(),
)
const missingTables = stores
  .map((store) => TABLE_OF_STORE[store] ?? store)
  .filter((table) => !new RegExp(`create table if not exists public\\.${table}\\b`).test(migrationSql))
check('每个本地用户数据仓库在云端都有对应表', missingTables, [])

const withoutRls = stores
  .map((store) => TABLE_OF_STORE[store] ?? store)
  .filter((table) => !new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(migrationSql))
check('每张云端表都启用了 RLS', withoutRls, [])

// ---------------------------------------------------------------- 列解析器
//
// 云端表的列来自两处：`create table` 里的列定义，以及后续 `alter table … add column`
// 的增列（stage3 给 day_plans 加了 11 列，stage5 又给三张子表补了 updated_at）。
// **只读 create table 会得出错误的「云端缺 10 列」结论**——实测踩过，
// 所以下面用「按分号切语句 → 判语句类型 → 顶层逗号切列」这套，两处都收。

/** 取 `openIndex` 处括号与之配对的括号内文本。 */
function parenBody(text, openIndex) {
  let depth = 0
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') {
      depth -= 1
      if (depth === 0) return text.slice(openIndex + 1, i)
    }
  }
  return ''
}

/** 按顶层逗号切分（列定义里的 `check (x in ('a','b'))` 不算分隔）。 */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** 表级约束行不是列定义。 */
const TABLE_CONSTRAINT = /^(unique|primary key|foreign key|constraint|check|exclude)\b/i

/** 解析一条列定义；约束行返回 null。 */
function parseColumnDef(line) {
  const text = line.trim()
  if (!text || TABLE_CONSTRAINT.test(text)) return null
  const match = /^([a-z_][a-z0-9_]*)\s+([\s\S]+)$/i.exec(text)
  if (!match) return null
  return { name: match[1], definition: match[2].replace(/\s+/g, ' ').trim() }
}

const SQL_STATEMENTS = migrationSql
  // 先剥掉 `--` 行注释再切语句：每个迁移文件都以注释开头，锚定 `^create table` 的
  // 判断会被注释行顶掉（实测让 day_plans 解析出 0 列）；注释里也常出现表名，
  // 不剥还会把断言喂成假通过。
  .replace(/^\s*--.*$/gm, '')
  .split(';')
  .map((part) => part.trim())
  .filter(Boolean)

/** 某张云端表的全部列：`create table` 与 `alter table … add column` 合并，后者覆盖前者。 */
function cloudColumnsOf(table) {
  const columns = new Map()
  for (const statement of SQL_STATEMENTS) {
    if (new RegExp(`^create table if not exists public\\.${table}\\b`, 'i').test(statement)) {
      const open = statement.indexOf('(')
      if (open < 0) continue
      for (const line of splitTopLevel(parenBody(statement, open))) {
        const column = parseColumnDef(line)
        if (column) columns.set(column.name, column.definition)
      }
      continue
    }
    if (
      new RegExp(`^alter table public\\.${table}\\b`, 'i').test(statement) &&
      /\badd column\b/i.test(statement)
    ) {
      // 一条 alter 可以带多个 `add column if not exists …`，逐个剥掉再切顶层逗号。
      const body = statement
        .replace(/^alter table public\.\w+/i, '')
        .replace(/\badd column\b/gi, '')
        .replace(/\bif not exists\b/gi, '')
      for (const line of splitTopLevel(body)) {
        const column = parseColumnDef(line)
        if (column) columns.set(column.name, column.definition)
      }
    }
  }
  return columns
}

// 解析器自检：`day_plans` 的 7 列来自 stage2 的 create table，11 列来自 stage3 的 add column。
// 少了后者就只剩 7，下面所有列级断言都会变成「云端缺一堆列」的假失败——先把它钉死。
check('列解析器同时读得到建表列与增列（day_plans 共 18 列）', cloudColumnsOf('day_plans').size, 18)

// 服务端变更时间：`docs/18 §5.4` 要求 11 张同步表都有 `updated_at` 与 `set_updated_at` 触发器。
// `stores` 已经含 `profiles`（元数据表的云端落点），正好是那 11 张。
const withoutUpdatedAt = stores
  .map((store) => TABLE_OF_STORE[store] ?? store)
  .filter((table) => !cloudColumnsOf(table).has('updated_at'))
check('每张云端表都有 updated_at 列', withoutUpdatedAt, [])

const withoutUpdatedTrigger = stores
  .map((store) => TABLE_OF_STORE[store] ?? store)
  .filter((table) => !new RegExp(`create trigger ${table}_set_updated_at`).test(migrationSql))
check('每张云端表都挂了 set_updated_at 触发器', withoutUpdatedTrigger, [])

// 日期约束：主表自己判 plan_date；挂在 day_plan_id 上的子表靠父记录判；
// daily_meal_items 多一层（挂在 daily_meals 上），必须有自己的判定函数。
const dateGuarded = ['day_plans', 'daily_meals', 'custom_tasks']
const missingDateGuard = dateGuarded.filter(
  (table) => !new RegExp(`create trigger ${table}_reject_historical`).test(migrationSql),
)
check('日期相关表都有历史日期触发器', missingDateGuard, [])

const lateTables = ['daily_supplements', 'daily_exercise_items', 'routine_tasks']
const missingLateGuard = lateTables.filter(
  (table) => !new RegExp(`create trigger ${table}_reject_historical`).test(migrationSql),
)
check('L6 新增的子表也接上了历史日期触发器', missingLateGuard, [])
check(
  '三餐内容项有独立的历史日期判定（多一层父键）',
  /create trigger daily_meal_items_reject_historical/.test(migrationSql) && /reject_historical_meal_items/.test(migrationSql),
  true,
)

// 复制昨天：新增表之后必须换新函数，而不是改写旧函数（迁移只追加）。
check('复制昨天在 L6 有了覆盖新增表的版本', /copy_yesterday_stage4/.test(migrationSql), true)
// S4-T7 删掉云端适配器之后，复制昨天整条链路都在本地完成（`local/dayPlanService.ts`
// 的 `copyYesterday` 自己读写 IndexedDB），没有任何 TS 代码再去调那两个 RPC。
// 这里断言的是「零调用方」而不是把这两条删掉：两个 SQL 函数还留在库里（服务端能力），
// 哪天有人顺手接上一个调用方，这条应该看得见。
const rpcCallers = walk(join(PROJECT_ROOT, 'src')).filter((file) =>
  /rpc\(\s*['"]copy_yesterday/.test(readFileSync(file, 'utf8')),
)
check('复制昨天已无 TS 调用方（整条链路在本地）', rpcCallers.map((file) => relative(PROJECT_ROOT, file)), [])

// 外键策略：删选项不得动历史计划，所以引用选项的外键必须是 set null。
const optionFkRestrict = /references public\.(food_options|exercise_options)\(id\)(?!\s*on delete set null)/
check('引用选项的外键一律 on delete set null', optionFkRestrict.test(migrationSql), false)

// ---- 8. 示例选项清单只有一份，播种只读它 ----

const examples = read('src/services/optionExamples.ts')
const names = [...examples.matchAll(/'([^'\n]+)'/g)].map((match) => match[1]).filter((value) => /[\u4e00-\u9fa5]/.test(value))
check('示例选项清单非空且可被扫描', names.length >= 10, true)
// S4-T7 起只剩本地播种这一个消费者：播种发生在**本地**注册时，
// 而云端账号是侧挂绑定（决策 D5：不迁密码、不搬身份），绑定流程不播种。
check('播种引用共享清单', read('src/services/local/optionSeed.ts').includes("from '../optionExamples'"), true)
const duplicatedSeeds = ['src/services/local/optionSeed.ts'].filter((path) =>
  names.some((name) => read(path).includes(name)),
)
check('播种不另写一份清单', duplicatedSeeds, [])

// ---- 9. 列级对齐：本地字段契约 → 云端列（S4-T6）----
//
// 为什么表名对得上还不够：推送是把本地记录**按字段**发成 PostgREST 的行。
// 本地契约里有一个字段、云端没有这一列，请求就是 400「column does not exist」；
// 反过来云端多一列且**既不可空又没默认值**，插入时省略它同样报错。
// 两种错法的症状一模一样：本地一切正常、云端一条没有、队列越堆越长。
// 所以这一组把「本地契约」与「云端列」逐字段对齐。

const { ROW_MAPPERS, USER_SCOPED_STORES } = await import('../src/services/sync/mapper.ts')

/** 仓库 → 云端表（`users` 在云端由 Supabase Auth 管，档案落 `profiles`）。 */
const userDataTables = USER_DATA_STORES.map((store) => ({ store, table: TABLE_OF_STORE[store] ?? store }))

const withoutMapper = USER_DATA_STORES.filter((store) => typeof ROW_MAPPERS[store] !== 'function')
check('每张用户数据仓库都有推送映射', withoutMapper, [])

// 契约里有、云端没有 → 推送必然 400。
const missingColumns = []
for (const { store, table } of userDataTables) {
  const columns = cloudColumnsOf(table)
  for (const field of Object.keys(RECORD_SCHEMAS[store])) {
    if (!columns.has(field)) missingColumns.push(`${table}.${field}`)
  }
}
check('本地契约的每个字段在云端都有同名列', missingColumns, [])

// 云端多出的列必须是可省略的（有默认值或允许 null），否则插入时省不掉。
// 目前多出的六列全部落在这一类里：`day_plans.exercise_content`、`daily_meals.plan_content`、
// 以及 `daily_meals` / `custom_tasks` 的 `created_at` / `updated_at`——它们是 L6 之前的形状，
// 本地契约里没有（`docs/01` 不变量 2：内容项独立成表），推送时由映射层剔除。
const unomittableColumns = []
for (const { store, table } of userDataTables) {
  for (const [name, definition] of cloudColumnsOf(table)) {
    if (name in RECORD_SCHEMAS[store]) continue
    const hasDefault = /\bdefault\b/i.test(definition)
    const nullable = !/\bnot null\b/i.test(definition)
    if (!hasDefault && !nullable) unomittableColumns.push(`${table}.${name}`)
  }
}
check('云端多出的列都能被省略（有默认值或可空）', unomittableColumns, [])

// `user_id` 是**表级**属性：多改一张表，PostgREST 就报「列不存在」；
// 少改一张，RLS 的 `with check (auth.uid() = user_id)` 会把整批行挡回去。
const scopedMismatch = []
for (const { store, table } of userDataTables) {
  const hasUserId = cloudColumnsOf(table).has('user_id')
  const expected = USER_SCOPED_STORES.includes(store)
  if (hasUserId !== expected) {
    scopedMismatch.push(`${table}：云端${hasUserId ? '有' : '无'} user_id，映射层期望${expected ? '有' : '无'}`)
  }
}
check('带 user_id 的云端表与 USER_SCOPED_STORES 完全一致', scopedMismatch, [])

// 开了 RLS 却不写策略 = 表对谁都读不出、写不进，而且不报错、只是空结果。
const withoutPolicy = stores
  .map((store) => TABLE_OF_STORE[store] ?? store)
  .filter((table) => !new RegExp(`create policy \\S+ on public\\.${table}\\b`).test(migrationSql))
check('每张云端表都有至少一条策略', withoutPolicy, [])

// ---- 10. 双向整体替换的 SQL（S5）----
//
// S5 的两个整体替换在云端各有一个 RPC，外加三处**事务级**历史日期豁免。
// 这一组守的是「豁免确实是受控的」——这类开关写错方向不会报错，只会静默放行，
// 而后果是「日常编辑也能改历史日期」，恰好是 `docs/01` 不变量 4 要防的事。

const STAGE6 = '202609200002_stage6_replace.sql'
check('stage6 迁移文件存在', existsSync(join(migrationDir, STAGE6)), true)

const stage6Sql = existsSync(join(migrationDir, STAGE6)) ? read(`database/migrations/${STAGE6}`) : ''

/**
 * 剥掉 SQL 注释再做字符串判断。
 *
 * 必须剥：这一批迁移的注释里**故意**提到了 `exercise_content` / `plan_content`
 * （解释为什么不能把它们发出去），不剥的话「快照里不许出现云端独有列」这条断言
 * 会被自己的说明文字判成失败。
 */
const stage6Code = stage6Sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

check('stage6 定义了三个 RPC', ['cloud_sync_summary', 'export_cloud_snapshot', 'import_local_backup'].filter(
  (name) => !new RegExp(`create or replace function public\\.${name}\\s*\\(`).test(stage6Code),
), [])

// 三个函数一律 `security invoker`：豁免靠事务级 GUC，不靠提权。
// 改成 `security definer` 会让函数以属主身份跑，RLS 与归属判断同时失效——
// 那是一个「能跑、能过测试、但任何登录用户都能改别人数据」的漏洞。
const REPLACE_FUNCS = ['cloud_sync_summary', 'export_cloud_snapshot', 'import_local_backup']
const definerFuncs = REPLACE_FUNCS.filter((name) => {
  const body = stage6Code.slice(stage6Code.indexOf(`function public.${name}`))
  const head = body.slice(0, body.indexOf('as $$'))
  return /security definer/.test(head)
})
check('三个替换 RPC 都不是 security definer', definerFuncs, [])

const invokerFuncs = REPLACE_FUNCS.filter((name) => {
  const body = stage6Code.slice(stage6Code.indexOf(`function public.${name}`))
  return /security invoker/.test(body.slice(0, body.indexOf('as $$')))
})
check('三个替换 RPC 都显式声明 security invoker', invokerFuncs.length, 3)

// 三处历史日期判定函数都必须带 GUC 豁免，而且**豁免必须在日期比较之前**。
// 顺序反了就等于没豁免：函数会先在日期比较处 `raise exception`，
// 后面的放行代码永远执行不到。这是这一组里最容易写错、也最难发现的一条。
const GUARDS = ['reject_historical_day_plan', 'reject_historical_stage3_rows', 'reject_historical_meal_items']
const guardProblems = []
for (const name of GUARDS) {
  const start = stage6Code.indexOf(`function public.${name}`)
  if (start < 0) {
    guardProblems.push(`${name}：stage6 里没有重定义（触发器还挂着旧函数体）`)
    continue
  }
  const rest = stage6Code.slice(start)
  const end = rest.indexOf('$$;')
  const body = end > 0 ? rest.slice(0, end) : rest
  const bypassAt = body.indexOf('molly.allow_history')
  const raiseAt = body.indexOf("raise exception '历史日期不可修改'")
  if (bypassAt < 0) guardProblems.push(`${name}：没有 molly.allow_history 豁免`)
  else if (raiseAt < 0) guardProblems.push(`${name}：找不到原来的拒绝语句（函数体被改坏了？）`)
  else if (bypassAt > raiseAt) guardProblems.push(`${name}：豁免写在日期比较之后，等于没豁免`)
}
check('三处历史日期豁免都在日期比较之前', guardProblems, [])

// 豁免必须由 `import_local_backup` 用 `set local` 打开：`set local` 只活到本事务结束，
// 用 `set`（会话级）会把豁免留在连接上，PostgREST 的连接是复用的——
// 那等于给之后所有请求都开了历史写入权限。
check('import_local_backup 用 set local 打开豁免', /set local molly\.allow_history\s*=\s*'on'/.test(stage6Code), true)
check('没有会话级 set molly.allow_history', /(^|[^l])\bset molly\.allow_history/.test(stage6Code), false)

// 三个函数都必须先从 public 收回执行权再单独授权。
// PostgreSQL 给新建函数默认 `grant execute to public`，不收回的话 `anon` 也能调。
const grantProblems = REPLACE_FUNCS.filter(
  (name) =>
    !new RegExp(`revoke all on function public\\.${name}[^;]*from public`).test(stage6Code) ||
    !new RegExp(`grant execute on function public\\.${name}[^;]*to authenticated`).test(stage6Code),
)
check('三个替换 RPC 都先 revoke public 再 grant authenticated', grantProblems, [])

// 快照必须额外输出一条合成 users 行：`parseBackup` 的外键校验要求
// `day_plans.user_id` 能在 `records.users` 里找到父记录，缺了整份快照会被拒绝。
check(
  'export_cloud_snapshot 输出合成 users 行',
  /'users',\s*jsonb_build_array/.test(stage6Code) && /'password_hash'/.test(stage6Code),
  true,
)

// 快照**只能**逐字段显式构造，不能整行 `to_jsonb(t)` 倒出去。
// 整行倒出会把云端独有的列（`exercise_content` / `plan_content`、子表的 `updated_at`）
// 一起发出去，而 `parseBackup` 对未定义字段是**整份拒绝**——
// 于是「从云端恢复到本地」在任何有数据的账号上都会失败。
check('快照没有整行 to_jsonb 倒出', /to_jsonb\(\s*[a-z]\s*\)/.test(stage6Code), false)
check(
  '快照里不出现云端独有列名',
  ['exercise_content', 'plan_content'].filter((column) => stage6Code.includes(column)),
  [],
)

/**
 * 截出一张表在 `export_cloud_snapshot()` 里的那一段。
 *
 * 从 `'<store>', coalesce((` 起，到该段结尾的 `'[]'::jsonb)` 止。
 * 不能用「往后数 N 个字符」那种窗口：`daily_meals` 的段只有两百来字符，
 * 而紧跟着的 `daily_meal_items` 段**合法地**含有 `created_at`，
 * 一个宽窗口会把邻居的字段算进来，报出一条假失败。
 */
function snapshotBlock(store) {
  const start = stage6Code.indexOf(`'${store}', coalesce((`)
  if (start < 0) return ''
  const end = stage6Code.indexOf("'[]'::jsonb)", start)
  return stage6Code.slice(start, end < 0 ? stage6Code.length : end)
}

// 逐张表比对快照字段与本地契约。
//
// 这是 `verify:sql` 那条运行时断言（真的调 `export_cloud_snapshot()`、
// 真的拿返回的 JSON 与契约比）的**静态前置**：脚本先在这里拦一道，
// 让人在改 SQL 的当下就知道自己漏了一个字段，而不必等到跑起 PostgreSQL。
//
// 两个方向都会出事：多一个字段 → `parseBackup` 报「出现未定义字段」整份拒绝；
// 少一个字段 → 那条记录在本地是「缺字段」，同样被拒。
const snapshotFieldProblems = []
for (const store of USER_DATA_STORES) {
  const block = snapshotBlock(store)
  if (!block) {
    snapshotFieldProblems.push(`${store}：stage6 里找不到快照段`)
    continue
  }
  const keys = new Set([...block.matchAll(/'([a-z_]+)',/g)].map((match) => match[1]))
  const actual = [...keys].filter((key) => key in RECORD_SCHEMAS[store]).sort()
  const expected = Object.keys(RECORD_SCHEMAS[store]).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    snapshotFieldProblems.push(`${store}：快照 [${actual.join(',')}] ≠ 契约 [${expected.join(',')}]`)
  }
}
check('每张表的快照字段与本地契约完全一致', snapshotFieldProblems, [])

console.log('')
console.log(`结果：${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  console.log('未通过：')
  failures.forEach((item) => console.log(`  - ${item.name}`))
  process.exitCode = 1
}
