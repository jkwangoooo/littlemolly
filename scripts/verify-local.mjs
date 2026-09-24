#!/usr/bin/env node
// 本地验收脚本：用真实浏览器内核走通「登录 → 规划 → 保存 → 刷新恢复 → 退出」闭环，
// 检查桌面 / 手机视口无横向溢出、控制台无 error / warning。
//
// 用法：
//   npm run verify:local
//
// 脚本自带 Vite 开发服务器：会挑一个空闲端口自行拉起，结束时回收，
// 因此不会误验收「端口上恰好跑着的别的服务」，也不需要另开终端。
//
// 依赖：本机已安装 Chrome 或 Edge。不使用第三方 npm 包，不写入项目目录。
// 可用 CHROME_PATH 指定浏览器可执行文件；用 APP_URL 指向已存在的服务时，脚本不再自行拉起服务器。
//
// 覆盖：数据库冷升级（v1 → v6，含老自由文本搬迁、登录名字段改名、两张设备状态表）→ 登录页 → 注册 → 周视图 → 底部导航 →
// 历史只读 → 模式切换与恢复默认 → 未来空日期引导 → 三餐多选 → 准备进度 → 健身多选（切「不健身」不清内容）→
// 补剂实例（打开面板补齐 / 模板行不可删 / 自定义行可删 / 不重复补齐）→ 执行区勾选（与准备区分离）→
// 自定义事项增改删 → 复制昨天（带内容、不带任何状态、不改模式）→
// 休息日家务（正常休息日自动带拖地洗衣 / 临时不上班不带 / 隐藏工作日准备项 / 可勾选）→
// 选项页（增改排序启停删、补剂时段分组、可用数量口径）→ 刷新恢复 → 账号间选项隔离 →
// 账号与同步子屏（未配置云端时同步卡说明不可用、不出现「已同步」说法）→
// 桌面与手机视口 → 退出登录 → 控制台干净。
//
// 另有一条贯穿全脚本的判据：**未配置云端时整轮交互零跨域请求**（S1 引入，S3 起由同步卡继续守）。

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBrowser } from './lib/find-browser.mjs'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPLICIT_APP_URL = process.env.APP_URL ?? null
/** 设置 SHOT_DIR 可把关键界面截图落盘，用于人工核对观感；不设置则完全不写文件。 */
const SHOT_DIR = process.env.SHOT_DIR ?? null
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 向系统要一个当前空闲的端口，避免撞上已在 5173 跑着的别的服务。 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/** 拉起本项目自己的 Vite 开发服务器，返回 { child, url }。 */
async function startDevServer() {
  const port = await findFreePort()
  const url = `http://127.0.0.1:${port}/`
  const viteBin = join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteBin)) throw new Error(`未找到 Vite（${viteBin}），请先运行 npm install。`)

  const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: PROJECT_ROOT,
    stdio: 'ignore',
  })
  child.on('error', () => {})

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Vite 开发服务器启动后立即退出。')
    const reachable = await fetch(url).then((response) => response.ok).catch(() => false)
    if (reachable) return { child, url }
    await sleep(250)
  }
  stopProcess(child)
  throw new Error('Vite 开发服务器未在预期时间内就绪。')
}

/** 结束自己拉起的进程；Windows 上按 PID 连子进程一起收，不用按进程名通杀。 */
function stopProcess(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill()
  }
}

// 浏览器定位抽到 scripts/lib/find-browser.mjs：Git Bash 里 ProgramFiles 可能不存在，
// 只按环境变量拼路径会把「本机装了 Chrome」误判成「本机没有浏览器」。
// 图标生成脚本与 verify-pwa 共用同一份实现。

async function launchBrowser(browserPath, userDataDir) {
  const child = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const portFile = join(userDataDir, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (existsSync(portFile)) {
      const port = readFileSync(portFile, 'utf8').split('\n')[0].trim()
      if (port) return { child, port }
    }
    await sleep(250)
  }
  child.kill()
  throw new Error('浏览器调试端口未在预期时间内就绪。')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.events = []
    this.handlers = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
      } else if (message.method) {
        this.events.push(message)
        this.handlers.get(message.method)?.(message.params)
      }
    })
  }
  /** 需要即时响应的事件（如 Fetch 拦截）用这里注册；其余事件留在 this.events 里事后统计。 */
  on(method, handler) {
    this.handlers.set(method, handler)
  }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function connect(port) {
  let target
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      target = targets.find((item) => item.type === 'page')
      if (target) break
    } catch {
      // 调试端点尚未就绪
    }
    await sleep(250)
  }
  if (!target) throw new Error('无法连接浏览器调试端点。')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败。')), { once: true })
  })
  return new Cdp(ws)
}

const stamp = Date.now()
/**
 * 账号（v5 起登录凭据是「账号 + 密码」，不再是邮箱）。
 * 规则是 3–20 位字母 / 数字 / 下划线，所以用短前缀 + 时间戳：既合法，复跑时也不会撞上已注册的账号。
 */
const ACCOUNT = `a${stamp}`
const ACCOUNT_B = `b${stamp}`
/** 清空站点数据之后注册的第三个账号：用来验证「换设备：新账号 + 导入备份」能完整搬家。 */
const ACCOUNT_C = `c${stamp}`
const PASSWORD = 'verify123'
/** 三餐多选：早餐选两项、午餐选一项，用来验证「一餐多项」而不是单个自由文本。 */
const BREAKFAST_FOODS = ['燕麦牛奶', '水煮蛋']
const LUNCH_FOODS = ['鸡胸沙拉']
const MEAL_NOTE = '温牛奶'
/** 健身多选。 */
const EXERCISE_PICKS = ['快走', '瑜伽']
/** 这一天自己加的补剂，名字刻意不与任何模板重合，才能验证「自定义项可删除」。 */
const DAY_SUPPLEMENT = '测试日用补剂'
const TASK_NAME = '测试事项'
const FOOD_NAME = '测试专属食物'
const FOOD_RENAMED = '测试食物已改名'
const TEMP_NAME = '临时待删食物'
/** 备份往返里临时新增的一条食物，导入后应当消失。 */
const BACKUP_EXTRA_FOOD = '备份往返临时食物'
const SUPPLEMENT_NAME = '测试补剂'
const DB_NAME = 'happy-little-molly-local'
/** v1 只包含这四张表；升级到最新版后必须补上后续三张与三张（选项、每日内容）再补一张（家务）且旧数据不丢。 */
const V1_STORES = ['custom_tasks', 'daily_meals', 'day_plans', 'users']
const V2_STORES = ['exercise_options', 'food_options', 'supplement_templates']
const V3_STORES = ['daily_exercise_items', 'daily_meal_items', 'daily_supplements']
const V4_STORES = ['routine_tasks']
/** v5 不新增仓库，只把 `users` 的登录名字段与唯一索引从 email 换成 username。 */
/** v6（S2）新增两张**设备状态**表：待上传队列与同步状态。它们不进备份、不同步。 */
const V6_STORES = ['sync_outbox', 'sync_state']
/**
 * 允许出现在待上传队列里的仓库：只有用户数据。
 * `users`（应用身份）与两张设备状态表都不该进队列——写进来要么是自激循环，要么是把本机状态推给云端。
 */
const SYNCABLE_STORES = [
  'day_plans',
  'daily_meals',
  'custom_tasks',
  'food_options',
  'supplement_templates',
  'exercise_options',
  'daily_meal_items',
  'daily_supplements',
  'daily_exercise_items',
  'routine_tasks',
]
const LATEST_VERSION = 7
/** v1 老库里的自由文本内容，v3 迁移应当把它转成一条「名称快照项」。 */
const LEGACY_MEAL_TEXT = '老库早餐内容'
const LEGACY_EXERCISE_TEXT = '老库健身内容'
/** v1 老库里的用户记录形状：那时登录名还叫 `email`，唯一索引也叫 `email`。 */
const SENTINEL_USER = { id: 'verify-sentinel-user', email: 'verify-sentinel@local.test', password_hash: 'x', created_at: '2020-01-01T00:00:00.000Z' }
/** v5 迁移后它应当**原样**变成 username（见 localDb.ts 的 renameUsersToUsername）。 */
const SENTINEL_USERNAME = SENTINEL_USER.email
const SENTINEL_PLAN = {
  id: 'verify-sentinel-plan',
  user_id: SENTINEL_USER.id,
  plan_date: '2020-01-01',
  mode: 'work',
  mode_override: false,
  exercise_decision: 'exercise',
  exercise_content: LEGACY_EXERCISE_TEXT,
}
const SENTINEL_MEAL = {
  id: 'verify-sentinel-meal',
  day_plan_id: SENTINEL_PLAN.id,
  meal_type: 'breakfast',
  plan_content: LEGACY_MEAL_TEXT,
  note: '',
  completed: false,
}

/**
 * 「明天」是否默认休息日。
 *
 * 与 `src/shared/date/dateUtils.ts` 的 `defaultModeForDate` 是同一条规则：周六 / 周日休息。
 * 验收脚本里凡是假定「明天是工作日」的地方都必须先问一句，否则周五与周六跑出来的结论不一样。
 */
function tomorrowIsRestDay() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).formatToParts(new Date())
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'
  const mondayFirst = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0
  return ((mondayFirst + 1) % 7) >= 5
}

/** 计算「今天」到「本周六」还要往后翻几天（Asia/Shanghai，周一为一周第一天，周六=5）。 */
function daysToSaturday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).formatToParts(new Date())
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'
  const mondayFirst = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0
  return (5 - mondayFirst + 7) % 7
}

const results = []

