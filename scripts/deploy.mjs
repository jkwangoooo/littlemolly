#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const configPath = process.env.MOLLY_DEPLOY_CONFIG || path.join(os.homedir(), '.happy-little-molly', 'deploy.env')
const requiredKeys = ['VERCEL_TOKEN', 'SUPABASE_DB_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

function fail(message) {
  console.error(`部署失败：${message}`)
  process.exitCode = 1
}

function parseEnv(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || match[1].startsWith('#')) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[match[1]] = value
  }
  return values
}

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`找不到部署凭据文件：${configPath}。先运行 npm run deploy:setup。`)
  }
  const values = parseEnv(fs.readFileSync(configPath, 'utf8'))
  const missing = requiredKeys.filter((key) => !values[key])
  if (missing.length) throw new Error(`凭据文件缺少：${missing.join('、')}`)
  return values
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function npxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.input === undefined ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    input: options.input,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] || ''} 退出码 ${result.status}`)
  }
  return result.stdout || ''
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    input: options.input,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim()
    throw new Error(`${command} ${args[0] || ''} 失败${details ? `：${details}` : ''}`)
  }
  return result.stdout || ''
}

function pgEnvironment(uri) {
  let parsed
  try {
    parsed = new URL(uri)
  } catch {
    throw new Error('SUPABASE_DB_URL 不是有效的 PostgreSQL URI')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('SUPABASE_DB_URL 必须使用 postgres:// 或 postgresql://')
  }
  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres',
    PGSSLMODE: parsed.searchParams.get('sslmode') || 'require',
  }
}

function psql(args, env) {
  return runCapture('psql', args, { env })
}

function verifySupabase(env) {
  const tableCount = psql([
    '-tAc',
    "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
  ], env).trim()
  const rpcNames = psql([
    '-tAc',
    "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('cloud_sync_summary','export_cloud_snapshot','import_local_backup') order by 1",
  ], env).trim().split(/\r?\n/).filter(Boolean)
  const policyCount = psql(['-tAc', "select count(*) from pg_policies where schemaname='public'"], env).trim()
  const expectedRpcs = ['cloud_sync_summary', 'export_cloud_snapshot', 'import_local_backup']
  if (tableCount !== '12') throw new Error(`Supabase public 表数量为 ${tableCount}，预期 12`)
  if (expectedRpcs.some((name) => !rpcNames.includes(name))) throw new Error(`Supabase RPC 不完整：${rpcNames.join('、')}`)
  if (policyCount !== '21') throw new Error(`Supabase RLS 策略数量为 ${policyCount}，预期 21`)
  console.log(`Supabase 验证通过：${tableCount} 张表、${expectedRpcs.length} 个 RPC、${policyCount} 条 RLS 策略`)
}

function vercelArgs(args, token) {
  return [...args, `--token=${token}`]
}

function vercel(args, token, options = {}) {
  return runCapture(npxCommand(), ['--yes', 'vercel', ...vercelArgs(args, token)], options)
}

function extractDeploymentUrl(output) {
  const urls = output.match(/https:\/\/[^\s"'<>`]+/g) || []
  return urls.map((url) => url.replace(/[),.;]+$/, '')).find((url) => /\.vercel\.app(?:\/|$)/.test(url)) || null
}

async function verifyDeployment(url) {
  const base = url.replace(/\/$/, '')
  const home = await fetch(`${base}/`)
  const html = await home.text()
  if (!home.ok) throw new Error(`首页 HTTP ${home.status}`)
  if (!/<title>[^<]+<\/title>/.test(html)) throw new Error('首页没有可读 title')

  const checks = [
    ['首页', home.status === 200],
    ['Service Worker 不缓存', (await fetch(`${base}/sw.js`, { method: 'HEAD' })).headers.get('cache-control')?.includes('no-cache')],
    ['Manifest 不缓存', (await fetch(`${base}/manifest.webmanifest`, { method: 'HEAD' })).headers.get('cache-control')?.includes('no-cache')],
  ]
  const assetPath = html.match(/\/assets\/[^"']+\.js/)?.[0]
  if (!assetPath) throw new Error('首页没有找到 JS 静态资源')
  checks.push(['Assets 长缓存', (await fetch(`${base}${assetPath}`, { method: 'HEAD' })).headers.get('cache-control')?.includes('immutable')])
  checks.push(['SPA 深链接回退', (await fetch(`${base}/deploy-check-${Date.now()}`)).status === 200])
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length) throw new Error(`线上自检失败：${failed.join('、')}`)
  console.log(`线上自检通过：首页 ${home.status}、SW/Manifest 缓存头、Assets 长缓存、SPA 深链接均正常`)
}

function promptSecret(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error('deploy:setup 需要在交互式终端中运行'))
      return
    }
    process.stdout.write(`${label}：`)
    let value = ''
    const onData = (chunk) => {
      const input = chunk.toString()
      for (const char of input) {
        if (char === '\u0003') {
          process.stdin.setRawMode(false)
          process.stdin.off('data', onData)
          reject(new Error('已取消'))
          return
        }
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false)
          process.stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u0008' || char === '\u007f') {
          value = value.slice(0, -1)
        } else {
          value += char
        }
      }
    }
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

