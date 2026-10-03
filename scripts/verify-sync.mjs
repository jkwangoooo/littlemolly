#!/usr/bin/env node
// 同步闭环验收（S4）：假云端 + 真实浏览器内核，验「本地写入 → 自动推送 → 云端收到正确行」。
//
// 用法：
//   npm run verify:sync
//
// 覆盖：未绑定时零云端请求 → 绑定（探测 → 确认 → 清空队列）→ 写入自动推送 →
// 防抖把连续两次写入攒成一批且推最后的值 → 删除也被推送 → 断网失败且队列不清空 →
// 恢复后自动补推 → 服务端拒绝时如实显示失败原因 → 恢复后失败原因被清掉 →
// 重复推送幂等 → 控制台干净。
//
// 依赖：本机已安装 Chrome 或 Edge。不使用第三方 npm 包，不写入项目目录。
//
// ---
//
// ## 假云端为什么跟应用**同源**
//
// 做法是：先向系统要一个空闲端口，用它既跑 Vite 开发服务器、又当作
// `VITE_SUPABASE_URL`。于是 supabase 客户端拼出来的 `http://127.0.0.1:<端口>/auth/v1/...`
// 与页面同源，**整条链路上没有跨域**——不需要伪造 CORS 头，也不需要给浏览器加
// `--disable-web-security` 这类会改变被测行为的开关。
//
// 代价是这里验不了「跨域请求数为 0」那条判据。那条判据由 `verify:local` 在
// **未配置云端**的产物上守（它统计的是 origin）。两者分工不同，不重复：
//
//   verify:local：未配置云端 → 一个第三方请求都不发（origin 口径）
//   verify:sync ：已配置但未绑定 → 一个云端请求都不发（路径口径，见断言 2）
//
// ## 为什么用 CDP 的 Fetch 域拦截，而不是起一个真的 HTTP 服务
//
// 起真服务也能收请求，但那样**假云端与断言处在两个进程里**：要收集「收到了哪些行」
// 就得再加一层 IPC 或轮询一个内部接口。用 CDP 拦截则假云端就在本脚本的内存里，
// 请求一到就能断言，也不占端口、不留残留进程。
//
// 拦截用两个精确的 URL 模式（不是 `*`）：`*` 会让每一个 Vite 模块请求都多一次
// CDP 往返，一百多个模块下来慢得没有道理。模式写错了也不会静默——断言 5
// 会先确认「连接云端账号确实发出了 /auth/v1 请求」，拦不到就立刻失败。
//
// ## 写入为什么直接调服务层，而不是点界面
//
// 本脚本验的是「写入 → 队列 → 推送」这条链路，需要的是**确定的 id 与确定的时序**
// （例如「1.5 秒防抖窗口内连写两次」）。点击路径本身已由 `verify:local` 逐项覆盖，
// 在这里再走一遍只会引入一层易碎的选择器依赖。绑定流程仍然走界面——
// 那是用户唯一能到达的入口，而且确认框的文案本身就是要验的东西。

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import './ts-resolve.mjs'
import { findBrowser } from './lib/find-browser.mjs'

// 项目源码一律用 `await import()` 取，**不能用静态 import**：
// `ts-resolve.mjs` 的解析钩子是在模块**求值**时注册的，而所有静态 import 的
// 解析都发生在求值之前——静态引入一个内部用无扩展名相对导入的源码文件
// （例如 `mapper.ts` 里的 `'../local/recordSchemas'`）会直接 ERR_MODULE_NOT_FOUND。
const { RECORD_SCHEMAS, USER_DATA_STORES } = await import('../src/services/local/recordSchemas.ts')
const { USER_SCOPED_STORES } = await import('../src/services/sync/mapper.ts')

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOT_DIR = process.env.SHOT_DIR ?? null
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- 假云端

/** 账号名与密码：与本地账号无关，云端账号是侧挂绑定。 */
const CLOUD_USERNAME = 'syncprobe'
const CLOUD_PASSWORD = 'cloudpass123'
/** 假云端账号的 id。断言「本地 user_id 被改写成了它」用。 */
const CLOUD_USER_ID = '11111111-2222-4333-8444-555555555555'
/**
 * 假的 anon key。
 *
 * 长得像 JWT 是**必需的**：supabase-js 见到 `sb_` 开头的 key 会打印
 * 「Unrecognized Supabase API key format」告警，而本脚本最后一条断言是
 * 「控制台无 error / warning」——用一个随便的字符串会让那条断言假失败。
 */
const FAKE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJmYWtlIiwicm9sZSI6ImFub24ifQ.fake-signature'
/** 服务端拒绝时返回的文案，用来断言它一路传到了界面上。 */
const CLOUD_REJECT_MESSAGE = '模拟云端拒绝写入'

/**
 * 假云端的全部状态。
 *
 * `rest` 记下每一个到达的 `/rest/v1` 请求（只读探测、表写入与 RPC 都在内），`rows` 按主键去重存行——
 * **用主键去重正好就是验幂等的手段**：同一条记录推两次，`rows` 里仍然只有一行。
 */
const cloud = {
  auth: [],
  rest: [],
  rows: new Map(),
  /** 置为非空时，业务请求一律返回 500（验「上传失败」分支）。 */
  rejectBusiness: null,
  /**
   * 置为非空时，**只有** `import_local_backup` 返回 500。
   *
   * 与 `rejectBusiness` 的区别是「失败发生在前一步还是这一步」：
   * 整体替换的按钮在弹确认框之前要先调 `cloud_sync_summary()` 问条数，
   * 用 `rejectBusiness` 会连确认框都弹不出来，测到的是「读条数失败」而不是
   * 「替换失败」——那是另一条分支（`summaryFailed`）。要测后者，必须让探测照常成功。
   */
  rejectReplace: null,
  /**
   * 置为表名时，**只有那张表的写入（POST）**返回 500。
   *
   * 用途是「持续推不上去的一批积压」：`rejectBusiness` 会连 RPC 一起掐，
   * 而整体替换的探测正走 RPC。有了这个开关，就能在**推送一直失败**的同时
   * 让上传照常成功——于是「上传把本账号积压的队列清空了」这条断言才有辨别力
   * （否则 A 的队列本来就是空的，断言天然成立，等于没测）。
   */
  rejectTable: null,
  /**
   * 置为真时，云端请求**放行给网络栈**而不是由本脚本应答。
   *
   * 这是「断网」分支唯一可行的做法：CDP 的 Fetch 域在**网络条件之前**拦截，
   * 也就是说离线时如果这里照样 fulfill 一个 201，请求会「成功」——
   * 断网测试会以「推送成功」的形式假通过。放行之后由网络栈按离线处理，
   * 请求以 `ERR_INTERNET_DISCONNECTED` 失败，才是真实行为。
   */
  offline: false,
}

/** 假云端的登录会话。`main()` 里按真实映射规则填好，`handleAuth` 直接取用。 */
let session = null

const rowKey = (table, id) => `${table}\u0000${id}`
/** 真正的推送动作（探测用的 HEAD 不算）。**RPC 也不算**——它们是整体替换，另有断言。 */
const cloudWrites = () => cloud.rest.filter((item) => !item.rpc && (item.method === 'POST' || item.method === 'DELETE'))
const cloudRowsOf = (table) => [...cloud.rows.entries()].filter(([key]) => key.startsWith(`${table}\u0000`)).map(([, row]) => row)

