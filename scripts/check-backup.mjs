#!/usr/bin/env node
// 备份格式回归：合法备份必须通过；任何一处坏掉都必须被拒，且错误可读、不返回半成品。
//
// 用法：npm run check:backup
//
// 为什么需要它（docs/05 L5）：「导入前确认；格式错误时不得覆盖现有数据」是硬性要求。
// 浏览器里能验证「粘贴一段坏文本，界面报错且数据还在」，但拼不出几十种「差一个字段 / 类型错 /
// 版本过高 / 引用断裂」的文件；而这类文件正是手改备份、跨版本备份最常见的失败方式。
// 因此这一层的判定放到纯数据模块 backupFormat.ts，在 Node 里逐条断言。
//
// 不碰 IndexedDB、不依赖构建产物：backupFormat.ts 是纯数据层，直接导入即可。

// 必须先注册扩展名补全钩子，再动态导入源码（源码用的是不带 .ts 的相对导入）。
// 注意：这里**不能**改成静态 import——静态导入在「链接阶段」就解析全部模块图，
// 那时钩子还没注册，无扩展名导入会直接 ERR_MODULE_NOT_FOUND。
import './ts-resolve.mjs'

const {
  BACKUP_APP,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_META_STORES,
  BACKUP_STORE_COUNT,
  BACKUP_STORES,
  backupFileName,
  buildBackup,
  describeBackupSummary,
  hasSchema,
  parseBackup,
  serializeBackup,
  summarizeRecords,
} = await import('../src/services/local/backupFormat.ts')
const { sanitizeRecord, validateRecord } = await import('../src/services/local/recordSchemas.ts')
<<<<<<< HEAD
const { DB_VERSION } = await import('../src/services/local/localDb.ts')
const {
  assertNoIdCollisions, copyWorkspaceRecords, OWNER_STORES, selectWorkspaceRecords,
} = await import('../src/services/local/workspaceRecords.ts')
=======
>>>>>>> origin/main

const failures = []
let passed = 0

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed += 1
  else failures.push({ name, actual, expected })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`}`)
}

/** 断言「必须被拒」，并检查错误码与提示里是否讲清了原因。 */
function expectReject(name, run, needle) {
  let error = null
  try {
    run()
  } catch (reason) {
    error = reason
  }
  const codeOk = error?.code === 'backup_invalid'
  const messageOk = !needle || String(error?.message ?? '').includes(needle)
  const ok = Boolean(error) && codeOk && messageOk
  if (ok) passed += 1
  else {
    failures.push({ name, actual: error ? `${error.code ?? '无错误码'} / ${error.message}` : '没有抛错', expected: `code=backup_invalid 且提示含「${needle ?? ''}」` })
  }
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${error ? `${error.code ?? '无错误码'}：${error.message}` : '没有抛错'}`}`,
  )
}

<<<<<<< HEAD
function workspaceError(run) {
  try {
    run()
    return null
  } catch (error) {
    return String(error?.message ?? error)
  }
}

function expectWorkspaceReject(name, run, needle) {
  const message = workspaceError(run)
  check(name, message?.includes(needle) ? needle : message, needle)
}

const TS = '2026-09-15T02:30:00.000Z'
const USER = { id: 'u1', username: 'W', created_at: TS }
=======
const TS = '2026-09-15T02:30:00.000Z'
const USER = { id: 'u1', email: 'someone@example.com', password_hash: '', created_at: TS }
>>>>>>> origin/main
const PLAN = {
  id: 'p1',
  user_id: 'u1',
  plan_date: '2026-09-15',
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
  exercise_decision: 'undecided',
  exercise_note: '',
  exercise_completed: false,
}
const FOOD = { id: 'f1', user_id: 'u1', name: '鸡蛋', active: true, sort_order: 0, created_at: TS, updated_at: TS }
const MEAL = { id: 'm1', day_plan_id: 'p1', meal_type: 'breakfast', note: '', completed: false }
const ITEM = { id: 'i1', daily_meal_id: 'm1', food_option_id: null, food_name_snapshot: '鸡蛋', sort_order: 0, created_at: TS }

