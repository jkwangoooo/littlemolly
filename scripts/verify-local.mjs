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
// 覆盖：数据库冷升级（v1 → v3，含老自由文本搬迁）→ 登录页 → 注册 → 周视图 → 历史只读 →
// 模式切换与恢复默认 → 未来空日期引导 → 三餐多选 → 准备进度 → 健身多选（切「不健身」不清内容）→
// 补剂实例（打开面板补齐 / 模板行不可删 / 自定义行可删 / 不重复补齐）→ 执行区勾选（与准备区分离）→
// 自定义事项增改删 → 复制昨天（带内容、不带任何状态、不改模式）→
// 选项页（增改排序启停删、补剂时段分组、可用数量口径）→ 刷新恢复 → 账号间选项隔离 →
// 桌面与手机视口 → 退出登录 → 控制台干净。

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  const found = candidates.find((path) => existsSync(path))
  if (!found) throw new Error('未找到 Chrome / Edge，请用 CHROME_PATH 指定浏览器可执行文件。')
  return found
}

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
const EMAIL = `verify-${stamp}@local.test`
const EMAIL_B = `verify-b-${stamp}@local.test`
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
const SUPPLEMENT_NAME = '测试补剂'
const DB_NAME = 'happy-little-molly-local'
/** v1 只包含这四张表；升级到最新版后必须补上后续三张与三张（选项、每日内容）且旧数据不丢。 */
const V1_STORES = ['custom_tasks', 'daily_meals', 'day_plans', 'users']
const V2_STORES = ['exercise_options', 'food_options', 'supplement_templates']
const V3_STORES = ['daily_exercise_items', 'daily_meal_items', 'daily_supplements']
const LATEST_VERSION = 3
/** v1 老库里的自由文本内容，v3 迁移应当把它转成一条「名称快照项」。 */
const LEGACY_MEAL_TEXT = '老库早餐内容'
const LEGACY_EXERCISE_TEXT = '老库健身内容'
const SENTINEL_USER = { id: 'verify-sentinel-user', email: 'verify-sentinel@local.test', password_hash: 'x', created_at: '2020-01-01T00:00:00.000Z' }
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

const results = []

