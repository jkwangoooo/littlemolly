// 用**本机真实 PostgreSQL** 把 `database/migrations/*.sql` 全部执行一遍，
// 再把三个 RPC 的真实往返跑通。
//
// ## 为什么需要这个脚本
//
// stage1–stage5 五个迁移从写下到 S5 之前**只做过静态检查**：`check:cloud-parity`
// 是文本比对（正则找函数名、列名、授权语句），它证明「该写的都写了」，
// 但证明不了「写的东西跑得起来」。语法错、函数名拼错、策略写反、
// `jsonb_populate_recordset` 的列不匹配——这一类问题静态检查一个都发现不了，
// 而它们的症状全都出现在**运行时**，也就是用户那边。
//
// 这个脚本把它们提前到本机：起一个临时集群 → 应用垫片 → 按文件名顺序执行全部迁移
// → 断言结构与行为 → 关掉删掉。
//
// ## 与其它脚本的分工
//
// - `check:cloud-parity`：SQL 文本与 TS 契约的**静态**一致性。
// - `verify:sql`（本脚本）：SQL 在**真库**上的行为。
// - `verify:sync`：浏览器 + 假云端，验的是 TS 侧闭环。
//
// ## 它证明什么、不证明什么
//
// 证明：迁移能按序执行成功；表 / 索引 / 触发器 / 策略 / RPC 真的建得出来；
// 历史日期触发器与 `molly.allow_history` 豁免真的按设计工作（且**不泄漏**到事务外）；
// `import_local_backup` / `export_cloud_snapshot` 的往返真的跑通，快照字段集合
// 与本地 `RECORD_SCHEMAS` 逐张表严格一致；替换语义（先删后插）真的成立；
// 非法输入被拒且一条不写；RLS 双账号隔离有效。
//
// 不证明：PostgREST 的 schema cache、GoTrue 的会话、Supabase 的托管配置
// （邮箱验证 / Site URL / 连接池）——那些只有真实项目能验（`docs/19` §5 的 S6）。
//
// ## 找不到 PostgreSQL 时
//
// **直接失败，不静默跳过。** 理由与 `findBrowser` 一致：一个不跑的验收脚本等于没有，
// 而「跳过」在 CI 上看起来和「通过」一模一样。用 `MOLLY_PG_BIN` 指定 bin 目录。

import './ts-resolve.mjs'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXE = process.platform === 'win32' ? '.exe' : ''
const PG_USER = 'molly'
const DB_NAME = 'molly'

const A_ID = '11111111-1111-4111-8111-111111111111'
const B_ID = '22222222-2222-4222-8222-222222222222'
/** 一个**过去**的日期（相对脚本运行时的 2026 年）。历史日期规则必须拒它。 */
const PAST_DATE = '2026-01-05'
/** 一个未来的日期，用来证明「拒的只是历史，不是全部写入」。 */
const FUTURE_DATE = '2099-06-01'

// ---------------------------------------------------------------- PostgreSQL 定位

/** 版本化的安装根：从新到旧。只列常见的，找不到就用 `MOLLY_PG_BIN`。 */
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
    const has = ['initdb', 'pg_ctl', 'psql'].every((tool) => existsSync(join(dir, `${tool}${EXE}`)))
    if (has) return dir
  }
  throw new Error(
    '未找到 PostgreSQL（需要 initdb / pg_ctl / psql 三个可执行文件）。' +
      '本脚本必须在真实数据库上运行，不会静默跳过。' +
      '装一个 PostgreSQL 16+，或用 MOLLY_PG_BIN 指定 bin 目录。',
  )
}

// ---------------------------------------------------------------- 断言框架

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
}

/**
 * 从 psql 的 stderr 里取出「服务端到底说了什么」。
 *
 * 走 `-f` 时错误行长这样：`psql:query-42.sql:3: ERROR:  new row violates …`，
 * 走 `-c` 时是 `ERROR:  …`。两种都要能剥掉前缀——断言用的是精确文本，
 * 前缀留在里面会让每一条比对都失败，而且看起来像「错误信息不对」。
 */
function firstError(text) {
  const raw = String(text ?? '')
  const match = /(?:^|\n)[\s\S]*?\b(?:ERROR|FATAL):\s*([\s\S]*)/.exec(raw)
  if (!match) {
    return (
      raw
        .split('\n')
        .map((item) => item.trim())
        .find(Boolean)
        ?.slice(0, 140) ?? ''
    )
  }
  return match[1].split('\n')[0].replace(/\s*LINE \d+:.*$/, '').trim().slice(0, 140)
}

// ---------------------------------------------------------------- 主流程

const tmpRoot = mkdtempSync(join(tmpdir(), 'molly-verify-sql-'))
const dataDir = join(tmpRoot, 'data')
const logFile = join(tmpRoot, 'server.log')
let bin = null
let port = 0
let started = false

