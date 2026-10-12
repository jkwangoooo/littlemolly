import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBrowser } from './find-browser.mjs'
import { FIXTURE_ENV, FIXTURE_PASSWORD } from './auth-fixture.mjs'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const DB_NAME = 'happy-little-molly-local'
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

export async function findFreePort() {
  return new Promise((done, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

export async function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise((done) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      killer.on('error', done)
      killer.on('exit', done)
    })
  } else {
    child.kill()
    await Promise.race([new Promise((done) => child.once('exit', done)), sleep(1500)])
  }
}

export async function startDevServer({ configured = true } = {}) {
  const port = await findFreePort()
  const url = `http://127.0.0.1:${port}/`
  const child = spawn(process.execPath, [join(PROJECT_ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(configured ? FIXTURE_ENV : { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }) },
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  child.on('error', (error) => { output += error.message })
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error(`Vite exited: ${output.slice(-1200)}`)
    if (await fetch(url).then((r) => r.ok).catch(() => false)) return { child, url, output: () => output }
    await sleep(200)
  }
  await stopProcess(child)
  throw new Error(`Vite did not become ready: ${output.slice(-1200)}`)
}

export class Cdp {
  constructor(ws) {
    this.ws = ws
    this.sequence = 0
    this.pending = new Map()
    this.events = []
    this.handlers = new Map()
    ws.addEventListener('close', () => this.rejectPending(new Error('CDP connection closed')))
    ws.addEventListener('error', () => this.rejectPending(new Error('CDP connection failed')))
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timeout)
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
        else pending.resolve(message.result)
      } else if (message.method) {
        this.events.push(message)
        this.handlers.get(message.method)?.(message.params)
      }
    })
  }
  on(method, handler) { this.handlers.set(method, handler) }
  send(method, params = {}) {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP connection is unavailable'))
    const id = ++this.sequence
    return new Promise((resolveValue, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timed out: ${method}`)) }, 30000)
      this.pending.set(id, { resolve: resolveValue, reject, timeout })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
  close() {
    this.ws.close()
    this.rejectPending(new Error('CDP closed'))
  }
}

function removeProfile(profile) {
  const absolute = resolve(profile)
  if (!absolute.startsWith(`${resolve(tmpdir())}${sep}molly-verify-`)) throw new Error(`Unsafe profile cleanup: ${absolute}`)
  rmSync(absolute, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 })
}

export async function launchBrowser({ label = 'auth', app = null } = {}) {
  const profile = join(tmpdir(), `molly-verify-${label}-${process.pid}-${Date.now()}`)
  mkdirSync(profile, { recursive: true })
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`]
  if (app) args.push(`--app=${app}`)
  else args.push('about:blank')
  const child = spawn(findBrowser(), args, { stdio: 'ignore' })
  let startupError
  child.on('error', (error) => { startupError = error })
  try {
    const portFile = join(profile, 'DevToolsActivePort')
    let port
    for (let i = 0; i < 100; i += 1) {
      if (startupError) throw startupError
      if (existsSync(portFile)) { port = readFileSync(portFile, 'utf8').split('\n')[0].trim(); if (port) break }
      if (child.exitCode !== null) throw new Error('Browser exited before CDP became ready')
      await sleep(150)
    }
    if (!port) throw new Error('Browser CDP port is unavailable')
    let target
    for (let i = 0; i < 60; i += 1) {
      target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((rows) => rows.find((row) => row.type === 'page')).catch(() => null)
      if (target) break
      await sleep(150)
    }
    if (!target) throw new Error('Browser page target is unavailable')
    const browser = await connectPage(target, { child, profile })
    const pages = new Set([browser])
    browser.newPage = async () => {
      const created = await browser.cdp.send('Target.createTarget', { url: 'about:blank' })
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const pageTarget = targets.find((page) => page.id === created.targetId)
      if (!pageTarget) throw new Error('New browser page target is unavailable')
      const page = await connectPage(pageTarget, { child, profile })
      page.close = async () => {
        await browser.cdp.send('Target.closeTarget', { targetId: created.targetId })
        page.cdp.close()
        pages.delete(page)
      }
      pages.add(page)
      return page
    }
    browser.close = async () => {
      await browser.cdp.send('Browser.close').catch(() => {})
      for (const page of pages) page.cdp.close()
      await stopProcess(child)
      removeProfile(profile)
    }
    return browser
  } catch (error) {
    await stopProcess(child)
    removeProfile(profile)
    throw error
  }
}

async function connectPage(target, { child, profile }) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let cdp
  try {
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket timed out')), 10000)
      ws.addEventListener('open', () => { clearTimeout(timer); done() }, { once: true })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP websocket failed')) }, { once: true })
      ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('CDP websocket closed')) }, { once: true })
    })
    cdp = new Cdp(ws)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Log.enable')
  } catch (error) {
    if (cdp) cdp.close()
    else ws.close()
    throw error
  }
  const browser = {
    child, cdp, profile,
    evaluate: async (expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result?.value
    },
    navigate: async (url) => { await cdp.send('Page.navigate', { url }); await sleep(200) },
  }
  browser.until = async (expression, timeout = 20000) => {
    const end = Date.now() + timeout
    let last
    while (Date.now() < end) {
      try { last = await browser.evaluate(expression); if (last) return last } catch (error) { last = error.message }
      await sleep(100)
    }
    throw new Error(`Timed out waiting for ${expression}: ${String(last)}; page=${await browser.evaluate('document.body.innerText').catch(() => 'unavailable')}`)
  }
  browser.installHelpers = () => browser.evaluate(`(${installPageHelpers.toString()})()`)
  browser.login = async (password = FIXTURE_PASSWORD) => {
    await browser.until(`!!document.querySelector('input[type="password"]')`)
    await browser.installHelpers()
    await browser.evaluate(`window.__m.fill('账号','W');window.__m.fill('密码',${JSON.stringify(password)});window.__m.click('登录')`)
  }
  browser.ready = () => browser.until(`!!document.querySelector('.bottom-nav')`)
  browser.clickBubble = async (id) => {
    const position = await browser.evaluate(`(()=>{const node=document.querySelector('.rhythm-bubble[data-node-id="'+${JSON.stringify(id)}+'"]');if(!node)throw new Error('Bubble not found: '+${JSON.stringify(id)});node.scrollIntoView({block:'center'});const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position })
  }
  browser.longPressBubble = async (id) => {
    const position = await browser.evaluate(`(()=>{const node=document.querySelector('.rhythm-bubble[data-node-id="'+${JSON.stringify(id)}+'"]');if(!node)throw new Error('Bubble not found: '+${JSON.stringify(id)});node.scrollIntoView({block:'center'});const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position })
    await sleep(600)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position })
  }
  browser.reload = async () => { await cdp.send('Page.reload', { ignoreCache: true }); await sleep(200); await browser.installHelpers() }
  browser.shot = async (name) => {
    if (!process.env.SHOT_DIR) return
    mkdirSync(process.env.SHOT_DIR, { recursive: true })
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(join(process.env.SHOT_DIR, `${name}.png`), Buffer.from(result.data, 'base64'))
  }
  browser.readDb = () => browser.evaluate(`(async()=>{const listed=await indexedDB.databases();if(!listed.some(db=>db.name===${JSON.stringify(DB_NAME)}))return {version:0,names:[],indexes:{},rows:{}};return new Promise((done,reject)=>{const r=indexedDB.open(${JSON.stringify(DB_NAME)});r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const names=[...db.objectStoreNames];const tx=db.transaction(names,'readonly');const rows={};const indexes={};for(const name of names){const store=tx.objectStore(name);indexes[name]=[...store.indexNames];const q=store.getAll();q.onsuccess=()=>rows[name]=q.result}tx.oncomplete=()=>{const version=db.version;db.close();done({version,names,indexes,rows})};tx.onerror=()=>reject(tx.error)}})})()`)
  browser.noise = () => cdp.events.filter((event) =>
    event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(event.params.type))
    || (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params.entry?.level) && !String(event.params.entry?.url ?? '').startsWith('https://molly-auth-fixture.invalid')),
  )
  return browser
}