// 注入到页面的交互辅助函数。重写界面时请保留 .prep-row / .execution-row / .task-row /
// .bottom-sheet / .confirm-modal / .mode-card / .progress-head / .option-row /
// .panel-group / .panel-row / .picker-row 这些类名，以及 data-meal / data-period 这两个属性，
// 脚本依赖它们定位 L2 的多选与补剂分组。
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

  setValue: (el, value) => { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) },
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
  clickOptionButton: (name, label) => {
    const row = window.__m.optionRow(name);
    if (!row) return 'NO_ROW:' + name;
    const button = [...row.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
    if (!button) return 'NO_BUTTON:' + label;
    button.click();
    return 'OK';
  },
  accountText: () => { const card = document.querySelector('.account-card'); return card ? card.innerText : 'NO_ACCOUNT_CARD'; },
  dbSchema: () => new Promise((resolve, reject) => {
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
      resolve(JSON.stringify({ version: db.version, names, indexes }));
      db.close();
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
    record('未登录时渲染登录页', initial.includes('登录') && initial.includes('邮箱'), firstLine(initial))

    // 2. 注册并进入日计划页
    const signedUp = await evaluate(`
      (async () => {
        window.__m.fill('邮箱', ${JSON.stringify(EMAIL)});
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
        return JSON.stringify({ schema, sentinel });
      })()
    `))
    const allStores = [...V1_STORES, ...V2_STORES, ...V3_STORES]
    record(`v1 老库被升级到 v${LATEST_VERSION} 且十张表齐备`,
      upgrade.schema.version === LATEST_VERSION && allStores.every((name) => upgrade.schema.names.includes(name)),
      `version=${upgrade.schema.version}, tables=${upgrade.schema.names.join(',')}`)
    record('升级后 v1 老数据仍可读',
      upgrade.sentinel?.email === SENTINEL_USER.email,
      `读取到 ${upgrade.sentinel ? upgrade.sentinel.email : 'null'}`)

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

    // 3. 周视图
    await evaluate(`window.__m.clickText('本周')`)
    await sleep(1000)
    const week = await evaluate(`
      JSON.stringify({
        days: document.querySelectorAll('.week-day').length,
        text: window.__m.text(),
      })
    `)
    const weekData = JSON.parse(week)
    record('本周视图固定显示 7 天', weekData.days === 7, `week-day 数量 = ${weekData.days}`)
    await evaluate(`window.__m.clickText('今日')`)
    await sleep(900)

    // 4. 历史日期只读
    const movedBack = await evaluate(`window.__m.clickAria('前一天', '.icon-button')`)
    await sleep(1200)
    const history = await evaluate(`
      JSON.stringify({
        note: window.__m.text().includes('历史计划仅供查看'),
        hasSwitch: !!window.__m.byText('改为休息日') || !!window.__m.byText('改为工作日'),
      })
    `)
    const historyData = JSON.parse(history)
    if (movedBack !== 'OK') record('历史日期显示只读提示且无模式切换', false, movedBack)
    else record('历史日期显示只读提示且无模式切换', historyData.note && !historyData.hasSwitch,
      `note=${historyData.note}, hasSwitch=${historyData.hasSwitch}`)

    // 5. 模式切换与恢复默认
    await evaluate(`window.__m.clickAria('后一天', '.icon-button')`)
    await sleep(1200)
    const modeBefore = await evaluate(`window.__m.modeLabel()`)
    await evaluate(`window.__m.clickContains('改为')`)
    await sleep(700)
    const dialogText = await evaluate(`(document.querySelector('.confirm-modal') || {}).innerText || ''`)
    const dialogOk = dialogText.includes('恭喜幸福小Molly，今天不上班') || dialogText.includes('幸福小Molly，今天要上班哦')
    await evaluate(`window.__m.clickText('确认切换')`)
    await sleep(1300)
    const modeAfter = await evaluate(`window.__m.modeLabel()`)
    const override = await evaluate(`window.__m.text().includes('人工覆盖默认模式')`)
    record('模式切换有确认文案且生效', dialogOk && modeAfter !== modeBefore && override === true,
      `「${modeBefore}」→「${modeAfter}」，确认框=${dialogOk}`)

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
    const emptyHint = await evaluate(`
      JSON.stringify({
        shown: !!document.querySelector('.empty-day'),
        titled: window.__m.text().includes('这一天还没有计划'),
        guides: window.__m.text().includes('准备这一天'),
      })
    `)
    const hintData = JSON.parse(emptyHint)
    record('未来空日期显示「准备这一天」引导', hintData.shown && hintData.titled && hintData.guides,
      `引导块=${hintData.shown}, 标题=${hintData.titled}, 含引导语=${hintData.guides}`)
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
        return JSON.stringify({
          title,
          candidates,
          picked,
          checkedBeforeSave,
          status: body.includes('已保存'),
          breakfastInSummary: ${JSON.stringify(BREAKFAST_FOODS)}.every((name) => body.includes(name)),
          lunchInSummary: body.includes(${JSON.stringify(LUNCH_FOODS[0])}),
        });
      })()
    `))
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
        const before = window.__m.executeStates();
        const breakfast = await window.__m.executeToggle('早餐已完成');
        const vitamin = await window.__m.executeToggle('维生素 D已完成');
        const workout = await window.__m.executeToggle('健身已完成');

        window.__m.clickText('准备明天');
        await window.__m.wait(1500);
        return JSON.stringify({
          rows,
          before,
          breakfast,
          vitamin,
          workout,
          prepBoxes: window.__m.prepChecked(),
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
    record('执行区勾选完成不影响准备区勾选',
      execution.before.every((item) => item.checked === false) &&
        execution.breakfast === 'CHECKED' &&
        execution.vitamin === 'CHECKED' &&
        execution.workout === 'CHECKED' &&
        JSON.stringify(execution.prepBoxes) === JSON.stringify([false, true, false, false, false]) &&
        /1\/5/.test(execution.progressText),
      `初始=${JSON.stringify(execution.before.map((item) => item.checked))}, 三餐=${execution.breakfast}, 补剂=${execution.vitamin}, 健身=${execution.workout}, 准备区=${JSON.stringify(execution.prepBoxes)} ${execution.progressText}`)

    // 9. 自定义事项：新增
    const taskAdded = await evaluate(`
      (async () => {
        window.__m.clickContains('添加事项');
        await window.__m.wait(800);
        const title = (document.querySelector('.bottom-sheet h2') || {}).textContent;
        window.__m.fill('事项名称', ${JSON.stringify(TASK_NAME)});
        await window.__m.wait(200);
        window.__m.clickText('保存');
        await window.__m.wait(1300);
        const rows = [...document.querySelectorAll('.task-row')];
        return JSON.stringify({ title, count: rows.length, found: rows.some((row) => row.textContent.includes(${JSON.stringify(TASK_NAME)})) });
      })()
    `)
    const taskData = JSON.parse(taskAdded)
    record('自定义事项可新增', taskData.title === '添加事项' && taskData.found === true && taskData.count === 1,
      `面板标题=${taskData.title}, 事项数=${taskData.count}`)

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
        return JSON.stringify({
          asked: asked.includes('不会复制任何准备勾选'),
          hasMeals: ${JSON.stringify(BREAKFAST_FOODS)}.every((name) => body.includes(name)) && body.includes(${JSON.stringify(LUNCH_FOODS[0])}),
          hasSupplements: body.includes('维生素 D') && body.includes('钙片'),
          fishStaysUnplanned: !body.includes('鱼油'),
          hasExercise: body.includes('已决定健身'),
          prep: window.__m.prepChecked(),
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
      copyData.asked && copyData.hasMeals && copyData.hasSupplements && copyData.hasExercise && prepAllCleared,
      `确认文案=${copyData.asked}, 三餐=${copyData.hasMeals}, 补剂=${copyData.hasSupplements}, 健身=${copyData.hasExercise}, 准备项=${JSON.stringify(copyData.prep)}`)
    record('复制昨天原样带走「今天不吃」的补剂，不回填成默认吃',
      copyData.fishStaysUnplanned === true,
      `复制后摘要里是否出现鱼油=${!copyData.fishStaysUnplanned}`)
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
        const labels = window.__m.executeText();
        return JSON.stringify({
          states: window.__m.executeStates(),
          hasContent: labels.join('|').includes('燕麦牛奶') && labels.join('|').includes('维生素 D'),
        });
      })()
    `))
    record('复制昨天不带走任何完成状态',
      copiedExecution.hasContent === true &&
        copiedExecution.states.length >= 5 &&
        copiedExecution.states.every((item) => item.checked === false),
      `执行区状态=${JSON.stringify(copiedExecution.states.map((item) => item.checked))}`)

    // 13. 刷新恢复
    await goto()
    const afterReload = await text()
    record('刷新后会话恢复且仍在日计划页', afterReload.includes('执行今天') && !afterReload.includes('邮箱'))
    await evaluate(`window.__m.clickText('准备明天')`)
    await sleep(1100)
    const persisted = await text()
    record('刷新后规划内容从本地数据库恢复',
      persisted.includes('燕麦牛奶') && persisted.includes('维生素 D'),
      firstLine(persisted, 120))

    // 14. 选项页（L1）：三个分区、示例选项、可用数量口径与本地模式说明
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const optionPage = JSON.parse(await evaluate(`
      JSON.stringify({
        sections: ['food', 'supplement', 'exercise'].filter((kind) => !!window.__m.optionSection(kind)),
        hint: window.__m.text().includes('停用只影响以后的新计划'),
        food: window.__m.optionNames('food'),
        supplement: window.__m.optionNames('supplement'),
        supplementGroups: window.__m.optionGroupLabels('supplement'),
        exercise: window.__m.optionNames('exercise'),
        summaries: {
          food: window.__m.optionSummary('food'),
          supplement: window.__m.optionSummary('supplement'),
          exercise: window.__m.optionSummary('exercise'),
        },
        account: window.__m.accountText(),
      })
    `))
    record('选项页渲染食物 / 补剂 / 健身三个分区', optionPage.sections.length === 3, optionPage.sections.join(','))
    record('新账号自动带出可编辑的示例选项',
      optionPage.food.length === 5 && optionPage.supplement.length === 3 && optionPage.exercise.length === 4,
      `食物 ${optionPage.food.length} / 补剂 ${optionPage.supplement.length} / 健身 ${optionPage.exercise.length}`)
    record('补剂示例按早 / 中 / 晚分组', JSON.stringify(optionPage.supplementGroups) === JSON.stringify(['早', '中', '晚']),
      optionPage.supplementGroups.join(','))
    record('选项页说明了停用只影响以后的新计划', optionPage.hint === true)
    record('初始全部启用，可用数量与清单一致',
      optionPage.summaries.food === '启用 5 项 · 停用 0 项' &&
        optionPage.summaries.supplement === '启用 3 项 · 停用 0 项' &&
        optionPage.summaries.exercise === '启用 4 项 · 停用 0 项',
      `食物「${optionPage.summaries.food}」`)
    record('本地模式说明不伪装云端同步成功',
      optionPage.account.includes('本地模式') && !/已同步|同步成功|上次同步/.test(optionPage.account),
      firstLine(optionPage.account, 80))
    await shot('04-选项页')

    // 15. 选项页（L1）：新增 / 重名校验 / 排序 / 改名 / 停用 / 删除
    const mutations = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
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
        window.__m.clickOptionButton(${JSON.stringify(FOOD_NAME)}, '上移');
        await window.__m.wait(1300);
        out.afterMove = window.__m.optionNames('food');

        window.__m.clickOptionButton(${JSON.stringify(FOOD_NAME)}, '改名');
        await window.__m.wait(700);
        window.__m.fill('名称', ${JSON.stringify(FOOD_RENAMED)});
        await window.__m.wait(150);
        window.__m.clickText('保存');
        await window.__m.wait(1300);
        out.afterRename = window.__m.optionNames('food');

        // 停用：需二次确认，且「可用数量」随之下降（该数量与 L2 选择器同源）
        window.__m.clickOptionButton(${JSON.stringify(FOOD_RENAMED)}, '停用');
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
        window.__m.clickOptionButton(${JSON.stringify(TEMP_NAME)}, '删除');
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

    // 16. 选项页（L1）：补剂按时段落位，健身项目保持独立
    const supplement = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
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
        out.exercise = window.__m.optionNames('exercise');
        out.exerciseSummary = window.__m.optionSummary('exercise');
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

    // 17. 选项：刷新后仍在（本地持久化）
    await goto()
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const optionReload = JSON.parse(await evaluate(`
      JSON.stringify({
        food: window.__m.optionNames('food'),
        foodStatus: window.__m.optionStatus(${JSON.stringify(FOOD_RENAMED)}),
        foodSummary: window.__m.optionSummary('food'),
        supplement: window.__m.optionNames('supplement'),
        groups: window.__m.optionGroupLabels('supplement'),
      })
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

    // 18. 选项页视口
    for (const [label, width, height] of [
      ['桌面 1440x900', 1440, 900],
      ['手机 390x844', 390, 844],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await sleep(700)
      const metrics = JSON.parse(await evaluate('JSON.stringify({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })'))
      record(`选项页 ${label} 无横向溢出`, metrics.scroll <= metrics.inner, `scrollWidth=${metrics.scroll}, innerWidth=${metrics.inner}`)
      await shot(`06-选项页-视口-${label}`)
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await evaluate(`window.__m.clickText('今日')`)
    await sleep(900)

    // 19. 日计划页视口
    for (const [label, width, height] of [
      ['桌面 1440x900', 1440, 900],
      ['手机 390x844', 390, 844],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await sleep(700)
      const metrics = JSON.parse(await evaluate('JSON.stringify({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })'))
      record(`${label} 无横向溢出`, metrics.scroll <= metrics.inner, `scrollWidth=${metrics.scroll}, innerWidth=${metrics.inner}`)
      await shot(`07-日计划-视口-${label}`)
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride')

    // 20. 退出登录
    await sleep(400)
    await evaluate(`window.__m.clickText('退出登录')`)
    await sleep(1500)
    const afterSignOut = await text()
    record('退出登录后回到登录页', afterSignOut.includes('邮箱') && afterSignOut.includes('注册'))

    // 21. 第二个本地账号：各自的选项互不可见（docs/05 L1「不同本地账号之间互不可见」）
    await evaluate(`
      (async () => {
        window.__m.fill('邮箱', ${JSON.stringify(EMAIL_B)});
        window.__m.fill('密码', ${JSON.stringify(PASSWORD)});
        await window.__m.wait(200);
        window.__m.clickText('注册');
      })()
    `)
    await sleep(1800)
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const secondAccount = JSON.parse(await evaluate(`
      JSON.stringify({
        food: window.__m.optionNames('food'),
        supplement: window.__m.optionNames('supplement'),
        exercise: window.__m.optionNames('exercise'),
        account: window.__m.accountText(),
      })
    `))
    const allSecondAccountNames = [...secondAccount.food, ...secondAccount.supplement, ...secondAccount.exercise]
    record('第二个账号只看到自己的示例选项',
      JSON.stringify(secondAccount.food) === JSON.stringify(SEED_FOODS) &&
        secondAccount.supplement.length === 3 &&
        secondAccount.exercise.length === 4,
      `食物=${secondAccount.food.join(',')}`)
    record('第二个账号看不到第一个账号的选项',
      !allSecondAccountNames.includes(FOOD_RENAMED) && !allSecondAccountNames.includes(SUPPLEMENT_NAME) && !allSecondAccountNames.includes(TEMP_NAME))
    record('账号卡显示当前登录邮箱', secondAccount.account.includes(EMAIL_B), firstLine(secondAccount.account, 60))

    // 22. 控制台
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