/** 连到临时集群的固定参数。`-X` 忽略用户级 psqlrc（否则别人的配置会污染输出）。 */
const conn = () => ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', PG_USER, '-v', 'ON_ERROR_STOP=1']
/** 每条查询一个临时 SQL 文件的序号（见 `query()` 里为什么不用 `-c`）。 */
let sqlSeq = 0

function run(tool, args, options = {}) {
  const result = spawnSync(join(bin, `${tool}${EXE}`), args, {
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, ...(options.env ?? {}) },
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.tolerateFailure) {
    throw new Error(`${tool} ${args.join(' ')} 失败：\n${result.stderr || result.stdout}`)
  }
  return result
}

/**
 * 跑一条查询，返回 `{ out, err, code }`。
 *
 * `asUser` 走 `PGOPTIONS` 而不是在 SQL 里写 `set role`：后者在多语句 `-c` 里
 * 会把 `SET` 的命令标签混进 `-tA` 的输出，解析起来要额外做一次过滤。
 * 而且 `PGOPTIONS` 的方式每次调用都是**干净的独立会话**，
 * 不会出现「上一条断言设过的 role 泄漏到下一条」这种最难查的假通过。
 */
function query(sql, options = {}) {
  const settings = []
  if (options.role) settings.push(`-c role=${options.role}`)
  if (options.asUser) {
    settings.push('-c role=authenticated', `-c request.jwt.claim.sub=${options.asUser}`)
  }
  // SQL 走**临时文件**而不是 `-c` 参数。
  //
  // Windows 上 Node 传给子进程的 argv 会先被转成当前代码页（中文机器上是 GBK）的窄字节，
  // 而 psql 按 `client_encoding`（这里是 UTF8）去解码——两边不一致，于是夹具里的中文
  // 会以 `invalid byte sequence for encoding "UTF8"` 失败，看起来像 SQL 有问题。
  // 走文件没有这一层转换：文件由我们按 UTF-8 写，psql 按 `PGCLIENTENCODING` 读，
  // 中文往返走的正是真实场景里的那条路。
  const file = join(tmpRoot, `query-${sqlSeq++}.sql`)
  writeFileSync(file, `${sql}\n`, 'utf8')
  const result = spawnSync(join(bin, `psql${EXE}`), [...conn(), '-tAq', '-f', file], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PGCLIENTENCODING: 'UTF8',
      ...(settings.length ? { PGOPTIONS: settings.join(' ') } : {}),
    },
  })
  // 「psql **没跑起来**」与「SQL 被数据库**拒绝**」是两回事，绝不能混为一谈：
  //
  //   - 「SQL 被拒」是**被测行为**，由调用方按错误文本断言（`expectFailure`）；
  //   - 「psql 没跑起来」（超时 / 被信号杀掉 / 起不来）是**验收环境坏了**。
  //     此时 stdout/stderr 是空的、`status` 是 `null`，若照下面 `code: result.status ?? 1`
  //     落成 1，就会被当成「查询失败」——于是 `count()` 得到 0、`scalar()` 得到 null、
  //     `expectFailure()` 得到「（无错误信息）」，一连串断言以**业务规则错误**的形式报红，
  //     而真正的原因（机器被压满、60s 超时）一个字都看不到。
  //
  // 实测：`verify:sql` 与 `verify:local` / `verify:sync` **并行**跑时命中过
  // （两个 Chrome + 两个 Vite + PostgreSQL 抢 CPU，psql 撞上 60s 超时），
  // 单独跑 8 次全绿、并行那次报出 6 条「替换 / 历史豁免」失败——全是假失败。
  // 所以这里显式抛错，让基础设施故障以它本来的样子失败。
  // 注意 `run()` 早就有这个检查，`query()` 是漏掉的那一处。
  if (result.error || result.signal || result.status === null) {
    const reason = result.error?.code ?? result.signal ?? 'status=null'
    throw new Error(`psql 未能正常执行（${reason}）：${sql.split('\n')[0].slice(0, 80)}`)
  }
  return {
    // `\r\n` → `\n`：Windows 版 psql 按文本模式写 stdout，每行都带 `\r`。
    // 单值查询被 `trim()` 顺手盖住了，**多行输出不会**——`split('\n')` 之后
    // 每行末尾留一个不可见的 `\r`，逐行比对会整片假失败（实测 10 张表全红，
    // 打印出来两侧字符串看起来一模一样）。归一放在这一处，调用方不必各自处理。
    out: (result.stdout ?? '').replace(/\r\n/g, '\n').trim(),
    err: (result.stderr ?? '').replace(/\r\n/g, '\n').trim(),
    code: result.status ?? 1,
  }
}

/** 取一个标量。查询失败时返回 `null`（调用方自己断言失败）。 */
function scalar(sql, options) {
  const result = query(sql, options)
  return result.code === 0 ? result.out : null
}
const count = (sql, options) => Number(scalar(sql, options))
/** 期望这条语句**失败**；成功时返回 `null`，失败时返回错误文本。 */
function expectFailure(sql, options) {
  const result = query(sql, options)
  return result.code === 0 ? null : firstError(result.err) || '（无错误信息）'
}

