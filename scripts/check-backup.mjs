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

const TS = '2026-09-15T02:30:00.000Z'
const USER = { id: 'u1', email: 'someone@example.com', password_hash: '', created_at: TS }
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

const fileOf = (records) => buildBackup({ dbVersion: 4, exportedAt: TS, sourceEmail: USER.email, records })
const textOf = (records) => serializeBackup(fileOf(records))
/** 手改 JSON 文本：模拟用户或别的工具动过备份文件。 */
const tamper = (records, edit) => JSON.stringify(edit(JSON.parse(textOf(records))))

// ---- 仓库清单与契约必须同源 ----
check('文件标记与格式名固定', [BACKUP_APP, BACKUP_FORMAT], ['happy-little-molly', 'local-backup'])
check('备份仓库数等于 11 张业务表', BACKUP_STORE_COUNT, 11)
check('元数据仓库只有 users', BACKUP_META_STORES, ['users'])
check(
  '每张备份仓库都有字段契约',
  BACKUP_STORES.filter((store) => !hasSchema(store)),
  [],
)

// ---- 合法备份必须通过 ----
const good = parseBackup(textOf(baseRecords()), 4)
check('合法备份解析通过', good.summary.formatVersion, BACKUP_FORMAT_VERSION)
check('合法备份记录数齐全', Object.keys(good.records).length, 5)
check('用户表不计入数据条数', good.summary.counts.users ?? null, null)
check('数据条数为四张业务表合计（不含 users）', good.summary.total, 4)
check('来源邮箱被读出', good.summary.sourceEmail, USER.email)
check('结构版本一致时没有提醒', good.summary.warnings, [])
check('序列化后是缩进 2 空格的文本', serializeBackup(fileOf(baseRecords())).split('\n')[1], '  "app": "happy-little-molly",')
check('序列化结果以换行结尾', serializeBackup(fileOf(baseRecords())).endsWith('\n'), true)

// 序列化 → 解析 往返必须稳定：备份文件是「存下来以后再读回去」的东西。
const roundTrip = parseBackup(textOf(baseRecords()), 4)
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
const older = parseBackup(tamper(baseRecords(), (f) => ({ ...f, db_version: 3 })), 4)
check('结构版本不一致只提醒不拒绝', older.summary.warnings.length, 1)
check('提醒里写明两边的版本号', older.summary.warnings[0].includes('3') && older.summary.warnings[0].includes('4'), true)

// ---- 未知仓库 / 坏记录 ----
expectReject('未知仓库被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: { ...f.records, secret_notes: [] } }))), '不认识的仓库')
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
  () => parseBackup(tamper(baseRecords(), (f) => { delete f.records.users; return f })),
  '缺少关联的父记录',
)

// ---- 空备份：放行等于「用一个空文件清空自己」，风险与收益完全不对称 ----
expectReject('没有任何数据被拒', () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: {} }))), '没有任何数据')
expectReject(
  '只有元数据仓库也算空备份',
  () => parseBackup(tamper(baseRecords(), (f) => ({ ...f, records: { users: f.records.users } }))),
  '没有任何数据',
)

// ---- 摘要与文件名 ----
const summary = summarizeRecords(baseRecords(), { sourceEmail: USER.email, exportedAt: TS, dbVersion: 4 })
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

console.log('')
console.log(`结果：${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  console.log('未通过：')
  failures.forEach((item) => console.log(`  - ${item.name}`))
  process.exitCode = 1
}