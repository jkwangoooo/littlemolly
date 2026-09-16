#!/usr/bin/env node
// 后端一致性回归（L6）：门面 / 契约 / 两种后端实现 / 云端 SQL 四者的对应关系。
//
// 用法：npm run check:cloud-parity
//
// 为什么需要它：L6 的核心承诺是「为本地服务实现等价的 Supabase 适配器，不改页面业务接口」。
// 这句话有三处会悄悄失效的地方，`npm run typecheck` 只能挡住其中一处：
//
//   1. 云端适配器少了一个函数或签名不一致 —— **类型断言（cloud/parity.ts）能挡住**，
//      本脚本再用源码文本复核一遍，防止有人用 `as any` 之类的手段绕过断言；
//   2. 页面绕过门面直接 import `services/local/*` —— 类型检查完全看不出来，
//      本脚本静态扫描界面层；
//   3. 云端 SQL 缺一张表 / 少开 RLS —— 也和类型无关，本脚本对着迁移文件查。
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

// ---- 1. 契约里的每个名字，云端都必须真的导出 ----

/** 契约模块名 → 两侧实现文件。名字保持一致是门面能机械切换的前提。 */
const BACKENDS = {
  auth: 'authService',
  dayPlan: 'dayPlanService',
  option: 'optionService',
  backup: 'backupService',
}

check('契约覆盖四个后端模块', Object.keys(CONTRACT_KEYS).sort(), Object.keys(BACKENDS).sort())

for (const [group, file] of Object.entries(BACKENDS)) {
  const cloudPath = `src/services/cloud/${file}.ts`
  const localPath = `src/services/local/${file}.ts`
  check(`${file}：本地实现存在`, existsSync(join(PROJECT_ROOT, localPath)), true)
  check(`${file}：云端实现存在`, existsSync(join(PROJECT_ROOT, cloudPath)), true)

  const cloudSource = read(cloudPath)
  const localSource = read(localPath)

  const missingInCloud = CONTRACT_KEYS[group].filter(
    (name) => !new RegExp(`export\\s+(async\\s+)?(function\\s+|const\\s+|let\\s+)?${name}\\b`).test(cloudSource),
  )
  const missingInLocal = CONTRACT_KEYS[group].filter(
    (name) => !new RegExp(`export\\s+(async\\s+)?(function\\s+|const\\s+|let\\s+)?${name}\\b`).test(localSource),
  )
  check(`${file}：契约里的每个名字云端都导出了`, missingInCloud, [])
  check(`${file}：契约里的每个名字本地都导出了`, missingInLocal, [])
}

// ---- 2. 类型断言文件存在且引用了全部四个云端模块 ----

const paritySource = read('src/services/cloud/parity.ts')
const parityMissing = Object.values(BACKENDS).filter(
  (file) => !new RegExp(`from\\s*'\\./${file}'`).test(paritySource),
)
check('cloud/parity.ts 断言了全部四个云端模块', parityMissing, [])
check(
  'cloud/parity.ts 用契约类型做断言（而不是 any）',
  /BackupApi|DayPlanApi|AuthApi|OptionApi/.test(paritySource) && !/\bas any\b/.test(paritySource),
  true,
)

// ---- 3. 页面只能经门面取数：界面层不得直接引用 services/local ----

const uiFiles = [...walk(join(PROJECT_ROOT, 'src/app')), ...walk(join(PROJECT_ROOT, 'src/features'))]
check('界面层存在可扫描的源文件', uiFiles.length > 0, true)

