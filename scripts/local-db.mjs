// 本地 Supabase/PostgreSQL 仿真数据库。
//
// 这不是浏览器业务数据的新落点：IndexedDB 仍然是应用的唯一写入落点。
// 本工具只提供一个可持久化的 PostgreSQL 实例，用来仿真线上 Supabase 的
// 表结构、RLS、触发器与 RPC，方便本地联调和手工检查。

import './ts-resolve.mjs'
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXE = process.platform === 'win32' ? '.exe' : ''
const PG_USER = process.env.MOLLY_LOCAL_PG_USER ?? 'molly'
const DB_NAME = process.env.MOLLY_LOCAL_PG_DB ?? 'molly'
const PORT = Number(process.env.MOLLY_LOCAL_PG_PORT ?? 55432)
const ROOT_DIR = process.env.MOLLY_LOCAL_DB_DIR
  ? resolve(process.env.MOLLY_LOCAL_DB_DIR)
  : join(ROOT, '.local-supabase')
const DATA_DIR = join(ROOT_DIR, 'data')
const LOG_FILE = join(ROOT_DIR, 'postgres.log')
const PID_FILE = join(ROOT_DIR, 'postgres.pid')
const BACKUP_DIR = join(ROOT_DIR, 'backups')
const MIGRATIONS_DIR = join(ROOT, 'database', 'migrations')
const SHIM_FILE = join(ROOT, 'scripts', 'lib', 'supabase-shim.sql')

const PG_ROOTS = [
  ...['18', '17', '16', '15', '14', '13'].map((v) => `C:/Program Files/PostgreSQL/${v}/bin`),
  ...['18', '17', '16', '15', '14', '13'].map((v) => `/usr/lib/postgresql/${v}/bin`),
  '/opt/homebrew/opt/postgresql@16/bin',
  '/usr/local/opt/postgresql@16/bin',
  '/usr/local/pgsql/bin',
]

function findPgBin() {
  const candidates = [process.env.MOLLY_PG_BIN, ...PG_ROOTS].filter(Boolean)
  for (const dir of candidates) {
    if (['initdb', 'pg_ctl', 'pg_isready', 'psql', 'postgres'].every((tool) =>
      existsSync(join(dir, `${tool}${EXE}`)))) {
      return dir
    }
  }
  throw new Error(
    '未找到 PostgreSQL。请安装 PostgreSQL 16+，或用 MOLLY_PG_BIN 指定包含 initdb、pg_ctl、pg_isready、psql、postgres 的 bin 目录。',
  )
}

function run(tool, args, options = {}) {
  const result = spawnSync(join(options.bin ?? findPgBin(), `${tool}${EXE}`), args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 180_000,
    input: options.input,
    env: { ...process.env, ...(options.env ?? {}) },
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.tolerateFailure) {
    throw new Error(`${tool} ${args.join(' ')} 失败：\n${result.stderr || result.stdout}`)
  }
  return result
}

function connectionArgs() {
  return ['-X', '-h', '127.0.0.1', '-p', String(PORT), '-U', PG_USER]
}

function ensureDirectories() {
  mkdirSync(ROOT_DIR, { recursive: true })
  mkdirSync(BACKUP_DIR, { recursive: true })
}

function readPid() {
  if (!existsSync(PID_FILE)) return null
  const value = Number(readFileSync(PID_FILE, 'utf8').trim())
  return Number.isInteger(value) && value > 0 ? value : null
}

function isReady(bin) {
  return run(
    'pg_isready',
    ['-h', '127.0.0.1', '-p', String(PORT), '-U', PG_USER, '-d', DB_NAME],
    { bin, tolerateFailure: true, timeout: 10_000 },
  ).status === 0
}

function waitReady(bin, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolveReady, reject) => {
    const check = () => {
      if (isReady(bin)) {
        resolveReady()
        return
      }
      if (Date.now() > deadline) {
        reject(new Error(`本地 PostgreSQL 启动超时，请查看 ${LOG_FILE}`))
        return
      }
      setTimeout(check, 400)
    }
    check()
  })
}

function startPostgres(bin) {
  ensureDirectories()
  const log = openSync(LOG_FILE, 'a')
  const child = spawn(
    join(bin, `postgres${EXE}`),
    ['-D', DATA_DIR, '-p', String(PORT), '-c', 'listen_addresses=127.0.0.1'],
    // Windows 下必须真正脱离 Node 父进程，否则命令结束时 postgres 也会被回收。
    { stdio: ['ignore', log, log], detached: true },
  )
  child.unref()
  writeFileSync(PID_FILE, String(child.pid), 'utf8')
  return child
}

