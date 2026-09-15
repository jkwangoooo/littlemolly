#!/usr/bin/env node
// 本地数据结构回归：迁移表「只追加」、仓库定义与迁移表一一对应、示例选项不写死在界面层。
//
// 用法：npm run check:local-data
//
// 直接导入 src/services/local/localDb.ts 与 optionSeed.ts（Node 22.18+ / 24 原生支持剥离类型），
// 不引入测试框架、不产生构建产物。
//
// 为什么需要它：docs/01 把「数据库迁移只追加，不改写旧迁移」列为硬性规则。
// 真实浏览器只能验证「新装出来是多少张表」，无法验证「旧版本升级时旧表没被动过」，
// 所以这里对着迁移表本身做静态断言，与 npm run verify:local 的运行时检查互补。

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

const { LOCAL_SCHEMA } = await import('../src/services/local/localDb.ts')

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

// ---- 已有数据的版本必须带搬迁函数：只建表不搬数据，老用户的自由文本会被静默丢掉 ----
check('v3 迁移带数据搬迁函数', typeof migrations[3].migrate, 'function')
check('v1 / v2 只建表、不做数据搬迁', migrationVersions.slice(0, 2).map((key) => migrations[key].migrate ?? null), [null, null])
check('v4 只建表、不做数据搬迁', migrations[4].migrate ?? null, null)

// ---- 定义与迁移必须一一对应，防止「加了 STORES 忘了 MIGRATIONS」这类漏项 ----
check('迁移表覆盖的仓库与 STORES 清单完全一致', [...new Set(migratedNames)].sort(), storeNames)
check('每个仓库只在一个版本里引入', migratedNames.length, new Set(migratedNames).size)
check('所有仓库的主键都是 id', [...new Set(stores.map((store) => store.keyPath))], ['id'])

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

const cloudLeaks = uiFiles
  .filter((file) => {
    const source = readFileSync(file, 'utf8')
    return /from\s+['"]@supabase/.test(source) || /\bsupabase\b/i.test(source)
  })
  .map((file) => relative(PROJECT_ROOT, file))
check('界面层没有直接引用 supabase', cloudLeaks, [])

// ---- 示例选项属于服务层数据，不能写死在页面逻辑里（docs/05 L1 验收）----
const seedSource = readFileSync(join(PROJECT_ROOT, 'src/services/local/optionSeed.ts'), 'utf8')
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