/** 一份最小但字段齐备、引用自洽的备份记录集合。 */
const baseRecords = () => ({
  users: [{ ...USER }],
  day_plans: [{ ...PLAN }],
  food_options: [{ ...FOOD }],
  daily_meals: [{ ...MEAL }],
  daily_meal_items: [{ ...ITEM }],
})

<<<<<<< HEAD
const fileOf = (records) => buildBackup({ dbVersion: DB_VERSION, exportedAt: TS, sourceUsername: USER.username, records })
=======
const fileOf = (records) => buildBackup({ dbVersion: 4, exportedAt: TS, sourceEmail: USER.email, records })
>>>>>>> origin/main
const textOf = (records) => serializeBackup(fileOf(records))
/** 手改 JSON 文本：模拟用户或别的工具动过备份文件。 */
const tamper = (records, edit) => JSON.stringify(edit(JSON.parse(textOf(records))))

// ---- 仓库清单与契约必须同源 ----
check('文件标记与格式名固定', [BACKUP_APP, BACKUP_FORMAT], ['happy-little-molly', 'local-backup'])
<<<<<<< HEAD
check('当前备份格式为不含密码的 v3', BACKUP_FORMAT_VERSION, 3)
=======
>>>>>>> origin/main
check('备份仓库数等于 11 张业务表', BACKUP_STORE_COUNT, 11)
check('元数据仓库只有 users', BACKUP_META_STORES, ['users'])
check(
  '每张备份仓库都有字段契约',
  BACKUP_STORES.filter((store) => !hasSchema(store)),
  [],
)

// ---- 合法备份必须通过 ----
<<<<<<< HEAD
const good = parseBackup(textOf(baseRecords()), DB_VERSION)
=======
const good = parseBackup(textOf(baseRecords()), 4)
>>>>>>> origin/main
check('合法备份解析通过', good.summary.formatVersion, BACKUP_FORMAT_VERSION)
check('合法备份记录数齐全', Object.keys(good.records).length, 5)
check('用户表不计入数据条数', good.summary.counts.users ?? null, null)
check('数据条数为四张业务表合计（不含 users）', good.summary.total, 4)
<<<<<<< HEAD
check('来源账号被读出', good.summary.sourceUsername, USER.username)
=======
check('来源邮箱被读出', good.summary.sourceEmail, USER.email)
>>>>>>> origin/main
check('结构版本一致时没有提醒', good.summary.warnings, [])
check('序列化后是缩进 2 空格的文本', serializeBackup(fileOf(baseRecords())).split('\n')[1], '  "app": "happy-little-molly",')
check('序列化结果以换行结尾', serializeBackup(fileOf(baseRecords())).endsWith('\n'), true)

// 序列化 → 解析 往返必须稳定：备份文件是「存下来以后再读回去」的东西。
<<<<<<< HEAD
const roundTrip = parseBackup(textOf(baseRecords()), DB_VERSION)
=======
const roundTrip = parseBackup(textOf(baseRecords()), 4)
>>>>>>> origin/main
check('往返后引用关系保持不变', roundTrip.records.daily_meal_items[0].daily_meal_id, 'm1')

