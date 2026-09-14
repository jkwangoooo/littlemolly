#!/usr/bin/env node
// 本地验收脚本：用真实浏览器内核验证「登录 → 规划 → 保存 → 刷新恢复 → 退出」闭环，
// 并检查桌面 / 手机视口无横向溢出、控制台无 error / warning。
//
// 用法：
//   1. 另开终端运行 npm run dev
//   2. 运行 npm run verify:local
//
// 依赖：本机已安装 Chrome 或 Edge。不使用第三方 npm 包，不写入项目目录。
// 可用 CHROME_PATH 环境变量指定浏览器可执行文件。

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5173/'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
      } else if (message.method) {
        this.events.push(message)
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
      // 调试端点尚未就绪，继续重试
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

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
}

const stamp = Date.now()
const EMAIL = `verify-${stamp}@local.test`
const PASSWORD = 'verify123'

const signUpScript = `
(() => {
  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const email = document.querySelector('input[type=email]')
  const password = document.querySelector('input[type=password]')
  if (!email || !password) return 'NO_FORM'
  setValue(email, ${JSON.stringify(EMAIL)})
  setValue(password, ${JSON.stringify(PASSWORD)})
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '注册')
  if (!button) return 'NO_BUTTON'
  button.click()
  return 'CLICKED'
})()
`

const signOutScript = `
(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '退出登录')
  if (!button) return 'NO_BUTTON'
  button.click()
  return 'CLICKED'
})()
`

const prepareScript = `
(async () => {
  const tab = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '准备明天')
  if (!tab) return 'NO_PREPARE_TAB'
  tab.click()
  await new Promise((resolve) => setTimeout(resolve, 900))
  const checkbox = document.querySelector('.prep-row input[type=checkbox]')
  if (!checkbox) return 'NO_CHECKBOX'
  checkbox.click()
  await new Promise((resolve) => setTimeout(resolve, 900))
  return document.body.innerText
})()
`

const readPreparedStateScript = `
(async () => {
  const tab = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '准备明天')
  if (tab) tab.click()
  await new Promise((resolve) => setTimeout(resolve, 900))
  const checkbox = document.querySelector('.prep-row input[type=checkbox]')
  return checkbox ? checkbox.checked : 'NO_CHECKBOX'
})()
`

async function main() {
  const browserPath = findBrowser()
  const userDataDir = join(tmpdir(), `molly-verify-${stamp}`)
  let child = null

  try {
    const appReachable = await fetch(APP_URL).then(() => true).catch(() => false)
    if (!appReachable) {
      console.error(`无法访问 ${APP_URL}，请先在另一个终端运行 npm run dev。`)
      process.exitCode = 1
      return
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

    await cdp.send('Page.navigate', { url: APP_URL })
    await sleep(2500)

    const initial = await evaluate('document.body.innerText')
    record('未登录时渲染登录页', initial.includes('登录') && initial.includes('邮箱'))

    const clicked = await evaluate(signUpScript)
    await sleep(2000)
    const afterSignUp = await evaluate('document.body.innerText')
    record('注册后进入日计划页', afterSignUp.includes('执行今天') && afterSignUp.includes('准备明天'), clicked)

    const prepared = await evaluate(prepareScript)
    record(
      '准备明天可勾选并显示本地保存状态',
      typeof prepared === 'string' && prepared.includes('本地保存状态') && prepared.includes('已保存'),
      typeof prepared === 'string' ? prepared.split('\n').filter((line) => line.includes('进度')).join(' / ') : String(prepared),
    )

    await cdp.send('Page.navigate', { url: APP_URL })
    await sleep(2500)
    const afterReload = await evaluate('document.body.innerText')
    record('刷新后会话恢复且仍在日计划页', afterReload.includes('执行今天') && !afterReload.includes('邮箱'))

    const restored = await evaluate(readPreparedStateScript)
    record('刷新后准备勾选从本地数据库恢复', restored === true, `checkbox.checked = ${restored}`)

    for (const [label, width, height] of [
      ['桌面 1440x900', 1440, 900],
      ['手机 390x844', 390, 844],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await sleep(700)
      const metrics = JSON.parse(await evaluate('JSON.stringify({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })'))
      record(`${label} 无横向溢出`, metrics.scroll <= metrics.inner, `scrollWidth=${metrics.scroll}, innerWidth=${metrics.inner}`)
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride')

    await sleep(400)
    await evaluate(signOutScript)
    await sleep(1500)
    const afterSignOut = await evaluate('document.body.innerText')
    record('退出登录后回到登录页', afterSignOut.includes('邮箱') && afterSignOut.includes('注册'))

    const noisy = cdp.events.filter((event) => {
      if (event.method === 'Runtime.exceptionThrown') return true
      if (event.method === 'Log.entryAdded') return ['error', 'warning'].includes(event.params.entry.level)
      if (event.method === 'Runtime.consoleAPICalled') return ['error', 'warning'].includes(event.params.type)
      return false
    })
    record(
      '控制台无 error / warning',
      noisy.length === 0,
      noisy
        .slice(0, 3)
        .map((event) => event.params.entry?.text ?? event.params.exceptionDetails?.text ?? event.params.type)
        .join(' | '),
    )

    const failed = results.filter((item) => !item.ok)
    console.log('')
    console.log(`结果：${results.length - failed.length}/${results.length} 通过`)
    if (failed.length) process.exitCode = 1
  } finally {
    if (child) child.kill()
    await sleep(500)
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('验收脚本异常：', error.message)
  process.exitCode = 2
})