async function setup() {
  const localEnvPath = path.join(root, '.env.local')
  const localValues = fs.existsSync(localEnvPath) ? parseEnv(fs.readFileSync(localEnvPath, 'utf8')) : {}
  const savedValues = fs.existsSync(configPath) ? parseEnv(fs.readFileSync(configPath, 'utf8')) : {}
  const current = { ...localValues, ...savedValues }
  const values = {}
  const force = process.argv.includes('--force')
  for (const key of requiredKeys) {
    if (current[key] && !force) {
      values[key] = current[key]
      console.log(`${key} 已读取现有配置`)
      continue
    }
    const hint = current[key] ? '（回车保留已有值）' : ''
    const value = await promptSecret(`${key}${hint}`)
    values[key] = value || current[key] || ''
  }
  const missing = requiredKeys.filter((key) => !values[key])
  if (missing.length) throw new Error(`仍缺少：${missing.join('、')}`)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const content = `${requiredKeys.map((key) => `${key}=${values[key]}`).join('\n')}\n`
  fs.writeFileSync(configPath, content, { encoding: 'utf8', mode: 0o600 })
  try { fs.chmodSync(configPath, 0o600) } catch { /* Windows uses the user profile ACL. */ }
  console.log(`部署凭据已保存到 ${configPath}`)
  console.log('该文件在仓库之外，不会进入 Git 或 Vercel 部署包。')
}

async function deploy() {
  const config = loadConfig()
  const vercelProject = path.join(root, '.vercel', 'project.json')
  if (!fs.existsSync(vercelProject)) throw new Error('项目尚未关联 Vercel，请先在本目录执行一次 vercel link')

  console.log('1/7 前置检查')
  run(npmCommand(), ['run', 'typecheck'])
  run(npmCommand(), ['run', 'lint'])
  run(npmCommand(), ['run', 'build'])
  run(npmCommand(), ['run', 'verify:pwa'])

  const pgEnv = pgEnvironment(config.SUPABASE_DB_URL)
  console.log('2/7 执行 Supabase 幂等迁移')
  psql(['-v', 'ON_ERROR_STOP=1', '-f', path.join(root, 'deploy', 'supabase-all-migrations.sql')], pgEnv)
  psql(['-c', "notify pgrst, 'reload schema';"], pgEnv)
  console.log('3/7 验证 Supabase 结构')
  verifySupabase(pgEnv)

  console.log('4/7 写入 Vercel production 构建变量')
  vercel(['env', 'add', 'VITE_SUPABASE_URL', 'production', '--force', '--yes'], config.VERCEL_TOKEN, { input: `${config.VITE_SUPABASE_URL}\n` })
  vercel(['env', 'add', 'VITE_SUPABASE_ANON_KEY', 'production', '--force', '--yes'], config.VERCEL_TOKEN, { input: `${config.VITE_SUPABASE_ANON_KEY}\n` })

  console.log('5/7 部署 production')
  const output = vercel(['deploy', '--prod', '--yes'], config.VERCEL_TOKEN)
  process.stdout.write(output)
  const url = extractDeploymentUrl(output)
  if (!url) throw new Error('部署完成但没有从 Vercel 输出中解析出线上 URL')

  console.log('6/7 线上自检')
  await verifyDeployment(url)
  console.log('7/7 部署完成')
  console.log(`线上地址：${url}`)
}

try {
  if (process.argv[2] === 'setup') await setup()
  else await deploy()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