/** 把 JS 对象当成 jsonb 字面量嵌进 SQL。用自定义 dollar-quoting 避开转义。 */
const jsonb = (value) => `$molly$${JSON.stringify(value)}$molly$::jsonb`

// ---------------------------------------------------------------- 备份夹具

/**
 * 一份「每张表各一条」的本地备份，日期全是**过去**的。
 *
 * 历史日期是有意选的：云端触发器一律拒绝写今天之前（`docs/01` 不变量 4），
 * 所以这份夹具同时也是「豁免真的生效」的判据——它导入成功，
 * 就说明 `import_local_backup` 里的 `set local molly.allow_history` 起了作用。
 */
function backupFixture() {
  const stamp = (day) => `${day}T00:00:00.000Z`
  return {
    app: 'happy-little-molly',
    format: 'local-backup',
    version: 2,
    db_version: 7,
    exported_at: '2026-09-20T00:00:00.000Z',
    source_user: { username: 'a' },
    counts: {},
    records: {
      users: [{ id: A_ID, username: 'a', password_hash: '', created_at: stamp('1970-01-01') }],
      food_options: [
        {
          id: '0f000000-0000-4000-8000-000000000001',
          user_id: A_ID,
          name: '燕麦',
          active: true,
          sort_order: 0,
          created_at: stamp('2026-01-01'),
          updated_at: stamp('2026-01-01'),
        },
      ],
      day_plans: [
        {
          id: '0d000000-0000-4000-8000-000000000001',
          user_id: A_ID,
          plan_date: PAST_DATE,
          mode: 'work',
          mode_override: false,
          created_at: stamp(PAST_DATE),
          updated_at: stamp(PAST_DATE),
          outfit_ready: true,
          meals_ready: false,
          supplements_ready: false,
          morning_ready: false,
          exercise_ready: false,
          morning_focus: 'early',
          morning_completed: true,
          exercise_decision: 'rest',
          exercise_note: '膝盖不舒服',
          exercise_completed: false,
        },
      ],
      daily_meals: [
        {
          id: '0e000000-0000-4000-8000-000000000001',
          day_plan_id: '0d000000-0000-4000-8000-000000000001',
          meal_type: 'breakfast',
          note: '热的',
          completed: true,
        },
      ],
      daily_meal_items: [
        {
          id: '0a000000-0000-4000-8000-000000000001',
          daily_meal_id: '0e000000-0000-4000-8000-000000000001',
          food_option_id: '0f000000-0000-4000-8000-000000000001',
          food_name_snapshot: '燕麦',
          sort_order: 0,
          created_at: stamp(PAST_DATE),
        },
      ],
      custom_tasks: [
        {
          id: '0c000000-0000-4000-8000-000000000001',
          day_plan_id: '0d000000-0000-4000-8000-000000000001',
          task_time: '05:00',
          title: '送孩子',
          note: '',
          completed: false,
        },
      ],
      daily_supplements: [
        {
          id: '0b000000-0000-4000-8000-000000000001',
          day_plan_id: '0d000000-0000-4000-8000-000000000001',
          name_snapshot: '维生素D',
          period: 'morning',
          planned: true,
          completed: true,
          sort_order: 0,
          created_at: stamp(PAST_DATE),
          updated_at: stamp(PAST_DATE),
        },
      ],
      daily_exercise_items: [
        {
          id: '09000000-0000-4000-8000-000000000001',
          day_plan_id: '0d000000-0000-4000-8000-000000000001',
          exercise_option_id: null,
          name_snapshot: '散步',
          sort_order: 0,
          created_at: stamp(PAST_DATE),
        },
      ],
      routine_tasks: [
        {
          id: '08000000-0000-4000-8000-000000000001',
          day_plan_id: '0d000000-0000-4000-8000-000000000001',
          kind: 'mop',
          title: '拖地',
          completed: false,
        },
      ],
      // 下面两张表**必须各留一条**。
      //
      // 「快照字段集合 vs 本地契约」这条断言只能从**快照里真实存在的行**反推字段：
      // 表里没有数据时，它那一行冒号后面是空的，比对要么以「两侧都空」假通过、
      // 要么以「云端=[] 契约=7 项」假失败。少了它们，云端字段清单里
      // 这两张表就完全没人守——而它们正是最容易写错的一类（`period` 那种
      // 带 check 约束的列，多一个少一个都只有真跑一遍才发现）。
      exercise_options: [
        {
          id: '07000000-0000-4000-8000-000000000001',
          user_id: A_ID,
          name: '散步',
          active: true,
          sort_order: 0,
          created_at: stamp('2026-01-01'),
          updated_at: stamp('2026-01-01'),
        },
      ],
      supplement_templates: [
        {
          id: '06000000-0000-4000-8000-000000000001',
          user_id: A_ID,
          name: '维生素D',
          period: 'morning',
          active: true,
          sort_order: 0,
          created_at: stamp('2026-01-01'),
          updated_at: stamp('2026-01-01'),
        },
      ],
    },
  }
}

