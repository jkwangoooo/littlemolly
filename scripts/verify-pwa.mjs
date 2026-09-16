#!/usr/bin/env node
// PWA 层验收：**跑生产构建产物**，不是 dev server。
//
// 用法：
//   npm run verify:pwa            （可选 SHOT_DIR=<目录> 落盘截图，用于人工核对观感）
//
// 为什么必须单独一个脚本（而不是塞进 verify:local）：
// verify:local 走 Vite dev server，而本项目**刻意不在 dev 注册 service worker**——
// 它有两个用例依赖「请求真的发到服务器」（CDP 把 /src/main.tsx 换成空模块来造 v1 老库、
// Storage.clearDataForOrigin 清站点数据）。把 SW 检查塞进去，只会逼着去改那些已经验收过的用例。
// 所以这里自己起一个零依赖静态服务器托管 dist/，把 PWA 相关的一切收在这个脚本里：
//
//   1. dev 模式没有 SW 注册（同一份脚本里对着 dev server 断言，杜绝「以为没注册」）
//   2. manifest 字段齐全、图标全部可访问、index.html 里 iOS 需要的 meta 都在
//   3. SW 注册并 activated、Cache Storage 里有应用壳、缓存里没有任何跨域条目
//   4. 断网（CDP 模拟）+ 真的把服务器关掉，刷新仍能渲染出应用；断网时读得到已写入的本地数据
//   5. 重新构建后：新版本处于 waiting（不静默替换正在用的页面），用户点「刷新」才接管，旧缓存被清理
//   6. 「选项」页的存储状态卡片如实显示用量 / 是否持久化 / 是否独立窗口
//   7. 桌面 1440x900 与手机 390x844 无横向溢出，控制台无 error / warning
//
// 依赖：本机已安装 Chrome 或 Edge。不使用第三方 npm 包，不写项目目录（截图目录由 SHOT_DIR 指定）。

import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createProbeServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBrowser } from './lib/find-browser.mjs'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = join(PROJECT_ROOT, 'dist')
const SHOT_DIR = process.env.SHOT_DIR ?? null
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

const SHELL_ICONS = [
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon.svg',
]

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
}
function firstLine(value, limit = 120) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

/** 控制台噪音的说明文本：带上来源 URL，否则「404」这种报错根本没法定位。 */
function describeNoise(events) {
  return events
    .slice(0, 3)
    .map((event) => {
      const entry = event.params.entry
      const text = entry?.text ?? event.params.exceptionDetails?.text ?? event.params.type ?? event.method
      const url = entry?.url ?? event.params.exceptionDetails?.url ?? ''
      return url ? `${text} (${url})` : String(text)
    })
    .join(' | ')
}

// ---------------------------------------------------------------- 基础设施

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createProbeServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/** 图标预览页：只给验收用（挂在静态服务器上），截图人工核对图标观感。 */
function iconsPreviewHtml() {
  const items = [
    ['icons/icon-192.png', '192 · any'],
    ['icons/icon-512.png', '512 · any'],
    ['icons/icon-maskable-512.png', '512 · maskable'],
    ['apple-touch-icon.png', '180 · apple-touch'],
  ]
  return `<!doctype html><meta charset="utf-8"><title>图标预览</title>
<link rel="icon" href="/favicon.svg">
<style>
  body { margin: 0; padding: 20px; background: #f4f1ef; color: #24211f; font: 13px/1.5 sans-serif; }
  ul { display: flex; flex-wrap: wrap; gap: 20px; margin: 0; padding: 0; list-style: none; }
  li { display: grid; gap: 6px; justify-items: center; }
  img { border-radius: 12px; background: #fff; }
</style>
<ul>
${items.map(([src, label]) => `  <li><img src="/${src}" width="96" height="96" alt=""><span>${label}</span></li>`).join('\n')}
</ul>
`
}