// ---------------------------------------------------------------- 假云端的三个 RPC（S5）
//
// 这一层是**真实 SQL 的替身**：`cloud_sync_summary` / `export_cloud_snapshot` /
// `import_local_backup` 三个函数在真库里的实现见
// `database/migrations/202609200002_stage6_replace.sql`，真伪两边的行为
// 由 `verify:sql`（真 PostgreSQL）与 `verify:sync`（浏览器闭环）分别覆盖。
//
// **字段清单不在这里重抄一遍**：快照按 `RECORD_SCHEMAS`（项目自己的字段契约）
// 过滤，于是「假云端发出去的形状」与「本地契约」不可能漂移。
// 真库里那份 SQL 是逐字段显式写的，由 `check:cloud-parity` 第 10 组
// 静态比对 + `verify:sql` 运行时比对来钉住。

/** 假云端这个账号下的行，按「根表看 user_id、子表沿父键推导」筛。 */
function ownedRows(store) {
  const planIds = new Set(cloudRowsOf('day_plans').map((row) => row.id))
  const mealIds = new Set(cloudRowsOf('daily_meals').filter((row) => planIds.has(row.day_plan_id)).map((row) => row.id))
  if (store === 'daily_meal_items') {
    return cloudRowsOf(store).filter((row) => mealIds.has(row.daily_meal_id))
  }
  if (['daily_meals', 'custom_tasks', 'daily_supplements', 'daily_exercise_items', 'routine_tasks'].includes(store)) {
    return cloudRowsOf(store).filter((row) => planIds.has(row.day_plan_id))
  }
  return cloudRowsOf(store)
}

/** 与 `cloud_sync_summary()` 同口径：10 张用户数据表、含子表、只数非空。 */
function cloudSummaryOf() {
  const counts = {}
  let total = 0
  for (const store of USER_DATA_STORES) {
    const n = ownedRows(store).length
    if (n > 0) {
      counts[store] = n
      total += n
    }
  }
  return { counts, total }
}

/** 与 `export_cloud_snapshot()` 同形状：逐字段按契约过滤 + 一条合成 users 行。 */
function cloudSnapshotOf() {
  const records = {}
  for (const store of USER_DATA_STORES) {
    const schema = RECORD_SCHEMAS[store]
    records[store] = ownedRows(store).map((row) => {
      const out = {}
      for (const key of Object.keys(schema)) if (key in row) out[key] = row[key]
      return out
    })
  }
  // 这条合成行是硬要求：`parseBackup` 的外键校验要求 `day_plans.user_id`
  // 能在 `records.users` 里找到父记录，缺了整份快照会被拒绝。
  records.users = [
    { id: CLOUD_USER_ID, username: session?.user?.email ?? '', password_hash: '', created_at: '1970-01-01T00:00:00.000Z' },
  ]
  const counts = {}
  let total = 0
  for (const [store, rows] of Object.entries(records)) {
    if (store === 'users' || !rows.length) continue
    counts[store] = rows.length
    total += rows.length
  }
  return {
    app: 'happy-little-molly',
    format: 'local-backup',
    version: 2,
    db_version: 1,
    exported_at: new Date().toISOString(),
    source_user: { username: session?.user?.email ?? '' },
    counts,
    records,
  }
}

/** 与 `import_local_backup()` 同语义：先清空本账号全部业务行，再整体写入。 */
function cloudReplaceWith(payload) {
  for (const key of [...cloud.rows.keys()]) cloud.rows.delete(key)
  const imported = {}
  let total = 0
  for (const store of USER_DATA_STORES) {
    const rows = payload?.records?.[store] ?? []
    if (!rows.length) continue
    for (const row of rows) {
      const next = { ...row }
      // 归属由服务端定：真实 SQL 里是 `auth.uid()`，这里是当前假会话的账号。
      if (USER_SCOPED_STORES.includes(store)) next.user_id = session?.user?.id ?? CLOUD_USER_ID
      cloud.rows.set(rowKey(store, next.id), next)
    }
    imported[store] = rows.length
    total += rows.length
  }
  return { imported, total }
}

/** `/rest/v1/rpc/*` 的假应答。 */
function handleRpc(cdp, params, url) {
  const name = url.pathname.replace('/rest/v1/rpc/', '')
  const body = params.request.postData ?? ''
  // 记进 `cloud.rest` 是为了让「未绑定时不发任何云端请求」那条断言也覆盖 RPC；
  // `rpc: true` 让 `cloudWrites()` 把它排除在「推送动作」之外。
  cloud.rest.push({ method: params.request.method, table: `rpc:${name}`, query: url.search, body, rpc: true })

  if (cloud.rejectBusiness) {
    return respond(cdp, params.requestId, 500, JSON.stringify({ message: cloud.rejectBusiness }))
  }
  // 只掐替换本身，探测照常（理由见 `rejectReplace` 的注释）。
  if (cloud.rejectReplace && name === 'import_local_backup') {
    return respond(cdp, params.requestId, 500, JSON.stringify({ message: cloud.rejectReplace }))
  }

  if (name === 'cloud_sync_summary') {
    return respond(cdp, params.requestId, 200, JSON.stringify(cloudSummaryOf()))
  }
  if (name === 'export_cloud_snapshot') {
    return respond(cdp, params.requestId, 200, JSON.stringify(cloudSnapshotOf()))
  }
  if (name === 'import_local_backup') {
    let args = {}
    try {
      args = JSON.parse(body || '{}')
    } catch {
      return respond(cdp, params.requestId, 400, JSON.stringify({ message: '假云端收到的 RPC 参数不是 JSON' }))
    }
    return respond(cdp, params.requestId, 200, JSON.stringify(cloudReplaceWith(args.payload)))
  }
  return respond(cdp, params.requestId, 404, JSON.stringify({ message: `假云端没有实现 ${name}` }))
}

/** 每个业务请求的应答。`extraHeaders` 用来补 `content-range`（计数查询要用）。 */
function respond(cdp, requestId, responseCode, body, extraHeaders = {}) {
  const headers = { 'content-type': 'application/json', ...extraHeaders }
  const options = {
    requestId,
    responseCode,
    responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
  }
  // 204 不能带 body：带了 Chrome 会直接把这次 fulfill 判成失败。
  if (body) options.body = Buffer.from(body, 'utf8').toString('base64')
  return cdp.send('Fetch.fulfillRequest', options)
}

/** `/auth/v1/*` 的假应答。 */
function handleAuth(cdp, params, url) {
  cloud.auth.push(`${params.request.method} ${url.pathname}`)
  if (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/signup') {
    return respond(cdp, params.requestId, 200, JSON.stringify(session))
  }
  if (url.pathname === '/auth/v1/logout') return respond(cdp, params.requestId, 204, '')
  if (url.pathname === '/auth/v1/user') return respond(cdp, params.requestId, 200, JSON.stringify(session.user))
  return respond(cdp, params.requestId, 200, '{}')
}