const bypass = uiFiles
  .filter((file) => /from\s+['"][^'"]*services\/local\//.test(readFileSync(file, 'utf8')))
  .map((file) => relative(PROJECT_ROOT, file))
check('界面层没有绕过门面直连 services/local', bypass, [])

// ---- 4. 门面必须经 @backend 切换，且 @backend 只出现在门面目录里 ----
//
// 这条断言不是洁癖：vite.config.ts 用**相对替换**把 @backend 指到 ../local/ 或 ../cloud/，
// 相对解析的基准是引用方所在目录。门面文件在 src/services/api/ 下，恰好与
// src/services/ 差一级；换成别处的文件去引用，相对路径就会指错地方。

for (const file of Object.values(BACKENDS)) {
  const facadePath = `src/services/api/${file}.ts`
  check(`门面 ${file} 存在`, existsSync(join(PROJECT_ROOT, facadePath)), true)
  const facadeSource = read(facadePath)
  check(`门面 ${file} 指向上游后端`, facadeSource.includes(`from '@backend/${file}'`), true)
  check(`门面 ${file} 同时放行值与类型导出`, /export type \* from '@backend\//.test(facadeSource), true)
}

const backendAliasOutsideFacade = walk(join(PROJECT_ROOT, 'src'))
  .filter((file) => !file.includes(join('services', 'api')))
  .filter((file) => /from\s+['"]@backend\//.test(readFileSync(file, 'utf8')))
  .map((file) => relative(PROJECT_ROOT, file))
check('@backend 只出现在门面目录', backendAliasOutsideFacade, [])

// ---- 5. 云端适配器不得被本地构建拉到 ----
//
// 本地构建是否含 supabase，取决于「有没有任何非云端模块引用 src/services/cloud」。
// 这里静态守住这个前提，比每次构建完 grep 产物更快，也不会被上一次云构建的产物误导。

const cloudDir = join(PROJECT_ROOT, 'src/services/cloud')
const cloudLeaks = walk(join(PROJECT_ROOT, 'src'))
  .filter((file) => !file.startsWith(cloudDir))
  .filter((file) => /from\s+['"][^'"]*\/cloud\//.test(readFileSync(file, 'utf8')))
  .map((file) => relative(PROJECT_ROOT, file))
check('除云端目录自身，没有模块引用 src/services/cloud', cloudLeaks, [])

// ---- 6. 云端 SQL 必须覆盖本地全部对象仓库 ----

const migrationDir = join(PROJECT_ROOT, 'database/migrations')
const migrationFiles = readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()
check('迁移文件都以 12 位时间前缀命名', migrationFiles.filter((name) => !/^\d{12}_/.test(name)), [])
check('迁移文件不少于四批（stage1-stage4）', migrationFiles.length >= 4, true)
const migrationSql = migrationFiles.map((name) => read(`database/migrations/${name}`)).join('\n')

/** 仓库名 → 云端表名。`users` 是本地概念，云端由 Supabase Auth 管理，档案落在 profiles。 */
const TABLE_OF_STORE = { users: 'profiles' }
const stores = LOCAL_SCHEMA.stores.map((store) => store.name)
const missingTables = stores
  .map((store) => TABLE_OF_STORE[store] ?? store)
  .filter((table) => !new RegExp(`create table if not exists public\\.${table}\\b`).test(migrationSql))
check('每个本地仓库在云端都有对应表', missingTables, [])

const withoutRls = stores
  .map((store) => TABLE_OF_STORE[store] ?? store)
  .filter((table) => !new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(migrationSql))
check('每张云端表都启用了 RLS', withoutRls, [])

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
const copySource = read('src/services/cloud/dayPlanService.ts')
check('云端复制昨天调用的是新版本 RPC', copySource.includes("rpc('copy_yesterday_stage4'"), true)
check('云端复制昨天不再调用 stage3 的旧 RPC', copySource.includes("rpc('copy_yesterday_stage3'"), false)

// 外键策略：删选项不得动历史计划，所以引用选项的外键必须是 set null。
const optionFkRestrict = /references public\.(food_options|exercise_options)\(id\)(?!\s*on delete set null)/
check('引用选项的外键一律 on delete set null', optionFkRestrict.test(migrationSql), false)

// ---- 7. 示例选项清单只有一份，两种后端共用 ----

const examples = read('src/services/optionExamples.ts')
const names = [...examples.matchAll(/'([^'\n]+)'/g)].map((match) => match[1]).filter((value) => /[\u4e00-\u9fa5]/.test(value))
check('示例选项清单非空且可被扫描', names.length >= 10, true)
check('本地播种引用共享清单', read('src/services/local/optionSeed.ts').includes("from '../optionExamples'"), true)
check('云端播种引用共享清单', read('src/services/cloud/optionSeed.ts').includes("from '../optionExamples'"), true)
const duplicatedSeeds = ['src/services/local/optionSeed.ts', 'src/services/cloud/optionSeed.ts'].filter((path) =>
  names.some((name) => read(path).includes(name)),
)
check('两侧播种都不再各写一份清单', duplicatedSeeds, [])

console.log('')
console.log(`结果：${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  console.log('未通过：')
  failures.forEach((item) => console.log(`  - ${item.name}`))
  process.exitCode = 1
}
