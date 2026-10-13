#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const configPath = process.env.MOLLY_DEPLOY_CONFIG || path.join(os.homedir(), '.happy-little-molly', 'deploy.env')
const requiredKeys = ['VERCEL_TOKEN', 'SUPABASE_DB_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

function assertExternalConfigPath() {
  const resolvedRoot = path.resolve(root)
  const resolvedConfig = path.resolve(configPath)
  const isWithin = (base, target) => {
    const relative = path.relative(base, target)
    return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  }
  const physicalPath = (target, followedLinks = 0) => {
    if (followedLinks > 40) throw new Error('无法核验部署凭据文件的实际路径：符号链接层数过多或存在循环')
    let ancestor = target
    const missingParts = []
    let stats
    while (!stats) {
      try {
        stats = fs.lstatSync(ancestor)
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      const parent = path.dirname(ancestor)
      if (parent === ancestor) throw new Error('无法核验部署凭据文件的实际路径')
      missingParts.unshift(path.basename(ancestor))
      ancestor = parent
    }
    // lstat also finds dangling links; resolve their targets before appending missing descendants.
    const actualAncestor = stats.isSymbolicLink()
      ? physicalPath(path.resolve(fs.realpathSync.native(path.dirname(ancestor)), fs.readlinkSync(ancestor)), followedLinks + 1)
      : fs.realpathSync.native(ancestor)
    return path.resolve(actualAncestor, ...missingParts)
  }
  if (isWithin(resolvedRoot, resolvedConfig) || isWithin(physicalPath(resolvedRoot), physicalPath(resolvedConfig))) {
    throw new Error('部署凭据文件必须位于仓库之外，不能使用仓库内的 deploy.env 或其它路径')
  }
}

function decodeJwtPayload(value) {
  const parts = value.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function validatePublicSupabaseKey(value) {
  const key = String(value || '').trim()
  const lower = key.toLowerCase()
  if (!key) throw new Error('VITE_SUPABASE_ANON_KEY 不能为空')
  if (lower.startsWith('service_role') || lower.startsWith('sb_secret_')) {
    throw new Error('VITE_SUPABASE_ANON_KEY 不能使用 service_role 或 sb_secret 管理员密钥')
  }
  if (lower.startsWith('sb_publishable_')) return key
  const payload = decodeJwtPayload(key)
  if (!payload || payload.role !== 'anon') {
    throw new Error('VITE_SUPABASE_ANON_KEY 必须是 role=anon 的 legacy anon JWT 或 sb_publishable_ 公钥')
  }
  return key
}

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
  assertExternalConfigPath()
  if (!fs.existsSync(configPath)) {
    throw new Error(`找不到部署凭据文件：${configPath}。先运行 npm run deploy:setup。`)
  }
  const values = parseEnv(fs.readFileSync(configPath, 'utf8'))
  const missing = requiredKeys.filter((key) => !values[key])
  if (missing.length) throw new Error(`凭据文件缺少：${missing.join('、')}`)
  values.VITE_SUPABASE_ANON_KEY = validatePublicSupabaseKey(values.VITE_SUPABASE_ANON_KEY)
  return values
}

function npmCommand() {
  return process.platform === 'win32' ? process.execPath : 'npm'
}

function npxCommand() {
  return process.platform === 'win32' ? process.execPath : 'npx'
}

function npmArgs(args) {
  return process.platform === 'win32'
    ? ['--max-old-space-size=4096', process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args]
    : args
}

function npxArgs(args) {
  return process.platform === 'win32'
    ? ['--max-old-space-size=4096', process.env.npx_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'), ...args]
    : args
}

function npxCliCommand() {
  return process.platform === 'win32'
    ? 'cmd.exe'
    : 'npx'
}

function npxCliArgs(args) {
  return process.platform === 'win32'
    ? ['/d', '/s', '/c', `npx.cmd ${args.map((arg) => /^[A-Za-z0-9_./:=@+-]+$/.test(arg) ? arg : `"${String(arg).replaceAll('"', '\\"')}"`).join(' ')}`]
    : args
}

function run(command, args, options = {}) {
  const actualArgs = command === npmCommand() ? npmArgs(args)
    : command === npxCommand() ? npxArgs(args)
      : args
  const result = spawnSync(command, actualArgs, {
    cwd: root,
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.input === undefined ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    input: options.input,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] || ''} 退出码 ${result.status}`)
  }
  return result.stdout || ''
}

function runCapture(command, args, options = {}) {
  const actualArgs = command === npmCommand() ? npmArgs(args)
    : command === npxCommand() ? npxArgs(args)
      : args
  const result = spawnSync(command, actualArgs, {
    cwd: root,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    input: options.input,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
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
  const candidates = process.platform === 'win32'
    ? [
        process.env.MOLLY_PSQL,
        'C:/Program Files/PostgreSQL/16/bin/psql.exe',
        'C:/Program Files/PostgreSQL/15/bin/psql.exe',
      ].filter(Boolean)
    : ['psql']
  const executable = candidates.find((candidate) => candidate === 'psql' || fs.existsSync(candidate))
  if (!executable) throw new Error('找不到 PostgreSQL psql；请设置 MOLLY_PSQL 或安装 PostgreSQL 16')
  return runCapture(executable, args, { env })
}

function verifySupabase(env) {
  const expectedTables = [
    'profiles',
    'sync_test_records',
    'day_plans',
    'daily_meals',
    'daily_meal_items',
    'custom_tasks',
    'daily_supplements',
    'daily_exercise_items',
    'routine_tasks',
    'food_options',
    'supplement_templates',
    'exercise_options',
  ]
  const tableNames = psql([
    '-tAc',
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name",
  ], env).trim().split(/\r?\n/).filter(Boolean)
  const rpcNames = psql([
    '-tAc',
    "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('account_access','cloud_sync_summary','export_cloud_snapshot','import_local_backup') order by 1",
  ], env).trim().split(/\r?\n/).filter(Boolean)
  const allowlistTable = psql([
    '-tAc',
    "select count(*) from information_schema.tables where table_schema='private' and table_name='account_allowlist' and table_type='BASE TABLE'",
  ], env).trim()
  const expectedRpcs = ['account_access', 'cloud_sync_summary', 'export_cloud_snapshot', 'import_local_backup']
  const missingTables = expectedTables.filter((name) => !tableNames.includes(name))
  const extraTables = tableNames.filter((name) => !expectedTables.includes(name))
  if (missingTables.length || extraTables.length) {
    throw new Error(`Supabase public 表结构不匹配：缺少 ${missingTables.join('、') || '无'}；多出 ${extraTables.join('、') || '无'}`)
  }
  if (expectedRpcs.some((name) => !rpcNames.includes(name))) {
    throw new Error(`Supabase 认证/RPC 不完整：缺少 ${expectedRpcs.filter((name) => !rpcNames.includes(name)).join('、')}`)
  }
  if (allowlistTable !== '1') {
    throw new Error('Supabase 尚未建立 private.account_allowlist；请先核实真实迁移历史，在可信 Supabase SQL Editor 只执行缺失迁移。deploy/supabase-all-migrations.sql 仅用于空项目初始化')
  }
  const allowlistRows = psql(['-tAc', 'select count(*) from private.account_allowlist'], env).trim()
  const authAccountRows = psql([
    '-tAc',
    'select count(*) from private.account_allowlist a join auth.users u on u.id=a.user_id',
  ], env).trim()
  const gatePolicies = psql([
    '-tAc',
    "select count(*) from pg_policies where schemaname='public' and policyname='account_uid_gate' and permissive='RESTRICTIVE'",
  ], env).trim()
  const invokerRpcs = psql([
    '-tAc',
    "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('account_access','cloud_sync_summary','export_cloud_snapshot','import_local_backup') and not p.prosecdef",
  ], env).trim()
  if (gatePolicies !== String(expectedTables.length)) {
    throw new Error(`Supabase UID 门禁策略不完整：${gatePolicies} 条，预期 ${expectedTables.length} 条`)
  }
  if (invokerRpcs !== String(expectedRpcs.length)) {
    throw new Error(`Supabase 认证/RPC 存在 security definer：security invoker 核验为 ${invokerRpcs}/${expectedRpcs.length}`)
  }
  if (allowlistRows !== '1') {
    throw new Error(`Supabase W 账号门禁尚未准备：allowlist 当前 ${allowlistRows} 行，预期 1 行；请先在可信 Supabase Auth/SQL 管理入口创建 W 并写入目标 UID`)
  }
  if (authAccountRows !== '1') {
    throw new Error('Supabase allowlist 没有关联唯一的真实 Auth 身份；请先在可信 Supabase Auth/SQL 管理入口核验目标账号与 UID')
  }
  console.log(`Supabase 核验通过：${expectedTables.length} 张表、${expectedRpcs.length} 个认证/RPC、${gatePolicies} 条 UID 门禁策略、W 门禁 1 行`)
}

function vercelArgs(args, token) {
  return [...args, `--token=${token}`]
}

function vercel(args, token, options = {}) {
  return runCapture(npxCliCommand(), npxCliArgs(['--yes', 'vercel', ...vercelArgs(args, token)]), options)
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
  assertExternalConfigPath()
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
  values.VITE_SUPABASE_ANON_KEY = validatePublicSupabaseKey(values.VITE_SUPABASE_ANON_KEY)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  assertExternalConfigPath()
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

  const pgEnv = pgEnvironment(config.SUPABASE_DB_URL)
  console.log('2/7 只读核验 Supabase 结构与 W 账号门禁')
  verifySupabase(pgEnv)

  console.log('3/7 写入 Vercel production 构建变量')
  vercel(['env', 'add', 'VITE_SUPABASE_URL', 'production', '--force', '--yes'], config.VERCEL_TOKEN, { input: `${config.VITE_SUPABASE_URL}\n` })
  vercel(['env', 'add', 'VITE_SUPABASE_ANON_KEY', 'production', '--force', '--yes'], config.VERCEL_TOKEN, { input: `${config.VITE_SUPABASE_ANON_KEY}\n` })

  console.log('4/7 部署 production')
  const output = vercel(['deploy', '--prod', '--yes'], config.VERCEL_TOKEN)
  process.stdout.write(output)
  const url = extractDeploymentUrl(output)
  if (!url) throw new Error('部署完成但没有从 Vercel 输出中解析出线上 URL')

  console.log('5/7 线上自检')
  await verifyDeployment(url)
  console.log('6/7 部署完成')
  console.log(`线上地址：${url}`)
}

try {
  if (process.argv[2] === 'setup') await setup()
  else await deploy()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