/** `/rest/v1/*` 的假应答。 */
function handleRest(cdp, params, url) {
  // PostgREST 的 RPC 入口是 `/rest/v1/rpc/<函数名>`，与表路径同一个前缀但语义完全不同
  // （S5 的三个整体替换函数走这里）。必须先分流，否则会被当成一张叫 `rpc/xxx` 的表。
  if (url.pathname.startsWith('/rest/v1/rpc/')) return handleRpc(cdp, params, url)

  const table = url.pathname.replace('/rest/v1/', '')
  const method = params.request.method
  const body = params.request.postData ?? ''
  cloud.rest.push({ method, table, query: url.search, body })

  // 探测（`select(..., { head: true })`）：只回 `content-range`，不回行内容。
  // postgrest-js 的 count 就是从 `content-range` 的斜杠后面取的。
  if (method === 'HEAD' || method === 'GET') {
    return respond(cdp, params.requestId, 200, '', { 'content-range': `*/${cloudRowsOf(table).length}` })
  }

  if (cloud.rejectBusiness) {
    return respond(cdp, params.requestId, 500, JSON.stringify({ message: cloud.rejectBusiness }))
  }
  // 只掐某一张表的写入（理由见 `rejectTable` 的注释）。
  if (cloud.rejectTable && table === cloud.rejectTable && method === 'POST') {
    return respond(cdp, params.requestId, 500, JSON.stringify({ message: `模拟云端拒绝写入 ${table}` }))
  }

  if (method === 'POST') {
    let rows = []
    try {
      rows = JSON.parse(body)
    } catch {
      return respond(cdp, params.requestId, 400, JSON.stringify({ message: '假云端收到的请求体不是 JSON' }))
    }
    for (const row of rows) cloud.rows.set(rowKey(table, row.id), row)
    return respond(cdp, params.requestId, 201, '')
  }

  if (method === 'DELETE') {
    const decoded = decodeURIComponent(url.search)
    const matched = /id=in\.\(([^)]*)\)/.exec(decoded)
    const ids = matched ? matched[1].split(',').filter(Boolean) : []
    for (const id of ids) cloud.rows.delete(rowKey(table, id))
    return respond(cdp, params.requestId, 204, '')
  }

  return respond(cdp, params.requestId, 200, '[]')
}

// ---------------------------------------------------------------- 浏览器与服务器

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

/**
 * 拉起 Vite 开发服务器，并**把它的地址同时当作假云端的地址**（见文件头）。
 *
 * `VITE_*` 是构建期内联的：Vite 的 `loadEnv` 除了读 `.env*` 文件，也会把
 * `process.env` 里同前缀的变量并进来，所以在这里塞进子进程环境即可生效。
 * 注意结尾不能带斜杠——supabase 客户端是自己拼 `${url}/auth/v1`。
 */
async function startDevServer() {
  const port = await findFreePort()
  const url = `http://127.0.0.1:${port}/`
  const viteBin = join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteBin)) throw new Error(`未找到 Vite（${viteBin}），请先运行 npm install。`)

  const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: PROJECT_ROOT,
    stdio: 'ignore',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: `http://127.0.0.1:${port}`,
      VITE_SUPABASE_ANON_KEY: FAKE_ANON_KEY,
    },
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

function stopProcess(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill()
  }
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
  /** 需要即时响应的事件（Fetch 拦截）用这里注册；其余事件留在 this.events 里事后统计。 */
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

// ---------------------------------------------------------------- 页面辅助

const stamp = Date.now()
const ACCOUNT = `s${stamp}`
const PASSWORD = 'verify123'
const DB_NAME = 'happy-little-molly-local'
const FOOD_A = '同步测试食物甲'
const FOOD_B = '同步测试食物乙'
/** 换账号用例里 B 写的那条：它绝不该出现在 A 绑定的云端账号里。 */
const FOOD_SWITCH = '换账号测试食物'
/** 整体替换用例：只存在于云端、本地没有的那条。恢复后它必须出现在本地。 */
const FOOD_CLOUD_ONLY = '云端独有的食物'
/** 整体替换用例：只存在于本地、云端没有的那条。恢复后它**必须消失**。 */
const FOOD_LOCAL_ONLY = '本地独有的食物'
/** 整体替换用例：推送持续失败时留在队列里、又必须被上传带走的那条。 */
const FOOD_PENDING = '推送失败后积压的食物'
/** 第二个本地账号的账号名。 */
const ACCOUNT_B = `s${stamp}b`

const HELPERS = `
window.__m = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  text: () => document.body.innerText,
  byText: (text, tag) => [...document.querySelectorAll(tag || 'button')].find((el) => el.textContent.trim() === text),
  clickText: (text, tag) => { const el = window.__m.byText(text, tag); if (!el) return 'NOT_FOUND:' + text; el.click(); return 'OK' },
  setValue: (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  },
  fill: (labelText, value) => {
    const label = [...document.querySelectorAll('label')].find((item) => item.textContent.includes(labelText));
    if (!label) return 'NO_LABEL:' + labelText;
    const input = label.querySelector('input, textarea, select');
    if (!input) return 'NO_INPUT:' + labelText;
    window.__m.setValue(input, value);
    return 'OK';
  },
  // 账号与同步子屏的两张卡：本地账号（.account-card）与云端同步（.sync-card）。
  syncText: () => { const card = document.querySelector('.sync-card'); return card ? card.innerText : 'NO_SYNC_CARD'; },
  optionEntry: (kind) => document.querySelector('[data-option-entry="' + kind + '"]'),
  openOptionsOverview: async () => {
    const back = document.querySelector('.topbar-back button');
    if (back) { back.click(); await window.__m.wait(400); }
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
  // 直接调服务层做写入（理由见脚本文件头）。走的是与界面完全相同的写入路径：
  // optionService → localDb.put → 同事务追加 sync_outbox。
  write: async (action) => {
    const options = await import('/src/services/api/optionService.ts');
    if (action.kind === 'create') return (await options.createOption('food', { name: action.name })).id;
    if (action.kind === 'rename') { await options.renameOption('food', action.id, action.name); return action.id; }
    if (action.kind === 'delete') { await options.deleteOption('food', action.id); return action.id; }
    // 读一遍本地食物的名字。用于验证「从云端恢复到本地」之后本地真的换成了云端那份。
    if (action.kind === 'list') return (await options.listOptions('food')).map((row) => row.name);
    return 'UNKNOWN_ACTION';
  },
  status: async () => {
    const { readSyncStatus } = await import('/src/services/api/syncService.ts');
    return await readSyncStatus();
  },
  outbox: async () => {
    const { getAll } = await import('/src/services/local/localDb.ts');
    const rows = await getAll('sync_outbox');
    return rows.map((row) => ({ store: row.store, record_id: row.record_id, op: row.op, attempts: row.attempts, local_user_id: row.local_user_id }));
  },
  // 当前本地账号 id，以及库里那几张**按账号分行**的状态表（S4 补丁 ② 的判据）。
  localUserId: async () => {
    const { currentLocalUserId } = await import('/src/services/sync/syncState.ts');
    return currentLocalUserId();
  },
  syncStateRows: async () => {
    const { getAll } = await import('/src/services/local/localDb.ts');
    const rows = await getAll('sync_state');
    return rows.map((row) => ({ id: row.id, enabled: row.enabled, cloud_email: row.cloud_email }));
  },
}
`

// ---------------------------------------------------------------- 断言框架

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
}
function firstLine(value, limit = 100) {
  return String(value ?? '').split('\n').filter(Boolean).join(' / ').slice(0, limit)
}

/** 轮询直到条件成立，返回条件值；超时返回 `null`。用于等推送这类异步过程。 */
async function waitFor(predicate, timeoutMs = 12_000, stepMs = 250) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) return null
    await sleep(stepMs)
  }
}

/** 控制台里的 error / warning。浏览器不区分「被测代码报的」与「测试自己造的」。 */
function consoleNoise(cdp) {
  return cdp.events.filter((event) => {
    if (event.method === 'Runtime.exceptionThrown') return true
    if (event.method === 'Log.entryAdded') return ['error', 'warning'].includes(event.params.entry.level)
    if (event.method === 'Runtime.consoleAPICalled') return ['error', 'warning'].includes(event.params.type)
    return false
  })
}