/** 只含一条 day_plans 的最小备份，用来验「替换」而不是「合并」。 */
function minimalBackup(mode = 'rest') {
  return {
    app: 'happy-little-molly',
    format: 'local-backup',
    version: 2,
    records: {
      day_plans: [
        {
          id: '0d000000-0000-4000-8000-000000000001',
          plan_date: PAST_DATE,
          mode,
          mode_override: true,
          created_at: `${PAST_DATE}T00:00:00.000Z`,
          updated_at: `${PAST_DATE}T00:00:00.000Z`,
          outfit_ready: false,
          meals_ready: false,
          supplements_ready: false,
          morning_ready: false,
          exercise_ready: false,
          morning_focus: '',
          morning_completed: false,
          exercise_decision: 'undecided',
          exercise_note: '',
          exercise_completed: false,
        },
      ],
    },
  }
}

const importBackup = (payload, options) =>
  scalar(`select public.import_local_backup(${jsonb(payload)})::text`, options)
const summaryOf = (options) => scalar(`select public.cloud_sync_summary()::text`, options)

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address()
      probe.close(() => resolvePort(free))
    })
  })
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * 直接拉起 `postgres`，**不走 `pg_ctl start`**。
 *
 * 在 Windows 上 `pg_ctl start` 配合 `spawnSync` 会挂住：`pg_ctl` 通过管道等
 * postmaster 的就绪信号，而被它拉起来的 `postgres` 继承了同一组管道句柄，
 * 于是「等信号」和「等句柄关闭」互相僵住，直到 spawnSync 自己超时。
 * 自己 spawn + 轮询 `pg_isready` 没有这个问题，而且超时时能看到日志文件。
 */
function startCluster() {
  const log = openSync(logFile, 'a')
  const child = spawn(
    join(bin, `postgres${EXE}`),
    ['-D', dataDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1'],
    { stdio: ['ignore', log, log], detached: false },
  )
  child.unref()
  return child
}

/** 轮询到数据库能接受连接为止。超时返回 false（调用方负责报错并给出日志路径）。 */
async function waitReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    // 注意 `pg_isready` **没有** `-X`（那是 psql 的选项）。加错了它每次都返回非零，
    // 于是「数据库明明已经起来了」却被判成启动超时。
    const probe = spawnSync(
      join(bin, `pg_isready${EXE}`),
      ['-h', '127.0.0.1', '-p', String(port), '-U', PG_USER, '-d', 'postgres'],
      { encoding: 'utf8', timeout: 10_000 },
    )
    if (probe.status === 0) return true
    if (Date.now() > deadline) return false
    await sleep(400)
  }
}

// ---------------------------------------------------------------- 断言