function startStaticServer(root) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (url.pathname === '/__icons-preview') {
      response.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'], 'Cache-Control': 'no-store' })
      response.end(iconsPreviewHtml())
      return
    }

    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '')
    const filePath = join(root, relative === '' ? 'index.html' : relative)
    if (!filePath.startsWith(root)) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('forbidden')
      return
    }

    let stat = null
    try {
      stat = statSync(filePath)
    } catch {
      stat = null
    }
    if (!stat || !stat.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }

    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      // 不做 HTTP 缓存：验收要的是「每次刷新都问服务器」，缓存策略由 service worker 负责。
      'Cache-Control': 'no-cache',
    })
    createReadStream(filePath).pipe(response)
  })
  return server
}

/**
 * 在指定端口上监听，失败就重试。
 * 断网用例要先把服务器关掉再在**同一个端口**恢复——换端口就换了源，
 * 缓存与 IndexedDB 都不在同一份数据上了，验证会变成假的。
 */
async function listenWithRetry(server, port, attempts = 25) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ok = await new Promise((resolve) => {
      const onError = () => {
        server.removeListener('listening', onListening)
        resolve(false)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve(true)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })
    if (ok) return true
    await sleep(400)
  }
  return false
}

function runNpm(args, label) {
  return new Promise((resolve, reject) => {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const child = spawn(npmCommand, args, {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`${label} 退出码 ${code}：${firstLine(output.slice(-500), 500)}`))
    })
  })
}

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

/** 注入页面的小工具：只做「按文案点按钮 / 填输入框 / 读状态」，不参与业务判断。 */
const PAGE_HELPERS = `
window.__p = {
  byText: (text) => [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === text),
  clickText: (text) => { const el = window.__p.byText(text); if (!el) return 'NOT_FOUND:' + text; el.click(); return 'OK' },
  fill: (labelText, value) => {
    const label = [...document.querySelectorAll('label')].find((item) => item.textContent.includes(labelText));
    if (!label) return 'NO_LABEL:' + labelText;
    const input = label.querySelector('input');
    if (!input) return 'NO_INPUT:' + labelText;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  text: () => document.body.innerText,
  box: (selector) => { const el = document.querySelector(selector); return el ? el.innerText.replace(/\\n+/g, ' | ').trim() : 'NO_ELEMENT:' + selector },
  sw: async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return JSON.stringify({
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null,
      active: registration && registration.active ? registration.active.scriptURL : null,
      activeState: registration && registration.active ? registration.active.state : null,
      waiting: registration && registration.waiting ? registration.waiting.scriptURL : null,
      installing: registration && registration.installing ? registration.installing.scriptURL : null,
    });
  },
  cacheReport: async () => {
    const names = await caches.keys();
    const report = {};
    for (const name of names) {
      const cache = await caches.open(name);
      report[name] = (await cache.keys()).map((request) => request.url);
    }
    return JSON.stringify(report);
  },
  storageCard: () => {
    const card = document.querySelector('[data-storage-card]');
    // 找不到卡片也返回合法 JSON：调用方一律 JSON.parse，不能抛异常。
    if (!card) return JSON.stringify({ missing: true, text: '', usage: '', persisted: '', mode: '' });
    return JSON.stringify({
      missing: false,
      text: card.innerText.replace(/\\n+/g, ' | ').trim(),
      usage: (document.querySelector('[data-storage-usage]') || {}).textContent || '',
      persisted: (document.querySelector('[data-storage-persisted]') || {}).textContent || '',
      mode: (document.querySelector('[data-storage-standalone]') || {}).textContent || '',
    });
  },
  overflow: () => JSON.stringify({
    innerWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }),
};
'ready'
`

function scriptBuildParam(url) {
  if (!url) return null
  try {
    return new URL(url).searchParams.get('build')
  } catch {
    return null
  }
}

/**
 * 用独立的应用窗口（`--app=`）检查「已安装到主屏幕」这一支。
 *
 * 为什么另开一个浏览器实例：应用窗口必须换一个用户数据目录（同一个目录不能同时被两个
 * Chrome 实例占用），所以这是一个全新的存储分区——正好也顺带验证了「新设备 / 新分区
 * 首次打开独立窗口」的完整路径：注册 → 选项页 → 存储卡片。
 * 返回值里的 `card` 就是卡片读到的真实状态，`standalone` 是浏览器自己的回答。
 *
 * 截图必须用**这个窗口自己的** CDP 连接拍：主窗口的 `Page.captureScreenshot`
 * 拍到的是主窗口，两张图会长得一模一样，人工核对时会被骗过去。
 */