function describeNoise(event) {
  return event.params.entry?.text ?? event.params.exceptionDetails?.text ?? event.params.type ?? ''
}

/**
 * 刻意制造的云端 500 会在控制台留下一条「Failed to load resource」。
 *
 * 那条噪声**是测试自己造成的**，不该算进「应用控制台干净」里；但它也不能被无条件
 * 忽略——所以断言拆成两段（注入前 / 注入后），并且只放行这一种文案。
 */
const INTENTIONAL_500 = /Failed to load resource: the server responded with a status of 500/

// ---------------------------------------------------------------- 主流程

async function main() {
  const browserPath = findBrowser()
  const userDataDir = join(tmpdir(), `molly-sync-${stamp}`)
  let child = null
  let devServer = null
  let cdp = null

  try {
    devServer = await startDevServer()
    const appUrl = devServer.url
    console.log(`使用临时开发服务器（同时充当假云端）：${appUrl}`)

    const { emailForUsername } = await import('../src/services/cloud/identity.ts')
    // 会话体里的邮箱要与应用算出来的完全一致，否则断言的是两个不同的云端身份。
    session = {
      access_token: 'fake-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'fake-refresh-token',
      user: {
        id: CLOUD_USER_ID,
        aud: 'authenticated',
        role: 'authenticated',
        email: emailForUsername(CLOUD_USERNAME),
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        confirmed_at: '2026-01-01T00:00:00.000Z',
        last_sign_in_at: '2026-01-01T00:00:00.000Z',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { username: CLOUD_USERNAME },
        identities: [],
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        is_anonymous: false,
      },
    }

    const launched = await launchBrowser(browserPath, userDataDir)
    child = launched.child
    cdp = await connect(launched.port)
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')

    // 拦截只针对两个云端路径前缀（理由见文件头）。
    cdp.on('Fetch.requestPaused', (params) => {
      const url = new URL(params.request.url)
      const isCloud = url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/')
      // 断网分支放行给网络栈（理由见 cloud.offline 的注释）。放行的请求不记账，
      // 于是「云端收到了什么」这条账始终只包含**真的到达过假云端**的请求。
      if (!isCloud || cloud.offline) {
        void cdp.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {})
        return
      }
      const task = url.pathname.startsWith('/auth/v1/')
        ? handleAuth(cdp, params, url)
        : handleRest(cdp, params, url)
      // 拦截里抛出的异常必须自己吞掉：它发生在事件回调里，没人 await，
      // 漏出去会变成 unhandled rejection 把整个脚本带崩，而现场信息已经丢了。
      void task.catch((reason) => console.error('拦截处理失败：', reason.message))
    })
    await cdp.send('Fetch.enable', {
      patterns: [
        { urlPattern: '*://*/auth/v1/*', requestStage: 'Request' },
        { urlPattern: '*://*/rest/v1/*', requestStage: 'Request' },
      ],
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
      let ready = false
      for (let attempt = 0; attempt < 60; attempt += 1) {
        ready = await evaluate("Boolean([...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '注册'))")
        if (ready) break
        await sleep(150)
      }
      if (!ready) await sleep(2600)
      await evaluate(HELPERS)
    }
    const text = () => evaluate('window.__m.text()')
    const status = () => evaluate('window.__m.status()')
    const outbox = () => evaluate('window.__m.outbox()')
    const syncCard = () => evaluate('window.__m.syncText()')
    /**
     * 打开「选项 → 账号与同步」。
     *
     * 两步都不能省：同步卡在选项页的账号子屏里，必须先从日程页右上角进入选项
     *，再从概览进入账号与同步（直接查找子屏入口会得到 `NO_ENTRY`）。
     */
    const openAccountCard = async () => {
      // 先退到概览：子屏里才有返回键，日计划页没有（`openOptionsOverview` 自己会判空）。
      await evaluate(`window.__m.openOptionsOverview()`)
      await evaluate(`window.__m.clickText('选项')`)
      await sleep(600)
      await evaluate(`window.__m.openOptionList('account')`)
    }

    if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
    const shot = async (label) => {
      if (!SHOT_DIR) return
      try {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        writeFileSync(join(SHOT_DIR, `${label}.png`), Buffer.from(data, 'base64'))
      } catch (reason) {
        console.warn(`截图 ${label} 失败（不影响验收）：${reason.message}`)
      }
    }

    // 1. 注册本地账号
    await goto()
    await evaluate(`
      (async () => {
        window.__m.fill('账号', ${JSON.stringify(ACCOUNT)});
        window.__m.fill('密码', ${JSON.stringify(PASSWORD)});
        await window.__m.wait(200);
        return window.__m.clickText('注册');
      })()
    `)
    await sleep(2200)
    const signedUp = await text()
    record('注册后进入日计划页', signedUp.includes('执行今天'), firstLine(signedUp))

    // 2. 未绑定：一个云端请求都不该发
    //
    // 这一条与 verify:local 的「零跨域请求」是**不同口径**：那边验的是「未配置云端」，
    // 这边验的是「配置了、但用户还没绑定」。后者更容易破——只要有人把调度器的
    // 「先看绑定状态」改成「先读队列」再顺手探测一下云端，就会在这里露出来。
    //
    // 注意队列里**本来就不是空的**：注册会播种示例选项、建今天的计划，
    // 那些也是用户数据写入，同样进队列。所以下面一律比增量，不比绝对值。
    //
    // 先自检构建期配置确实注入了。这一条挂了的话，后面所有同步断言都会以
    // 「同步卡不可用」的形式失败，很难看出根因其实是环境变量没传进 Vite。
    const configured = await evaluate(
      `(async () => (await import('/src/services/capabilities.ts')).cloudSyncConfigured)()`,
    )
    record('自检：VITE_SUPABASE_* 已注入，同步能力可用', configured === true, `cloudSyncConfigured=${configured}`)

    const seeded = await outbox()
    // 播种发生在 `writeSession()` 之前（`local/authService.ts` 的顺序：建账号 → 播种 → 写会话），
    // 所以入队钩子那一刻读不到会话，归属只能由调用方显式指定。
    // 少了这一步，这批条目会变成「无归属」——永不被推送，而界面一直显示「待上传 N 条」。
    const accountId = await evaluate('window.__m.localUserId()')
    record(
      '注册播种的条目记在新账号名下（无归属的条目永远推不上去）',
      seeded.length > 0 && seeded.every((row) => row.local_user_id === accountId),
      `播种 ${seeded.length} 条，归属=${JSON.stringify([...new Set(seeded.map((row) => row.local_user_id))])}`,
    )
    const restBefore = cloud.rest.length
    const authBefore = cloud.auth.length
    await openAccountCard()
    const unboundCard = await syncCard()
    record('未绑定云端账号时同步卡说明未连接', unboundCard.includes('未连接云端账号'), firstLine(unboundCard))
    // 主动写一笔数据：未绑定时写入只该进队列，不该有任何上行动作。
    await evaluate(`window.__m.write({ kind: 'create', name: ${JSON.stringify(FOOD_A)} })`)
    await sleep(3000)
    record('未绑定时的写入进了队列', (await outbox()).length === seeded.length + 1, `注册后 ${seeded.length} 条 → 现在 ${(await outbox()).length} 条`)
    record(
      '未绑定云端账号时不发任何云端请求',
      cloud.rest.length === restBefore && cloud.auth.length === authBefore,
      `/rest/v1 ${cloud.rest.length - restBefore} 条 · /auth/v1 ${cloud.auth.length - authBefore} 条`,
    )

    // 3. 绑定：探测 → 确认框 → 确认
    await evaluate(`
      (async () => {
        window.__m.fill('云端账号名', ${JSON.stringify(CLOUD_USERNAME)});
        window.__m.fill('云端密码', ${JSON.stringify(CLOUD_PASSWORD)});
        await window.__m.wait(200);
        return window.__m.clickText('连接已有账号');
      })()
    `)
    // 探测要发 /auth/v1/token，再加一次 cloud_sync_summary。等确认框出现。
    const probeText = await waitFor(async () => {
      const current = await text()
      return current.includes('确认连接') ? current : null
    }, 12_000)
    record('连接云端账号后弹出确认框', Boolean(probeText), firstLine(probeText ?? ''))
    // 自检：这条同时证明 CDP 的 URL 模式确实拦到了请求。模式写错时，
    // 下面所有「云端收到了什么」的断言都会以「0 条」的形式失败，很难看出根因。
    record('CDP 拦截生效：/auth/v1 收到登录请求', cloud.auth.some((item) => item.startsWith('POST /auth/v1/token')), cloud.auth.join(' | '))
    // S5 起口径变了：不再对四张根表各发一次 HEAD 计数，而是调一次 `cloud_sync_summary()`。
    // 旧口径数不到子表（三餐内容项、加餐、运动项、常规任务），与本地 `localCount` 对不上，
    // 用户会看到「云端 3 条 · 本地 20 条」这种凭空的差异。断言两半都留着：
    // 「有新口径」证明改对了，「没有 HEAD」证明旧口径真的没在跑。
    record(
      '探测云端条数走的是 cloud_sync_summary，不是把数据搬下来',
      cloud.rest.some((item) => item.method === 'POST' && item.table === 'rpc:cloud_sync_summary') &&
        cloud.rest.every((item) => item.method !== 'HEAD'),
      cloud.rest.map((item) => `${item.method} ${item.table}`).join(' | '),
    )
    record('云端为空时给出「还没有数据」的确认文案', (probeText ?? '').includes('这个云端账号还没有数据'), firstLine(probeText ?? '', 160))

    await evaluate(`window.__m.clickText('确认连接')`)
    await sleep(1200)
    const boundStatus = await status()
    record('确认后写入 sync_state 并记住云端账号', boundStatus.bound === true && boundStatus.cloudEmail === emailForUsername(CLOUD_USERNAME), `bound=${boundStatus.bound} email=${boundStatus.cloudEmail}`)
    // 绑定前那次写入是「相对一个当时并不存在的云端关系」算出来的增量，
    // 推上去只会得到一份看起来成功、实际残缺的云端数据，所以绑定时就清掉。
    record('绑定清空了绑定前积压的队列', boundStatus.pendingCount === 0, `pendingCount=${boundStatus.pendingCount}`)
    record('绑定不清空本地数据', boundStatus.localCount > 0, `localCount=${boundStatus.localCount}`)
    await openAccountCard()
    const boundCard = await syncCard()
    record('已绑定的同步卡不再出现 S3 那句过渡说明', boundCard.includes('还没有开始上传') === false, firstLine(boundCard, 160))
    record('已绑定的同步卡如实显示待上传条数', boundCard.includes('待上传 0 条'), firstLine(boundCard, 160))
    record('已绑定的同步卡不出现「已同步」这类结论', /已同步|同步成功|上次同步/.test(boundCard) === false, firstLine(boundCard, 160))
    await shot('01-bound')

    // 4. 写入 → 自动推送
    const foodId = await evaluate(`window.__m.write({ kind: 'create', name: ${JSON.stringify(FOOD_B)} })`)
    const drained = await waitFor(async () => ((await outbox()).length === 0 ? true : null), 12_000)
    record('写入后队列被自动推空（防抖 1.5s 内触发）', drained === true, JSON.stringify(await outbox()))

    const foodRows = cloudRowsOf('food_options')
    record('假云端收到了 food_options 的写入', cloudWrites().some((item) => item.table === 'food_options' && item.method === 'POST'), cloudWrites().map((item) => `${item.method} ${item.table}`).join(' | '))
    record('云端拿到的正是刚写的那条记录', foodRows.some((row) => row.name === FOOD_B), JSON.stringify(foodRows.map((row) => row.name)))
    const pushedRow = foodRows.find((row) => row.name === FOOD_B)
    record('推送时 user_id 被改写成云端账号 id', pushedRow?.user_id === CLOUD_USER_ID, `user_id=${pushedRow?.user_id}`)
    // 本地账号 id 与云端账号 id 毫无关系。沿用本地 id 会被 RLS 的
    // `with check (auth.uid() = user_id)` 直接拒绝——所以这条不是「更好」，是「必须」。
    const localUserId = await evaluate(
      `(async () => (await import('/src/services/api/authService.ts')).currentUser().id)()`,
    )
    record('推送时不再沿用本地账号 id', pushedRow?.user_id !== localUserId, `本地 id=${localUserId} / 云端 id=${pushedRow?.user_id}`)
    record(
      '推送出去的行不带本地账号 id 的痕迹',
      JSON.stringify(pushedRow ?? {}).includes(localUserId) === false,
      JSON.stringify(pushedRow ?? {}),
    )

    const afterPush = await status()
    record('推送成功后写入 last_push_at', Boolean(afterPush.lastPushAt), `lastPushAt=${afterPush.lastPushAt}`)
    record('推送成功不留下失败原因', afterPush.lastError === null, JSON.stringify(afterPush.lastError))
    await openAccountCard()
    const pushedCard = await syncCard()
    record('界面上「最后上传」不再是「还没有上传过」', !pushedCard.includes('还没有上传过'), firstLine(pushedCard, 160))
    record('队列排空时给出的是「不代表性一致」的说法', pushedCard.includes('这不代表云端内容与本地完全一致'), firstLine(pushedCard, 200))
    await shot('02-after-push')

    // 5. 防抖 + 压缩：1.5 秒内连写两次，只该推一次，且推的是**最后**的值
    //
    // 两次写入是两个独立事务，压缩发生在第二次写入的事务里（`compactionVictims`）。
    // 若压缩失效，云端会先收到甲再收到乙——结果碰巧也对，但请求数与队列语义都不对；
    // 若把顺序搞反（推了先写的那条），云端会留下一个过期的名字。
    const writesBefore = cloudWrites().length
    await evaluate(`window.__m.write({ kind: 'rename', id: ${JSON.stringify(foodId)}, name: '同步测试食物·第一次改名' })`)
    await evaluate(`window.__m.write({ kind: 'rename', id: ${JSON.stringify(foodId)}, name: '同步测试食物·第二次改名' })`)
    await sleep(400)
    const burstOutbox = await outbox()
    record('防抖窗口内的连续写入在队列里收敛成一条', burstOutbox.length === 1, JSON.stringify(burstOutbox))
    await waitFor(async () => ((await outbox()).length === 0 ? true : null), 12_000)
    const renamedRow = cloudRowsOf('food_options').find((row) => row.id === foodId)
    record('连续两次改名后云端留下的是最后一次的值', renamedRow?.name === '同步测试食物·第二次改名', `云端 name=${renamedRow?.name}`)
    record('同一批只发了一次请求（没有把两次改名都推上去）', cloudWrites().length - writesBefore === 1, `新增 ${cloudWrites().length - writesBefore} 次`)

    // 6. 删除也要推上去
    await evaluate(`window.__m.write({ kind: 'delete', id: ${JSON.stringify(foodId)} })`)
    await waitFor(async () => ((await outbox()).length === 0 ? true : null), 12_000)
    record('删除被推送为 DELETE 请求', cloudWrites().some((item) => item.method === 'DELETE' && item.table === 'food_options'), cloudWrites().map((item) => `${item.method} ${item.table}`).join(' | '))
    record('云端对应的行确实消失了', cloudRowsOf('food_options').every((row) => row.id !== foodId), JSON.stringify(cloudRowsOf('food_options').map((row) => row.name)))

    // 7. 断网：请求发不出去，队列必须原地保留
    //
    // 这里只断言「队列不清空」，不断言「有没有发请求」：浏览器在离线时
    // `navigator.onLine` 会变假，调度器可能**提前返回、一次都不尝试**，
    // 也可能尝试了但请求失败——两条路都是对的，而它们对「发了几个请求」的答案相反。
    // 断言一个两种正确实现下答案不同的东西，只会得到一个随环境变化的假失败。
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })
    cloud.offline = true
    // 「最后上传」要跟**此刻**的值比，不能跟上一步比——中间已经成功推过好几次了。
    const pushAtBeforeOffline = (await status()).lastPushAt
    const offlineFoodId = await evaluate(`window.__m.write({ kind: 'create', name: '离线期间写入的食物' })`)
    await sleep(4000)
    const offlineOutbox = await outbox()
    record('断网期间的写入留在队列里（没有被当成推送成功）', offlineOutbox.length === 1, JSON.stringify(offlineOutbox))
    record('断网期间的记录确实没进云端', cloudRowsOf('food_options').every((row) => row.id !== offlineFoodId), `云端 ${cloudRowsOf('food_options').length} 行`)
    // 断网期间**不该**把「上传失败」写成一条长期结论：这不是云端拒绝，只是网还没通。
    // 更不该更新「最后上传」——那会把一次没成功的上传说成成功。
    const offlineStatus = await status()
    record('断网不更新「最后上传」时间', offlineStatus.lastPushAt === pushAtBeforeOffline, `${offlineStatus.lastPushAt} vs ${pushAtBeforeOffline}`)

    // 8. 恢复：自动补推
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })
    cloud.offline = false
    const recovered = await waitFor(async () => ((await outbox()).length === 0 ? true : null), 20_000)
    record('恢复网络后自动补推（无需用户手动操作）', recovered === true, JSON.stringify(await outbox()))
    if (!recovered) {
      // 诊断用：自然恢复没成功时，确认「online 事件 → 立刻推」这条契约本身还在。
      // 分开记一条，是为了让失败时能看出是「事件没触发」还是「推送路径坏了」。
      await evaluate(`window.dispatchEvent(new Event('online'))`)
      const nudged = await waitFor(async () => ((await outbox()).length === 0 ? true : null), 10_000)
      record('online 事件能触发补推（自然恢复失败时的诊断项）', nudged === true, JSON.stringify(await outbox()))
    }
    record('补推后云端拿到了离线期间的记录', cloudRowsOf('food_options').some((row) => row.id === offlineFoodId), `云端 ${cloudRowsOf('food_options').length} 行`)

    // 9. 服务端拒绝：队列保留、原因如实显示
    //
    // 用「云端返回 500」而不是「断网」来验失败分支：断网有两种正确实现
    // （提前返回 / 请求失败），而服务端拒绝只有一条路径，结论稳定。
    // 「最后上传」要跟**此刻**的值比，不能跟上一步比——中间已经成功推过好几次了。
    const pushAtBeforeReject = (await status()).lastPushAt
    const noiseBeforeReject = consoleNoise(cdp).length
    cloud.rejectBusiness = CLOUD_REJECT_MESSAGE
    const rejectedFoodId = await evaluate(`window.__m.write({ kind: 'create', name: '被拒绝的食物' })`)
    const failed = await waitFor(async () => {
      const current = await status()
      return current.lastError ? current : null
    }, 15_000)
    record('云端拒绝时如实记下失败原因', failed?.lastError?.message?.includes(CLOUD_REJECT_MESSAGE) === true, JSON.stringify(failed?.lastError ?? null))
    record('推送失败时队列不清空', (await outbox()).length === 1, JSON.stringify(await outbox()))
    record('推送失败不更新「最后上传」时间', failed?.lastPushAt === pushAtBeforeReject, `${failed?.lastPushAt} vs ${pushAtBeforeReject}`)
    await openAccountCard()
    const failedCard = await syncCard()
    record('界面上出现「上传失败」与具体原因', failedCard.includes('上传失败') && failedCard.includes(CLOUD_REJECT_MESSAGE), firstLine(failedCard, 220))
    await shot('03-failed')

    // 10. 恢复：退避重试成功后，失败原因必须被清掉
    cloud.rejectBusiness = null
    const healed = await waitFor(async () => {
      const current = await status()
      return current.lastError === null && current.pendingCount === 0 ? current : null
    }, 25_000)
    record('云端恢复后按退避自动重试成功', healed !== null, healed ? `pendingCount=${healed.pendingCount}` : JSON.stringify(await status()))
    record('重试成功后失败原因被清掉（界面不挂过期信息）', (await status()).lastError === null, JSON.stringify((await status()).lastError))
    record('重试成功后云端拿到了那条记录', cloudRowsOf('food_options').some((row) => row.id === rejectedFoodId), `云端 ${cloudRowsOf('food_options').length} 行`)

    // 11. 幂等：同一条记录再推一次，云端仍然只有一行
    const rowsBefore = cloudRowsOf('food_options').length
    await evaluate(`window.__m.write({ kind: 'rename', id: ${JSON.stringify(rejectedFoodId)}, name: '被拒绝的食物·改名后重推' })`)
    await waitFor(async () => ((await outbox()).length === 0 ? true : null), 15_000)
    const rowsAfter = cloudRowsOf('food_options').length
    record('重复推送同一条记录不会在云端产生第二行', rowsBefore === rowsAfter, `${rowsBefore} → ${rowsAfter}`)
    const idempotentRow = cloudRowsOf('food_options').find((row) => row.id === rejectedFoodId)
    record('重复推送后云端内容与本地最后一次写入一致', idempotentRow?.name === '被拒绝的食物·改名后重推', `云端 name=${idempotentRow?.name}`)
    // 云端不该看到设备状态表：队列与同步状态是纯粹的本机账本。
    record('设备状态表从未被推送', cloud.rest.every((item) => item.table !== 'sync_outbox' && item.table !== 'sync_state'), cloud.rest.map((item) => item.table).filter((table, index, all) => all.indexOf(table) === index).join(' | '))
    // 本地账号（users）是应用身份，本地密码不迁移（决策 D5）。
    record('本地账号表从未被推送', cloud.rest.every((item) => item.table !== 'users'), '')

    // 12. 收尾：重新加载后仍认得这个绑定（sync_state 是持久的）
    await goto()
    const afterReload = await status()
    record('刷新后绑定关系仍在（sync_state 持久化）', afterReload.bound === true && afterReload.cloudEmail === emailForUsername(CLOUD_USERNAME), `bound=${afterReload.bound}`)

    // 12b. 换本地账号不串推（S4 补丁 ②）
    //
    // 这一段守的是这次改造要修的那个缺陷。背景：绑定是「本地账号 ↔ 云端账号」的关系，
    // 而 `sync_state` 早先是**设备级单行**。于是退出 A、登录 B 之后，B 会读到 A 的绑定，
    // 界面上显示「已连接 A 的云端」，B 的改动被推到 **A 的云端账号**里——
    // 全程没有任何提示，A 下次打开自己的云端会看到不属于自己的数据。
    //
    // 判据分三块：绑定记在账号名下（读不到别人的）、未绑定的新账号一个请求都不发、
    // 换回原账号后别人的待上传条目仍然留在队列里（不会被顺手推走）。
    //
    // 退出登录通过认证门面触发：它只清本地会话，**不清 `sync_state`**。
    // 这正是泄露发生的路径，所以必须用它来验，不能用「断开连接」（那条路本来就会清状态）。
    const accountA = await evaluate('window.__m.localUserId()')
    const stateRows = await evaluate('window.__m.syncStateRows()')
    record(
      '绑定记在本地账号名下（sync_state 的主键就是本地账号 id）',
      stateRows.length === 1 && stateRows[0].id === accountA && stateRows[0].cloud_email === emailForUsername(CLOUD_USERNAME),
      JSON.stringify(stateRows),
    )

    const signOutAnd = async (account, action) => {
      await openAccountCard()
      await evaluate(`(async () => { const { signOut } = await import('/src/services/api/authService.ts'); await signOut(); })()`)
      await sleep(1500)
      await evaluate(`
        (async () => {
          window.__m.fill('账号', ${JSON.stringify(account)});
          window.__m.fill('密码', ${JSON.stringify(PASSWORD)});
          await window.__m.wait(200);
          return window.__m.clickText(${JSON.stringify(action)});
        })()
      `)
      await sleep(2400)
    }

    await signOutAnd(ACCOUNT_B, '注册')
    const accountB = await evaluate('window.__m.localUserId()')
    const stateRowsB = await evaluate('window.__m.syncStateRows()')
    await openAccountCard()
    const bCard = await syncCard()
    record(
      '换账号后新账号看到的是「未连接」，而不是上一任的绑定',
      accountB !== accountA && bCard.includes('未连接云端账号') && !bCard.includes(emailForUsername(CLOUD_USERNAME)),
      `本地账号=${accountB === accountA ? '与 A 相同（异常）' : 'B'} / ${firstLine(bCard, 140)}`,
    )
    record(
      '上一任账号的绑定没有被删掉（换回来仍然认得）',
      stateRowsB.length === 1 && stateRowsB[0].id === accountA && stateRowsB[0].cloud_email === emailForUsername(CLOUD_USERNAME),
      JSON.stringify(stateRowsB),
    )

    const restBeforeB = cloud.rest.length
    await evaluate(`window.__m.write({ kind: 'create', name: ${JSON.stringify(FOOD_SWITCH)} })`)
    await sleep(3200)
    const outboxB = await outbox()
    record(
      '未绑定的新账号写入只进队列，一个云端请求都不发',
      outboxB.some((row) => row.local_user_id === accountB) && cloud.rest.length === restBeforeB,
      `队列归属=${JSON.stringify([...new Set(outboxB.map((row) => row.local_user_id))])} / 云端新增 ${cloud.rest.length - restBeforeB} 次`,
    )

    await signOutAnd(ACCOUNT, '登录')
    const backA = await status()
    record(
      '换回原账号后绑定仍在（绑定跟着账号走，不跟着设备走）',
      backA.bound === true && backA.cloudEmail === emailForUsername(CLOUD_USERNAME),
      JSON.stringify(backA),
    )
    // 等一轮推送过去：A 的队列是空的，调度器读到的批次必须**一条都没有**，
    // 而不是「把 B 的条目推上去」。这是这次改造最要紧的一条判据。
    await sleep(3200)
    const afterBack = await outbox()
    record(
      '另一个账号的待上传条目留在队列里，没有被推到这个账号的云端',
      afterBack.some((row) => row.local_user_id === accountB) &&
        cloudRowsOf('food_options').every((row) => row.name !== FOOD_SWITCH),
      `队列归属=${JSON.stringify([...new Set(afterBack.map((row) => row.local_user_id))])} / 云端食物=${JSON.stringify(cloudRowsOf('food_options').map((row) => row.name))}`,
    )

    // 12.5 整体替换（S5）
    //
    // 两个按钮都不可撤销，各自要有一条完整闭环：确认框出现 → 调对 RPC →
    // 数据真的换了方向 → 界面如实报数 → 失败时不伪装成功。
    //
    // 「两边不一致」由**直接改假云端的行**来制造，而不是在本地造差异：
    // 本地造差异要么靠断网、要么靠抢在 1.5s 防抖之前——前者会往控制台灌噪声
    // （污染第 13 节），后者是时序赌博。直接动假云端既确定又不留噪声。
    //
    // 先造一条**属于本账号的**积压条目：否则「上传后队列空了」是天然成立的，
    // 断言等于没测（A 的队列本来就是空的）。用 `rejectTable` 而不是断网或
    // `rejectBusiness`：前者会给控制台灌 `ERR_INTERNET_DISCONNECTED`（第 13 节不认），
    // 后者会连探测一起掐掉、确认框都弹不出来。这里要的正是「推送一直失败、上传照常成功」。
    cloud.rejectTable = 'food_options'
    await evaluate(`window.__m.write({ kind: 'create', name: ${JSON.stringify(FOOD_PENDING)} })`)
    const backlog = await waitFor(async () => {
      const rows = await outbox()
      return rows.some((row) => row.local_user_id === accountA) ? rows : null
    }, 15_000)
    record(
      '推送持续失败时本账号积压了队列（为下面那条断言造状态）',
      Boolean(backlog),
      `属于本账号 ${(backlog ?? []).filter((row) => row.local_user_id === accountA).length} 条`,
    )

    const localFoods = await evaluate(`window.__m.write({ kind: 'list' })`)
    const localTotal = (await status()).localCount
    // 模拟云端被清空（换设备 / 灾难恢复）：上传应该把云端整份重建出来。
    cloud.rows.clear()

    await openAccountCard()
    await evaluate(`window.__m.clickText('上传本地数据到云端')`)
    const uploadConfirm = await waitFor(async () => {
      const current = await text()
      return current.includes('用本地数据替换云端？') ? current : null
    }, 12_000)
    record('点「上传本地数据到云端」弹出二次确认', Boolean(uploadConfirm), firstLine(uploadConfirm ?? '', 140))
    // 必须钉住**顺序**，不能只查「出现过本地/云端这两个词」：这两个词在确认框的正文里
    // 本来就会出现，只查出现等于没查；而把方向写反恰恰是这块界面最危险的错法。
    // 后半句同时要求云端那个数字是 0——云端刚被清空，所以它也顺带证明了
    // 确认框里的条数是**当场问到的**，不是把状态卡上的旧数字抄过来的。
    record(
      '确认框把覆盖方向写对了（本地 → 云端），且云端条数是当场问到的 0',
      /将用\s*本地\s*\d+\s*条\s*替换\s*云端\s*0\s*条/.test(uploadConfirm ?? ''),
      firstLine(uploadConfirm ?? '', 200),
    )
    await evaluate(`window.__m.clickText('替换云端数据')`)
    const uploadDone = await waitFor(async () => {
      const current = await syncCard()
      return current.includes('云端已替换为本地内容') ? current : null
    }, 20_000)
    record('确认后云端被整份替换，界面如实报出结果', Boolean(uploadDone), firstLine(uploadDone ?? '', 200))
    record(
      '上传走的是 import_local_backup',
      cloud.rest.some((item) => item.method === 'POST' && item.table === 'rpc:import_local_backup'),
      cloud.rest.filter((item) => item.rpc).map((item) => item.table).join(' | '),
    )
    record(
      '上传后云端条数与本地一致',
      cloudSummaryOf().total === localTotal,
      `云端 ${cloudSummaryOf().total} / 本地 ${localTotal}`,
    )
    const cloudFoods = cloudRowsOf('food_options').map((row) => row.name).sort()
    record(
      '上传后云端食物与本地逐条一致（被清空的云端整份重建）',
      JSON.stringify(cloudFoods) === JSON.stringify([...localFoods].sort()),
      `云端=${JSON.stringify(cloudFoods)} / 本地=${JSON.stringify(localFoods)}`,
    )
    // 上传成功后本账号的队列该空了；B 那条**不属于这个账号**，必须原样留着。
    const outboxAfterUpload = await outbox()
    record(
      '上传清空了本账号积压的队列，另一个账号的条目不动',
      outboxAfterUpload.every((row) => row.local_user_id !== accountA) &&
        outboxAfterUpload.some((row) => row.local_user_id === accountB),
      `本账号残留 ${outboxAfterUpload.filter((row) => row.local_user_id === accountA).length} 条 / 队列共 ${outboxAfterUpload.length} 条`,
    )

    // 反向：往云端塞一条本地没有的食物，**同时**在本地写一条云端没有的。
    // 两个方向都必须造出来：只造「云端多一条」的话，「整体替换」与「合并」的结果
    // 完全一样（本地内容 ⊆ 云端内容），断言就分不出实现对错——
    // 本地那条**必须被删掉**，才算证明了这一步是替换而不是合并。
    const CLOUD_ONLY_ID = 'c1000000-0000-4000-8000-000000000001'
    const cloudTotalBeforeRestore = cloudSummaryOf().total
    cloud.rows.set(rowKey('food_options', CLOUD_ONLY_ID), {
      id: CLOUD_ONLY_ID,
      user_id: CLOUD_USER_ID,
      name: FOOD_CLOUD_ONLY,
      active: true,
      sort_order: 99,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })
    // 这条推不上去（`rejectTable` 还掐着 food_options），所以它只存在于本地。
    await evaluate(`window.__m.write({ kind: 'create', name: ${JSON.stringify(FOOD_LOCAL_ONLY)} })`)

    await openAccountCard()
    await evaluate(`window.__m.clickText('从云端恢复到本地')`)
    const restoreConfirm = await waitFor(async () => {
      const current = await text()
      return current.includes('用云端数据替换本地？') ? current : null
    }, 12_000)
    record('点「从云端恢复到本地」弹出二次确认', Boolean(restoreConfirm), firstLine(restoreConfirm ?? '', 140))
    // 反方向同样钉住顺序：两个方向共用一句句式，只有把源与目标调过来，
    // 所以「写反了」在这一侧和那一侧是同一个 bug 的两种表现。
    record(
      '确认框把覆盖方向写对了（云端 → 本地）',
      /将用\s*云端\s*\d+\s*条\s*替换\s*本地\s*\d+\s*条/.test(restoreConfirm ?? ''),
      firstLine(restoreConfirm ?? '', 200),
    )
    await evaluate(`window.__m.clickText('替换本地数据')`)
    const restoreDone = await waitFor(async () => {
      const current = await syncCard()
      return current.includes('本地已替换为云端内容') ? current : null
    }, 20_000)
    record('确认后本地被整份替换，界面如实报出结果', Boolean(restoreDone), firstLine(restoreDone ?? '', 200))
    record(
      '恢复走的是 export_cloud_snapshot',
      cloud.rest.some((item) => item.method === 'POST' && item.table === 'rpc:export_cloud_snapshot'),
      cloud.rest.filter((item) => item.rpc).map((item) => item.table).join(' | '),
    )
    const foodsAfterRestore = await evaluate(`window.__m.write({ kind: 'list' })`)
    record(
      '恢复后本地出现只存在于云端的那条记录',
      foodsAfterRestore.includes(FOOD_CLOUD_ONLY),
      JSON.stringify(foodsAfterRestore),
    )
    // 这一条才是「替换」与「合并」的分水岭：本地独有的那条必须消失。
    record(
      '恢复后本地独有的那条被删掉了（是替换不是合并）',
      foodsAfterRestore.includes(FOOD_LOCAL_ONLY) === false,
      JSON.stringify(foodsAfterRestore),
    )
    const afterRestore = await status()
    record(
      '恢复后本地条数与云端一致，并写下 last_restore_at',
      afterRestore.localCount === cloudTotalBeforeRestore + 1 && Boolean(afterRestore.lastRestoreAt),
      `本地 ${afterRestore.localCount} / 云端 ${cloudTotalBeforeRestore + 1} / lastRestoreAt=${afterRestore.lastRestoreAt}`,
    )

    // 失败分支：只掐替换本身（探测照常），否则确认框根本弹不出来，
    // 测到的是「读条数失败」——那是另一条分支，不是这条。
    cloud.rejectReplace = '模拟云端拒绝整体替换'
    const cloudTotalBeforeFail = cloudSummaryOf().total
    await openAccountCard()
    await evaluate(`window.__m.clickText('上传本地数据到云端')`)
    const failConfirm = await waitFor(async () => {
      const current = await text()
      return current.includes('用本地数据替换云端？') ? current : null
    }, 12_000)
    record('替换失败前确认框照常弹出（探测没被掐）', Boolean(failConfirm), firstLine(failConfirm ?? '', 140))
    await evaluate(`window.__m.clickText('替换云端数据')`)
    const failText = await waitFor(async () => {
      const current = await syncCard()
      return current.includes('上传到云端失败') ? current : null
    }, 20_000)
    record(
      '替换失败时如实报错，绝不出现「已替换」',
      Boolean(failText) && !(failText ?? '').includes('云端已替换为本地内容'),
      firstLine(failText ?? '', 200),
    )
    record(
      '替换失败时云端数据一行没动',
      cloudSummaryOf().total === cloudTotalBeforeFail,
      `失败前 ${cloudTotalBeforeFail} / 失败后 ${cloudSummaryOf().total}`,
    )
    cloud.rejectReplace = null
    // 收掉「只掐 food_options」：再留着会让后面的重试继续报 500。
    cloud.rejectTable = null

    // 13. 控制台
    //
    // 拆成两段（理由见 INTENTIONAL_500 的注释）：注入 500 之前必须是**完全干净**的，
    // 注入之后只允许出现那一种刻意制造的噪声。
    const noise = consoleNoise(cdp)
    record('注入云端 500 之前控制台完全干净', noiseBeforeReject === 0, `${noiseBeforeReject} 条`)
    const unexpected = noise.slice(noiseBeforeReject).filter((event) => !INTENTIONAL_500.test(describeNoise(event)))
    record(
      '注入 500 之后只多出刻意制造的那条噪声',
      unexpected.length === 0,
      unexpected.length
        ? unexpected.slice(0, 3).map(describeNoise).join(' | ')
        : `多出 ${noise.length - noiseBeforeReject} 条，均为刻意制造的 500`,
    )

    const failedResults = results.filter((item) => !item.ok)
    console.log('')
    console.log(`结果：${results.length - failedResults.length}/${results.length} 通过`)
    if (failedResults.length) {
      console.log('未通过：')
      failedResults.forEach((item) => console.log(`  - ${item.name}`))
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