// 注入到页面的交互辅助函数。重写界面时请保留 .prep-row / .execution-row / .task-row /
// .bottom-sheet / .center-card / .confirm-modal / .mode-card / .progress-head / .option-row /
// .panel-group / .panel-row / .picker-row 这些类名，以及 data-meal / data-period 这两个属性，
// 脚本依赖它们定位 L2 的多选与补剂分组。
// 编辑弹层（抽屉或居中卡片）统一用 data-editor-card 定位，形态换了脚本不必跟着改。
const HELPERS = `
window.__m = {
  byText: (text, tag) => [...document.querySelectorAll(tag || 'button')].find((el) => el.textContent.trim() === text),
  clickText: (text, tag) => { const el = window.__m.byText(text, tag); if (!el) return 'NOT_FOUND:' + text; el.click(); return 'OK' },
  clickContains: (text, tag) => { const el = [...document.querySelectorAll(tag || 'button')].find((node) => node.textContent.includes(text)); if (!el) return 'NOT_FOUND:' + text; el.click(); return 'OK' },
  clickAria: (label, tag) => { const el = [...document.querySelectorAll(tag || 'button')].find((node) => node.getAttribute('aria-label') === label); if (!el) return 'NOT_FOUND:' + label; el.click(); return 'OK' },
  prepRow: (label) => [...document.querySelectorAll('.prep-row')].find((row) => (row.querySelector('strong') || {}).textContent?.includes(label)),

  // ---- L2：编辑面板里的多选选择器 ----
  // 多选是按受控数组整体替换实现的，连续两次点击若挤在同一个 tick 里，
  // 第二次会基于上一次之前的旧数组计算，把第一项吃掉。因此每次点击后都要等一次渲染。
  pickerRows: (scopeSelector) => {
    const scope = document.querySelector(scopeSelector || '.picker');
    if (!scope) return [];
    return [...scope.querySelectorAll('.picker-row')];
  },
  pickerOptions: (scopeSelector) => window.__m.pickerRows(scopeSelector).map((row) => row.textContent.trim()),
  pickerChecked: (scopeSelector) =>
    window.__m.pickerRows(scopeSelector)
      .filter((row) => { const box = row.querySelector('input[type=checkbox]'); return box && box.checked; })
      .map((row) => row.textContent.trim()),
  pick: async (scopeSelector, name) => {
    const row = window.__m.pickerRows(scopeSelector).find((item) => item.textContent.includes(name));
    if (!row) return 'NO_OPTION:' + name;
    const box = row.querySelector('input[type=checkbox]');
    if (!box) return 'NO_CHECKBOX:' + name;
    box.click();
    await window.__m.wait(260);
    return box.checked ? 'CHECKED' : 'UNCHECKED';
  },
  /** 面板分组（三餐按 data-meal、补剂按 data-period）下的行文本。 */
  groupRows: (selector) => {
    const group = document.querySelector(selector);
    return group ? [...group.querySelectorAll('.panel-row, .picker-row')].map((row) => row.textContent.trim()) : [];
  },
  groupChecked: (selector) => {
    const group = document.querySelector(selector);
    if (!group) return [];
    return [...group.querySelectorAll('input[type=checkbox]')].filter((box) => box.checked).map((box) => box.getAttribute('aria-label') || box.parentElement.textContent.trim());
  },
  clickIn: (selector, text) => {
    const scope = document.querySelector(selector);
    if (!scope) return 'NO_SCOPE:' + selector;
    const button = [...scope.querySelectorAll('button')].find((item) => item.textContent.includes(text));
    if (!button) return 'NO_BUTTON:' + text;
    button.click();
    return 'OK';
  },
  lastSupplementInput: () => {
    const inputs = [...document.querySelectorAll('.panel-row input[placeholder]')];
    return inputs.length ? inputs[inputs.length - 1] : null;
  },

  // ---- L2：执行区 ----
  executeRows: () => [...document.querySelectorAll('.execution-row')],
  executeToggle: async (ariaLabel) => {
    const box = [...document.querySelectorAll('.execution-row input[type=checkbox]')].find((item) => item.getAttribute('aria-label') === ariaLabel);
    if (!box) return 'NO_ROW:' + ariaLabel;
    box.click();
    await window.__m.wait(1100);
    const after = [...document.querySelectorAll('.execution-row input[type=checkbox]')].find((item) => item.getAttribute('aria-label') === ariaLabel);
    return after && after.checked ? 'CHECKED' : 'UNCHECKED';
  },
  executeStates: () => [...document.querySelectorAll('.execution-row input[type=checkbox]')].map((box) => ({ label: box.getAttribute('aria-label') || '', checked: box.checked })),
  executeText: () => [...document.querySelectorAll('.execution-row')].map((row) => row.innerText.replace(/\\n+/g, ' ').trim()),

  // ---- L3：休息日家务 ----
  routineRows: () => [...document.querySelectorAll('[data-routine]')],
  routineText: () => window.__m.routineRows().map((row) => row.textContent.trim()),
  routineToggle: async (label) => {
    const box = window.__m.routineRows().map((row) => row.querySelector('input[type=checkbox]')).find((item) => item && item.getAttribute('aria-label') === label);
    if (!box) return 'NO_ROW:' + label;
    box.click();
    await window.__m.wait(1100);
    const after = window.__m.routineRows().map((row) => row.querySelector('input[type=checkbox]')).find((item) => item && item.getAttribute('aria-label') === label);
    return after && after.checked ? 'CHECKED' : 'UNCHECKED';
  },

  // 备份文本域是 textarea，它的 value setter 在 HTMLTextAreaElement.prototype 上，
  // 用 input 的那份会抛 Illegal invocation。这里按标签选原型，两种元素都能设值。
  setValue: (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  },
  fill: (labelText, value) => {
    const label = [...document.querySelectorAll('label')].find((item) => item.textContent.includes(labelText));
    if (!label) return 'NO_LABEL:' + labelText;
    const input = label.querySelector('input, textarea, select');
    if (!input) return 'NO_INPUT:' + labelText;
    if (input.tagName === 'SELECT') { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); }
    else { window.__m.setValue(input, value); }
    return 'OK';
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  text: () => document.body.innerText,
  modeLabel: () => (document.querySelector('.mode-card strong') || {}).textContent || '',
  prepChecked: () => [...document.querySelectorAll('.prep-row input[type=checkbox]')].map((box) => box.checked),
  progress: () => (document.querySelector('.progress-head strong') || {}).textContent || '',
  optionSection: (kind) => document.querySelector('.option-section[data-option-kind="' + kind + '"]'),
  // 选项页现在是「概览 + 子屏」：概览只放入口行，清单在自己的子屏里（docs/17 §4）。
  optionEntry: (kind) => document.querySelector('[data-option-entry="' + kind + '"]'),
  optionEntrySummary: (kind) => {
    const entry = window.__m.optionEntry(kind);
    return entry ? ((entry.querySelector('small') || {}).textContent || '').trim() : 'NO_ENTRY';
  },
  openOptionsOverview: async () => {
    const back = document.querySelector('.topbar-back button');
    if (back) {
      back.click();
      await window.__m.wait(400);
    }
    return 'OK';
  },
  openOptionList: async (kind) => {
    await window.__m.openOptionsOverview();
    const entry = window.__m.optionEntry(kind);
    if (!entry) return 'NO_ENTRY:' + kind;
    entry.click();
    await window.__m.wait(700);
    return 'OK';
  },
  openOptionMenu: (name) => {
    const row = window.__m.optionRow(name);
    if (!row) return 'NO_ROW:' + name;
    const trigger = row.querySelector('.row-menu-trigger');
    if (!trigger) return 'NO_TRIGGER';
    trigger.click();
    return 'OK';
  },
  optionMenuItems: () => [...document.querySelectorAll('.row-menu-item')].map((item) => item.textContent.trim()),
  optionNames: (kind) => {
    const section = window.__m.optionSection(kind);
    if (!section) return [];
    return [...section.querySelectorAll('.option-row strong')].map((el) => el.textContent.trim());
  },
  optionGroupLabels: (kind) => {
    const section = window.__m.optionSection(kind);
    if (!section) return [];
    return [...section.querySelectorAll('.option-group-label')].map((el) => el.textContent.trim());
  },
  optionRow: (name) => [...document.querySelectorAll('.option-row')].find((row) => ((row.querySelector('strong') || {}).textContent || '').trim() === name),
  optionStatus: (name) => { const row = window.__m.optionRow(name); return row ? (row.querySelector('small') || {}).textContent.trim() : 'NO_ROW'; },
  optionSummary: (kind) => { const section = window.__m.optionSection(kind); const el = section && section.querySelector('.option-summary'); return el ? el.textContent.trim() : 'NO_SUMMARY'; },
  optionGroupNames: (kind, label) => {
    const section = window.__m.optionSection(kind);
    if (!section) return [];
    return [...section.querySelectorAll('.option-group')]
      .filter((group) => ((group.querySelector('.option-group-label') || {}).textContent || '').trim() === label)
      .flatMap((group) => [...group.querySelectorAll('.option-row strong')].map((el) => el.textContent.trim()));
  },
  clickSectionContains: (kind, text) => {
    const section = window.__m.optionSection(kind);
    if (!section) return 'NO_SECTION:' + kind;
    const button = [...section.querySelectorAll('button')].find((item) => item.textContent.includes(text));
    if (!button) return 'NO_BUTTON:' + text;
    button.click();
    return 'OK';
  },
  // 行内动作现在收在「…」溢出菜单里：先开菜单再点条目。
  clickOptionButton: async (name, label) => {
    const opened = window.__m.openOptionMenu(name);
    if (opened !== 'OK') return opened;
    await window.__m.wait(150);
    const item = [...document.querySelectorAll('.row-menu-item')].find((node) => node.textContent.trim() === label);
    if (!item) return 'NO_BUTTON:' + label;
    item.click();
    return 'OK';
  },
  // 账号与同步子屏现在有两张卡：本地账号（.account-card）与云端同步（.sync-card）。
  // 分开取，避免同步卡的文案混进账号卡的断言里——那会让两条断言互相掩护。
  accountText: () => { const card = document.querySelector('.account-card'); return card ? card.innerText : 'NO_ACCOUNT_CARD'; },
  syncText: () => { const card = document.querySelector('.sync-card'); return card ? card.innerText : 'NO_SYNC_CARD'; },

  // ---- L5：本地备份卡片 ----
  backupSection: () => document.querySelector('.backup-card'),
  backupBox: () => document.querySelector('.backup-text'),
  backupText: () => { const box = window.__m.backupBox(); return box ? box.value : 'NO_BACKUP_BOX'; },
  backupNote: () => { const el = document.querySelector('[data-backup-note]'); return el ? el.textContent.trim() : ''; },
  backupError: () => { const el = document.querySelector('[data-backup-error]'); return el ? el.textContent.trim() : ''; },
  backupImported: () => { const el = document.querySelector('[data-backup-imported]'); return el ? el.textContent.trim() : ''; },
  backupModalOpen: () => !!document.querySelector('.confirm-modal'),
  backupModalText: () => { const el = document.querySelector('.confirm-modal'); return el ? el.innerText.replace(/\\n+/g, ' ').trim() : ''; },
  backupPaste: (value) => { const box = window.__m.backupBox(); if (!box) return 'NO_BACKUP_BOX'; window.__m.setValue(box, value); return 'OK'; },
  backupClear: () => { const button = [...document.querySelectorAll('.backup-card button')].find((item) => item.textContent.trim() === '清空输入'); if (!button) return 'NO_BUTTON'; button.click(); return 'OK'; },
  /** 卡片内按钮：避免与页面其它位置的同名按钮混淆。 */
  backupClick: (label) => {
    const card = window.__m.backupSection();
    if (!card) return 'NO_CARD';
    const button = [...card.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
    if (!button) return 'NO_BUTTON:' + label;
    if (button.disabled) return 'DISABLED:' + label;
    button.click();
    return 'OK';
  },

  /**
   * 读取库结构。库不存在时**绝不能**用无版本号的 open 去「打探」——那样会凭空造出一个空的 v1 库，
   * 应用随后按最新版本打开时 oldVersion=1，第 1 号迁移被跳过，首批仓库再也建不出来。
   * 所以先用 indexedDB.databases() 判断存在性，不存在就如实返回，不碰数据库。
   */
  dbSchema: async () => {
    const listed = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : null;
    if (listed && !listed.some((entry) => entry.name === ${JSON.stringify(DB_NAME)})) {
      return JSON.stringify({ version: 0, names: [], indexes: {}, exists: false });
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(${JSON.stringify(DB_NAME)});
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const names = [...db.objectStoreNames].sort();
        const indexes = {};
        for (const name of names) {
          const store = db.transaction(name).objectStore(name);
          indexes[name] = [...store.indexNames].sort();
        }
        resolve(JSON.stringify({ version: db.version, names, indexes, exists: true }));
        db.close();
      };
    });
  },
  dbRecords: async (storeName) => new Promise((resolve, reject) => {
    const request = indexedDB.open(${JSON.stringify(DB_NAME)});
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve('[]');
        return;
      }
      const tx = db.transaction(storeName, 'readonly');
      const read = tx.objectStore(storeName).getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        resolve(JSON.stringify(read.result));
        db.close();
      };
    };
  }),
};
'ready'
`

function record(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
}
function firstLine(value, limit = 90) {
  return String(value ?? '').split('\n').filter(Boolean).join(' / ').slice(0, limit)
}