async function main() {
  bin = findPgBin()
  console.log(`PostgreSQL: ${bin}`)
  port = await findFreePort()

  run('initdb', ['-D', dataDir, '-U', PG_USER, '--encoding=UTF8', '--locale=C', '-A', 'trust'])
  started = true
  startCluster()
  if (!(await waitReady())) {
    const tail = existsSync(logFile) ? readFileSync(logFile, 'utf8').slice(-1500) : '（没有日志文件）'
    throw new Error(`PostgreSQL 在 127.0.0.1:${port} 上启动超时。服务器日志：\n${tail}`)
  }
  run('psql', [...conn(), '-d', 'postgres', '-c', `create database ${DB_NAME}`])

  // 1. 垫片 + 迁移，按文件名顺序
  const shim = join(ROOT, 'scripts', 'lib', 'supabase-shim.sql')
  const migrationsDir = join(ROOT, 'database', 'migrations')
  const migrationFiles = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(migrationsDir, name))

  // 垫片必须先于迁移（`alter default privileges` 只影响之后创建的对象，
  // 而 stage6 的 `revoke ... from public` 依赖「默认授权已经给过」这个前提）。
  run('psql', [...conn(), '-d', DB_NAME, '-q', '-f', shim])

  let applied = 0
  for (const file of migrationFiles) {
    const name = file.split(/[\\/]/).pop()
    const result = run('psql', [...conn(), '-d', DB_NAME, '-q', '-f', file], { tolerateFailure: true })
    if (result.status !== 0) {
      record(`迁移执行成功：${name}`, false, firstError(result.stderr || result.stdout))
    } else {
      applied += 1
    }
  }
  record(
    `全部 ${migrationFiles.length} 个迁移在真实 PostgreSQL 上执行成功`,
    applied === migrationFiles.length,
    `成功 ${applied} / ${migrationFiles.length}`,
  )

  // 2. 结构
  const tables = [
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
  const list = tables.map((name) => `'${name}'`).join(',')
  record(
    '10 张业务表全部建出来了',
    count(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname in (${list})`) === tables.length,
    `实际 ${count(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname in (${list})`)} / ${tables.length}`,
  )
  record(
    '10 张业务表全部开启了行级安全（RLS）',
    count(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname in (${list})`) ===
      tables.length,
    'relrowsecurity 全为真',
  )
  record(
    '10 张业务表全部有策略',
    count(`select count(distinct tablename) from pg_policies where schemaname = 'public' and tablename in (${list})`) ===
      tables.length,
    `有策略的表 ${count(`select count(distinct tablename) from pg_policies where schemaname = 'public' and tablename in (${list})`)} / ${tables.length}`,
  )
  record(
    '三处历史日期触发器都挂上了',
    count(`select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and not t.tgisinternal
             and t.tgfoid in ('public.reject_historical_day_plan'::regproc,
                              'public.reject_historical_stage3_rows'::regproc,
                              'public.reject_historical_meal_items'::regproc)`) >= 3,
    `命中 ${count(`select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and not t.tgisinternal
             and t.tgfoid in ('public.reject_historical_day_plan'::regproc,
                              'public.reject_historical_stage3_rows'::regproc,
                              'public.reject_historical_meal_items'::regproc)`)} 个触发器`,
  )
  record(
    '三个 RPC 都存在',
    count(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('cloud_sync_summary', 'export_cloud_snapshot', 'import_local_backup')`) === 3,
    'cloud_sync_summary / export_cloud_snapshot / import_local_backup',
  )
  // `security definer` 会让函数以定义者的权限运行，绕过调用者的 RLS。
  // 整体替换是**用户自己的数据**之间的搬运，没有任何理由提权——
  // 一旦某个函数被写成 definer，越权就从「不可能」变成「取决于函数体写得对不对」。
  record(
    '三个 RPC 都是 security invoker（不提权）',
    count(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and not p.prosecdef
             and p.proname in ('cloud_sync_summary', 'export_cloud_snapshot', 'import_local_backup')`) === 3,
    'prosecdef 全为假',
  )

  // 3. 两个云端账号
  run('psql', [
    ...conn(),
    '-d',
    DB_NAME,
    '-q',
    '-c',
    `insert into auth.users (id, email) values ('${A_ID}', 'a@molly.local'), ('${B_ID}', 'b@molly.local')`,
  ])

  // 4. 往返：导入 → 摘要 → 快照
  const imported = JSON.parse(importBackup(backupFixture(), { asUser: A_ID }) ?? 'null')
  record(
    '导入一份「每张表各一条、日期全在过去」的备份成功',
    imported?.total === 10,
    `total=${imported?.total} · 分表=${JSON.stringify(imported?.imported)}`,
  )
  // 这一条同时是历史日期豁免的判据：夹具里的 `plan_date` 是 2026-01-05，
  // 不豁免的话第一条 insert 就会撞上「历史日期不可修改」。
  record(
    '导入过程中历史日期被放行（豁免真的生效）',
    count(`select count(*) from public.day_plans where plan_date = '${PAST_DATE}'`, { asUser: A_ID }) === 1,
    `plan_date=${PAST_DATE} 的行数 = ${count(`select count(*) from public.day_plans where plan_date = '${PAST_DATE}'`, { asUser: A_ID })}`,
  )

  const summary = JSON.parse(summaryOf({ asUser: A_ID }) ?? 'null')
  record('摘要口径与本地一致：10 张表、含子表、只数非空', summary?.total === 10, JSON.stringify(summary))
  record(
    '摘要按表给出条数，子表也在内',
    Object.keys(summary?.counts ?? {}).sort().join(',') ===
      [
        'custom_tasks',
        'daily_exercise_items',
        'daily_meal_items',
        'daily_meals',
        'daily_supplements',
        'day_plans',
        'exercise_options',
        'food_options',
        'routine_tasks',
        'supplement_templates',
      ]
        .sort()
        .join(','),
    JSON.stringify(Object.keys(summary?.counts ?? {})),
  )

  const snapshot = JSON.parse(scalar(`select public.export_cloud_snapshot()::text`, { asUser: A_ID }) ?? 'null')
  const { RECORD_SCHEMAS, USER_DATA_STORES } = await import('../src/services/local/recordSchemas.ts')
  record(
    '快照的文件形状与本地备份一致（app / format / version）',
    snapshot?.app === 'happy-little-molly' && snapshot?.format === 'local-backup' && snapshot?.version === 2,
    `app=${snapshot?.app} format=${snapshot?.format} version=${snapshot?.version}`,
  )
  record(
    '快照里有合成的 users 行（缺了它 parseBackup 会整份拒绝）',
    Array.isArray(snapshot?.records?.users) && snapshot.records.users[0]?.id === A_ID,
    JSON.stringify(snapshot?.records?.users),
  )
  record(
    '快照的仓库集合 = 10 张用户数据表 + users',
    Object.keys(snapshot?.records ?? {}).sort().join(',') === [...USER_DATA_STORES, 'users'].sort().join(','),
    JSON.stringify(Object.keys(snapshot?.records ?? {}).sort()),
  )

  // 逐张表的字段集合与本地契约严格比对。
  //
  // 这是本脚本最要紧的一条：stage6 里的字段清单是**逐字手写**的，
  // 多一个（`exercise_content` 那种云端独有列）或少一个，本地 `parseBackup`
  // 都会**整份拒绝**——「从云端恢复到本地」会以「备份文件不合法」告终，
  // 而静态检查只比对文本、发现不了清单与契约的分叉。
  // 注意 `records->store` 是**数组**（一张表的记录列表），不是对象——
  // `jsonb_object_keys` 直接作用在它上面会报 `cannot call jsonb_object_keys on an array`。
  // 先 `jsonb_array_elements` 展开，再对每个元素取键；用 `distinct` 是因为
  // 同一张表的多行必须字段一致（不一致本身就说明快照有问题）。
  const fieldRows = scalar(
    `select k || '|' || coalesce((
        select string_agg(distinct f, ',' order by f)
          from jsonb_array_elements(s->'records'->k) e, jsonb_object_keys(e) f
      ), '')
       from public.export_cloud_snapshot() s, jsonb_object_keys(s->'records') k
      order by k`,
    { asUser: A_ID },
  )
  const fieldLines = (fieldRows ?? '').split('\n').filter(Boolean)
  const mismatched = []
  const withoutRows = []
  for (const line of fieldLines) {
    const [store, fields] = line.split('|')
    if (!fields) withoutRows.push(store)
    const expected = Object.keys(RECORD_SCHEMAS[store] ?? {}).sort()
    const actual = fields ? fields.split(',').sort() : []
    if (expected.join(',') !== actual.join(',')) {
      mismatched.push(`${store}: 云端=[${actual}] 契约=[${expected}]`)
    }
  }
  // 快照里一张表没有数据时，它那一行的字段是空的——比对会以「云端=[] 契约=N 项」
  // 失败，但那**不是**字段清单写错了，而是夹具没覆盖到这张表（实测踩过：
  // `exercise_options` / `supplement_templates` 一开始没进夹具，报出来的
  // 却像是「云端字段清单和本地契约分叉」）。单独立一条断言把这两种失败分开：
  // 看到它红就去补夹具，看到下面那条红才去查迁移。
  record(
    '夹具覆盖了快照里的每一张表（否则字段集合无从比对）',
    withoutRows.length === 0,
    withoutRows.length ? `快照里没有数据的表：${withoutRows.join(', ')}` : `${fieldLines.length} 张表都有数据`,
  )
  // `fieldLines.length` 这个前置条件不能省：快照是空的时候（导入失败）
  // 上面那个循环一次都不跑，`mismatched` 自然为空——断言会以「0 张表通过」的形式
  // 假通过。要求「11 张表都真的比过」（10 张用户数据表 + users）才能说明问题。
  record(
    '快照每张表的字段集合与本地 recordSchemas 严格一致',
    mismatched.length === 0 && fieldLines.length === USER_DATA_STORES.length + 1,
    mismatched.length
      ? mismatched.join(' · ')
      : `比对了 ${fieldLines.length} 张表 / 期望 ${USER_DATA_STORES.length + 1} 张`,
  )

  // 时间戳必须是 UTC 的 `…Z` 形状：本地 `TIMESTAMP_PATTERN` 两种时区都认，
  // 但「同一份云端数据导出两次逐字节相同」要靠固定 UTC 才成立。
  record(
    '快照的时间戳一律是 UTC 的 …Z 形状',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(snapshot?.records?.food_options?.[0]?.created_at ?? ''),
    snapshot?.records?.food_options?.[0]?.created_at,
  )
  // `time` 列的原生 JSON 形状是 `HH:MM:SS`，本地是 `HH:MM`。
  record(
    '快照把 task_time 收窄成 HH:MM',
    snapshot?.records?.custom_tasks?.[0]?.task_time === '05:00',
    snapshot?.records?.custom_tasks?.[0]?.task_time,
  )
  // 导出两次，records 部分必须逐字节相同（exported_at 之外的一切都不该抖动）。
  const snapshotAgain = JSON.parse(scalar(`select public.export_cloud_snapshot()::text`, { asUser: A_ID }) ?? 'null')
  record(
    '同一份数据导出两次，records 逐字节相同',
    JSON.stringify(snapshot?.records) === JSON.stringify(snapshotAgain?.records),
    '排序与时间戳都是确定的',
  )

  // 5. 替换语义：再导入一份只有 day_plans 的，其余表必须被清空
  const replaced = JSON.parse(importBackup(minimalBackup(), { asUser: A_ID }) ?? 'null')
  record('再次导入（只有 day_plans）成功', replaced?.total === 1, `total=${replaced?.total}`)
  record(
    '替换是「先删后插」，不是「合并」',
    count(`select count(*) from public.food_options`, { asUser: A_ID }) === 0 &&
      count(`select count(*) from public.daily_meals`, { asUser: A_ID }) === 0 &&
      count(`select count(*) from public.day_plans`, { asUser: A_ID }) === 1,
    `food_options=${count(`select count(*) from public.food_options`, { asUser: A_ID })} · daily_meals=${count(`select count(*) from public.daily_meals`, { asUser: A_ID })} · day_plans=${count(`select count(*) from public.day_plans`, { asUser: A_ID })}`,
  )
  record(
    '替换后同一主键的行是新的内容（不是旧的留下）',
    scalar(`select mode || '/' || mode_override::text from public.day_plans where id = '0d000000-0000-4000-8000-000000000001'`, {
      asUser: A_ID,
    }) === 'rest/true',
    'mode=rest / mode_override=true',
  )
  record(
    '替换后摘要跟着变',
    JSON.parse(summaryOf({ asUser: A_ID }) ?? 'null')?.total === 1,
    summaryOf({ asUser: A_ID }),
  )

  // 6. 历史日期：日常路径必须仍然被拒，且豁免不泄漏到事务外
  const beforeCount = count(`select count(*) from public.day_plans`, { asUser: A_ID })
  const directPast = expectFailure(
    `insert into public.day_plans (user_id, plan_date, mode) values ('${A_ID}', '${PAST_DATE}', 'work')`,
    { asUser: A_ID },
  )
  record('日常写入（不走 RPC）仍然拒绝历史日期', directPast === '历史日期不可修改', directPast ?? '（竟然成功了）')
  record(
    '被拒之后一行都没写进去',
    count(`select count(*) from public.day_plans`, { asUser: A_ID }) === beforeCount,
    `${beforeCount} → ${count(`select count(*) from public.day_plans`, { asUser: A_ID })}`,
  )
  record(
    '日常写入未来日期照常放行（拒的只是历史，不是全部）',
    expectFailure(
      `insert into public.day_plans (user_id, plan_date, mode) values ('${A_ID}', '${FUTURE_DATE}', 'work')`,
      { asUser: A_ID },
    ) === null,
    `plan_date=${FUTURE_DATE}`,
  )
  // 关键：`set local` 的作用域是**事务**。RPC 返回、事务提交之后，
  // 豁免必须已经失效——否则「导入过一次之后这个连接就能随便改历史」。
  //
  // 必须显式写 `begin` / `commit`：psql 会把文件里的多条语句放进**一个隐式事务**，
  // 不划边界的话测到的是「同一个事务里豁免仍然有效」（那本来就该有效），
  // 而不是「豁免不跨事务」。
  const leak = expectFailure(
    `begin;
     select public.import_local_backup(${jsonb(minimalBackup())});
     commit;
     insert into public.day_plans (user_id, plan_date, mode) values ('${A_ID}', '${PAST_DATE}', 'work');`,
    { asUser: A_ID },
  )
  record(
    '豁免不泄漏：RPC 返回后同一个会话里改历史仍被拒',
    leak === '历史日期不可修改',
    leak ?? '（竟然成功了：豁免泄漏到了事务外）',
  )

  // 7. 非法输入：必须被拒，且一条都不写
  //
  // 期望值用**精确文本**而不是「包含某个词」：这些错误会原样显示给用户，
  // 措辞变了就该有人看一眼（`docs/01` 的文案也是这么当契约用的）。
  const beforeReject = count(`select count(*) from public.day_plans`, { asUser: A_ID })
  const rejects = [
    [
      'app / format 不对',
      '这不是「幸福小Molly」的备份文件',
      { app: 'x', format: 'local-backup', version: 2, records: {} },
    ],
    [
      '出现了不认识的仓库',
      '备份里出现了不认识的仓库：sync_outbox',
      { app: 'happy-little-molly', format: 'local-backup', version: 2, records: { sync_outbox: [] } },
    ],
    [
      '备份格式版本不受支持',
      '备份格式版本不受支持：9',
      { app: 'happy-little-molly', format: 'local-backup', version: 9, records: {} },
    ],
  ]
  for (const [label, expected, payload] of rejects) {
    const error = expectFailure(`select public.import_local_backup(${jsonb(payload)})`, { asUser: A_ID })
    record(`坏 payload 被拒（${label}）`, error === expected, error ?? '（竟然被接受了）')
  }
  record(
    '三次拒绝之后条数一点没变（拒绝不是「删完才发现不对」）',
    count(`select count(*) from public.day_plans`, { asUser: A_ID }) === beforeReject,
    `${beforeReject} → ${count(`select count(*) from public.day_plans`, { asUser: A_ID })}`,
  )

  // 8. RLS：双账号隔离
  record(
    'B 的摘要一条都数不到',
    JSON.parse(summaryOf({ asUser: B_ID }) ?? 'null')?.total === 0,
    summaryOf({ asUser: B_ID }),
  )
  record(
    'B 直接查表也看不到 A 的任何行',
    count(`select count(*) from public.day_plans`, { asUser: B_ID }) === 0 &&
      count(`select count(*) from public.food_options`, { asUser: B_ID }) === 0,
    `day_plans=${count(`select count(*) from public.day_plans`, { asUser: B_ID })} · food_options=${count(`select count(*) from public.food_options`, { asUser: B_ID })}`,
  )
  // 断言错误文本里必须出现 `row-level security`：只判「失败了」是不够的，
  // 任何原因（字段名打错、编码问题）都会让这条语句失败，那样就成了假通过。
  const forged = expectFailure(
    `insert into public.food_options (id, user_id, name, active, sort_order, created_at, updated_at)
     values ('0f000000-0000-4000-8000-0000000000ff', '${A_ID}', 'forged', true, 0, now(), now())`,
    { asUser: B_ID },
  )
  record(
    'B 冒用 A 的 user_id 插入被 RLS 拒绝',
    (forged ?? '').includes('row-level security'),
    forged ?? '（竟然成功了）',
  )

  // B 导入自己的数据，A 的一行都不能被牵连。
  const bBackup = {
    app: 'happy-little-molly',
    format: 'local-backup',
    version: 2,
    records: {
      food_options: [
        {
          id: '0f000000-0000-4000-8000-0000000000bb',
          user_id: B_ID,
          name: 'B 的食物',
          active: true,
          sort_order: 0,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  }
  record(
    'B 导入自己的备份成功',
    JSON.parse(importBackup(bBackup, { asUser: B_ID }) ?? 'null')?.total === 1,
    importBackup(bBackup, { asUser: B_ID }),
  )
  record(
    'B 的替换没有牵连 A 的数据',
    count(`select count(*) from public.day_plans`, { asUser: A_ID }) === beforeReject &&
      count(`select count(*) from public.food_options where user_id = '${A_ID}'`) === 0,
    `A 的 day_plans=${count(`select count(*) from public.day_plans`, { asUser: A_ID })}`,
  )
  record(
    'B 现在能看到自己的那条，A 看不到',
    count(`select count(*) from public.food_options`, { asUser: B_ID }) === 1 &&
      count(`select count(*) from public.food_options`, { asUser: A_ID }) === 0,
    `B=${count(`select count(*) from public.food_options`, { asUser: B_ID })} · A=${count(`select count(*) from public.food_options`, { asUser: A_ID })}`,
  )

  // 9. 未登录：拿不到数据
  //
  // 这一条不能断言「anon 没有执行权」——Supabase 给 `public` schema 下新建对象
  // 默认授权给三个角色，stage6 的 `revoke ... from public` 收不回那些显式授权。
  // 真正该守住的是**结果**：未登录调用拿不到任何数据。
  const anon = query(`select public.cloud_sync_summary()::text`, { role: 'anon' })
  record(
    'anon 调用摘要拿不到任何数据（要么无权限、要么未登录报错）',
    anon.code !== 0 && !anon.out.includes('total'),
    firstError(anon.err) || anon.out,
  )
  const anonImport = query(`select public.import_local_backup(${jsonb(backupFixture())})::text`, { role: 'anon' })
  record(
    'anon 调用整体替换拿不到任何数据',
    anonImport.code !== 0 && !anonImport.out.includes('imported'),
    firstError(anonImport.err) || anonImport.out,
  )

  const failed = results.filter((item) => !item.ok)
  console.log('')
  console.log(`结果：${results.length - failed.length}/${results.length} 通过`)
  if (failed.length) {
    console.log('未通过：')
    failed.forEach((item) => console.log(`  - ${item.name}`))
    process.exitCode = 1
  }
}

try {
  await main()
} catch (reason) {
  console.error(`\n无法完成 SQL 验收：${reason.message}`)
  process.exitCode = 1
} finally {
  if (started) {
    // `immediate`：临时集群里的数据用完就删，不需要干净关闭的检查点。
    // 超时不当作失败——后面的目录清理失败也只是留个临时目录，不影响验收结论。
    spawnSync(join(bin, `pg_ctl${EXE}`), ['-D', dataDir, '-m', 'immediate', '-w', '-t', '30', 'stop'], {
      encoding: 'utf8',
      timeout: 45_000,
    })
    await sleep(500)
  }
  // Windows 上 postgres 退出后可能还短暂持有文件句柄，给几次重试。
  // 清不掉不是验收失败（临时目录由系统回收），但要**说出来**，不能默默吞掉。
  try {
    rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch (reason) {
    console.warn(`临时集群目录没能删掉（不影响验收结论）：${tmpRoot}\n  ${reason.message}`)
  }
}