async function inspectStandaloneWindow(browserPath, appUrl, stamp) {
  const userDataDir = join(tmpdir(), `molly-pwa-app-${stamp}`)
  const child = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      `--app=${appUrl}`,
    ],
    { stdio: 'ignore' },
  )
  child.on('error', () => {})

  let cdp = null
  try {
    const portFile = join(userDataDir, 'DevToolsActivePort')
    let port = null
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (existsSync(portFile)) {
        port = readFileSync(portFile, 'utf8').split('\n')[0].trim()
        if (port) break
      }
      await sleep(250)
    }
    if (!port) throw new Error('应用窗口的调试端口未就绪。')

    cdp = await connect(port)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await sleep(2500)
    await cdp.send('Runtime.evaluate', { expression: PAGE_HELPERS, awaitPromise: true, returnByValue: true })

    const evaluate = async (expression) => {
      const outcome = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (outcome.exceptionDetails) throw new Error(outcome.exceptionDetails.text)
      return outcome.result.value
    }
    const shotHere = async (label) => {
      if (!SHOT_DIR) return
      try {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        writeFileSync(join(SHOT_DIR, `${label}.png`), Buffer.from(data, 'base64'))
      } catch (reason) {
        console.warn(`截图 ${label} 失败（不影响验收）：${reason.message}`)
      }
    }

    let rendered = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
      rendered = await evaluate(`document.body.innerText.includes('邮箱')`)
      if (rendered) break
      await sleep(500)
    }
    await shotHere('02-app-standalone-first-screen')

    if (!rendered) return { standalone: false, rendered: false, card: { missing: true, text: '', mode: '', usage: '', persisted: '' } }

    await evaluate(`
      (async () => {
        window.__p.fill('邮箱', ${JSON.stringify(`app-${stamp}@local.test`)});
        window.__p.fill('密码', 'verify123');
        await window.__p.wait(200);
        window.__p.clickText('注册');
        await window.__p.wait(2400);
      })()
    `)
    const standalone = await evaluate(`window.matchMedia('(display-mode: standalone)').matches`)
    const card = JSON.parse(
      await evaluate(`
        (async () => {
          window.__p.clickText('选项');
          await window.__p.wait(1800);
          return window.__p.storageCard();
        })()
      `),
    )
    await shotHere('02-app-standalone-options')
    // 再拍一张把卡片滚进视野的：人工核对「已安装」这一支的观感时，
    // 截首屏是看不到卡片的（它在选项页靠下的位置）。
    await evaluate(`document.querySelector('[data-storage-card]').scrollIntoView({ block: 'center' })`)
    await sleep(500)
    await shotHere('02b-app-standalone-storage-card')
    return { standalone, rendered: !card.missing, card }
  } finally {
    if (cdp) {
      try {
        cdp.ws.close()
      } catch {
        // 关闭失败不影响结果
      }
    }
    child.kill()
    await sleep(400)
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

async function main() {
  const browserPath = findBrowser()
  const stamp = Date.now()
  const EMAIL = `pwa-${stamp}@local.test`
  const PASSWORD = 'verify123'
  const userDataDir = join(tmpdir(), `molly-pwa-${stamp}`)
  let child = null
  let devServer = null
  let server = null
  let port = null

  try {
    // ---------------------------------------------------------------- 1 构建
    console.log('构建生产产物…')
    const buildOutput = await runNpm(['run', 'build'], 'npm run build')
    const builtSummary = buildOutput
      .split('\n')
      .filter((line) => line.includes('modules transformed') || line.includes('built in'))
      .join(' / ')
    const shellFiles = ['sw.js', 'manifest.webmanifest', 'apple-touch-icon.png', ...SHELL_ICONS.map((icon) => icon)]
    const missing = shellFiles.filter((file) => !existsSync(join(DIST_DIR, file)))
    record(
      '生产构建产出完整应用壳（sw.js / manifest / 图标）',
      missing.length === 0,
      missing.length ? `缺少 ${missing.join(', ')}` : firstLine(builtSummary),
    )

    // ---------------------------------------------------------------- 2 两个服务器
    port = await findFreePort()
    server = startStaticServer(DIST_DIR)
    if (!(await listenWithRetry(server, port))) throw new Error(`静态服务器无法监听 ${port}。`)
    const appUrl = `http://127.0.0.1:${port}/`
    const origin = new URL(appUrl).origin
    console.log(`托管 dist/：${appUrl}`)

    devServer = await startDevServer()
    console.log(`dev server：${devServer.url}`)

    // ---------------------------------------------------------------- 3 浏览器
    const launched = await launchBrowser(browserPath, userDataDir)
    child = launched.child
    const cdp = await connect(launched.port)
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')

    const evaluate = async (expression) => {
      const outcome = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (outcome.exceptionDetails) {
        throw new Error(outcome.exceptionDetails.exception?.description ?? outcome.exceptionDetails.text)
      }
      return outcome.result.value
    }
    const navigate = async (url, wait = 2500) => {
      await cdp.send('Page.navigate', { url })
      await sleep(wait)
      await evaluate(PAGE_HELPERS)
    }
    const reload = async (wait = 2500) => {
      await cdp.send('Page.reload', {})
      await sleep(wait)
      await evaluate(PAGE_HELPERS)
    }
    /** 轮询直到表达式返回 true；返回最后一次的实际值，便于失败时写进报告。 */
    const until = async (expression, timeoutMs = 15000, interval = 300) => {
      const deadline = Date.now() + timeoutMs
      let last = null
      while (Date.now() < deadline) {
        last = await evaluate(expression)
        if (last === true) return last
        await sleep(interval)
      }
      return last
    }
    const text = () => evaluate('window.__p.text()')
    const swState = async () => JSON.parse(await evaluate('window.__p.sw()'))
    const cacheReport = async () => JSON.parse(await evaluate('window.__p.cacheReport()'))

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

    // ---------------------------------------------------------------- 4 dev 不注册 SW
    await cdp.send('Storage.clearDataForOrigin', {
      origin: new URL(devServer.url).origin,
      storageTypes: 'indexeddb,local_storage,cache_storage,service_workers',
    })
    await navigate(devServer.url, 1500)
    // Vite dev 首次访问要预构建依赖，首屏可能比生产慢好几秒，因此轮询等文案出现，
    // 而不是赌一个固定等待时间——否则「dev 页面没起来」会被误读成「dev 注册了 SW」。
    const devReady = await until(`document.body.innerText.includes('邮箱') && document.body.innerText.includes('注册')`, 30000)
    const devState = await swState()
    record(
      'dev server 上渲染出登录页（确认 dev 页面确实跑起来了）',
      devReady === true,
      devReady === true ? '登录页已渲染' : firstLine(await text(), 80),
    )
    record(
      'dev 模式下没有注册任何 service worker',
      devState.registrations === 0 && devState.controller === null,
      `registrations=${devState.registrations}, controller=${devState.controller}`,
    )

    // ---------------------------------------------------------------- 5 生产首屏
    cdp.events.length = 0
    await cdp.send('Storage.clearDataForOrigin', {
      origin,
      storageTypes: 'indexeddb,local_storage,cache_storage,service_workers',
    })
    await navigate(appUrl)
    await shot('01-app-login')

    const loginText = await text()
    record('生产构建首屏渲染登录页', loginText.includes('邮箱') && loginText.includes('注册'), firstLine(loginText, 60))

    // manifest
    const manifest = JSON.parse(await evaluate(`fetch('/manifest.webmanifest').then((response) => response.text())`))
    const manifestFields = ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color', 'icons']
    const missingFields = manifestFields.filter((field) => manifest[field] === undefined || manifest[field] === '')
    record(
      'manifest 字段齐全',
      missingFields.length === 0 && manifest.display === 'standalone' && manifest.start_url === '/' && manifest.scope === '/',
      missingFields.length ? `缺少 ${missingFields.join(', ')}` : `display=${manifest.display}, start_url=${manifest.start_url}, scope=${manifest.scope}`,
    )

    const iconEntries = Array.isArray(manifest.icons) ? manifest.icons : []
    const has192 = iconEntries.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png')
    const has512 = iconEntries.some((icon) => icon.sizes === '512x512' && (icon.purpose ?? 'any').includes('any'))
    const hasMaskable = iconEntries.some((icon) => (icon.purpose ?? '').includes('maskable') && icon.sizes === '512x512')
    record('manifest 的 icons 含 192/512 any 与 512 maskable', has192 && has512 && hasMaskable, `${iconEntries.length} 个：${iconEntries.map((icon) => `${icon.sizes}/${icon.purpose ?? 'any'}`).join(', ')}`)

    const html = await evaluate(`fetch('/index.html').then((response) => response.text())`)
    const htmlChecks = {
      manifestLink: /rel="manifest"/.test(html),
      appleTouchIcon: /rel="apple-touch-icon"[^>]*sizes="180x180"/.test(html),
      mobileCapable: /name="mobile-web-app-capable"/.test(html),
      appleCapable: /name="apple-mobile-web-app-capable"/.test(html),
      statusBar: /name="apple-mobile-web-app-status-bar-style"/.test(html),
    }
    record(
      'index.html 含 iOS / Android 安装所需 meta 与 apple-touch-icon',
      Object.values(htmlChecks).every(Boolean),
      Object.entries(htmlChecks).filter(([, ok]) => !ok).map(([key]) => key).join(', ') || '全部存在',
    )

    const iconReport = JSON.parse(
      await evaluate(`
        Promise.all(${JSON.stringify([...SHELL_ICONS, ...iconEntries.map((icon) => icon.src)])}.map((path) =>
          fetch(path).then((response) => ({ path, status: response.status, ok: response.ok, type: response.headers.get('content-type') || '' }))
            .catch((reason) => ({ path, status: 0, ok: false, type: String(reason) }))
        )).then((list) => JSON.stringify(list))
      `),
    )
    const badIcons = iconReport.filter((item) => !item.ok || !item.type.includes('image'))
    record(
      'manifest 与 HTML 里引用的每个图标都能取到且是图片',
      badIcons.length === 0,
      badIcons.length ? badIcons.map((item) => `${item.path}:${item.status}`).join(', ') : `${iconReport.length} 个全部 200`,
    )

    // ---------------------------------------------------------------- 6 SW 注册与缓存
    const activated = await until(
      `navigator.serviceWorker.ready.then((registration) => !!(registration.active && registration.active.state === 'activated'))`,
      20000,
    )
    const registeredState = await swState()
    record(
      'service worker 注册成功并 activated',
      activated === true && registeredState.activeState === 'activated',
      `active=${registeredState.active}, state=${registeredState.activeState}`,
    )

    // 首次安装时页面还没被 SW 接管（刻意不 clients.claim），刷新一次才会进入受控状态。
    await reload()
    const controlledState = await swState()
    record('刷新后页面由 service worker 接管', Boolean(controlledState.controller), String(controlledState.controller))

    const report = await cacheReport()
    const cacheNames = Object.keys(report)
    const shellName = cacheNames.find((name) => name.startsWith('molly-shell-'))
    record(
      'Cache Storage 里存在应用壳缓存（缓存名带构建戳）',
      Boolean(shellName) && scriptBuildParam(registeredState.active) !== null,
      `caches=${cacheNames.join(', ') || '空'}, 构建戳=${scriptBuildParam(registeredState.active)}`,
    )

    const shellEntries = shellName ? report[shellName] : []
    const hasHtml = shellEntries.some((url) => url.endsWith('/index.html'))
    const hasJs = shellEntries.some((url) => /\.js$/.test(url))
    const hasCss = shellEntries.some((url) => /\.css$/.test(url))
    const missingShell = [...SHELL_ICONS, 'manifest.webmanifest'].filter(
      (file) => !shellEntries.some((url) => url.endsWith(`/${file}`)),
    )
    record(
      '应用壳缓存包含 HTML / JS / CSS / manifest / 图标',
      hasHtml && hasJs && hasCss && missingShell.length === 0,
      `共 ${shellEntries.length} 条；缺 ${missingShell.join(', ') || '无'}`,
    )

    const crossOrigin = shellEntries.filter((url) => new URL(url).origin !== origin)
    record('缓存里没有任何跨域条目（Supabase 之类一律不缓存）', crossOrigin.length === 0, crossOrigin.slice(0, 3).join(', ') || `${shellEntries.length} 条全部同源`)

    const firstConsoleNoise = cdp.events.filter((event) => {
      if (event.method === 'Runtime.exceptionThrown') return true
      if (event.method === 'Log.entryAdded') return ['error', 'warning'].includes(event.params.entry.level)
      if (event.method === 'Runtime.consoleAPICalled') return ['error', 'warning'].includes(event.params.type)
      return false
    })
    record(
      '生产首屏（含 SW 注册）控制台无 error / warning',
      firstConsoleNoise.length === 0,
      describeNoise(firstConsoleNoise),
    )

    // ---------------------------------------------------------------- 7 断网：模拟
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await reload()
    const offlineEmulated = await text()
    record('CDP 模拟断网后刷新仍渲染登录页', offlineEmulated.includes('邮箱') && offlineEmulated.includes('注册'), firstLine(offlineEmulated, 60))
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })

    // ---------------------------------------------------------------- 8 断网：真的关掉服务器
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
    console.log('已关闭静态服务器，验证真实断网。')

    await reload(3500)
    const offlineReal = await text()
    record('关掉服务器后刷新仍渲染登录页（应用壳来自缓存）', offlineReal.includes('邮箱') && offlineReal.includes('注册'), firstLine(offlineReal, 60))

    const registeredOffline = await evaluate(`
      (async () => {
        window.__p.fill('邮箱', ${JSON.stringify(EMAIL)});
        window.__p.fill('密码', ${JSON.stringify(PASSWORD)});
        await window.__p.wait(200);
        window.__p.clickText('注册');
        await window.__p.wait(2200);
        return window.__p.text();
      })()
    `)
    record('断网时仍能注册并进入日计划页（IndexedDB 离线可写）', registeredOffline.includes('执行今天'), firstLine(registeredOffline, 70))

    const optionsOffline = await evaluate(`
      (async () => {
        window.__p.clickText('选项');
        await window.__p.wait(1600);
        return window.__p.text();
      })()
    `)
    record(
      '断网时读得到已写入的本地数据（注册时播种的示例食物来自 IndexedDB）',
      optionsOffline.includes('燕麦牛奶') && optionsOffline.includes('维生素 D'),
      optionsOffline.includes('燕麦牛奶') ? '示例食物与补剂都在' : firstLine(optionsOffline, 90),
    )

    // ---------------------------------------------------------------- 9 恢复网络
    if (!(await listenWithRetry(server, port))) throw new Error(`静态服务器无法在 ${port} 上恢复。`)
    console.log(`静态服务器已恢复：${appUrl}`)

    await reload()
    const backOnline = await text()
    record('恢复网络后刷新，会话与数据仍在（仍停在已登录状态）', backOnline.includes('执行今天') || backOnline.includes('选项'), firstLine(backOnline, 60))

    // ---------------------------------------------------------------- 10 重新构建 → 更新提示
    const oldStamp = scriptBuildParam((await swState()).active)
    cdp.events.length = 0
    await runNpm(['run', 'build'], 'npm run build（第二次）')
    await reload(3000)

    const waitingReady = await until(
      `navigator.serviceWorker.getRegistration().then((registration) => !!(registration && registration.waiting))`,
      20000,
    )
    const noticeVisible = await until(`!!document.querySelector('[data-update-notice]')`, 10000)
    const pendingState = await swState()
    const newStamp = scriptBuildParam(pendingState.waiting ?? pendingState.installing)
    record(
      '重新构建后新版本处于 waiting（当前页面仍在跑旧版本，未被静默替换）',
      waitingReady === true && pendingState.active === pendingState.controller,
      `active=${scriptBuildParam(pendingState.active)}, waiting=${newStamp}, 构建戳已变化=${newStamp !== oldStamp}`,
    )
    record('页面出现「新版本已下载」提示', noticeVisible === true, firstLine(await evaluate(`window.__p.box('[data-update-notice]')`), 60))

    const beforeApply = await cacheReport()
    const beforeNames = Object.keys(beforeApply)
    record(
      '新版本装好但未接管前，旧缓存仍在（不提前清理）',
      beforeNames.includes(`molly-shell-${oldStamp}`) && beforeNames.includes(`molly-shell-${newStamp}`),
      beforeNames.join(', '),
    )

    await evaluate(`window.__p.clickText('刷新')`)
    await sleep(3500)
    await evaluate(PAGE_HELPERS)
    const afterApply = await swState()
    record(
      '用户确认刷新后新版本接管（active 的构建戳已更新）',
      scriptBuildParam(afterApply.active) === newStamp && afterApply.controller === afterApply.active,
      `active=${scriptBuildParam(afterApply.active)}, waiting=${scriptBuildParam(afterApply.waiting)}`,
    )

    const afterReport = await cacheReport()
    record(
      '旧缓存被清理，只剩当前版本的应用壳',
      Object.keys(afterReport).length === 1 && Object.keys(afterReport)[0] === `molly-shell-${newStamp}`,
      Object.keys(afterReport).join(', '),
    )

    // ---------------------------------------------------------------- 11 存储状态卡片
    const card = JSON.parse(
      await evaluate(`
        (async () => {
          window.__p.clickText('选项');
          await window.__p.wait(1600);
          return window.__p.storageCard();
        })()
      `),
    )
    record(
      '选项页有存储状态卡片，三行事实都有值',
      card.missing === false && card.usage.length > 0 && card.persisted.length > 0 && card.mode.length > 0,
      firstLine(`用量=${card.usage} / 持久化=${card.persisted} / 运行方式=${card.mode}`, 140),
    )
    record(
      '卡片文案不夸大（不出现「已同步」这类不成立的结论）',
      !card.text.includes('已同步') && (card.text.includes('未获得') || card.text.includes('已获得') || card.text.includes('不支持')),
      card.text.includes('已同步') ? '出现了「已同步」' : '未出现夸大表述',
    )
    record(
      '未安装时如实显示为浏览器标签页',
      card.mode.includes('浏览器标签页'),
      card.mode,
    )

    // 安装入口：manifest 可安装时 Chromium 会派发 beforeinstallprompt，
    // 卡片应当据此给出「安装到主屏幕」按钮。这条同时验证了
    // 「事件在渲染前被捕获 → 状态进 React → 按钮渲染出来」整条链路。
    const installButton = await evaluate(`!!window.__p.byText(${JSON.stringify('安装到主屏幕')})`)
    record(
      '浏览器给出安装入口时，卡片提供「安装到主屏幕」按钮',
      installButton === true,
      installButton === true ? 'beforeinstallprompt 已被捕获，按钮已渲染' : '本次运行浏览器未派发 beforeinstallprompt',
    )

    // 独立窗口（已安装）状态：**真的**开一个独立窗口来验，不靠打桩。
    // headless Chrome 的 --app=<url> 会以应用窗口方式打开，页面里
    // `matchMedia('(display-mode: standalone)')` 因此为真——这是模拟不出来的那部分
    // （CDP 的 Emulation.setEmulatedMedia 不支持 display-mode，实测无效）。
    const standalone = await inspectStandaloneWindow(browserPath, appUrl, stamp)
    record(
      '独立窗口状态下卡片显示「独立窗口（已安装到主屏幕）」',
      standalone.standalone === true && standalone.card.mode.includes('独立窗口'),
      `display-mode:standalone=${standalone.standalone}, 卡片=${standalone.card.mode}`,
    )
    record(
      '独立窗口下给出「已安装」说明而不是继续引导安装',
      standalone.card.text.includes('已经安装'),
      firstLine(standalone.card.text, 120),
    )
    record(
      '独立窗口首屏可正常渲染（已安装后的观感，截图已落盘）',
      standalone.rendered === true,
      standalone.rendered ? '已登录并进入选项页' : '未渲染出预期界面',
    )

    // 图标预览页（截图人工核对观感）
    await navigate(`${appUrl}__icons-preview`, 1500)
    await shot('03-icons-preview')

    // ---------------------------------------------------------------- 12 视口与控制台
    await navigate(appUrl)
    await evaluate(`window.__p.clickText('选项')`)
    await sleep(1200)

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(600)
    const desktop = JSON.parse(await evaluate('window.__p.overflow()'))
    await shot('04-options-desktop')
    record(
      '桌面 1440x900 无横向溢出',
      desktop.documentScrollWidth <= desktop.innerWidth && desktop.bodyScrollWidth <= desktop.innerWidth,
      `scrollWidth=${desktop.documentScrollWidth}, innerWidth=${desktop.innerWidth}`,
    )

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await sleep(600)
    const mobile = JSON.parse(await evaluate('window.__p.overflow()'))
    await shot('05-options-mobile')
    record(
      '手机 390x844 无横向溢出',
      mobile.documentScrollWidth <= mobile.innerWidth && mobile.bodyScrollWidth <= mobile.innerWidth,
      `scrollWidth=${mobile.documentScrollWidth}, innerWidth=${mobile.innerWidth}`,
    )

    // 存储卡片在选项页靠下的位置，单独滚到视野里拍一张，人工核对排版与文案。
    await evaluate(`document.querySelector('[data-storage-card]').scrollIntoView({ block: 'center' })`)
    await sleep(500)
    await shot('06-storage-card-mobile')

    // iOS 安全区：装上主屏幕后没有浏览器工具栏兜底，底部导航会压在 Home 指示条上。
    // CDP 能模拟安全区（Chrome 152 实测支持 Emulation.setSafeAreaInsetsOverride），
    // 所以这一条不需要真机就能验：给一个 34px 的底部安全区，看有没有人把它让出来。
    const insetsApplied = await cdp
      .send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 34, left: 0, right: 0 } })
      .then(() => true)
      .catch(() => false)
    await sleep(400)
    const safeArea = JSON.parse(
      await evaluate(`
        JSON.stringify({
          viewport: (document.querySelector('meta[name=viewport]') || {}).content || '',
          navPaddingBottom: parseFloat(getComputedStyle(document.querySelector('.bottom-nav')).paddingBottom) || 0,
          pagePaddingBottom: parseFloat(getComputedStyle(document.querySelector('.page')).paddingBottom) || 0,
        })
      `),
    )
    record(
      'iOS 安全区：底部导航与页面为 Home 指示条让出空间',
      insetsApplied &&
        safeArea.viewport.includes('viewport-fit=cover') &&
        safeArea.navPaddingBottom === 34 &&
        safeArea.pagePaddingBottom === 80 + 34,
      `viewport-fit=cover=${safeArea.viewport.includes('viewport-fit=cover')}, 导航 padding-bottom=${safeArea.navPaddingBottom}px, 页面 padding-bottom=${safeArea.pagePaddingBottom}px（期望 34 / 114）`,
    )
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: 0, right: 0 } }).catch(() => {})

    const noisy = cdp.events.filter((event) => {
      if (event.method === 'Runtime.exceptionThrown') return true
      if (event.method === 'Log.entryAdded') return ['error', 'warning'].includes(event.params.entry.level)
      if (event.method === 'Runtime.consoleAPICalled') return ['error', 'warning'].includes(event.params.type)
      return false
    })
    record(
      '更新流程与存储卡片段控制台无 error / warning',
      noisy.length === 0,
      describeNoise(noisy),
    )

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
    if (server) {
      server.closeAllConnections?.()
      server.close()
    }
    await sleep(500)
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('验收脚本异常：', error.message)
  process.exitCode = 2
})