async function main() {
  const browserPath = findBrowser()
  const userDataDir = join(tmpdir(), `molly-verify-${stamp}`)
  let child = null
  let devServer = null
  /** 第一个账号导出的备份文本，留到清空站点数据之后做「换设备搬家」验证。 */
  let BACKUP_TEXT = ''

  try {
    let appUrl = EXPLICIT_APP_URL
    if (appUrl) {
      const reachable = await fetch(appUrl).then(() => true).catch(() => false)
      if (!reachable) {
        console.error(`APP_URL 指定的 ${appUrl} 无法访问。`)
        process.exitCode = 1
        return
      }
    } else {
      devServer = await startDevServer()
      appUrl = devServer.url
      console.log(`使用临时开发服务器：${appUrl}`)
    }

    const launched = await launchBrowser(browserPath, userDataDir)
    child = launched.child
    const cdp = await connect(launched.port)
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Page.enable')

    // 网络监听：**只统计，不拦截**（拦截由下面的 Fetch 域负责）。
    //
    // 用途是 S1 引入的新判据：**未配置云端时整轮交互零跨域请求**。
    // 它替换掉了旧判据「本地产物 0 命中 supabase」——后者在运行时共存后不再成立，
    // 而这条更强：旧判据只证明「代码没打进产物」，这条证明**运行时也不会偷偷联网**。
    //
    // 放在 Page.enable 之后、第一次导航之前，才能覆盖整轮交互（含冷升级那一次）。
    await cdp.send('Network.enable')
    const appOrigin = new URL(appUrl).origin
    const crossOriginRequests = []
    cdp.on('Network.requestWillBeSent', (params) => {
      const url = params?.request?.url ?? ''
      if (!/^https?:/i.test(url)) return
      try {
        if (new URL(url).origin !== appOrigin) crossOriginRequests.push(url)
      } catch {
        // 解析不了的地址不参与判定
      }
    })

    const evaluate = async (expression) => {
      const outcome = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (outcome.exceptionDetails) {
        throw new Error(outcome.exceptionDetails.exception?.description ?? outcome.exceptionDetails.text)
      }
      return outcome.result.value
    }
    const goto = async () => {
      await cdp.send('Page.navigate', { url: appUrl })
      await sleep(2200)
      await evaluate(HELPERS)
    }
    const text = () => evaluate('window.__m.text()')

    if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
    // 截图是可选的人工核对辅助：任何失败都只告警，绝不能让验收结果受影响。
    const shot = async (label) => {
      if (!SHOT_DIR) return
      try {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        writeFileSync(join(SHOT_DIR, `${label}.png`), Buffer.from(data, 'base64'))
      } catch (reason) {
        console.warn(`截图 ${label} 失败（不影响验收）：${reason.message}`)
      }
    }

    // 0. 冷升级：先造一个 v1 老库，再让应用去打开它。
    //    做法是把入口模块的响应换成一个空模块，让页面停在「同源、但没有跑应用」的状态，
    //    这样才能在应用碰到数据库之前，用原生 IndexedDB 建出只会由 v1 代码产生的老库。
    //    由此验证 docs/01 的硬性规则：迁移只追加，老数据在升级后仍然可读。
    cdp.on('Fetch.requestPaused', (params) => {
      const isEntry = params.request.url.includes('/src/main.tsx')
      const task = isEntry
        ? cdp.send('Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }],
            body: '',
          })
        : cdp.send('Fetch.continueRequest', { requestId: params.requestId })
      void task.catch(() => {})
    })
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await cdp.send('Page.navigate', { url: appUrl })
    await sleep(2000)
    const seededV1 = await evaluate(`
      new Promise((resolve, reject) => {
        const request = indexedDB.open(${JSON.stringify(DB_NAME)}, 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('users', { keyPath: 'id' }).createIndex('email', 'email', { unique: true });
          const plans = db.createObjectStore('day_plans', { keyPath: 'id' });
          plans.createIndex('user_date', ['user_id', 'plan_date'], { unique: true });
          plans.createIndex('user_id', 'user_id');
          const meals = db.createObjectStore('daily_meals', { keyPath: 'id' });
          meals.createIndex('plan_type', ['day_plan_id', 'meal_type'], { unique: true });
          meals.createIndex('day_plan_id', 'day_plan_id');
          db.createObjectStore('custom_tasks', { keyPath: 'id' }).createIndex('day_plan_id', 'day_plan_id');
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['users', 'day_plans', 'daily_meals'], 'readwrite');
          tx.objectStore('users').put(${JSON.stringify(SENTINEL_USER)});
          tx.objectStore('day_plans').put(${JSON.stringify(SENTINEL_PLAN)});
          tx.objectStore('daily_meals').put(${JSON.stringify(SENTINEL_MEAL)});
          tx.oncomplete = () => { db.close(); resolve(['users', 'day_plans', 'daily_meals']); };
          tx.onerror = () => reject(tx.error);
        };
      })
    `)
    await cdp.send('Fetch.disable')
    record('可在同源页面上造出带自由文本内容的 v1 老库', Array.isArray(seededV1) && seededV1.length === 3, String(seededV1))
    await goto()

    // 1. 登录页
    await goto()
    const initial = await text()
    record('未登录时渲染登录页', initial.includes('登录') && initial.includes('账号'), firstLine(initial))

    // 2. 注册并进入日计划页
    const signedUp = await evaluate(`
      (async () => {
        window.__m.fill('账号', ${JSON.stringify(ACCOUNT)});
        window.__m.fill('密码', ${JSON.stringify(PASSWORD)});
        await window.__m.wait(200);
        return window.__m.clickText('注册');
      })()
    `)
    await sleep(1800)
    const afterSignUp = await text()
    record('注册后进入日计划页', afterSignUp.includes('执行今天') && afterSignUp.includes('准备明天'), signedUp)

    // 2b. 冷升级结果：应用是懒打开数据库的（登录页不读数据），注册写入才真正碰到库，
    //     因此在这里断言 v1 老库已经被应用一路升到最新版，且老数据仍在、老自由文本已被搬迁。
    const upgrade = JSON.parse(await evaluate(`
      (async () => {
        const schema = JSON.parse(await window.__m.dbSchema());
        const openDb = () => new Promise((resolve, reject) => {
          const request = indexedDB.open(${JSON.stringify(DB_NAME)});
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const readAll = async (store) => {
          const db = await openDb();
          return new Promise((resolve, reject) => {
            const all = db.transaction(store, 'readonly').objectStore(store).getAll();
            all.onsuccess = () => { resolve(all.result ?? []); db.close(); };
            all.onerror = () => reject(all.error);
          });
        };
        const sentinel = await new Promise((resolve, reject) => {
          const request = indexedDB.open(${JSON.stringify(DB_NAME)});
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const get = db.transaction('users', 'readonly').objectStore('users').get(${JSON.stringify(SENTINEL_USER.id)});
            get.onsuccess = () => { resolve(get.result ?? null); db.close(); };
            get.onerror = () => reject(get.error);
          };
        });
        return JSON.stringify({
          schema,
          sentinel,
          outbox: await readAll('sync_outbox'),
          state: await readAll('sync_state'),
        });
      })()
    `))
    const allStores = [...V1_STORES, ...V2_STORES, ...V3_STORES, ...V4_STORES, ...V6_STORES]
    record(`v1 老库被升级到 v${LATEST_VERSION} 且十三张表齐备`,
      upgrade.schema.version === LATEST_VERSION &&
        upgrade.schema.names.length === allStores.length &&
        allStores.every((name) => upgrade.schema.names.includes(name)),
      `version=${upgrade.schema.version}, tables=${upgrade.schema.names.join(',')}`)
    record('升级后 v1 老账号仍可读，且登录名字段已原样改名为 username',
      upgrade.sentinel?.username === SENTINEL_USERNAME && upgrade.sentinel?.email === undefined,
      upgrade.sentinel ? `username=${upgrade.sentinel.username}, email=${String(upgrade.sentinel.email)}` : 'null')
    record('v5 把 users 的唯一索引从 email 换成 username',
      JSON.stringify(upgrade.schema.indexes.users) === JSON.stringify(['username']),
      `indexes.users=${JSON.stringify(upgrade.schema.indexes.users)}`)
    // v6（S2）：两张设备状态表按定义建出来——`sync_outbox` 的索引是压缩与排序的载体，
    // 少了 store_record 就退化成全表扫，少了 seq 批次就没有稳定全序。
    record('v6 建出 sync_outbox 并带 seq / store_record 索引',
      JSON.stringify(upgrade.schema.indexes.sync_outbox) === JSON.stringify(['seq', 'store_record']),
      `indexes.sync_outbox=${JSON.stringify(upgrade.schema.indexes.sync_outbox)}`)
    record('v6 建出 sync_state（主键 id，无索引；v7 起一行一个本地账号）',
      JSON.stringify(upgrade.schema.indexes.sync_state) === JSON.stringify([]),
      `indexes.sync_state=${JSON.stringify(upgrade.schema.indexes.sync_state)}`)
    record('v6 只建空表：同步状态还没有行（尚未绑定云端账号）',
      upgrade.state.length === 0,
      `sync_state=${upgrade.state.length} 行`)
    // 注册时的「建账号 + 播种示例选项 + 建今天的计划」全是用户数据写入，
    // 因此队列此刻必须有内容，且**只能**有用户数据仓库——`users` 与两张设备表一条都不许进。
    record('注册与播种的写入都进了待上传队列，且只含用户数据仓库',
      upgrade.outbox.length > 0 && upgrade.outbox.every((row) => SYNCABLE_STORES.includes(row.store)),
      `队列 ${upgrade.outbox.length} 条：${[...new Set(upgrade.outbox.map((row) => row.store))].sort().join(' · ')}`)
    record('队列条目都是尚未尝试过的（S2 不推送）',
      upgrade.outbox.every((row) => row.attempts === 0 && row.last_error === null),
      `attempts=${JSON.stringify([...new Set(upgrade.outbox.map((row) => row.attempts))])}`)

    // 2c. 验证 v3 自由文本搬迁：单独读取新表确认快照项已生成
    const migration = JSON.parse(await evaluate(`
      (async () => {
        const readAll = (store) => new Promise((resolve, reject) => {
          const request = indexedDB.open(${JSON.stringify(DB_NAME)});
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const all = db.transaction(store, 'readonly').objectStore(store).getAll();
            all.onsuccess = () => { resolve(all.result ?? []); db.close(); };
            all.onerror = () => reject(all.error);
          };
        });
        const mealItems = await readAll('daily_meal_items');
        const exerciseItems = await readAll('daily_exercise_items');
        const mealItem = mealItems.find((row) => row.daily_meal_id === ${JSON.stringify(SENTINEL_MEAL.id)});
        const exerciseItem = exerciseItems.find((row) => row.day_plan_id === ${JSON.stringify(SENTINEL_PLAN.id)});
        return JSON.stringify({
          mealItem: mealItem ? { name: mealItem.food_name_snapshot, optionId: mealItem.food_option_id ?? null } : null,
          exerciseItem: exerciseItem ? { name: exerciseItem.name_snapshot, optionId: exerciseItem.exercise_option_id ?? null } : null,
        });
      })()
    `))
    record('v3 把老库三餐自由文本迁成一条名称快照项',
      migration.mealItem?.name === LEGACY_MEAL_TEXT && migration.mealItem?.optionId === null,
      JSON.stringify(migration.mealItem))
    record('v3 把老库健身自由文本迁成一条名称快照项',
      migration.exerciseItem?.name === LEGACY_EXERCISE_TEXT && migration.exerciseItem?.optionId === null,
      JSON.stringify(migration.exerciseItem))

    // 3. 周视图 + 底部导航
    await evaluate(`window.__m.clickText('本周')`)
    await sleep(1000)
    const week = await evaluate(`
      JSON.stringify({
        days: document.querySelectorAll('.week-day').length,
        text: window.__m.text(),
        bottomNav: (() => {
          const nav = document.querySelector('.bottom-nav');
          if (!nav) return null;
          return [...nav.querySelectorAll('button')].map((button) => ({ text: button.textContent.trim(), active: button.classList.contains('active') }));
        })(),
      })
    `)
    const weekData = JSON.parse(week)
    record('本周视图固定显示 7 天', weekData.days === 7, `week-day 数量 = ${weekData.days}`)
    record('底部导航含今日 / 本周 / 选项三入口且当前高亮本周',
      weekData.bottomNav?.length === 3 &&
        weekData.bottomNav.map((item) => item.text).join(',') === '今日,本周,选项' &&
        weekData.bottomNav.find((item) => item.text === '本周')?.active === true,
      `底部导航=${JSON.stringify(weekData.bottomNav)}`)
    await evaluate(`window.__m.clickText('今日')`)
    await sleep(900)

    // 3b. 底部导航可切换到选项页并高亮
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const optionsNav = await evaluate(`
      JSON.stringify({
        hasOptions: window.__m.text().includes('常用食物'),
        active: (() => {
          const nav = document.querySelector('.bottom-nav');
          if (!nav) return null;
          const button = [...nav.querySelectorAll('button')].find((item) => item.textContent.trim() === '选项');
          return button ? button.classList.contains('active') : null;
        })(),
      })
    `)
    const optionsNavData = JSON.parse(optionsNav)
    record('底部导航可切到选项页且高亮选项',
      optionsNavData.hasOptions === true && optionsNavData.active === true,
      `选项页=${optionsNavData.hasOptions}, 高亮=${optionsNavData.active}`)
    await evaluate(`window.__m.clickText('今日')`)
    await sleep(900)

    // 4. 历史日期只读
    const movedBack = await evaluate(`window.__m.clickAria('前一天', '.icon-button')`)
    await sleep(1200)
    const history = await evaluate(`
      JSON.stringify({
        note: window.__m.text().includes('历史计划仅供查看'),
        hasSwitch: !!window.__m.byText('改为休息日') || !!window.__m.byText('改为工作日'),
        hasNextButton: !!document.querySelector('.today-focus-action:not(:disabled)'),
        locked: [...document.querySelectorAll('.today-route input[type=checkbox]')].every((box) => box.disabled),
      })
    `)
    const historyData = JSON.parse(history)
    if (movedBack !== 'OK') record('历史日期显示只读提示且无模式切换', false, movedBack)
    else record('历史日期显示只读提示且无模式切换', historyData.note && !historyData.hasSwitch && !historyData.hasNextButton && historyData.locked,
      `note=${historyData.note}, hasSwitch=${historyData.hasSwitch}, nextButton=${historyData.hasNextButton}, locked=${historyData.locked}`)

    // 5. 模式切换与恢复默认
    await evaluate(`window.__m.clickAria('后一天', '.icon-button')`)
    await sleep(1200)
    const modeBefore = await evaluate(`window.__m.modeLabel()`)
    await evaluate(`window.__m.clickContains('改为')`)
    await sleep(700)
    const dialogText = await evaluate(`(document.querySelector('.confirm-modal') || {}).innerText || ''`)
    const dialogOk = dialogText.includes('这一天会改为休息日。') || dialogText.includes('这一天会改为工作日。')
    await evaluate(`window.__m.clickText('确认切换')`)
    await sleep(1300)
    const modeAfter = await evaluate(`window.__m.modeLabel()`)
    const override = await evaluate(`window.__m.text().includes('人工覆盖默认模式')`)
    record('模式切换有确认文案且生效', dialogOk && modeAfter !== modeBefore && override === true,
      `「${modeBefore}」→「${modeAfter}」，确认框=${dialogOk}`)
    const celebration = JSON.parse(await evaluate(`
      JSON.stringify({
        open: Boolean(document.querySelector('[data-testid="holiday-celebration"]')),
        phase: document.querySelector('[data-testid="holiday-celebration"]')?.getAttribute('data-phase') || null,
      })
    `))
    record('工作日切休息日保存成功后播放庆祝动效',
      celebration.open === true,
      `open=${celebration.open}, phase=${celebration.phase}`)
    await evaluate(`window.__m.clickText('跳过演出')`)
    await sleep(180)

    await evaluate(`window.__m.clickContains('恢复默认')`)
    await sleep(1300)
    const restored = await evaluate(`window.__m.text().includes('按星期自动判断')`)
    record('恢复默认清除人工覆盖', restored === true)

    // 5b. 切换日期后保存状态不得残留上一天的结论（L0 报告 R9）
    const statusReset = JSON.parse(await evaluate(`
      (async () => {
        const read = () => (document.querySelector('.status') || {}).textContent || '';
        const before = read();
        window.__m.clickAria('后一天', '.icon-button');
        await window.__m.wait(1300);
        return JSON.stringify({ before, after: read() });
      })()
    `))
    record('切换日期后保存状态不再残留上一天的结论',
      statusReset.before.includes('已保存') && statusReset.after.includes('尚未修改'),
      `${statusReset.before.trim()} → ${statusReset.after.trim()}`)

    // 6. 准备明天：三餐面板（先确保目标日是工作日，避免周五运行时落在休息日）
    await evaluate(`window.__m.clickText('准备明天')`)
    await sleep(1100)

    // 6a. 未来空日期引导：只做说明，不落库（docs/02「引导用户准备这一天，但不强制填写」）
    //
    // 注意「明天」不一定是工作日：明天若是周六 / 周日，`useDayPlanData` 会按
    // 「正常休息日自动补齐家务」先创建一份 rest 计划并带出拖地 / 洗衣，
    // 这一天已经不算空，引导块**本就不该出现**（EmptyDayHint 的注释：计划一旦产生，引导自行消失）。
    // 因此这里按明天的实际模式分别断言，而不是假定明天一定是工作日——
    // 只防「周五跑」是不够的，周六跑的时候明天同样是休息日。
    const emptyHint = await evaluate(`
      JSON.stringify({
        shown: !!document.querySelector('.empty-day'),
        titled: window.__m.text().includes('这一天还没有计划'),
        guides: window.__m.text().includes('从一件小事开始就好，不着急。'),
        routines: window.__m.routineText().length,
      })
    `)
    const hintData = JSON.parse(emptyHint)
    if (tomorrowIsRestDay()) {
      record('明天是休息日时不出现空日期引导（已自动带出家务）',
        !hintData.shown && hintData.routines > 0,
        `引导块=${hintData.shown}, 家务项=${hintData.routines}`)
    } else {
      record('未来空日期显示轻量引导', hintData.shown && hintData.titled && hintData.guides,
        `引导块=${hintData.shown}, 标题=${hintData.titled}, 含引导语=${hintData.guides}`)
    }
    await shot('01-未来空日期引导')

    const workday = await evaluate(`
      (async () => {
        if (window.__m.modeLabel() !== '休息日') return 'ALREADY_WORK';
        window.__m.clickContains('改为');
        await window.__m.wait(700);
        window.__m.clickText('确认切换');
        await window.__m.wait(1300);
        return 'SWITCHED';
      })()
    `)
    record('目标日可确认为工作日', workday === 'ALREADY_WORK' || workday === 'SWITCHED', workday)
    const meals = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('三餐已安排', '.row-main');
        await window.__m.wait(900);
        const title = (document.querySelector('.bottom-sheet h2') || {}).textContent || '';
        const bodyLockedWhileOpen = document.body.style.overflow === 'hidden';
        const candidates = window.__m.pickerOptions('.panel-group[data-meal="breakfast"]');
        const picked = [];
        for (const name of ${JSON.stringify(BREAKFAST_FOODS)}) {
          picked.push(await window.__m.pick('.panel-group[data-meal="breakfast"]', name));
        }
        picked.push(await window.__m.pick('.panel-group[data-meal="lunch"]', ${JSON.stringify(LUNCH_FOODS[0])}));
        const checkedBeforeSave = window.__m.pickerChecked('.panel-group[data-meal="breakfast"]');
        window.__m.fill('早餐备注', ${JSON.stringify(MEAL_NOTE)});
        await window.__m.wait(220);
        window.__m.clickText('保存');
        await window.__m.wait(1600);
        const body = window.__m.text();
        const bodyUnlockedAfterSave = document.body.style.overflow !== 'hidden';
        return JSON.stringify({
          title,
          bodyLockedWhileOpen,
          bodyUnlockedAfterSave,
          candidates,
          picked,
          checkedBeforeSave,
          status: body.includes('已保存'),
          breakfastInSummary: ${JSON.stringify(BREAKFAST_FOODS)}.every((name) => body.includes(name)),
          lunchInSummary: body.includes(${JSON.stringify(LUNCH_FOODS[0])}),
        });
      })()
    `))
    record('打开底部面板锁定 body 滚动，保存后恢复',
      meals.bodyLockedWhileOpen === true && meals.bodyUnlockedAfterSave === true,
      `打开时锁定=${meals.bodyLockedWhileOpen}, 保存后恢复=${meals.bodyUnlockedAfterSave}`)
    record('三餐面板按早 / 中 / 晚分组多选常用食物',
      meals.title === '编辑三餐' &&
        meals.candidates.length === 5 &&
        meals.picked.every((value) => value === 'CHECKED') &&
        JSON.stringify(meals.checkedBeforeSave) === JSON.stringify(BREAKFAST_FOODS),
      `面板标题=${meals.title}, 候选项=${meals.candidates.length}, 勾选=${meals.picked.join(',')}, 保存前已选=${meals.checkedBeforeSave.join('、')}`)
    record('三餐保存后摘要按名称快照列出所选内容',
      meals.status && meals.breakfastInSummary && meals.lunchInSummary,
      `已保存=${meals.status}, 含早餐项=${meals.breakfastInSummary}, 含午餐项=${meals.lunchInSummary}`)

    // 6b. 计划产生后引导自动消失，说明引导块只是提示、不是必须停留的状态
    const hintGone = await evaluate(`!document.querySelector('.empty-day')`)
    record('计划保存后空日期引导自动消失', hintGone === true)
    await shot('02-计划已填写')

    // 7. 勾选准备项与进度
    const progress = await evaluate(`
      (async () => {
        const row = window.__m.prepRow('三餐已安排');
        if (!row) return 'NO_ROW';
        row.querySelector('input[type=checkbox]').click();
        await window.__m.wait(1100);
        return JSON.stringify({ progress: window.__m.progress(), status: window.__m.text().includes('已保存') });
      })()
    `)
    const progressData = JSON.parse(progress)
    record('准备项勾选后进度与保存状态一致', /1\/5/.test(progressData.progress) && progressData.status,
      `${progressData.progress}, 已保存=${progressData.status}`)

    const routeInteraction = JSON.parse(await evaluate(`
      (async () => {
        const initial = {
          focus: document.querySelector('.today-focus')?.getAttribute('data-focus-id'),
          nodes: [...document.querySelectorAll('.prep-row')].map((row) => row.getAttribute('data-node-id')),
          noFire: !document.querySelector('.molly-fire'),
        };
        document.querySelector('.today-focus-action')?.click();
        await window.__m.wait(1100);
        const afterClick = {
          outfit: document.querySelector('[data-node-id="outfit_ready"] input')?.checked,
          focus: document.querySelector('.today-focus')?.getAttribute('data-focus-id'),
        };
        const focusText = document.querySelector('.today-focus-item');
        const event = (type, x) => new PointerEvent(type, {
          bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: 30,
        });
        focusText?.dispatchEvent(event('pointerdown', 20));
        focusText?.dispatchEvent(event('pointerup', 105));
        await window.__m.wait(1100);
        const afterSwipe = {
          supplements: document.querySelector('[data-node-id="supplements_ready"] input')?.checked,
          focus: document.querySelector('.today-focus')?.getAttribute('data-focus-id'),
        };
        document.querySelector('[data-node-id="outfit_ready"] input')?.click();
        await window.__m.wait(500);
        document.querySelector('[data-node-id="supplements_ready"] input')?.click();
        await window.__m.wait(700);
        return JSON.stringify({ initial, afterClick, afterSwipe, restored: window.__m.progress() });
      })()
    `))
    record('准备轨道五节点与焦点卡按钮共用完成保存路径',
      routeInteraction.initial.nodes.join(',') === 'outfit_ready,meals_ready,supplements_ready,morning_ready,exercise_ready' &&
        routeInteraction.initial.focus === 'outfit_ready' && routeInteraction.initial.noFire &&
        routeInteraction.afterClick.outfit === true && routeInteraction.afterClick.focus === 'supplements_ready',
      JSON.stringify(routeInteraction))
    record('焦点卡右滑完成后推进，节点仍可点击撤销',
      routeInteraction.afterSwipe.supplements === true &&
        routeInteraction.afterSwipe.focus === 'morning_ready' &&
        /1\/5/.test(routeInteraction.restored),
      JSON.stringify(routeInteraction))

    // 8. 健身面板：多选项 + 决定；选「不健身」不得清掉已选项目
    const exercise = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('健身安排已决定', '.row-main');
        await window.__m.wait(900);
        const title = (document.querySelector('.bottom-sheet h2') || {}).textContent || '';
        const candidates = window.__m.pickerOptions('.panel-group');
        const picked = [];
        for (const name of ${JSON.stringify(EXERCISE_PICKS)}) {
          picked.push(await window.__m.pick('.panel-group', name));
        }
        window.__m.fill('安排', 'exercise');
        await window.__m.wait(320);
        window.__m.fill('备注', '热身 10 分钟');
        await window.__m.wait(220);
        window.__m.clickText('保存');
        await window.__m.wait(1500);

        // 切成「不健身」再存一次：项目是内容，不该被清掉
        window.__m.clickContains('健身安排已决定', '.row-main');
        await window.__m.wait(900);
        window.__m.fill('安排', 'rest');
        await window.__m.wait(320);
        window.__m.clickText('保存');
        await window.__m.wait(1500);

        // 再打开：项目应当原样还在，切回健身并保存
        window.__m.clickContains('健身安排已决定', '.row-main');
        await window.__m.wait(900);
        const restored = window.__m.pickerChecked('.panel-group');
        window.__m.fill('安排', 'exercise');
        await window.__m.wait(320);
        window.__m.clickText('保存');
        await window.__m.wait(1500);
        return JSON.stringify({ title, candidates, picked, restored, ok: window.__m.text().includes('已决定健身') });
      })()
    `))
    record('健身面板可多选项目并保存决定',
      exercise.title === '编辑健身安排' &&
        exercise.candidates.length === 4 &&
        exercise.picked.every((value) => value === 'CHECKED') &&
        exercise.ok === true,
      `面板标题=${exercise.title}, 候选项=${exercise.candidates.length}, 勾选=${exercise.picked.join(',')}`)
    record('选「不健身」不清空已选项目',
      JSON.stringify(exercise.restored) === JSON.stringify(EXERCISE_PICKS),
      `重新打开后已选=${exercise.restored.join('、')}`)

    // 8b. 补剂面板：打开时按模板补齐当天清单，模板行不可删、自定义行可删
    const supplements = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('早中晚补剂已安排', '.row-main');
        await window.__m.wait(1600);
        const title = (document.querySelector('.bottom-sheet h2') || {}).textContent || '';
        const templateRows = {
          morning: window.__m.groupRows('.panel-group[data-period="morning"]'),
          noon: window.__m.groupRows('.panel-group[data-period="noon"]'),
          evening: window.__m.groupRows('.panel-group[data-period="evening"]'),
        };
        const removeButtonsOnTemplates = document.querySelectorAll('.panel-row button').length;

        // 取消「今天吃鱼油」：行要留在面板里，只是不勾
        const fishRow = [...document.querySelectorAll('.panel-row')].find((row) => row.textContent.includes('鱼油'));
        fishRow.querySelector('input[type=checkbox]').click();
        await window.__m.wait(320);
        const fishStillListed = [...document.querySelectorAll('.panel-row')].some((row) => row.textContent.includes('鱼油'));

        // 自己加一条
        window.__m.clickIn('.panel-group[data-period="noon"]', '添加补剂');
        await window.__m.wait(360);
        const input = window.__m.lastSupplementInput();
        if (input) window.__m.setValue(input, ${JSON.stringify(DAY_SUPPLEMENT)});
        await window.__m.wait(320);
        const removeButtonsAfterAdd = document.querySelectorAll('.panel-row button').length;

        window.__m.clickText('保存');
        await window.__m.wait(1700);
        const body = window.__m.text();
        return JSON.stringify({
          title,
          templateRows,
          removeButtonsOnTemplates,
          fishStillListed,
          removeButtonsAfterAdd,
          summaryHasMorning: body.includes('早 维生素 D'),
          summaryHasEvening: body.includes('晚 钙片'),
          summaryHasCustom: body.includes(${JSON.stringify(DAY_SUPPLEMENT)}),
          summaryExcludesFish: !body.includes('鱼油'),
        });
      })()
    `))
    record('补剂面板打开时按模板补齐当天清单',
      supplements.title === '编辑补剂' &&
        supplements.templateRows.morning.some((row) => row.includes('维生素 D')) &&
        supplements.templateRows.noon.some((row) => row.includes('鱼油')) &&
        supplements.templateRows.evening.some((row) => row.includes('钙片')),
      `面板标题=${supplements.title}, 早组=${supplements.templateRows.morning.join('|')}`)
    record('模板来源的补剂不给删除按钮，只能取消「今天吃」',
      supplements.removeButtonsOnTemplates === 0 &&
        supplements.fishStillListed === true &&
        supplements.removeButtonsAfterAdd === 1,
      `模板行删除按钮=${supplements.removeButtonsOnTemplates}, 取消勾选后仍在列表=${supplements.fishStillListed}, 加自定义行后删除按钮=${supplements.removeButtonsAfterAdd}`)
    record('补剂摘要只列「今天吃」的项，自定义项可加入',
      supplements.summaryHasMorning &&
        supplements.summaryHasEvening &&
        supplements.summaryHasCustom &&
        supplements.summaryExcludesFish,
      `早=${supplements.summaryHasMorning}, 晚=${supplements.summaryHasEvening}, 自定义=${supplements.summaryHasCustom}, 已排除未勾选项=${supplements.summaryExcludesFish}`)

    // 8c. 再次打开补剂面板：已存在的实例不会被重复补一遍；自定义行可移除
    const supplementsReopen = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('早中晚补剂已安排', '.row-main');
        await window.__m.wait(2200);
        const rows = [...document.querySelectorAll('.panel-row')];

        // 自定义行判定：有删除按钮的就是自定义行（模板行不给删除按钮）
        const fish = rows.filter((row) => row.textContent.includes('鱼油'));
        const customRows = rows.filter((row) => !!row.querySelector('button'));
        const fishChecked = fish.length ? fish[0].querySelector('input[type=checkbox]').checked : null;
        const fishRemovable = fish.length ? !!fish[0].querySelector('button') : null;
        const customRemovable = customRows.length ? !!customRows[0].querySelector('button') : null;

        if (customRows.length) customRows[0].querySelector('button').click();
        await window.__m.wait(320);
        window.__m.clickText('保存');
        await window.__m.wait(1700);
        const body = window.__m.text();
        return JSON.stringify({
          customRowCount: customRows.length,
          fishCount: fish.length,
          fishChecked,
          fishRemovable,
          customRemovable,
          customGone: !body.includes(${JSON.stringify(DAY_SUPPLEMENT)}),
          morningKept: body.includes('维生素 D'),
          eveningKept: body.includes('钙片'),
        });
      })()
    `))
    record('再次打开补剂面板不会重复补齐已存在的实例',
      supplementsReopen.fishCount === 1 && supplementsReopen.fishChecked === false,
      `鱼油行数=${supplementsReopen.fishCount}, 仍为未勾选=${supplementsReopen.fishChecked}`)
    record('自定义补剂可移除，模板来源的行不提供删除',
      supplementsReopen.customRowCount === 1 &&
        supplementsReopen.customRemovable === true &&
        supplementsReopen.fishRemovable === false &&
        supplementsReopen.customGone === true &&
        supplementsReopen.morningKept === true &&
        supplementsReopen.eveningKept === true,
      `自定义行=${supplementsReopen.customRowCount} 可删=${supplementsReopen.customRemovable}, 模板行可删=${supplementsReopen.fishRemovable}, 删除生效=${supplementsReopen.customGone}`)
    await shot('03-补剂面板')

    // 8d. 执行区：内容与完成状态严格分开——执行区勾「吃了」，准备区的勾选不受影响
    const execution = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickText('执行今天');
        await window.__m.wait(1100);
        window.__m.clickAria('后一天', '.icon-button');
        await window.__m.wait(1400);

        const rows = window.__m.executeText();
        const routeNodes = [...document.querySelectorAll('.today-route > .route-list > .route-stop')]
          .map((stop) => {
            const row = stop.querySelector('[data-node-id]');
            return { id: row?.getAttribute('data-node-id'), state: row?.getAttribute('data-node-state') };
          });
        const before = window.__m.executeStates();
        const nextBefore = document.querySelector('.today-focus-item')?.textContent || '';
        const originalTransaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(stores, mode, options) {
          if (mode === 'readwrite') throw new Error('模拟本地写入失败');
          return originalTransaction.call(this, stores, mode, options);
        };
        const failedToggle = await window.__m.executeToggle('早餐已完成');
        const failed = {
          status: document.querySelector('.local-status')?.textContent || '',
          reason: document.querySelector('.notice')?.textContent || '',
          feedback: !!document.querySelector('.completion-feedback.visible'),
          breakfast: document.querySelector('[aria-label="早餐已完成"]')?.checked || false,
        };
        IDBDatabase.prototype.transaction = originalTransaction;
        document.querySelector('.notice .retry')?.click();
        await window.__m.wait(1100);
        const breakfast = document.querySelector('[aria-label="早餐已完成"]')?.checked ? 'CHECKED' : 'UNCHECKED';
        const nextAfter = document.querySelector('.today-focus-item')?.textContent || '';
        const feedbackAfterRetry = document.querySelector('.completion-feedback.visible')?.textContent || '';
        const vitamin = await window.__m.executeToggle('维生素 D已完成');
        const workout = await window.__m.executeToggle('健身已完成');
        const cancelBreakfast = await window.__m.executeToggle('早餐已完成');
        const cancellation = {
          next: document.querySelector('.today-focus-item')?.textContent || '',
          feedback: !!document.querySelector('.completion-feedback.visible'),
        };
        const uncheckedLabels = window.__m.executeStates().filter((item) => !item.checked).map((item) => item.label);
        for (const label of uncheckedLabels) {
          const box = [...document.querySelectorAll('.execution-row input[type="checkbox"]')]
            .find((item) => item.getAttribute('aria-label') === label);
          box?.click();
          await window.__m.wait(160);
        }
        await window.__m.wait(900);
        const allDone = {
          states: window.__m.executeStates(),
          text: document.querySelector('.today-focus h2')?.textContent || '',
          button: !!document.querySelector('.today-focus-action'),
          feedback: document.querySelector('.completion-feedback.visible')?.textContent || '',
        };
        const lastRow = document.querySelectorAll('.execution-row');
        const lastRowLabel = lastRow.length ? lastRow[lastRow.length - 1].querySelector('input')?.getAttribute('aria-label') || '' : '';
        const lastRowTitle = lastRow.length ? lastRow[lastRow.length - 1].querySelector('strong')?.textContent || '' : '';
        const cancelLast = await window.__m.executeToggle(lastRowLabel);
        const lastCancellation = {
          next: document.querySelector('.today-focus-item')?.textContent || '',
          feedback: !!document.querySelector('.completion-feedback.visible'),
        };
        const restoreLast = await window.__m.executeToggle(lastRowLabel);

        window.__m.clickText('准备明天');
        await window.__m.wait(1500);
        return JSON.stringify({
          rows,
          routeNodes,
          before,
          nextBefore,
          nextAfter,
          failedToggle,
          failed,
          feedbackAfterRetry,
          breakfast,
          vitamin,
          workout,
          cancelBreakfast,
          cancellation,
          uncheckedLabels,
          allDone,
          lastRowLabel,
          lastRowTitle,
          cancelLast,
          lastCancellation,
          restoreLast,
          prepBoxes: window.__m.prepChecked(),
          prepareHasFire: !!document.querySelector('.molly-fire'),
          progressText: window.__m.progress(),
        });
      })()
    `))
    const executionLabels = execution.rows.join(' | ')
    record('执行区列出三餐内容、补剂实例与健身项目',
      executionLabels.includes('燕麦牛奶') &&
        executionLabels.includes('鸡胸沙拉') &&
        executionLabels.includes('维生素 D') &&
        executionLabels.includes('钙片') &&
        EXERCISE_PICKS.every((name) => executionLabels.includes(name)),
      firstLine(executionLabels, 170))
    record('执行区不展示「今天不吃」的补剂',
      !executionLabels.includes('鱼油'),
      firstLine(executionLabels, 170))
    record('执行轨道按日常锚点排列，未安排节点不伪装完成',
      execution.routeNodes.slice(0, 8).map((item) => item.id).join(',') ===
        'morning,meal-breakfast,supplement-' + execution.routeNodes[2]?.id?.slice(11) +
        ',meal-lunch,exercise,meal-dinner,supplement-' + execution.routeNodes[6]?.id?.slice(11) &&
        execution.routeNodes[0]?.state === 'unprepared' &&
        execution.routeNodes.find((item) => item.id === 'meal-dinner')?.state === 'unprepared',
      JSON.stringify(execution.routeNodes))
    record('今日页暂不渲染小火伙伴',
      execution.prepareHasFire === false,
      `准备页仍有小火=${execution.prepareHasFire}`)
    record('执行区勾选完成不影响准备区勾选',
      execution.before.every((item) => item.checked === false) &&
        execution.nextBefore.includes('晨间') && execution.nextAfter.includes('晨间') &&
        execution.failedToggle === 'UNCHECKED' &&
        execution.failed.status.includes('本地保存失败') &&
        execution.failed.reason.includes('模拟本地写入失败') && !execution.failed.feedback &&
        !execution.failed.breakfast &&
        ['完成，今天轻松一点了。', '好，这件事处理好了。', '不错，继续按自己的节奏来。'].includes(execution.feedbackAfterRetry.trim()) &&
        execution.breakfast === 'CHECKED' &&
        execution.vitamin === 'CHECKED' &&
        execution.workout === 'CHECKED' &&
        JSON.stringify(execution.prepBoxes) === JSON.stringify([false, true, false, false, false]) &&
      /1\/5/.test(execution.progressText),
      `顺序=${execution.routeNodes.map((item) => item.id).join(',')}, 状态=${execution.routeNodes.map((item) => item.state).join(',')}, 初始=${JSON.stringify(execution.before.map((item) => item.checked))}, 首次=${execution.failedToggle}/${execution.failed.status}/${execution.failed.reason}/${execution.failed.feedback}, 重试=${execution.breakfast}/${execution.feedbackAfterRetry}, 下一步=${execution.nextBefore}→${execution.nextAfter}, 补剂=${execution.vitamin}, 健身=${execution.workout}, 准备区=${JSON.stringify(execution.prepBoxes)} ${execution.progressText}`)
    record('连续完成后未安排节点仍是焦点，取消完成不显示庆祝反馈',
      execution.cancelBreakfast === 'UNCHECKED' &&
        execution.cancellation.next.includes('晨间') && !execution.cancellation.feedback &&
        execution.uncheckedLabels.length > 0 &&
        execution.allDone.states.every((item) => item.checked) &&
        execution.allDone.text === '先把这一项安排好' && execution.allDone.button &&
        ['完成，今天轻松一点了。', '好，这件事处理好了。', '不错，继续按自己的节奏来。'].includes(execution.allDone.feedback.trim()) &&
        execution.cancelLast === 'UNCHECKED' && execution.lastCancellation.next.includes('晨间') &&
        !execution.lastCancellation.feedback && execution.restoreLast === 'CHECKED',
      `撤销首项=${execution.cancelBreakfast}/${execution.cancellation.next}/${execution.cancellation.feedback}, 连续完成=${execution.uncheckedLabels.length} 项/全勾=${execution.allDone.states.every((item) => item.checked)}/完成提示=${execution.allDone.text}/按钮=${execution.allDone.button}, 撤销末项=${execution.cancelLast}/${execution.lastCancellation.next}/${execution.lastCancellation.feedback}, 恢复=${execution.restoreLast}`)

    // 9. 自定义事项：新增
    const taskAdded = await evaluate(`
      (async () => {
        window.__m.clickContains('添加事项');
        await window.__m.wait(800);
        // 自定义事项是居中卡片，不是底部抽屉：用形态无关的 data-editor-card 定位。
        const title = (document.querySelector('[data-editor-card] h2') || {}).textContent;
        const centerCard = !!document.querySelector('.center-card[data-editor-card]');
        const bottomSheet = !!document.querySelector('.bottom-sheet[data-editor-card]');
        window.__m.clickText('保存');
        await window.__m.wait(300);
        const validation = {
          title: !!document.getElementById('task-title-error'),
          time: !!document.getElementById('task-time-error'),
          card: !!document.querySelector('[data-editor-card]'),
        };
        window.__m.fill('事项名称', ${JSON.stringify(TASK_NAME)});
        window.__m.fill('时间', '09:00');
        await window.__m.wait(200);
        window.__m.clickText('保存');
        await window.__m.wait(1300);
        const rows = [...document.querySelectorAll('.task-row')];
        return JSON.stringify({ title, count: rows.length, centerCard, bottomSheet, validation, found: rows.some((row) => row.textContent.includes(${JSON.stringify(TASK_NAME)})) });
      })()
    `)
    const taskData = JSON.parse(taskAdded)
    record('自定义事项必填校验且可新增', taskData.title === '添加事项' && taskData.validation.title === true && taskData.validation.time === true && taskData.validation.card === true && taskData.found === true && taskData.count === 1,
      `面板标题=${taskData.title}, 事项数=${taskData.count}`)
    record('自定义事项编辑用居中卡片（不是底部抽屉）', taskData.centerCard === true && taskData.bottomSheet === false,
      `center-card=${taskData.centerCard}, bottom-sheet=${taskData.bottomSheet}`)

    // 10. 自定义事项：编辑
    const taskEdited = await evaluate(`
      (async () => {
        const row = [...document.querySelectorAll('.task-row')][0];
        if (!row) return 'NO_ROW';
        row.querySelector('button.mini').click();
        await window.__m.wait(800);
        window.__m.fill('事项名称', '测试事项已改');
        await window.__m.wait(200);
        window.__m.clickText('保存');
        await window.__m.wait(1300);
        return JSON.stringify({ found: window.__m.text().includes('测试事项已改') });
      })()
    `)
    record('自定义事项可编辑', JSON.parse(taskEdited).found === true)

    // 11. 自定义事项：删除（二次确认）
    const taskDeleted = await evaluate(`
      (async () => {
        const row = [...document.querySelectorAll('.task-row')][0];
        if (!row) return 'NO_ROW';
        const buttons = [...row.querySelectorAll('button.mini')];
        const del = buttons.find((b) => b.textContent.trim() === '删除');
        if (!del) return 'NO_DELETE';
        del.click();
        await window.__m.wait(700);
        const asked = (document.querySelector('.confirm-modal') || {}).innerText || '';
        window.__m.clickText('确认删除');
        await window.__m.wait(1300);
        return JSON.stringify({ asked: asked.includes('删除事项'), remaining: document.querySelectorAll('.task-row').length });
      })()
    `)
    const deletedData = JSON.parse(taskDeleted)
    record('自定义事项删除需二次确认且可删除', deletedData.asked === true && deletedData.remaining === 0,
      `确认框=${deletedData.asked}, 剩余=${deletedData.remaining}`)

    // 12. 复制昨天：内容复制但不带任何状态，且不改目标日模式与 mode_override
    const copied = await evaluate(`
      (async () => {
        window.__m.clickAria('后一天', '.icon-button');
        await window.__m.wait(1400);
        const modeBefore = window.__m.modeLabel();
        window.__m.clickText('复制昨天');
        await window.__m.wait(700);
        const asked = (document.querySelector('.confirm-modal') || {}).innerText || '';
        window.__m.clickText('确认覆盖');
        await window.__m.wait(1800);
        const body = window.__m.text();
        const selectedDate = document.querySelector('.date-heading .muted')?.textContent || '';
        const previousDate = new Date(new Date(selectedDate + 'T00:00:00Z').getTime() - 86400000)
          .toISOString().slice(0, 10);
        const [plans, meals, mealItems, supplements, exercises, tasks] = await Promise.all([
          window.__m.dbRecords('day_plans').then(JSON.parse),
          window.__m.dbRecords('daily_meals').then(JSON.parse),
          window.__m.dbRecords('daily_meal_items').then(JSON.parse),
          window.__m.dbRecords('daily_supplements').then(JSON.parse),
          window.__m.dbRecords('daily_exercise_items').then(JSON.parse),
          window.__m.dbRecords('custom_tasks').then(JSON.parse),
        ]);
        const targetPlan = plans.find((item) => item.plan_date === selectedDate);
        const sourcePlan = plans.find((item) => item.plan_date === previousDate);
        const targetMeals = meals.filter((item) => item.day_plan_id === targetPlan?.id);
        const sourceMeals = meals.filter((item) => item.day_plan_id === sourcePlan?.id);
        const targetMealIds = new Set(targetMeals.map((item) => item.id));
        const sourceMealIds = new Set(sourceMeals.map((item) => item.id));
        const targetMealItems = mealItems.filter((item) => targetMealIds.has(item.daily_meal_id));
        const sourceMealItems = mealItems.filter((item) => sourceMealIds.has(item.daily_meal_id));
        const targetSupplements = supplements.filter((item) => item.day_plan_id === targetPlan?.id);
        const sourceSupplements = supplements.filter((item) => item.day_plan_id === sourcePlan?.id);
        const targetExercises = exercises.filter((item) => item.day_plan_id === targetPlan?.id);
        const sourceExercises = exercises.filter((item) => item.day_plan_id === sourcePlan?.id);
        const targetTasks = tasks.filter((item) => item.day_plan_id === targetPlan?.id);
        return JSON.stringify({
          asked: asked.includes('不会复制任何准备勾选'),
          hasMeals: ${JSON.stringify(BREAKFAST_FOODS)}.every((name) => targetMealItems.some((item) => item.food_name_snapshot === name)) &&
            targetMealItems.some((item) => item.food_name_snapshot === ${JSON.stringify(LUNCH_FOODS[0])}),
          hasSupplements: ['维生素 D', '钙片'].every((name) => targetSupplements.some((item) => item.name_snapshot === name && item.planned)),
          fishStaysUnplanned: !targetSupplements.some((item) => item.name_snapshot === '鱼油' && item.planned),
          hasExercise: targetPlan?.exercise_decision === 'exercise' &&
            ${JSON.stringify(EXERCISE_PICKS)}.every((name) => targetExercises.some((item) => item.name_snapshot === name)),
          prep: targetPlan ? ['outfit_ready', 'meals_ready', 'supplements_ready', 'morning_ready', 'exercise_ready']
            .map((key) => targetPlan[key]) : [],
          completionReset: targetMeals.every((item) => !item.completed) &&
            targetSupplements.every((item) => !item.completed) &&
            targetTasks.every((item) => !item.completed) &&
            targetPlan?.morning_completed === false && targetPlan?.exercise_completed === false,
          sourceHadContent: sourceMeals.length > 0 && sourceMealItems.length > 0 &&
            sourceSupplements.length > 0 && sourceExercises.length > 0,
          targetDate: selectedDate,
          sourceDate: previousDate,
          progress: window.__m.progress(),
          modeBefore,
          modeAfter: window.__m.modeLabel(),
          overrideAfter: body.includes('人工覆盖默认模式'),
        });
      })()
    `)
    const copyData = JSON.parse(copied)
    const prepAllCleared = copyData.prep.length === 0 || copyData.prep.every((value) => value === false)
    record('复制昨天带三餐 / 补剂 / 健身内容但不带准备勾选',
      copyData.asked && copyData.sourceHadContent && copyData.hasMeals && copyData.hasSupplements &&
        copyData.hasExercise && prepAllCleared && copyData.completionReset,
      `来源=${copyData.sourceDate}, 目标=${copyData.targetDate}, 来源有内容=${copyData.sourceHadContent}, 三餐=${copyData.hasMeals}, 补剂=${copyData.hasSupplements}, 健身=${copyData.hasExercise}, 完成状态已清空=${copyData.completionReset}, 准备项=${JSON.stringify(copyData.prep)}`)
    record('复制昨天原样带走「今天不吃」的补剂，不回填成默认吃',
      copyData.fishStaysUnplanned === true,
      `模式=${copyData.modeBefore}→${copyData.modeAfter}, 鱼油保持未安排=${copyData.fishStaysUnplanned}`)
    record('复制昨天不改目标日模式与人工覆盖',
      copyData.modeBefore === copyData.modeAfter && copyData.overrideAfter === false,
      `模式 ${copyData.modeBefore} → ${copyData.modeAfter}, 复制后存在人工覆盖=${copyData.overrideAfter}`)

    // 12b. 复制过来的内容不带任何完成状态：执行区应当整片未勾选
    const copiedExecution = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickText('执行今天');
        await window.__m.wait(1100);
        window.__m.clickAria('后一天', '.icon-button');
        await window.__m.wait(1100);
        window.__m.clickAria('后一天', '.icon-button');
        await window.__m.wait(1500);
        return JSON.stringify({
          states: window.__m.executeStates(),
          hasContent: !!document.querySelector('.today-route'),
        });
      })()
    `))
    record('复制昨天不带走任何完成状态',
      copyData.completionReset && copiedExecution.hasContent === true &&
        copiedExecution.states.every((item) => item.checked === false),
      `执行区状态=${JSON.stringify(copiedExecution.states.map((item) => item.checked))}`)

    // 12c. L3：休息日家务——导航到本周六（正常休息日），验证自动出现拖地 / 洗衣
    const saturdayOffset = daysToSaturday()
    const restDay = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickText('执行今天');
        await window.__m.wait(1100);
        for (let i = 0; i < ${saturdayOffset}; i += 1) {
          window.__m.clickAria('后一天', '.icon-button');
          await window.__m.wait(900);
        }
        await window.__m.wait(1500);
        return JSON.stringify({
          mode: window.__m.modeLabel(),
          override: window.__m.text().includes('人工覆盖默认模式'),
          routines: window.__m.routineText(),
          hasPrepList: !!document.querySelector('.prep-list'),
          hasRoutineList: document.querySelectorAll('[data-routine]').length > 0,
        });
      })()
    `))
    record('周六默认是休息日且无人工覆盖',
      restDay.mode === '休息日' && restDay.override === false,
      `模式=${restDay.mode}, 人工覆盖=${restDay.override}`)
    record('正常休息日自动出现拖地 / 洗衣两个实例',
      restDay.routines.includes('拖地') && restDay.routines.includes('洗衣') && restDay.routines.length === 2,
      `家务=${restDay.routines.join('、')}`)
    record('休息日隐藏工作日准备项（衣服 / 三餐 / 晨间）',
      restDay.hasPrepList === false,
      `准备列表存在=${restDay.hasPrepList}`)

    // 12d. 家务可勾选完成，刷新后保留
    const routineToggle = await evaluate(`window.__m.routineToggle('拖地已完成')`)
    await sleep(300)
    const routineAfter = await evaluate(`window.__m.routineToggle('洗衣已完成')`)
    record('家务可逐项勾选完成',
      routineToggle === 'CHECKED' && routineAfter === 'CHECKED',
      `拖地=${routineToggle}, 洗衣=${routineAfter}`)

    // 12e. 临时不上班（工作日切休息日）不自动带家务
    const tempRest = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('改为');
        await window.__m.wait(700);
        const dialog = (document.querySelector('.confirm-modal') || {}).innerText || '';
        window.__m.clickText('确认切换');
        await window.__m.wait(1400);
        return JSON.stringify({
          dialogOk: dialog.includes('这一天会改为工作日。'),
          mode: window.__m.modeLabel(),
          override: window.__m.text().includes('人工覆盖默认模式'),
          routines: window.__m.routineText(),
          hasRestNote: window.__m.text().includes('临时不上班'),
        });
      })()
    `))
    record('休息日切工作日有二次确认且文案正确',
      tempRest.dialogOk === true && tempRest.mode === '工作日' && tempRest.override === true,
      `确认框=${tempRest.dialogOk}, 模式=${tempRest.mode}, 覆盖=${tempRest.override}`)

    // 12f. 从工作日切回休息日（临时不上班），不自动带家务
    const tempRestBack = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('改为');
        await window.__m.wait(700);
        window.__m.clickText('确认切换');
        await window.__m.wait(1400);
        if (document.querySelector('[data-testid="holiday-celebration"]')) {
          window.__m.clickText('跳过演出');
          await window.__m.wait(180);
        }
        return JSON.stringify({
          mode: window.__m.modeLabel(),
          override: window.__m.text().includes('人工覆盖默认模式'),
          routines: window.__m.routineText(),
          hasRestNote: window.__m.text().includes('临时不上班'),
          hasPrepList: !!document.querySelector('.prep-list'),
        });
      })()
    `))
    record('临时不上班（人工切休息日）不自动带家务且显示说明',
      tempRestBack.mode === '休息日' &&
        tempRestBack.override === true &&
        tempRestBack.routines.length === 0 &&
        tempRestBack.hasRestNote === true,
      `模式=${tempRestBack.mode}, 覆盖=${tempRestBack.override}, 家务=${tempRestBack.routines.join('、')}, 说明=${tempRestBack.hasRestNote}`)

    // 12g. 休息日仍保留补剂 / 健身 / 自定义事项入口（自定义事项列表应可见）
    const restKeeps = JSON.parse(await evaluate(`
      JSON.stringify({
        hasSupplement: window.__m.text().includes('早中晚补剂') || window.__m.text().includes('补剂'),
        hasTimeline: window.__m.text().includes('自定义事项'),
        hasPrepList: !!document.querySelector('.prep-list'),
      })
    `))
    record('休息日保留补剂 / 健身 / 自定义事项，隐藏工作日准备项',
      restKeeps.hasTimeline === true && restKeeps.hasPrepList === false,
      `自定义事项=${restKeeps.hasTimeline}, 准备列表=${restKeeps.hasPrepList}`)

    // 12h. 恢复默认回到正常休息日，家务重新出现（补齐不重复）
    await evaluate(`window.__m.clickContains('恢复默认')`)
    await sleep(1400)
    const restoredRest = JSON.parse(await evaluate(`
      JSON.stringify({
        mode: window.__m.modeLabel(),
        override: window.__m.text().includes('人工覆盖默认模式'),
        routines: window.__m.routineText(),
      })
    `))
    record('恢复默认回到正常休息日并重新补齐家务',
      restoredRest.mode === '休息日' &&
        restoredRest.override === false &&
        restoredRest.routines.includes('拖地') &&
        restoredRest.routines.includes('洗衣') &&
        restoredRest.routines.length === 2,
      `模式=${restoredRest.mode}, 覆盖=${restoredRest.override}, 家务=${restoredRest.routines.join('、')}`)

    // 回到「执行今天」且是今天，供后续刷新恢复测试使用
    await evaluate(`window.__m.clickText('执行今天')`)
    await sleep(1100)

    // 13. 刷新恢复
    await goto()
    const afterReload = await text()
    record('刷新后会话恢复且仍在日计划页', afterReload.includes('执行今天') && !afterReload.includes('账号'))
    await evaluate(`window.__m.clickText('准备明天')`)
    await sleep(1100)
    const persisted = await text()
    record('刷新后规划内容从本地数据库恢复',
      persisted.includes('燕麦牛奶') && persisted.includes('维生素 D'),
      firstLine(persisted, 120))

    // 14. 选项页（L1）：概览入口与状态摘要、三份清单各自的子屏、可用数量口径与本地模式说明
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const optionPage = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        // 概览：三类清单入口（带状态摘要）+ 系统项入口，以及概览自身的体量
        out.entries = ['food', 'supplement', 'exercise'].filter((kind) => !!window.__m.optionEntry(kind));
        out.entrySummaries = {
          food: window.__m.optionEntrySummary('food'),
          supplement: window.__m.optionEntrySummary('supplement'),
          exercise: window.__m.optionEntrySummary('exercise'),
        };
        out.systemEntries = ['backup', 'storage'].filter((key) => !!window.__m.optionEntry(key));
        const region = document.querySelector('.page-scroll');
        out.overviewButtons = region.querySelectorAll('button').length;

        // 三份清单各自的子屏：标题与入口标签一致，清单、摘要、分组都在自己的屏里
        out.lists = {};
        out.summaries = {};
        out.titles = {};
        for (const kind of ['food', 'supplement', 'exercise']) {
          await window.__m.openOptionList(kind);
          out.titles[kind] = (document.querySelector('.topbar h1') || {}).textContent || '';
          out.lists[kind] = window.__m.optionNames(kind);
          out.summaries[kind] = window.__m.optionSummary(kind);
          if (kind === 'supplement') out.supplementGroups = window.__m.optionGroupLabels(kind);
          if (kind === 'food') {
            const rows = [...document.querySelectorAll('.option-row')];
            out.rowHeight = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0) / rows.length) : 0;
            out.rowButtons = rows.length ? rows[0].querySelectorAll('button').length : 0;
            // 停用语义说明在清单屏（停用发生的地方），不在概览页。
            out.hint = window.__m.text().includes('停用只影响以后的新计划');
          }
        }
        await window.__m.openOptionList('account');
        out.account = window.__m.accountText();
        out.sync = window.__m.syncText();
        await window.__m.openOptionsOverview();
        return JSON.stringify(out);
      })()
    `))
    record('选项概览渲染三类清单入口与状态摘要',
      optionPage.entries.length === 3 && optionPage.entrySummaries.food === '启用 5 项',
      `入口=${optionPage.entries.join(',')}；食物摘要「${optionPage.entrySummaries.food}」`)
    record('概览把系统项与清单分开',
      optionPage.systemEntries.length === 2,
      `系统入口=${optionPage.systemEntries.join(',')}`)
    record('清单子屏说明了停用只影响以后的新计划', optionPage.hint === true)
    record('概览按钮数从 71 降到个位数',
      optionPage.overviewButtons <= 15,
      `${optionPage.overviewButtons} 个按钮`)

    // 概览是否真的一屏内：必须在手机视口下量才有意义（脚本默认窗口高度只有几百像素）。
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await sleep(600)
    const overviewFit = JSON.parse(await evaluate(`      (async () => {
        await window.__m.openOptionsOverview();
        const region = document.querySelector('.page-scroll');
        const children = [...region.children];
        const last = children[children.length - 1];
        // 余量必须单独量：内容比可视区矮时 scrollHeight 会被 clientHeight 顶住，
        // 只看它分不出「刚好塞满」和「还有富余」（见 docs/17 §4.1 的实测口径）。
        // 再减去面板自身的下内边距，才是真正能吸收字体差异的余量。
        const paddingBottom = parseFloat(getComputedStyle(region).paddingBottom) || 0;
        return JSON.stringify({
          content: region.scrollHeight,
          visible: region.clientHeight,
          viewport: window.innerHeight,
          free: last ? Math.round(region.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom - paddingBottom) : null,
          breakdown: children.map((el) => Math.round(el.getBoundingClientRect().height) + ':' + String(el.className).split(' ')[0]).join(' '),
        });
      })()
    `))
    // 概览截图在手机视口下拍：这才是目标形态（脚本默认窗口只有几百像素高，拍出来不代表真机）。
    await shot('04-选项页')
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await sleep(400)
    record('概览在 390x844 手机视口下一屏放下（改前 4.1 屏）',
      overviewFit.content <= overviewFit.visible && (overviewFit.free ?? -1) >= 24,
      `内容区可视 ${overviewFit.content}px，真实余量 ${overviewFit.free}px（≥24 才够 iOS 字体差异）；各块 ${overviewFit.breakdown}`)
    record('每个清单进自己的子屏，标题与入口标签一致',
      optionPage.titles.food === '常用食物' &&
        optionPage.titles.supplement === '固定补剂' &&
        optionPage.titles.exercise === '健身项目与动作',
      Object.values(optionPage.titles).join(' / '))
    record('选项行内只剩拖拽手柄与溢出菜单（改前每行 5 个按钮）',
      optionPage.rowButtons === 2 && optionPage.rowHeight <= 70,
      `每行 ${optionPage.rowButtons} 个按钮，行高 ${optionPage.rowHeight}px`)
    record('新账号自动带出可编辑的示例选项',
      optionPage.lists.food.length === 5 && optionPage.lists.supplement.length === 3 && optionPage.lists.exercise.length === 4,
      `食物 ${optionPage.lists.food.length} / 补剂 ${optionPage.lists.supplement.length} / 健身 ${optionPage.lists.exercise.length}`)
    record('补剂示例按早 / 中 / 晚分组', JSON.stringify(optionPage.supplementGroups) === JSON.stringify(['早', '中', '晚']),
      optionPage.supplementGroups.join(','))
    record('初始全部启用，可用数量与清单一致',
      optionPage.summaries.food === '启用 5 项 · 停用 0 项' &&
        optionPage.summaries.supplement === '启用 3 项 · 停用 0 项' &&
        optionPage.summaries.exercise === '启用 4 项 · 停用 0 项',
      `食物「${optionPage.summaries.food}」`)
    record('统一账号说明不伪装云端同步成功',
      optionPage.account.includes('统一账号') && !/已同步|同步成功|上次同步/.test(optionPage.account),
      firstLine(optionPage.account, 80))

    // S3：账号与同步子屏多了一张云端同步卡。本脚本的运行环境就是「未配置云端」
    // （项目里没有 .env.local），此时它必须**直说不可用**，而不是给一个点了必然报错的按钮。
    // 另一条同类证据在整轮交互结束时：零跨域请求（见脚本开头的 Network 监听）。
    record('未配置云端时同步卡说明不可用，且不给可点的连接按钮',
      optionPage.sync.includes('云端同步不可用') && !optionPage.sync.includes('连接已有账号'),
      firstLine(optionPage.sync, 90))
    record('未配置云端时同步卡不出现任何「已同步」说法',
      !/已同步|同步成功|上次同步/.test(optionPage.sync),
      firstLine(optionPage.sync, 90))

    // 15. 选项页（L1）：新增 / 重名校验 / 排序 / 改名 / 停用 / 删除（都在清单子屏里，动作走行内溢出菜单）
    const mutations = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        // 清单现在在自己的子屏里：先进入「常用食物」。
        out.opened = await window.__m.openOptionList('food');
        window.__m.clickSectionContains('food', '添加食物');
        await window.__m.wait(700);
        out.addTitle = (document.querySelector('.bottom-sheet h2') || {}).textContent || '';
        window.__m.fill('名称', ${JSON.stringify(FOOD_NAME)});
        await window.__m.wait(150);
        window.__m.clickText('添加');
        await window.__m.wait(1300);
        out.afterAdd = window.__m.optionNames('food');
        out.addSummary = window.__m.optionSummary('food');

        // 重名必须被拒绝，且面板保留输入供改正
        window.__m.clickSectionContains('food', '添加食物');
        await window.__m.wait(700);
        window.__m.fill('名称', ${JSON.stringify(FOOD_NAME)});
        await window.__m.wait(150);
        window.__m.clickText('添加');
        await window.__m.wait(1200);
        out.duplicateNotice = (document.querySelector('.notice') || {}).textContent || '';
        out.sheetKept = !!document.querySelector('.bottom-sheet');
        window.__m.clickText('取消');
        await window.__m.wait(600);

        // 上移：与「清炒时蔬」交换位置
        await window.__m.clickOptionButton(${JSON.stringify(FOOD_NAME)}, '上移');
        await window.__m.wait(1300);
        out.afterMove = window.__m.optionNames('food');

        await window.__m.clickOptionButton(${JSON.stringify(FOOD_NAME)}, '改名');
        await window.__m.wait(700);
        window.__m.fill('名称', ${JSON.stringify(FOOD_RENAMED)});
        await window.__m.wait(150);
        window.__m.clickText('保存');
        await window.__m.wait(1300);
        out.afterRename = window.__m.optionNames('food');

        // 停用：需二次确认，且「可用数量」随之下降（该数量与 L2 选择器同源）
        await window.__m.clickOptionButton(${JSON.stringify(FOOD_RENAMED)}, '停用');
        await window.__m.wait(700);
        out.disableAsked = (document.querySelector('.confirm-modal') || {}).innerText || '';
        window.__m.clickText('确认停用');
        await window.__m.wait(1300);
        out.afterDisable = {
          names: window.__m.optionNames('food'),
          status: window.__m.optionStatus(${JSON.stringify(FOOD_RENAMED)}),
          summary: window.__m.optionSummary('food'),
        };

        // 删除：需二次确认，删完即从清单消失
        window.__m.clickSectionContains('food', '添加食物');
        await window.__m.wait(700);
        window.__m.fill('名称', ${JSON.stringify(TEMP_NAME)});
        await window.__m.wait(150);
        window.__m.clickText('添加');
        await window.__m.wait(1300);
        await window.__m.clickOptionButton(${JSON.stringify(TEMP_NAME)}, '删除');
        await window.__m.wait(700);
        out.deleteAsked = (document.querySelector('.confirm-modal') || {}).innerText || '';
        window.__m.clickText('确认删除');
        await window.__m.wait(1300);
        out.afterDelete = window.__m.optionNames('food');
        out.finalSummary = window.__m.optionSummary('food');
        return JSON.stringify(out);
      })()
    `))
    const SEED_FOODS = ['燕麦牛奶', '水煮蛋', '鸡胸沙拉', '番茄鸡蛋面', '清炒时蔬']
    record('新增食物立即出现在清单末尾',
      mutations.addTitle === '添加食物' && JSON.stringify(mutations.afterAdd) === JSON.stringify([...SEED_FOODS, FOOD_NAME]),
      `面板标题=${mutations.addTitle}, 清单=${mutations.afterAdd.join(',')}`)
    record('重名被拒绝且面板保留输入',
      mutations.duplicateNotice.includes('已有同名选项') && mutations.sheetKept === true,
      firstLine(mutations.duplicateNotice, 60))
    record('上移按同组交换顺序',
      JSON.stringify(mutations.afterMove) ===
        JSON.stringify([...SEED_FOODS.slice(0, 4), FOOD_NAME, SEED_FOODS[4]]),
      mutations.afterMove.join(','))
    record('改名只改目标项',
      JSON.stringify(mutations.afterRename) ===
        JSON.stringify([...SEED_FOODS.slice(0, 4), FOOD_RENAMED, SEED_FOODS[4]]),
      mutations.afterRename.join(','))
    record('停用需二次确认且停用项保留在清单里',
      mutations.disableAsked.includes('不会再出现在新计划的选择器中') &&
        mutations.afterDisable.status === '已停用' &&
        mutations.afterDisable.names.includes(FOOD_RENAMED),
      `确认框含停用说明=${mutations.disableAsked.includes('不会再出现在新计划的选择器中')}, 行状态=${mutations.afterDisable.status}`)
    record('停用后可用数量下降（与选择器同源）',
      mutations.afterDisable.summary === '启用 5 项 · 停用 1 项',
      mutations.afterDisable.summary)
    record('删除需二次确认且删除后从清单消失',
      mutations.deleteAsked.includes('不再出现在候选清单里') &&
        !mutations.afterDelete.includes(TEMP_NAME) &&
        mutations.afterDelete.length === 6,
      `确认框含删除说明=${mutations.deleteAsked.includes('不再出现在候选清单里')}, 剩余=${mutations.afterDelete.length}`)
    record('删除临时项后停用计数不受影响', mutations.finalSummary === '启用 5 项 · 停用 1 项', mutations.finalSummary)

    // 15a-2. 写入钩子（S2）：删除同样要进队列。上面刚真删掉了一项食物（走 optionService.remove → localDb.remove），
    //        队列里就该有一条 food_options 的 delete。这是「remove 也挂了钩子」的运行时证据——
    //        check:sync 只能证明规则正确，证明不了它真的被调用。
    const queuedDelete = JSON.parse(await evaluate(`
      (async () => {
        const rows = await new Promise((resolve, reject) => {
          const request = indexedDB.open(${JSON.stringify(DB_NAME)});
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const all = db.transaction('sync_outbox', 'readonly').objectStore('sync_outbox').getAll();
            all.onsuccess = () => { resolve(all.result ?? []); db.close(); };
            all.onerror = () => reject(all.error);
          };
        });
        return JSON.stringify(rows);
      })()
    `))
    record('删除食物后队列里出现一条 food_options 的 delete',
      queuedDelete.some((row) => row.store === 'food_options' && row.op === 'delete'),
      `队列 ${queuedDelete.length} 条，操作类型=${JSON.stringify([...new Set(queuedDelete.map((row) => row.op))])}`)

    // 15b. 拖拽排序（本次新增的交互）：按住手柄往下拖一位，顺序交换；再拖回来，顺序复原。
    //      用 CDP 派发真实鼠标事件（Chrome 会据此合成 pointer 事件），因此走的是和生产一致的那条路径。
    const dragStart = JSON.parse(await evaluate(`
      (async () => {
        await window.__m.openOptionList('food');
        const rows = [...document.querySelectorAll('.option-row')];
        const handle = rows[0].querySelector('.drag-handle');
        handle.scrollIntoView({ block: 'center' });
        await window.__m.wait(300);
        const box = handle.getBoundingClientRect();
        return JSON.stringify({
          before: window.__m.optionNames('food'),
          x: Math.round(box.left + box.width / 2),
          y: Math.round(box.top + box.height / 2),
          step: Math.round(rows[0].getBoundingClientRect().height),
        });
      })()
    `))
    async function dragBy(fromY, delta) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragStart.x, y: fromY, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x, y: fromY + delta, button: 'left' })
      await sleep(250)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragStart.x, y: fromY + delta, button: 'left', clickCount: 1 })
      await sleep(1600)
    }
    await dragBy(dragStart.y, dragStart.step)
    const draggedDown = JSON.parse(await evaluate(`JSON.stringify({ names: window.__m.optionNames('food') })`))
    record('拖拽手柄可以把一项往下拖一位（顺序交换）',
      draggedDown.names[0] === dragStart.before[1] && draggedDown.names[1] === dragStart.before[0],
      `拖前=${dragStart.before.slice(0, 2).join(',')} → 拖后=${draggedDown.names.slice(0, 2).join(',')}`)

    // 反向拖回去，顺便把数据还原成后续断言期望的顺序
    const dragBack = JSON.parse(await evaluate(`
      (async () => {
        const rows = [...document.querySelectorAll('.option-row')];
        const handle = rows[1].querySelector('.drag-handle');
        handle.scrollIntoView({ block: 'center' });
        await window.__m.wait(300);
        const box = handle.getBoundingClientRect();
        return JSON.stringify({
          y: Math.round(box.top + box.height / 2),
          step: Math.round(rows[1].getBoundingClientRect().height),
        });
      })()
    `))
    await dragBy(dragBack.y, -dragBack.step)
    const draggedUp = JSON.parse(await evaluate(`JSON.stringify({ names: window.__m.optionNames('food') })`))
    record('拖拽可以往回拖（顺序复原）',
      JSON.stringify(draggedUp.names) === JSON.stringify(dragStart.before),
      `复原后=${draggedUp.names.slice(0, 2).join(',')}`)

    // 16. 选项页（L1）：补剂按时段落位，健身项目保持独立（各自在自己的子屏里）
    const supplement = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('supplement');
        window.__m.clickSectionContains('supplement', '添加补剂');
        await window.__m.wait(700);
        out.periodField = (document.querySelector('.bottom-sheet') || {}).innerText.includes('时段');
        window.__m.fill('名称', ${JSON.stringify(SUPPLEMENT_NAME)});
        await window.__m.wait(150);
        window.__m.fill('时段', 'noon');
        await window.__m.wait(150);
        window.__m.clickText('添加');
        await window.__m.wait(1300);
        out.names = window.__m.optionNames('supplement');
        out.groups = window.__m.optionGroupLabels('supplement');
        out.midGroup = window.__m.optionGroupNames('supplement', '中');
        out.summary = window.__m.optionSummary('supplement');
        // 健身是另一屏：进去取一次，再回到补剂屏留给下面的截图
        await window.__m.openOptionList('exercise');
        out.exercise = window.__m.optionNames('exercise');
        out.exerciseSummary = window.__m.optionSummary('exercise');
        await window.__m.openOptionList('supplement');
        return JSON.stringify(out);
      })()
    `))
    record('补剂面板要求选择早 / 中 / 晚时段', supplement.periodField === true)
    record('新增补剂按 sort_order 落到「中」分组',
      JSON.stringify(supplement.names) === JSON.stringify(['维生素 D', '鱼油', SUPPLEMENT_NAME, '钙片']) &&
        JSON.stringify(supplement.midGroup) === JSON.stringify(['鱼油', SUPPLEMENT_NAME]),
      `清单=${supplement.names.join(',')}；中组=${supplement.midGroup.join(',')}`)
    record('健身分区不参与时段分组且保持独立',
      JSON.stringify(supplement.exercise) === JSON.stringify(['快走', '瑜伽', '力量训练', '拉伸']) &&
        supplement.exerciseSummary === '启用 4 项 · 停用 0 项',
      supplement.exercise.join(','))
    await shot('05-选项页-补剂分组')

    // 16b. 备份（L5）：备份 → 改数据 → 导入还原，验证「导出可恢复」这条验收线
    //      选择留在卡片里；这里用导出的文本做一次真实往返，并确认改过的数据被还原。
    const backupRoundTrip = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('backup');
        window.__m.backupClick('生成备份');
        await window.__m.wait(900);
        out.text = window.__m.backupText();
        out.note = window.__m.backupNote();

        // 改一下现有数据（新增一条食物），让备份与当前状态出现可见差异。
        // 清单在自己的子屏里，所以要先离开备份屏。
        await window.__m.openOptionList('food');
        window.__m.clickSectionContains('food', '添加食物');
        await window.__m.wait(700);
        window.__m.fill('名称', ${JSON.stringify(BACKUP_EXTRA_FOOD)});
        await window.__m.wait(150);
        window.__m.clickText('添加');
        await window.__m.wait(1300);
        out.afterEdit = window.__m.optionNames('food');

        // 回备份屏：重新粘回备份文本（改数据不会清空卡片里的文本，但显式重贴更贴近用户操作）
        await window.__m.openOptionList('backup');
        window.__m.backupPaste(out.text);
        await window.__m.wait(300);
        out.inspectResult = window.__m.backupClick('检查这份备份');
        await window.__m.wait(800);
        out.modalText = window.__m.backupModalText();
        out.modalOpen = window.__m.backupModalOpen();
        window.__m.clickText('确认导入并替换');
        await window.__m.wait(2600);
        out.imported = window.__m.backupImported();
        out.status = window.__m.text().split('\\n').find((line) => line.includes('本地保存状态')) || '';

        // 回食物屏确认还原结果
        await window.__m.openOptionList('food');
        out.restored = window.__m.optionNames('food');
        out.restoredStatus = window.__m.optionStatus(${JSON.stringify(FOOD_RENAMED)});
        return JSON.stringify(out);
      })()
    `))
    record('导出后修改数据，导入备份即还原',
      backupRoundTrip.afterEdit.includes(BACKUP_EXTRA_FOOD) &&
        !backupRoundTrip.restored.includes(BACKUP_EXTRA_FOOD) &&
        JSON.stringify(backupRoundTrip.restored) === JSON.stringify([...SEED_FOODS.slice(0, 4), FOOD_RENAMED, SEED_FOODS[4]]),
      `改后=${backupRoundTrip.afterEdit.join(',')} / 还原后=${backupRoundTrip.restored.join(',')}`)
    record('导入前必须二次确认且说明是「替换」',
      backupRoundTrip.modalText.includes('导入会用备份内容替换当前账号的全部数据') &&
        backupRoundTrip.modalText.includes('确认导入并替换'),
      firstLine(backupRoundTrip.modalText, 90))
    record('导入摘要列出备份里的内容与来源账号',
      backupRoundTrip.modalText.includes('共') && backupRoundTrip.modalText.includes(ACCOUNT),
      firstLine(backupRoundTrip.modalText, 90))
    record('导入后停用状态一并还原',
      backupRoundTrip.restoredStatus === '已停用',
      backupRoundTrip.restoredStatus)
    record('导入结果显示条数口径且保存状态落到已保存',
      backupRoundTrip.imported.includes('已替换为备份内容') && backupRoundTrip.status.includes('已保存'),
      `${firstLine(backupRoundTrip.imported, 60)} / ${backupRoundTrip.status.trim()}`)
    BACKUP_TEXT = backupRoundTrip.text

    // 17. 选项：刷新后仍在（本地持久化）
    await goto()
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const optionReload = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('food');
        out.food = window.__m.optionNames('food');
        out.foodStatus = window.__m.optionStatus(${JSON.stringify(FOOD_RENAMED)});
        out.foodSummary = window.__m.optionSummary('food');
        await window.__m.openOptionList('supplement');
        out.supplement = window.__m.optionNames('supplement');
        out.groups = window.__m.optionGroupLabels('supplement');
        await window.__m.openOptionsOverview();
        return JSON.stringify(out);
      })()
    `))
    record('刷新后选项清单与顺序保持不变',
      JSON.stringify(optionReload.food) === JSON.stringify(mutations.afterDelete) &&
        JSON.stringify(optionReload.supplement) === JSON.stringify(supplement.names),
      optionReload.food.join(','))
    record('刷新后停用状态与可用数量保持不变',
      optionReload.foodStatus === '已停用' && optionReload.foodSummary === '启用 5 项 · 停用 1 项',
      `${optionReload.foodStatus} / ${optionReload.foodSummary}`)
    record('刷新后补剂仍按早 / 中 / 晚分组',
      JSON.stringify(optionReload.groups) === JSON.stringify(['早', '中', '晚']),
      optionReload.groups.join(','))

    // 17b. 备份（L5）：生成 → 校验非法文本不覆盖 → 运行时契约守卫
    //      「格式错误不得覆盖现有数据」是 docs/05 L5 的硬性要求，这里在真浏览器里验一遍：
    //      坏文本连确认框都不该出现，更不该有任何写入。
    const backupFirst = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('backup');
        window.__m.backupClick('生成备份');
        await window.__m.wait(900);
        out.text = window.__m.backupText();
        out.note = window.__m.backupNote();
        out.hasCard = !!window.__m.backupSection();
        // 记下导入前的选项清单（要切到食物屏读），稍后用来证明坏文本没写进任何东西
        await window.__m.openOptionList('food');
        out.before = window.__m.optionNames('food');

        // 粘贴一段「看起来像 JSON、但格式标记不对」的文本
        await window.__m.openOptionList('backup');
        window.__m.backupPaste('{"app": "happy-little-molly", "format": "csv"}');
        await window.__m.wait(300);
        out.inspectDisabled = window.__m.backupClick('检查这份备份');
        await window.__m.wait(700);
        out.modalAfterBad = window.__m.backupModalOpen();
        out.errorText = window.__m.backupError();

        // 空输入时按钮本身就该禁用
        window.__m.backupClear();
        await window.__m.wait(500);
        out.inspectWhenEmpty = window.__m.backupClick('检查这份备份');

        // 回食物屏确认这一串操作没有写入任何东西
        await window.__m.openOptionList('food');
        out.after = window.__m.optionNames('food');
        await window.__m.openOptionList('backup');

        // 运行时契约守卫：坏记录必须被 assertRecord 拦下（不只靠静态检查）
        try {
          const schemas = await import('/src/services/local/recordSchemas.ts');
          const broken = { id: '', user_id: 'x', name: '缺字段的选项' };
          try {
            schemas.assertRecord('food_options', broken);
            out.guard = 'NO_THROW';
          } catch (reason) {
            out.guard = (reason && reason.code) + '|' + String(reason && reason.message);
          }
        } catch (reason) {
          out.guard = 'IMPORT_FAILED|' + String(reason && reason.message);
        }
        return JSON.stringify(out);
      })()
    `))
    record('选项页渲染本地备份卡片并能生成备份',
      backupFirst.hasCard === true && backupFirst.text.length > 200 && backupFirst.note.includes('共'),
      `${backupFirst.text.length} 字符 / 提示「${backupFirst.note}」`)
    record('生成的备份带格式标记与来源账号',
      backupFirst.text.includes('"format": "local-backup"') &&
        backupFirst.text.includes(`"username": ${JSON.stringify(ACCOUNT)}`),
      firstLine(backupFirst.text.split('\n').slice(0, 8).join(' '), 100))
    record('粘贴非法备份点「检查」不弹确认框',
      backupFirst.inspectDisabled === 'OK' && backupFirst.modalAfterBad === false,
      `点击结果=${backupFirst.inspectDisabled}, 弹框=${backupFirst.modalAfterBad}`)
    record('非法备份给出可读错误且不改动现有数据',
      backupFirst.errorText.includes('这份备份不能导入') &&
        JSON.stringify(backupFirst.after) === JSON.stringify(backupFirst.before),
      firstLine(backupFirst.errorText, 70))
    record('输入为空时「检查这份备份」按钮禁用',
      backupFirst.inspectWhenEmpty === 'DISABLED:检查这份备份',
      backupFirst.inspectWhenEmpty)
    record('运行时写入契约拦下坏记录',
      String(backupFirst.guard).startsWith('local_record_invalid') &&
        String(backupFirst.guard).includes('主键 id 不能为空'),
      firstLine(backupFirst.guard, 70))
    await shot('05b-选项页-备份卡片')

    // 18. 选项页视口
    let options390 = null
    for (const [label, width, height] of [
      ['桌面 1440x900', 1440, 900],
      ['手机 390x844', 390, 844],
      ['手机 320x844', 320, 844],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await sleep(700)
      const metrics = JSON.parse(await evaluate('JSON.stringify({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })'))
      if (width === 320) {
        record('选项页手机 320/390x844 无横向溢出', options390?.scroll <= options390?.inner && metrics.scroll <= metrics.inner,
          `390: ${options390?.scroll}/${options390?.inner}, 320: ${metrics.scroll}/${metrics.inner}`)
      } else if (width === 390) {
        options390 = metrics
      } else {
        record(`选项页 ${label} 无横向溢出`, metrics.scroll <= metrics.inner, `scrollWidth=${metrics.scroll}, innerWidth=${metrics.inner}`)
      }
      await shot(`06-选项页-视口-${label}`)
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await evaluate(`window.__m.clickText('今日')`)
    await sleep(900)

    // 19. 日计划页视口
    let day390 = null
    for (const [label, width, height] of [
      ['桌面 1440x900', 1440, 900],
      ['手机 390x844', 390, 844],
      ['手机 320x844', 320, 844],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await sleep(700)
      const metrics = JSON.parse(await evaluate('JSON.stringify({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })'))
      if (width === 320) {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
        await evaluate(`document.querySelector('.today-stack-surface')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
        const expanded = JSON.parse(await evaluate(`JSON.stringify((() => {
          const layer = document.querySelector('.today-stack.is-expanded');
          const card = layer?.querySelector('.today-stack-card-shell.is-expanded');
          const button = card?.querySelector('.today-stack-complete, .today-stack-arrange');
          const rect = (element) => element?.getBoundingClientRect();
          return {
            layer: rect(layer)?.width,
            cardLeft: rect(card)?.left,
            cardRight: rect(card)?.right,
            buttonRight: rect(button)?.right,
            inner: window.innerWidth,
            scroll: document.documentElement.scrollWidth,
          };
        })())`))
        await shot('07-日计划-展开-手机-320')
        const reduced = JSON.parse(await evaluate(`JSON.stringify({
          button: getComputedStyle(document.querySelector('.bottom-nav button')).transitionDuration,
          feedback: getComputedStyle(document.querySelector('.completion-feedback')).transitionDuration,
          focus: document.querySelector('.today-focus h2')?.textContent || '',
          route: !!document.querySelector('.today-route'),
        })`))
        record('手机 320x844 无横向溢出且关闭动效后状态完整',
          day390?.scroll <= day390?.inner && metrics.scroll <= metrics.inner &&
            reduced.button === '0s' && reduced.feedback === '0s' &&
            reduced.route && reduced.focus.length > 0 &&
            expanded.layer === expanded.inner && expanded.scroll <= expanded.inner &&
            expanded.cardLeft >= 0 && expanded.cardRight <= expanded.inner &&
            (!expanded.buttonRight || expanded.buttonRight <= expanded.inner),
          `390: ${day390?.scroll}/${day390?.inner}, 320: ${expanded.scroll}/${expanded.inner}, 展开卡片=${expanded.cardLeft}-${expanded.cardRight}, transition=${reduced.button}/${reduced.feedback}, 焦点=${reduced.focus.trim()}`)
        await evaluate(`document.querySelector('.today-stack-collapse')?.click()`)
        await cdp.send('Emulation.setEmulatedMedia', { features: [] })
      } else if (width === 390) {
        day390 = metrics
        await evaluate(`document.querySelector('.today-stack-surface')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
        await shot('07-日计划-展开-手机-390')
        await evaluate(`document.querySelector('.today-stack-collapse')?.click()`)
      } else {
        record(`${label} 无横向溢出`, metrics.scroll <= metrics.inner, `scrollWidth=${metrics.scroll}, innerWidth=${metrics.inner}`)
      }
      await shot(`07-日计划-视口-${label}`)
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride')

    // 19b. 弹层与底部导航的层级（真机反馈：抽屉里看不到「保存 / 取消」）
    // 底部导航是 fixed 且 z-index 30，抽屉也是 fixed 且贴着视口底边——两者在屏幕上抢同一条带子。
    // 导航若排在抽屉之上，抽屉钉底的操作区会被整条盖住，真机表现就是「确认和取消按钮看不到、点不到」。
    // 所以这里不只量矩形，还要在按钮中心做一次命中测试：位置算对但被别的东西盖住，同样算失败。
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await sleep(700)
    await evaluate(`window.__m.clickText('准备明天')`)
    await sleep(1200)
    await evaluate(`window.__m.clickContains('三餐已安排', '.row-main')`)
    await sleep(1200)
    const sheetLayering = JSON.parse(await evaluate(`
      (() => {
        const sheet = document.querySelector('.bottom-sheet[data-editor-card]');
        const actions = sheet ? sheet.querySelector('.actions') : null;
        const buttons = actions ? [...actions.querySelectorAll('button')] : [];
        const nav = document.querySelector('.bottom-nav');
        const navButton = nav ? nav.querySelector('button') : null;
        // 命中测试：中心点上真正接住指针的元素是否属于自己。返回 null（点在视口外）也算失败。
        const hit = (el) => {
          if (!el) return null;
          const box = el.getBoundingClientRect();
          const found = document.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2));
          return Boolean(found) && (el === found || el.contains(found) || found.contains(el));
        };
        return JSON.stringify({
          found: Boolean(sheet) && buttons.length > 0,
          labels: buttons.map((button) => button.textContent.trim()),
          buttonsHit: buttons.map(hit),
          actionsTop: actions ? Math.round(actions.getBoundingClientRect().top) : null,
          actionsBottom: actions ? Math.round(actions.getBoundingClientRect().bottom) : null,
          innerHeight: window.innerHeight,
          navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
          navHit: hit(navButton),
        });
      })()
    `))
    record('底部抽屉的「保存 / 取消」完整可见且可点（不被底部导航压住）',
      sheetLayering.found &&
        sheetLayering.buttonsHit.length > 0 &&
        sheetLayering.buttonsHit.every((value) => value === true) &&
        sheetLayering.actionsBottom !== null &&
        sheetLayering.actionsBottom <= sheetLayering.innerHeight,
      `按钮=${sheetLayering.labels.join('/')}，命中测试=${JSON.stringify(sheetLayering.buttonsHit)}，操作区 ${sheetLayering.actionsTop}→${sheetLayering.actionsBottom}（视口 ${sheetLayering.innerHeight}），导航顶边 ${sheetLayering.navTop}`)
    record('弹层打开时底部导航被遮罩盖住（不会在编辑途中误切页）',
      sheetLayering.navHit === false,
      `导航按钮命中自身=${sheetLayering.navHit}（期望 false：应被遮罩 / 抽屉盖住）`)
    await shot('07b-抽屉操作区-手机')
    await evaluate(`window.__m.clickText('取消')`)
    await sleep(900)
    await cdp.send('Emulation.clearDeviceMetricsOverride')

    // 19b. 并发建同一天的计划（S4 补丁 ① 的回归）
    //
    // 这一段直接复现那个缺陷：`upsertDayPlan` 早先是「先全表找、找不到就 put 一条新的」，
    // 读与写隔着事务边界。并发的两次调用会同时读到「不存在」，各建一条、各生成一个 id，
    // 第二条撞上 `day_plans.user_date` 唯一索引，写入整体失败并冒泡到界面
    // （`Unable to add key to index 'user_date'`）。休息日注册时两条路径必然并发：
    // `useDayPlanData` 自动建一份 rest 计划，界面上的首次写入同时也在建同一份。
    //
    // 用 10 个并发调用而不是 2 个：竞态窗口只有几十微秒，2 个调用偶尔会「恰好串上」而假通过。
    // 日期取远未来，既不可能与其它用例撞车，也一定是可写的（`assertWritableDate` 只挡历史）。
    const RACE_DATE = '2099-12-31'
    const race = JSON.parse(await evaluate(`
      (async () => {
        const { upsertDayPlan } = await import('/src/services/local/dayPlanService.ts');
        const { getAll } = await import('/src/services/local/localDb.ts');
        const attempts = await Promise.allSettled(
          Array.from({ length: 10 }, () => upsertDayPlan(${JSON.stringify(RACE_DATE)}, { morning_focus: '并发' })),
        );
        const rows = (await getAll('day_plans')).filter((plan) => plan.plan_date === ${JSON.stringify(RACE_DATE)});
        return JSON.stringify({
          rejected: attempts.filter((item) => item.status === 'rejected').map((item) => String(item.reason && item.reason.message || item.reason)),
          ids: [...new Set(attempts.filter((item) => item.status === 'fulfilled').map((item) => item.value.id))],
          rows: rows.length,
        });
      })()
    `))
    record('10 个并发调用建同一天的日计划，没有一次失败',
      race.rejected.length === 0,
      race.rejected.length ? race.rejected.slice(0, 2).join(' | ') : '0 次拒绝')
    record('并发建计划只落一行，且所有调用拿到同一个 id',
      race.rows === 1 && race.ids.length === 1,
      `落库 ${race.rows} 行，返回 ${race.ids.length} 个不同 id`)

    // 20. 退出登录
    await sleep(400)
    await evaluate(`window.__m.clickText('退出登录')`)
    await sleep(1500)
    const afterSignOut = await text()
    record('退出登录后回到登录页', afterSignOut.includes('账号') && afterSignOut.includes('注册'))

    // 21. 第二个本地账号：各自的选项互不可见（docs/05 L1「不同本地账号之间互不可见」）
    await evaluate(`
      (async () => {
        window.__m.fill('账号', ${JSON.stringify(ACCOUNT_B)});
        window.__m.fill('密码', ${JSON.stringify(PASSWORD)});
        await window.__m.wait(200);
        window.__m.clickText('注册');
      })()
    `)
    await sleep(1800)
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const secondAccount = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('food');
        out.food = window.__m.optionNames('food');
        await window.__m.openOptionList('supplement');
        out.supplement = window.__m.optionNames('supplement');
        await window.__m.openOptionList('exercise');
        out.exercise = window.__m.optionNames('exercise');
        await window.__m.openOptionList('account');
        out.account = window.__m.accountText();
        return JSON.stringify(out);
      })()
    `))
    const allSecondAccountNames = [...secondAccount.food, ...secondAccount.supplement, ...secondAccount.exercise]
    record('第二个账号只看到自己的示例选项',
      JSON.stringify(secondAccount.food) === JSON.stringify(SEED_FOODS) &&
        secondAccount.supplement.length === 3 &&
        secondAccount.exercise.length === 4,
      `食物=${secondAccount.food.join(',')}`)
    record('第二个账号看不到第一个账号的选项',
      !allSecondAccountNames.includes(FOOD_RENAMED) && !allSecondAccountNames.includes(SUPPLEMENT_NAME) && !allSecondAccountNames.includes(TEMP_NAME))
    record('账号卡显示当前登录账号', secondAccount.account.includes(ACCOUNT_B), firstLine(secondAccount.account, 60))

    // 21b. 清空站点数据（等同「清理浏览器数据」）后必须回到登录页，且库真的空了；
    //      重新注册一个新账号并导入之前导出的备份，数据应完整回来——这是备份存在的唯一理由。
    const ORIGIN = new URL(appUrl).origin
    await cdp.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' })
    await goto()
    // 清空动作发生在旧页面还活着的时候，旧页面的连接被强拆可能报出已被导航掉的噪音；
    // 那不是应用行为。从这里开始重新计数，后面的控制台检查仍然覆盖「清空之后」的完整流程。
    cdp.events.length = 0
    const afterWipe = await text()
    record('清空站点数据后回到登录页',
      afterWipe.includes('账号') && afterWipe.includes('注册') && !afterWipe.includes('执行今天'),
      firstLine(afterWipe, 70))

    const wipedSchema = JSON.parse(await evaluate(`(async () => { try { return await window.__m.dbSchema() } catch (reason) { return JSON.stringify({ error: String(reason) }) } })()`))
    record('清空后本地库已不存在（或为空库）',
      wipedSchema.exists === false || wipedSchema.names.length === 0,
      wipedSchema.exists === false ? '库不存在（未被动过）' : `tables=${wipedSchema.names.join(',')}`)

    await evaluate(`
      (async () => {
        window.__m.fill('账号', ${JSON.stringify(ACCOUNT_C)});
        window.__m.fill('密码', ${JSON.stringify(PASSWORD)});
        await window.__m.wait(200);
        window.__m.clickText('注册');
      })()
    `)
    await sleep(1800)
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const freshAccount = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('food');
        out.food = window.__m.optionNames('food');
        await window.__m.openOptionList('account');
        out.account = window.__m.accountText();
        return JSON.stringify(out);
      })()
    `))
    record('新账号拿到的是全新示例选项而不是旧数据',
      JSON.stringify(freshAccount.food) === JSON.stringify(SEED_FOODS) && freshAccount.account.includes(ACCOUNT_C),
      firstLine(freshAccount.account, 70))

    const restoredByImport = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('backup');
        window.__m.backupPaste(${JSON.stringify(BACKUP_TEXT)});
        await window.__m.wait(400);
        window.__m.backupClick('检查这份备份');
        await window.__m.wait(900);
        out.modal = window.__m.backupModalOpen();
        window.__m.clickText('确认导入并替换');
        await window.__m.wait(2800);
        out.imported = window.__m.backupImported();
        await window.__m.openOptionList('food');
        out.food = window.__m.optionNames('food');
        out.foodStatus = window.__m.optionStatus(${JSON.stringify(FOOD_RENAMED)});
        await window.__m.openOptionList('supplement');
        out.supplement = window.__m.optionNames('supplement');
        return JSON.stringify(out);
      })()
    `))
    record('换设备场景：新账号导入备份后选项完整回来',
      restoredByImport.modal === true &&
        JSON.stringify(restoredByImport.food) === JSON.stringify([...SEED_FOODS.slice(0, 4), FOOD_RENAMED, SEED_FOODS[4]]) &&
        restoredByImport.foodStatus === '已停用' &&
        restoredByImport.supplement.includes(SUPPLEMENT_NAME),
      `食物=${restoredByImport.food.join(',')} / 状态=${restoredByImport.foodStatus}`)
    record('导入结果提示写明「已替换为备份内容」',
      restoredByImport.imported.includes('已替换为备份内容'),
      firstLine(restoredByImport.imported, 80))

    // 导入回来的不只是选项：日计划本身也要能看见内容。
    // 断言只读「准备区」文本——选项页刚导完、刚 reload 过，全页文本里本来就有这些名字，
    // 拿全页文本去断言等于恒真。准备区的三餐摘要与补剂摘要来自这一天已保存的计划，
    // 它们出现才说明备份里的计划真的回到了界面上。
    await evaluate(`window.__m.clickText('今日')`)
    await sleep(1000)
    await evaluate(`window.__m.clickText('准备明天')`)
    await sleep(1800)
    const restoredPlan = JSON.parse(await evaluate(`
      JSON.stringify({
        prep: (() => {
          const list = document.querySelector('.prep-list');
          return list ? list.innerText.replace(/\\n+/g, ' · ').trim() : 'NO_PREP_LIST';
        })(),
        mode: window.__m.modeLabel(),
      })
    `))
    record('导入后日计划内容也一并恢复',
      restoredPlan.prep.includes('燕麦牛奶') &&
        restoredPlan.prep.includes('维生素 D') &&
        restoredPlan.prep.includes('健身安排已决定'),
      firstLine(restoredPlan.prep, 220))

    // 22. 零跨域请求（S1 新判据）
    //
    // 放在最后统计，覆盖从冷升级造库到「换设备 + 导入备份」的整轮交互。
    // 未配置云端时，应用不该对任何第三方发起请求：本地优先不只是「离线也能用」，
    // 而是「没让你联网，就一次都不会连」。
    record('未配置云端时整轮交互零跨域请求', crossOriginRequests.length === 0,
      crossOriginRequests.slice(0, 3).join(' | ') || `${appOrigin} 之外 0 条`)

    // 22b. v7 搬迁：sync_state 的归属从「设备」改成本地账号（S4 补丁 ②）
    //
    // 为什么值得单独造一次库：v7 改的是 `sync_state` 主键的**含义**，结构一个字节都没动，
    // 所以 `check:local-data` 只能对着纯规则（`rekeySyncStateRows`）断言，
    // 断言不到「迁移有没有在正确的时刻读到会话、有没有把旧主键那一行删掉」。
    // 而这条路径错了的症状是「换个账号登录就看到别人的云端绑定」——
    // 只有在真机上换账号才会暴露，那时数据已经推到别人的云端账号里了。
    //
    // 造库方式：v6 与 v7 的仓库定义完全一致（v7 不新增仓库），
    // 所以直接用当前的 `LOCAL_SCHEMA.stores` 建一个 **version = 6** 的库就是一份可信的老库。
    // 库里放一行 `id = 'singleton'` 的旧状态，再把会话指向那个账号；
    // 应用一读库就会把它升到 v7，搬迁应当把那一行改归属到登录中的账号。
    const REKEY_USER_ID = 'verify-rekey-user'
    const REKEY_STATE_EMAIL = 'legacy-cloud@molly.local'
    const rekeyUserId = await evaluate(`
      (async () => {
        const { LOCAL_SCHEMA } = await import('/src/services/local/localDb.ts');
        const DB = ${JSON.stringify(DB_NAME)};
        const TS = '2026-01-01T00:00:00.000Z';
        // 1) 删掉当前库。应用在 \`onversionchange\` 里会主动让出连接，所以删除不会被卡住。
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(DB);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => resolve();
        });
        // 2) 按当前定义建一个 v6 库，写入老形状的状态行与它归属的那个本地账号。
        await new Promise((resolve, reject) => {
          const open = indexedDB.open(DB, 6);
          open.onerror = () => reject(open.error);
          open.onupgradeneeded = () => {
            const database = open.result;
            for (const store of LOCAL_SCHEMA.stores) {
              const created = database.createObjectStore(store.name, { keyPath: store.keyPath });
              for (const index of store.indexes || []) {
                created.createIndex(index.name, index.keyPath, { unique: index.unique === true });
              }
            }
          };
          open.onsuccess = () => {
            const database = open.result;
            const tx = database.transaction(['users', 'sync_state'], 'readwrite');
            tx.objectStore('users').put({ id: ${JSON.stringify(REKEY_USER_ID)}, username: 'rekeyuser', password_hash: 'x', created_at: TS });
            tx.objectStore('sync_state').put({
              id: 'singleton',
              enabled: true,
              cloud_user_id: 'cloud-legacy',
              cloud_email: ${JSON.stringify(REKEY_STATE_EMAIL)},
              device_id: 'verify-device',
              bound_at: TS,
              last_push_at: null,
              last_restore_at: null,
              last_error_message: null,
              last_error_at: null,
              updated_at: TS,
            });
            tx.oncomplete = () => { database.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
        });
        // 3) 会话指向那个账号：搬迁要把它当作归属人。
        localStorage.setItem('happy-little-molly.session', JSON.stringify({ user: { id: ${JSON.stringify(REKEY_USER_ID)}, username: 'rekeyuser' } }));
        return ${JSON.stringify(REKEY_USER_ID)};
      })()
    `)
    // 重新加载：应用启动时读库 → 触发 v6 → v7 升级 → 搬迁。
    await cdp.send('Page.navigate', { url: appUrl })
    await sleep(3000)
    await evaluate(HELPERS)
    const rekey = JSON.parse(await evaluate(`
      (async () => {
        const { getAll } = await import('/src/services/local/localDb.ts');
        const rows = await getAll('sync_state');
        const version = await new Promise((resolve, reject) => {
          const request = indexedDB.open(${JSON.stringify(DB_NAME)});
          request.onsuccess = () => { const db = request.result; const value = db.version; db.close(); resolve(value); };
          request.onerror = () => reject(request.error);
        });
        return JSON.stringify({ version, rows });
      })()
    `))
    record('v6 老库被升级到 v7', rekey.version === 7, `version=${rekey.version}`)
    record('v7 把老状态行重新归属到登录中的本地账号',
      rekey.rows.length === 1 && rekey.rows[0].id === rekeyUserId,
      `行数 ${rekey.rows.length}，主键=${JSON.stringify(rekey.rows.map((row) => row.id))}`)
    record('v7 搬迁删掉了旧的 singleton 主键，其余字段原样保留',
      rekey.rows.every((row) => row.id !== 'singleton') &&
        rekey.rows[0]?.cloud_email === REKEY_STATE_EMAIL &&
        rekey.rows[0]?.enabled === true,
      JSON.stringify(rekey.rows[0] ?? null))
    // 收尾：清掉造出来的库与会话，后面的控制台检查跑在一次干净的启动上。
    await evaluate(`
      (async () => {
        localStorage.removeItem('happy-little-molly.session');
        await new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(${JSON.stringify(DB_NAME)});
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        });
        return 'OK';
      })()
    `)
    await cdp.send('Page.navigate', { url: appUrl })
    await sleep(2600)
    await evaluate(HELPERS)

    // 23. 控制台
    const noisy = cdp.events.filter((event) => {
      if (event.method === 'Runtime.exceptionThrown') return true
      if (event.method === 'Log.entryAdded') return ['error', 'warning'].includes(event.params.entry.level)
      if (event.method === 'Runtime.consoleAPICalled') return ['error', 'warning'].includes(event.params.type)
      return false
    })
    record('控制台无 error / warning', noisy.length === 0,
      noisy.slice(0, 3).map((event) => event.params.entry?.text ?? event.params.exceptionDetails?.text ?? event.params.type).join(' | '))

    const failed = results.filter((item) => !item.ok)
    console.log('')
    console.log(`结果：${results.length - failed.length}/${results.length} 通过`)
    if (failed.length) {
      console.log('未通过：')
      failed.forEach((item) => console.log(`  - ${item.name}`))
      process.exitCode = 1
    }
  } finally {
    if (child) child.kill()
    stopProcess(devServer?.child ?? null)
    await sleep(500)
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('验收脚本异常：', error.message)
  process.exitCode = 2
})