function installPageHelpers() {
  const set = (element, value) => {
    if (!element) throw new Error('Input was not found')
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const click = (label, root = document) => {
    const button = [...root.querySelectorAll('button')].find((item) => item.textContent.trim() === label || item.getAttribute('aria-label') === label)
    if (!button) throw new Error(`Button was not found: ${label}`)
    if (button.disabled) throw new Error(`Button is disabled: ${label}`)
    button.click()
    return true
  }
  window.__m = {
    set, click,
    fill: (label, value) => {
      const field = [...document.querySelectorAll('label')].find((item) => item.textContent.trim().startsWith(label))
      const input = field?.querySelector('input,textarea,select') ?? document.getElementById(field?.htmlFor)
      set(input, value)
    },
    openPreference: (key) => {
      const entry = document.querySelector(`[data-option-entry="${key}"]`)
      if (!entry) throw new Error(`Preference entry was not found: ${key}`)
      entry.click()
    },
    text: () => document.body.innerText,
    metrics: () => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }),
  }
  return true
}

export function createRecorder() {
  const results = []
  return {
    results,
    record(name, ok, detail = '') {
      results.push({ name, ok: !!ok })
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${String(detail).slice(0, 220)}` : ''}`)
      if (!ok) {
        const error = new Error(`Assertion failed: ${name}${detail ? ` (${detail})` : ''}`)
        error.name = 'AssertionError'
        throw error
      }
    },
    finish() {
      const failed = results.filter((result) => !result.ok).length
      console.log(`\n${results.length - failed}/${results.length} PASS`)
      if (failed) process.exitCode = 1
    },
  }
}
