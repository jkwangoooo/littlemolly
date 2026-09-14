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

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPLICIT_APP_URL = process.env.APP_URL ?? null
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

// 注入到页面的交互辅助函数。重写界面时请保留 .prep-row / .execution-row / .task-row /
// .bottom-sheet / .confirm-modal / .mode-card / .progress-head 这些类名，脚本依赖它们。
const HELPERS = `
window.__m = {
  byText: (text, tag) => [...document.querySelectorAll(tag || 'button')].find((el) => el.textContent.trim() === text),
  clickText: (text, tag) => { const el = window.__m.byText(text, tag); if (!el) return 'NOT_FOUND:' + text; el.click(); return 'OK' },
  clickContains: (text, tag) => { const el = [...document.querySelectorAll(tag || 'button')].find((node) => node.textContent.includes(text)); if (!el) return 'NOT_FOUND:' + text; el.click(); return 'OK' },
  clickAria: (label, tag) => { const el = [...document.querySelectorAll(tag || 'button')].find((node) => node.getAttribute('aria-label') === label); if (!el) return 'NOT_FOUND:' + label; el.click(); return 'OK' },
  prepRow: (label) => [...document.querySelectorAll('.prep-row')].find((row) => (row.querySelector('strong') || {}).textContent?.includes(label)),
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
};
'ready'
`

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
}
function firstLine(value, limit = 90) {
  return String(value ?? '').split('\n').filter(Boolean).join(' / ').slice(0, limit)
}

const stamp = Date.now()
const EMAIL = `verify-${stamp}@local.test`
const PASSWORD = 'verify123'
const BREAKFAST = '测试早餐'
const TASK_NAME = '测试事项'

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

    // 6. 准备明天：三餐面板（先确保目标日是工作日，避免周五运行时落在休息日）
    await evaluate(`window.__m.clickText('准备明天')`)
    await sleep(1100)
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
    await evaluate(`window.__m.clickContains('三餐已安排', '.row-main')`)
    await sleep(800)
    const sheetTitle = await evaluate(`(document.querySelector('.bottom-sheet h2') || {}).textContent || ''`)
    await evaluate(`window.__m.fill('早餐计划', ${JSON.stringify(BREAKFAST)})`)
    await evaluate(`window.__m.clickText('保存')`)
    await sleep(1400)
    const mealsSaved = await evaluate(`
      JSON.stringify({ status: window.__m.text().includes('已保存'), summary: window.__m.text().includes(${JSON.stringify(BREAKFAST)}) })
    `)
    const mealsData = JSON.parse(mealsSaved)
    record('三餐面板可编辑并保存', sheetTitle === '编辑三餐' && mealsData.status && mealsData.summary,
      `面板标题=${sheetTitle}, 已保存=${mealsData.status}, 摘要含内容=${mealsData.summary}`)

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

    // 8. 健身面板
    const exercise = await evaluate(`
      (async () => {
        window.__m.clickContains('健身安排已决定', '.row-main');
        await window.__m.wait(800);
        const title = (document.querySelector('.bottom-sheet h2') || {}).textContent;
        window.__m.fill('安排', 'exercise');
        await window.__m.wait(400);
        window.__m.fill('具体内容', '测试健身项目');
        await window.__m.wait(200);
        window.__m.clickText('保存');
        await window.__m.wait(1300);
        return JSON.stringify({ title, ok: window.__m.text().includes('已决定健身') });
      })()
    `)
    const exerciseData = JSON.parse(exercise)
    record('健身面板可选择健身并保存', exerciseData.title === '编辑健身安排' && exerciseData.ok === true,
      `面板标题=${exerciseData.title}`)

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

    // 12. 复制昨天：内容复制但不带准备状态
    const copied = await evaluate(`
      (async () => {
        window.__m.clickAria('后一天', '.icon-button');
        await window.__m.wait(1200);
        window.__m.clickText('复制昨天');
        await window.__m.wait(700);
        const asked = (document.querySelector('.confirm-modal') || {}).innerText || '';
        window.__m.clickText('确认覆盖');
        await window.__m.wait(1500);
        const body = window.__m.text();
        const prep = window.__m.prepChecked();
        return JSON.stringify({
          asked: asked.includes('不会复制准备勾选'),
          hasMeal: body.includes(${JSON.stringify(BREAKFAST)}),
          prep,
          progress: window.__m.progress(),
        });
      })()
    `)
    const copyData = JSON.parse(copied)
    const prepAllCleared = copyData.prep.length === 0 || copyData.prep.every((value) => value === false)
    record('复制昨天带内容但不带准备勾选', copyData.asked && copyData.hasMeal && prepAllCleared,
      `确认文案=${copyData.asked}, 含早餐=${copyData.hasMeal}, 准备项=${JSON.stringify(copyData.prep)}`)

    // 13. 刷新恢复
    await goto()
    const afterReload = await text()
    record('刷新后会话恢复且仍在日计划页', afterReload.includes('执行今天') && !afterReload.includes('邮箱'))
    await evaluate(`window.__m.clickText('准备明天')`)
    await sleep(1100)
    const persisted = await text()
    record('刷新后规划内容从本地数据库恢复', persisted.includes(BREAKFAST), firstLine(persisted, 120))

    // 14. 视口
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

    // 15. 退出登录
    await sleep(400)
    await evaluate(`window.__m.clickText('退出登录')`)
    await sleep(1500)
    const afterSignOut = await text()
    record('退出登录后回到登录页', afterSignOut.includes('邮箱') && afterSignOut.includes('注册'))

    // 16. 控制台
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
