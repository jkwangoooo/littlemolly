#!/usr/bin/env node
// 日期引擎规则回归：跨越月末、年末、闰年的日历运算，以及默认模式与日期关系判定。
//
// 用法：npm run check:dates
//
// 直接导入 src/shared/date/dateUtils.ts（Node 22.18+ / 24 原生支持剥离类型），
// 不引入测试框架、不产生构建产物。
//
// 覆盖 docs/05 的 L0 要求「默认模式」判定，并补上此前未验证的跨年周样例。

const failures = []
let passed = 0

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed += 1
  else failures.push({ name, actual, expected })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`}`)
}

function checkThrows(name, fn) {
  let threw = false
  try {
    fn()
  } catch {
    threw = true
  }
  check(name, threw, true)
}

const {
  addDays,
  classifyDate,
  dayOfWeekMondayFirst,
  defaultModeForDate,
  getMonday,
  getWeekDates,
  parseDateKey,
  WEEKDAY_LABELS,
} = await import('../src/shared/date/dateUtils.ts')

// ---- 一周七天：固定、升序、无重复、首日为周一 ----
const weekSamples = [
  '2026-09-14',
  '2026-12-31',
  '2027-01-01',
  '2027-02-28',
  '2028-01-01',
  '2028-02-29',
  '2028-12-31',
]
for (const day of weekSamples) {
  const week = getWeekDates(day)
  const ascending = week.every((value, index) => index === 0 || week[index - 1] < value)
  check(`getWeekDates(${day}) 为 7 天且升序无重复`, [week.length, ascending, new Set(week).size], [7, true, 7])
  check(`getWeekDates(${day}) 首日为周一`, dayOfWeekMondayFirst(week[0]), 0)
  check(`getWeekDates(${day}) 包含该日`, week.includes(day), true)
}

// ---- 跨年周：年份边界不能把一周拆错 ----
check('跨年周 2027-01-01 → 2026-12-28 至 2027-01-03',
  getWeekDates('2027-01-01'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
check('跨年周 2028-01-01 → 2027-12-27 至 2028-01-02',
  getWeekDates('2028-01-01'), ['2027-12-27', '2027-12-28', '2027-12-29', '2027-12-30', '2027-12-31', '2028-01-01', '2028-01-02'])

// ---- 周一自身 ----
check('getMonday 对周一返回自身', getMonday('2026-09-14'), '2026-09-14')
check('getMonday 对周日回到本周一', getMonday('2026-09-20'), '2026-09-14')

// ---- 星期序号（周一为 0，周日为 6）----
check('2026-09-14 为周一（0）', dayOfWeekMondayFirst('2026-09-14'), 0)
check('2026-09-20 为周日（6）', dayOfWeekMondayFirst('2026-09-20'), 6)

// ---- addDays 跨月末 / 年末 / 闰年 ----
check('月末进位 2027-02-28 + 1', addDays('2027-02-28', 1), '2027-03-01')
check('闰年 2028-02-28 + 1', addDays('2028-02-28', 1), '2028-02-29')
check('闰日次日 2028-02-29 + 1', addDays('2028-02-29', 1), '2028-03-01')
check('年末进位 2026-12-31 + 1', addDays('2026-12-31', 1), '2027-01-01')
check('年初回退 2027-01-01 - 1', addDays('2027-01-01', -1), '2026-12-31')
check('原地不动 + 0', addDays('2026-09-14', 0), '2026-09-14')
check('跨月回退 2027-03-01 - 1', addDays('2027-03-01', -1), '2027-02-28')

// ---- 默认模式：周一至周五 work，周六周日 rest ----
const week = getWeekDates('2026-09-14')
check('默认模式 周一至周日',
  week.map((date) => defaultModeForDate(date)),
  ['work', 'work', 'work', 'work', 'work', 'rest', 'rest'])
check('周标签与星期序号对齐', WEEKDAY_LABELS[dayOfWeekMondayFirst('2026-09-20')], '周日')

// ---- 日期关系判定（显式传入“今天”，不依赖运行时钟）----
const TODAY = '2026-09-14'
check('relation 昨天为 history', classifyDate('2026-09-13', TODAY), 'history')
check('relation 今天为 today', classifyDate('2026-09-14', TODAY), 'today')
check('relation 明天为 tomorrow', classifyDate('2026-09-15', TODAY), 'tomorrow')
check('relation 后天起为 future', classifyDate(addDays(TODAY, 2), TODAY), 'future')
check('relation 跨年过去为 history', classifyDate('2026-12-31', '2027-01-01'), 'history')
check('relation 跨年未来为 future', classifyDate('2027-01-02', '2026-12-31'), 'future')
check('relation 跨年次日为 tomorrow', classifyDate('2027-01-01', '2026-12-31'), 'tomorrow')

// ---- 非法日期必须被拒绝，不能静默滚动到别的日期 ----
checkThrows('拒绝 2026-02-30', () => parseDateKey('2026-02-30'))
checkThrows('拒绝 2027-02-29（非闰年）', () => parseDateKey('2027-02-29'))
checkThrows('拒绝 2026-13-01', () => parseDateKey('2026-13-01'))
checkThrows('拒绝 2026-1-1（非补零格式）', () => parseDateKey('2026-1-1'))
checkThrows('拒绝空字符串', () => parseDateKey(''))

console.log('')
console.log(`结果：${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  console.log('未通过：')
  failures.forEach((item) => console.log(`  - ${item.name}`))
  process.exitCode = 1
}