// ---- 文件级标记与版本 ----
expectReject('空字符串被拒', () => parseBackup(''), '为空')
expectReject('纯空白被拒', () => parseBackup('   \n '), '为空')
expectReject('非 JSON 被拒', () => parseBackup('{"app": "happy'), '不是合法的 JSON')
expectReject('JSON 数组被拒', () => parseBackup('[]'), '必须是一个 JSON 对象')
expectReject('别的应用的备份被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, app: 'other-app' }))), '不是「幸福小Molly」的备份文件')
expectReject('格式标记不对被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, format: 'csv' }))), '格式标记不正确')
expectReject('缺格式版本被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, version: undefined }))), '格式版本号无效')
expectReject('格式版本为 0 被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, version: 0 }))), '格式版本号无效')
expectReject('格式版本非整数被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, version: 1.5 }))), '格式版本号无效')
expectReject('来自更高版本的备份被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, version: BACKUP_FORMAT_VERSION + 1 }))), '来自更新的版本')
expectReject('缺数据库结构版本被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, db_version: undefined }))), '数据库结构版本号')
expectReject('缺导出时间被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, exported_at: '' }))), '缺少导出时间')
expectReject('缺 records 被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: undefined }))), '缺少 records')

// 结构版本不一致不拒绝，只给提醒：记录本身已逐条按当前契约校验过。
<<<<<<< HEAD
const older = parseBackup(tamper(baseRecords(), (f) => ({ ...f, db_version: 3 })), DB_VERSION)
check('结构版本不一致只提醒不拒绝', older.summary.warnings.length, 1)
check('提醒里写明两边的版本号', older.summary.warnings[0].includes('3') && older.summary.warnings[0].includes(String(DB_VERSION)), true)

// ---- 格式版本 1 的旧备份必须还能导入 ----
// v1 的邮箱字段归一成账号名；v1/v2 的旧密码字段读取时删除，不恢复认证能力。
// 手里只剩一份旧备份的人恰恰最需要把它导进去，所以读入时归一字段名，而不是为老文件放宽校验。
const legacyText = () => {
  const file = JSON.parse(textOf(baseRecords()))
  file.version = 1
  file.db_version = 4
  file.source_user = { email: 'legacy@example.com' }
  file.records.users = [{ id: 'u1', email: 'legacy@example.com', password_hash: 'legacy-only-hash', created_at: TS }]
  return JSON.stringify(file)
}
const legacyTamper = (edit) => {
  const file = JSON.parse(legacyText())
  edit(file)
  return JSON.stringify(file)
}

const legacyParsed = parseBackup(legacyText(), DB_VERSION)
check('旧格式备份仍可解析', legacyParsed.summary.total, 4)
check('旧格式备份的来源账号被读出', legacyParsed.summary.sourceUsername, 'legacy@example.com')
check(
  '旧格式备份归一账号名并移除密码字段',
  Object.keys(legacyParsed.records.users[0]).sort(),
  ['created_at', 'id', 'username'],
)
check(
  '旧格式备份给出格式提醒',
  legacyParsed.summary.warnings.filter((word) => word.includes('旧版格式')).length,
  1,
)
check(
  '当前格式的备份不出现格式提醒',
  good.summary.warnings.filter((word) => word.includes('旧版格式')).length,
  0,
)
check(
  'v1 备份提示旧密码字段已忽略',
  legacyParsed.summary.warnings.filter((word) => word.includes('密码字段已忽略')).length,
  1,
)
const legacyV2 = JSON.parse(textOf(baseRecords()))
legacyV2.version = 2
legacyV2.records.users[0].password_hash = 'legacy-only-hash'
const legacyV2Parsed = parseBackup(JSON.stringify(legacyV2), DB_VERSION)
check('v2 备份仍可解析业务记录', legacyV2Parsed.summary.total, good.summary.total)
check('v2 密码字段不进入解析结果', 'password_hash' in legacyV2Parsed.records.users[0], false)
check('v2 备份保留账号资料', legacyV2Parsed.records.users[0].username, USER.username)
check('v2 备份明确提示不恢复登录会话', legacyV2Parsed.summary.warnings.some((word) => word.includes('不创建账号或登录会话')), true)
// 归一之后走的是同一套契约校验：把归一后的字段改坏，照样要被拒。
expectReject(
  '旧格式备份也走当前契约校验',
  () => parseBackup(legacyTamper((file) => { file.records.users[0].username = 123 }), DB_VERSION),
  '格式不正确',
)
expectReject(
  '旧格式备份仍要求 users 记录带登录名',
  () => parseBackup(legacyTamper((file) => { delete file.records.users[0].email }), DB_VERSION),
  '格式不正确',
)

// ---- 未知仓库 / 坏记录 ----
expectReject('未知仓库被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: { ...f.records, secret_notes: [] } }))), '不认识的仓库')
expectReject('旧身份凭据仓库被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: { ...f.records, legacy_users: [] } }))), '不得包含任何身份凭据')
expectReject(
  'v3 备份中的密码字段被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.users[0].password_hash = 'unexpected-hash'; return f })),
  '格式不正确',
)
=======
const older = parseBackup(tamper(baseRecords(), (f) => ({ ...f, db_version: 3 })), 4)
check('结构版本不一致只提醒不拒绝', older.summary.warnings.length, 1)
check('提醒里写明两边的版本号', older.summary.warnings[0].includes('3') && older.summary.warnings[0].includes('4'), true)

// ---- 未知仓库 / 坏记录 ----
expectReject('未知仓库被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: { ...f.records, secret_notes: [] } }))), '不认识的仓库')
>>>>>>> origin/main
expectReject('仓库内容不是数组被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: { ...f.records, day_plans: {} } }))), '不是数组')
expectReject('记录不是对象被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: { ...f.records, day_plans: ['x'] } }))), '不是对象')
expectReject(
  '缺字段被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { delete f.records.day_plans[0].mode; return f }), 4),
  '格式不正确',
)
expectReject(
  '字段类型错被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.day_plans[0].meals_ready = 'yes'; return f })),
  '格式不正确',
)
expectReject(
  '多出未定义字段被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.day_plans[0].plan_content = '老库遗留'; return f })),
  '格式不正确',
)
expectReject(
  '枚举越界被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.day_plans[0].mode = 'holiday'; return f })),
  '格式不正确',
)
expectReject(
  '业务日期不合法被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.day_plans[0].plan_date = '2026-02-30'; return f })),
  '格式不正确',
)
expectReject(
  '时间戳不合法被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.food_options[0].created_at = '2026-09-15'; return f })),
  '格式不正确',
)
expectReject(
  '主键为空被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.food_options[0].id = ''; return f })),
  '格式不正确',
)
expectReject('错误提示指到具体仓库与行号', () => parseBackup(tamper(baseRecords(), (f) => { f.records.day_plans[0].mode = 'holiday'; return f })), 'day_plans 第 1 条')

// ---- 重复与引用完整性 ----
expectReject(
  '同仓库重复主键被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.food_options.push({ ...f.records.food_options[0] }); return f })),
  '重复主键',
)
expectReject(
  '同一天重复计划被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.day_plans.push({ ...f.records.day_plans[0], id: 'p2' }); return f })),
  '同一天有重复的计划',
)
expectReject(
  '计划指向不存在的账号被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.day_plans[0].user_id = 'ghost'; return f })),
  '关联关系已断裂',
)
expectReject(
  '餐次指向不存在的计划被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.daily_meals[0].day_plan_id = 'ghost'; return f })),
  '关联关系已断裂',
)
expectReject(
  '餐次内容指向不存在的餐次被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.daily_meal_items[0].daily_meal_id = 'ghost'; return f })),
  '关联关系已断裂',
)
expectReject(
  '缺父记录被拒',
<<<<<<< HEAD
  () => parseBackup(tamper(baseRecords(), (f) => { delete f.records.day_plans; return f })),
  '缺少关联的父记录',
)
expectReject(
  '缺少来源账号资料被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { delete f.records.users; return f })),
  '一个明确的来源账号',
)
expectReject(
  '多个来源账号资料被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.users.push({ ...USER, id: 'u2' }); return f })),
  '一个明确的来源账号',
)
expectReject(
  '餐次内容指向不存在的来源选项被拒',
  () => parseBackup(tamper(baseRecords(), (f) => { f.records.daily_meal_items[0].food_option_id = 'ghost'; return f })),
  '选项引用无效或归属不一致',
)
const withOption = baseRecords()
withOption.daily_meal_items[0].food_option_id = FOOD.id
check('同来源账号的选项引用合法', parseBackup(textOf(withOption), DB_VERSION).summary.total, good.summary.total)

// ---- 空备份：放行等于「用一个空文件清空自己」，风险与收益完全不对称 ----
expectReject('空 records 缺来源账号时被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: {} }))), '一个明确的来源账号')
=======
  () => parseBackup(tamper(baseRecords(), (f) => { delete f.records.users; return f })),
  '缺少关联的父记录',
)

// ---- 空备份：放行等于「用一个空文件清空自己」，风险与收益完全不对称 ----
expectReject('没有任何数据被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: {} }))), '没有任何数据')
>>>>>>> origin/main
expectReject(
  '只有元数据仓库也算空备份',
  () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: { users: f.records.users } }))),
  '没有任何数据',
)
<<<<<<< HEAD
check(
  'allowEmpty 允许有明确来源账号的空业务备份',
  parseBackup(textOf({ users: [{ ...USER }] }), DB_VERSION, { allowEmpty: true }).summary.total,
  0,
)
expectReject(
  'allowEmpty 不放宽来源账号约束',
  () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: {} })), DB_VERSION, { allowEmpty: true }),
  '一个明确的来源账号',
)

// ---- 摘要与文件名 ----
const summary = summarizeRecords(baseRecords(), { sourceUsername: USER.username, exportedAt: TS, dbVersion: DB_VERSION })
=======

// ---- 摘要与文件名 ----
const summary = summarizeRecords(baseRecords(), { sourceEmail: USER.email, exportedAt: TS, dbVersion: 4 })
>>>>>>> origin/main
check('摘要条数口径与解析一致', summary.total, good.summary.total)
const label = (store) => ({ day_plans: '日计划', food_options: '常用食物', daily_meals: '三餐', daily_meal_items: '餐次内容' })[store] ?? store
// 摘要按契约里的仓库顺序排列（不是文件里的书写顺序），因此同一份数据在任何机器上输出一致。
check('摘要文案列到每个非空仓库', describeBackupSummary(summary, label), '共 4 条（日计划 1 · 三餐 1 · 餐次内容 1 · 常用食物 1）')
check('无数据时摘要文案不空转', describeBackupSummary({ ...summary, counts: {}, total: 0 }, label), '没有数据')
check('文件名按 Asia/Shanghai 取日期', backupFileName('2026-09-14T17:00:00.000Z'), 'happy-little-molly-备份-2026-09-15.json')

// ---- 导出侧清洗：老库遗留字段不得让老用户「一条都导不出来」 ----
const legacy = { ...PLAN, exercise_content: '老库自由文本' }
check('写入口径会拒绝遗留字段', validateRecord('day_plans', legacy).some((issue) => issue.includes('exercise_content')), true)
check('导出口径会丢掉遗留字段', sanitizeRecord('day_plans', legacy).dropped, ['exercise_content'])
check('清洗后仍通过校验', validateRecord('day_plans', sanitizeRecord('day_plans', legacy).value), [])
check('清洗不丢业务字段', Object.keys(sanitizeRecord('day_plans', legacy).value).length, Object.keys(PLAN).length)

<<<<<<< HEAD
// ---- 恢复或复制父记录不能自动认领原先隔离的残留记录 ----
const TARGET_OWNER = 'auth-target'
const restoredWorkspace = (records) => {
  const parsed = parseBackup(textOf({ users: [{ ...USER }], ...records }), DB_VERSION)
  return Object.fromEntries(Object.entries(parsed.records)
    .filter(([store]) => store !== 'users')
    .map(([store, rows]) => [
      store, rows.map((row) => OWNER_STORES.has(store) ? { ...row, user_id: TARGET_OWNER } : row),
    ]))
}
const planOrphans = {
  daily_meals: { ...MEAL, id: 'orphan-meal', day_plan_id: 'recovered-plan' },
  custom_tasks: {
    id: 'orphan-task', day_plan_id: 'recovered-plan', task_time: '09:00',
    title: '旧任务', note: '', completed: false,
  },
  daily_supplements: {
    id: 'orphan-supplement', day_plan_id: 'recovered-plan', name_snapshot: '旧补剂',
    period: 'morning', planned: true, completed: false, sort_order: 0,
    created_at: TS, updated_at: TS,
  },
  daily_exercise_items: {
    id: 'orphan-exercise', day_plan_id: 'recovered-plan', exercise_option_id: null,
    name_snapshot: '旧运动', sort_order: 0, created_at: TS,
  },
  routine_tasks: {
    id: 'orphan-routine', day_plan_id: 'recovered-plan', kind: 'mop',
    title: '旧例行任务', completed: false,
  },
}
const mealOrphan = { ...ITEM, id: 'orphan-item', daily_meal_id: 'recovered-meal' }
const foreignPlan = { ...PLAN, id: 'foreign-plan', user_id: 'foreign-owner' }
const foreignMeal = { ...MEAL, id: 'foreign-meal', day_plan_id: foreignPlan.id }
const foreignFoodItem = {
  ...ITEM, id: 'foreign-food-item', daily_meal_id: foreignMeal.id, food_option_id: 'recovered-food',
}
const foreignExerciseItem = {
  ...planOrphans.daily_exercise_items, id: 'foreign-exercise-item',
  day_plan_id: foreignPlan.id, exercise_option_id: 'recovered-exercise',
}
check(
  '隔离残留夹具字段合法，错误确实来自缺失关联',
  [
    ...Object.entries(planOrphans).flatMap(([store, row]) => validateRecord(store, row)),
    ...validateRecord('daily_meal_items', mealOrphan),
    ...validateRecord('daily_meal_items', foreignFoodItem),
    ...validateRecord('daily_exercise_items', foreignExerciseItem),
  ],
  [],
)
const recoveredPlan = restoredWorkspace({ day_plans: [{ ...PLAN, id: 'recovered-plan' }] })
for (const [store, row] of Object.entries(planOrphans)) {
  expectWorkspaceReject(
    `恢复计划拒绝接入 ${store} 的隔离残留`,
    () => assertNoIdCollisions({ [store]: [row] }, recoveredPlan, TARGET_OWNER),
    '残留记录',
  )
}
const recoveredMeal = restoredWorkspace({
  day_plans: [{ ...PLAN }],
  daily_meals: [{ ...MEAL, id: 'recovered-meal' }],
})
expectWorkspaceReject(
  '恢复餐次拒绝接入缺失餐次父记录的隔离内容',
  () => assertNoIdCollisions({ daily_meal_items: [mealOrphan] }, recoveredMeal, TARGET_OWNER),
  '残留记录',
)
expectWorkspaceReject(
  '恢复计划拒绝沿已存在餐次认领两层孤儿',
  () => assertNoIdCollisions({
    daily_meals: [planOrphans.daily_meals],
    daily_meal_items: [{ ...mealOrphan, daily_meal_id: planOrphans.daily_meals.id }],
  }, recoveredPlan, TARGET_OWNER),
  '残留记录',
)
const recoveredOptions = restoredWorkspace({
  food_options: [{ ...FOOD, id: 'recovered-food' }],
  exercise_options: [{ ...FOOD, id: 'recovered-exercise', name: '步行' }],
})
expectWorkspaceReject(
  '恢复食物选项拒绝接入其他 owner 的缺失来源引用',
  () => assertNoIdCollisions({
    day_plans: [foreignPlan], daily_meals: [foreignMeal], daily_meal_items: [foreignFoodItem],
  }, recoveredOptions, TARGET_OWNER),
  '残留记录',
)
expectWorkspaceReject(
  '恢复运动选项拒绝接入其他 owner 的缺失来源引用',
  () => assertNoIdCollisions({
    day_plans: [foreignPlan], daily_exercise_items: [foreignExerciseItem],
  }, recoveredOptions, TARGET_OWNER),
  '残留记录',
)
const currentWorkspace = restoredWorkspace(withOption)
check(
  '完整替换当前 owner 的记录仍可复用原有主键',
  workspaceError(() => assertNoIdCollisions(currentWorkspace, currentWorkspace, TARGET_OWNER)),
  null,
)
check(
  '完整替换会删除当前 owner 的残留引用，允许恢复自己的缺失选项',
  workspaceError(() => assertNoIdCollisions({
    day_plans: [{ ...foreignPlan, user_id: TARGET_OWNER }],
    daily_meals: [foreignMeal], daily_meal_items: [foreignFoodItem],
    daily_exercise_items: [foreignExerciseItem],
  }, recoveredOptions, TARGET_OWNER)),
  null,
)
expectWorkspaceReject(
  '原有同表主键检查继续拒绝覆盖其他 owner',
  () => assertNoIdCollisions({
    day_plans: [{ ...foreignPlan, id: 'recovered-plan' }],
  }, recoveredPlan, TARGET_OWNER),
  '其他工作区冲突',
)
check(
  '关联检查按目标表比较，其他表的同名 ID 不触发认领',
  workspaceError(() => assertNoIdCollisions({
    custom_tasks: [planOrphans.custom_tasks],
  }, restoredWorkspace({ food_options: [{ ...FOOD, id: 'recovered-plan' }] }), TARGET_OWNER)),
  null,
)
const copyExisting = {
  day_plans: [foreignPlan],
  daily_meals: [foreignMeal, planOrphans.daily_meals],
  custom_tasks: [planOrphans.custom_tasks],
  daily_meal_items: [mealOrphan, foreignFoodItem],
  daily_exercise_items: [foreignExerciseItem],
}
const beforeCopy = JSON.stringify(copyExisting)
const missingReferences = ['recovered-plan', 'recovered-meal', 'recovered-food', 'recovered-exercise']
const candidates = [...missingReferences, 'copy-plan', 'copy-meal', 'copy-food', 'copy-item']
let candidateIndex = 0
const copied = copyWorkspaceRecords(
  parseBackup(textOf(withOption), DB_VERSION).records,
  copyExisting,
  TARGET_OWNER,
  () => candidates[candidateIndex++] ?? `copy-fallback-${candidateIndex}`,
)
check(
  '复制生成 ID 时跳过全部缺失父记录与来源引用 ID',
  Object.values(copied).flat().map((row) => row.id).filter((id) => missingReferences.includes(id)),
  [],
)
const combined = Object.fromEntries([...new Set([...Object.keys(copyExisting), ...Object.keys(copied)])]
  .map((store) => [store, [...(copyExisting[store] ?? []), ...(copied[store] ?? [])]]))
check(
  '复制后当前工作区只包含复制记录，不额外认领隔离孤儿',
  Object.values(selectWorkspaceRecords(combined, TARGET_OWNER)).flat().length,
  good.summary.total,
)
check(
  '复制后完整父链与来源选项均指向新 ID',
  [
    copied.daily_meals[0].day_plan_id,
    copied.daily_meal_items[0].daily_meal_id,
    copied.daily_meal_items[0].food_option_id,
    copied.day_plans[0].user_id,
    copied.food_options[0].user_id,
  ],
  [copied.day_plans[0].id, copied.daily_meals[0].id, copied.food_options[0].id, TARGET_OWNER, TARGET_OWNER],
)
check('复制不修改任何原隔离记录', JSON.stringify(copyExisting), beforeCopy)
expectWorkspaceReject(
  '连续生成悬空引用 ID 达到上限时拒绝整次复制',
  () => copyWorkspaceRecords(
    { day_plans: [{ ...PLAN }] }, copyExisting, TARGET_OWNER, () => 'recovered-plan',
  ),
  '无法为旧工作区生成',
)
check(
  '账号 UID 不作为业务记录引用占用新记录 ID',
  copyWorkspaceRecords(
    { day_plans: [{ ...PLAN }] }, copyExisting, TARGET_OWNER, () => foreignPlan.user_id,
  ).day_plans[0].id,
  foreignPlan.user_id,
)

=======
>>>>>>> origin/main
console.log('')
console.log(`结果：${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  console.log('未通过：')
  failures.forEach((item) => console.log(`  - ${item.name}`))
  process.exitCode = 1
<<<<<<< HEAD
}
=======
}
>>>>>>> origin/main