function applyFile(bin, database, file) {
  run('psql', [...connectionArgs(), '-d', database, '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    bin,
    // Windows 中文路径会在 Node → psql 的 argv 转换中被当前代码页改写。
    // 通过 stdin 传 UTF-8 内容，既避开路径编码问题，也更接近 SQL Editor 的执行方式。
    input: readFileSync(file, 'utf8'),
    env: { PGCLIENTENCODING: 'UTF8' },
  })
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(MIGRATIONS_DIR, name))
}

async function initDatabase(bin) {
  ensureDirectories()
  if (existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    console.log(`本地数据库已初始化：${DATA_DIR}`)
    return
  }

  run('initdb', ['-D', DATA_DIR, '-U', PG_USER, '--encoding=UTF8', '--locale=C', '-A', 'trust'], { bin })
  startPostgres(bin)
  await waitReady(bin)
  run('psql', [...connectionArgs(), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `create database ${DB_NAME}`], { bin })
  applyFile(bin, DB_NAME, SHIM_FILE)
  for (const file of migrationFiles()) {
    applyFile(bin, DB_NAME, file)
    console.log(`已应用迁移：${file.split(/[\\/]/).pop()}`)
  }
  console.log(`本地数据库已创建：postgresql://127.0.0.1:${PORT}/${DB_NAME}`)
}

async function startDatabase(bin) {
  ensureDirectories()
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    await initDatabase(bin)
    return
  }
  if (isReady(bin)) {
    console.log(`本地数据库已经在运行：postgresql://127.0.0.1:${PORT}/${DB_NAME}`)
    return
  }
  startPostgres(bin)
  await waitReady(bin)
  console.log(`本地数据库已启动：postgresql://127.0.0.1:${PORT}/${DB_NAME}`)
}

function stopDatabase(bin) {
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    console.log('本地数据库尚未初始化。')
    return
  }
  if (!isReady(bin)) {
    console.log('本地数据库当前未运行。')
    return
  }
  run('pg_ctl', ['-D', DATA_DIR, '-m', 'fast', '-w', '-t', '30', 'stop'], { bin })
  if (existsSync(PID_FILE)) rmSync(PID_FILE, { force: true })
  console.log('本地数据库已停止。数据目录仍保留。')
}

function statusDatabase(bin) {
  const initialized = existsSync(join(DATA_DIR, 'PG_VERSION'))
  const running = initialized && isReady(bin)
  console.log(JSON.stringify({
    initialized,
    running,
    host: '127.0.0.1',
    port: PORT,
    database: DB_NAME,
    dataDir: DATA_DIR,
    pid: readPid(),
  }, null, 2))
}

async function resetDatabase(bin) {
  ensureDirectories()
  if (existsSync(join(DATA_DIR, 'PG_VERSION')) && isReady(bin)) stopDatabase(bin)
  if (existsSync(DATA_DIR)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = join(BACKUP_DIR, `data-${stamp}`)
    copyDirectory(DATA_DIR, backup)
    rmSync(DATA_DIR, { recursive: true, force: true })
    console.log(`已备份旧数据：${backup}`)
  }
  await initDatabase(bin)
}

function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else copyFileSync(from, to)
  }
}

async function psql(bin, args) {
  await startDatabase(bin)
  const result = run('psql', [...connectionArgs(), '-d', DB_NAME, ...args], {
    bin,
    env: { PGCLIENTENCODING: 'UTF8' },
    timeout: 180_000,
  })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
}

async function main() {
  const command = process.argv[2] ?? 'status'
  const bin = findPgBin()
  const extra = process.argv.slice(3)

  if (command === 'init') await initDatabase(bin)
  else if (command === 'start') await startDatabase(bin)
  else if (command === 'stop') stopDatabase(bin)
  else if (command === 'status') statusDatabase(bin)
  else if (command === 'reset') await resetDatabase(bin)
  else if (command === 'psql') await psql(bin, extra)
  else {
    throw new Error('用法：npm run db:local -- <init|start|stop|status|reset|psql> [psql 参数]')
  }
}

try {
  await main()
} catch (reason) {
  console.error(`本地数据库操作失败：${reason instanceof Error ? reason.message : String(reason)}`)
  process.exitCode = 1
}
