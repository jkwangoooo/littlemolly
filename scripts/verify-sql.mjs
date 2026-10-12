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
const count = (sql, options) => {
  const value = scalar(sql, options)
  if (value === null || value === '' || !Number.isFinite(Number(value))) {
    throw new Error(`计数查询未成功：${sql.split('\n')[0].slice(0, 120)}`)
  }
  return Number(value)
}
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
    version: 3,
    db_version: 8,
    exported_at: '2026-10-12T00:00:00.000Z',
    source_user: { username: 'W' },
    counts: {},
    records: {
      users: [{ id: A_ID, username: 'W', created_at: stamp('1970-01-01') }],
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
    version: 3,
    db_version: 8,
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

const BUSINESS_TABLES = [
  'day_plans', 'daily_meals', 'daily_meal_items', 'custom_tasks',
  'daily_supplements', 'daily_exercise_items', 'routine_tasks',
  'food_options', 'supplement_templates', 'exercise_options',
]
const PUBLIC_TABLES = ['profiles', 'sync_test_records', ...BUSINESS_TABLES]
const GATE_MIGRATION = '20261011183805_account_identity_gate.sql'
const DENIED_MESSAGE = '当前账号未获应用访问授权'
const RPC_SIGNATURES = [
  'public.account_access()', 'public.cloud_sync_summary()',
  'public.export_cloud_snapshot()', 'public.import_local_backup(jsonb)',
]
const COPY_SIGNATURES = [
  'public.copy_yesterday_stage3(date)', 'public.copy_yesterday_stage4(date)',
]

/** 生成升级前的第二个工作区，整张关联图换 ID，不与 A 共用主键。 */
function legacyFixture(owner) {
  const file = backupFixture()
  file.version = 2
  file.db_version = 7
  file.source_user.username = owner === A_ID ? 'legacy-a' : 'legacy-b'
  const idMap = new Map(Object.values(file.records).flat()
    .filter((row) => row.id !== A_ID)
    .map((row) => [row.id, owner === A_ID ? row.id : `${row.id.slice(0, -1)}2`]))
  for (const [store, rows] of Object.entries(file.records)) {
    for (const row of rows) {
      if (store === 'users') {
        row.id = owner
        row.username = file.source_user.username
        continue
      }
      for (const field of ['id', 'day_plan_id', 'daily_meal_id', 'food_option_id', 'exercise_option_id']) {
        if (typeof row[field] === 'string') row[field] = idMap.get(row[field]) ?? row[field]
      }
      if ('user_id' in row) row.user_id = owner
      if (owner === B_ID && store === 'day_plans') row.plan_date = FUTURE_DATE
    }
  }
  return file
}

function ownerFilter(store, owner) {
  if (store === 'daily_meal_items') {
    return `t.daily_meal_id in (select m.id from public.daily_meals m
      join public.day_plans p on p.id = m.day_plan_id where p.user_id = '${owner}')`
  }
  if (['daily_meals', 'custom_tasks', 'daily_supplements', 'daily_exercise_items', 'routine_tasks'].includes(store)) {
    return `t.day_plan_id in (select p.id from public.day_plans p where p.user_id = '${owner}')`
  }
  return `t.user_id = '${owner}'`
}

/** 以数据库 owner 读取完整镜像；负向用例不能把「RLS 看不到」当成「没有被改」。 */
function ownerImage(owner) {
  return scalar(`select jsonb_build_object(${PUBLIC_TABLES.map((store) =>
    `'${store}', coalesce((select jsonb_agg(to_jsonb(t) order by ${
      store === 'profiles' ? 't.user_id' : 't.id'
    }) from public.${store} t where ${ownerFilter(store, owner)}), '[]'::jsonb)`,
  ).join(',')})::text`)
}

function visibleTotal(owner) {
  return count(`select ${PUBLIC_TABLES.map((store) =>
    `(select count(*) from public.${store})`,
  ).join(' + ')}`, { asUser: owner })
}

function rpcRejectedFor(owner) {
  return [
    'select public.cloud_sync_summary()',
    'select public.export_cloud_snapshot()',
    `select public.import_local_backup(${jsonb(backupFixture())})`,
  ].map((sql) => expectFailure(sql, { asUser: owner }))
}

function onlyAuthenticatedExec(signatures) {
  return scalar(`select bool_and(
    has_function_privilege('authenticated', f, 'EXECUTE')
    and not has_function_privilege('anon', f, 'EXECUTE')
    and not has_function_privilege('service_role', f, 'EXECUTE')
  ) from unnest(array[${signatures.map((name) => `'${name}'`).join(',')}]) f`) === 't'
}

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

  // 先导入升级前的 A/B 数据，再追加门禁，才能证明旧数据既保留又受限制。
  const shim = join(ROOT, 'scripts', 'lib', 'supabase-shim.sql')
  const migrationsDir = join(ROOT, 'database', 'migrations')
  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const migrationFiles = migrationNames.map((name) => join(migrationsDir, name))
  if (migrationNames.length !== 7 || migrationNames.at(-1) !== GATE_MIGRATION) {
    throw new Error('本轮 SQL 验收要求六个历史迁移后追加账号门禁迁移。')
  }

  const bundlePath = join(ROOT, 'deploy', 'supabase-all-migrations.sql')
  const bundle = readFileSync(bundlePath, 'utf8').replace(/\r\n/g, '\n')
  const marker = '-- ############################################################################'
  const expectedBody = migrationNames.map((name) =>
    `${marker}\n-- ##  ${name}\n${marker}\n\n` +
    readFileSync(join(migrationsDir, name), 'utf8').replace(/\r\n/g, '\n').trimEnd(),
  ).join('\n\n\n')
  const actualBody = bundle.slice(bundle.indexOf(marker)).trimEnd()
  record(
    '空库合并文件逐段等于七个源迁移，顺序和事务完整保留',
    actualBody === expectedBody,
    `源迁移 ${migrationNames.length} 个`,
  )

  run('psql', [...conn(), '-d', DB_NAME, '-q', '-f', shim])
  let applied = 0
  for (const file of migrationFiles.slice(0, -1)) {
    const name = file.split(/[\\/]/).pop()
    const result = run('psql', [...conn(), '-d', DB_NAME, '-q', '-f', file], { tolerateFailure: true })
    if (result.status !== 0) {
      record(`迁移执行成功：${name}`, false, firstError(result.stderr || result.stdout))
      throw new Error(`历史迁移未完成：${name}`)
    } else {
      applied += 1
    }
  }

  const identities = query(
    `insert into auth.users (id, email) values ('${A_ID}', 'a@molly.local'), ('${B_ID}', 'b@molly.local')`,
  )
  if (identities.code !== 0) throw new Error(firstError(identities.err))
  const oldA = JSON.parse(importBackup(legacyFixture(A_ID), { asUser: A_ID }) ?? 'null')
  const oldB = JSON.parse(importBackup(legacyFixture(B_ID), { asUser: B_ID }) ?? 'null')
  const probes = query(
    `insert into public.sync_test_records (user_id, content)
     values ('${A_ID}', 'legacy-a'), ('${B_ID}', 'legacy-b')`,
  )
  if (probes.code !== 0) throw new Error(firstError(probes.err))
  record('升级前 A/B 各有完整业务图、资料和诊断数据', oldA?.total === 10 && oldB?.total === 10)
  const beforeGateA = ownerImage(A_ID)
  const beforeGateB = ownerImage(B_ID)
  const gate = run('psql', [
    ...conn(), '-d', DB_NAME, '-q', '-f', migrationFiles.at(-1),
  ], { tolerateFailure: true })
  if (gate.status !== 0) {
    record(`迁移执行成功：${GATE_MIGRATION}`, false, firstError(gate.stderr || gate.stdout))
    throw new Error('账号门禁迁移未完成')
  }
  applied += 1
  record(
    `全部 ${migrationFiles.length} 个迁移在真实 PostgreSQL 上执行成功`,
    applied === migrationFiles.length,
    `成功 ${applied} / ${migrationFiles.length}`,
  )
  record(
    '追加门禁保持 A/B 全部旧数据原样，未删除或自动转移归属',
    beforeGateA !== null && beforeGateB !== null &&
      ownerImage(A_ID) === beforeGateA && ownerImage(B_ID) === beforeGateB,
  )

  run('psql', [...conn(), '-d', 'postgres', '-c', 'create database molly_merged'])
  run('psql', [...conn(), '-d', 'molly_merged', '-q', '-f', shim])
  const merged = run('psql', [
    ...conn(), '-d', 'molly_merged', '-q', '-f', bundlePath,
  ], { tolerateFailure: true })
  record(
    '七迁移合并文件在另一个空库初始化成功',
    merged.status === 0,
    merged.status === 0 ? '合并文件完整执行' : firstError(merged.stderr || merged.stdout),
  )

  // 2. 结构
  const tables = PUBLIC_TABLES
  const list = tables.map((name) => `'${name}'`).join(',')
  record(
    '十二张公开表全部建出来了',
    count(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname in (${list})`) === tables.length,
    `实际 ${count(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname in (${list})`)} / ${tables.length}`,
  )
  record(
    '十二张公开表全部开启了行级安全（RLS）',
    count(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname in (${list})`) ===
      tables.length,
    'relrowsecurity 全为真',
  )
  record(
    '十二张表保留原有 owner 策略，并各有 restrictive 门禁',
    count(`select count(distinct tablename) from pg_policies
           where schemaname = 'public' and tablename in (${list}) and permissive = 'PERMISSIVE'`) ===
      tables.length &&
    count(`select count(*) from pg_policies where schemaname = 'public' and tablename in (${list})
           and policyname = 'account_uid_gate' and permissive = 'RESTRICTIVE'
           and cmd = 'ALL' and roles = array['authenticated']::name[]
           and qual is not null and with_check is not null`) ===
      tables.length,
    '所有权和 UID allowlist 必须同时满足',
  )
  record(
    'anon 对十二张公开表没有任何表级权限',
    scalar(`select bool_and(not has_table_privilege('anon', 'public.' || t,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) from unnest(array[${list}]) t`) === 't',
  )
  record(
    'authenticated 的 profiles 只有 SELECT/UPDATE，其余十一表只有 CRUD',
    scalar(`select
      has_table_privilege('authenticated', 'public.profiles', 'SELECT')
      and has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.profiles', 'INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      and (select bool_and(
        has_table_privilege('authenticated', 'public.' || t, 'SELECT')
        and has_table_privilege('authenticated', 'public.' || t, 'INSERT')
        and has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
        and has_table_privilege('authenticated', 'public.' || t, 'DELETE')
        and not has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE,REFERENCES,TRIGGER')
      ) from unnest(array[${PUBLIC_TABLES.filter((name) => name !== 'profiles').map((name) => `'${name}'`).join(',')}]) t)`) === 't',
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
    '认证门禁及三个业务 RPC 都存在',
    count(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('account_access', 'cloud_sync_summary', 'export_cloud_snapshot', 'import_local_backup')`) === 4,
  )
  // `security definer` 会让函数以定义者的权限运行，绕过调用者的 RLS。
  // 整体替换是**用户自己的数据**之间的搬运，没有任何理由提权——
  // 一旦某个函数被写成 definer，越权就从「不可能」变成「取决于函数体写得对不对」。
  record(
    '认证门禁、业务和复制 RPC 均是 security invoker',
    count(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and not p.prosecdef
             and p.proname in ('account_access', 'cloud_sync_summary', 'export_cloud_snapshot', 'import_local_backup',
               'copy_yesterday_stage3', 'copy_yesterday_stage4')`) === 6,
    'prosecdef 全为假',
  )
  record('认证门禁及三个业务 RPC 仅授 authenticated 执行', onlyAuthenticatedExec(RPC_SIGNATURES))
  record('两个旧复制 RPC 仅授 authenticated 执行', onlyAuthenticatedExec(COPY_SIGNATURES))
  record(
    '私有门禁 lookup 固定空 search_path、无参数且仅授 authenticated 执行',
    scalar(`select p.prosecdef and p.pronargs = 0 and 'search_path=""' = any(p.proconfig)
      from pg_proc p where p.oid = 'private.is_account_allowed()'::regprocedure`) === 't' &&
      onlyAuthenticatedExec(['private.is_account_allowed()']),
  )
  record(
    'allowlist 开启 RLS，anon/authenticated/service_role 无表权限',
    scalar(`select c.relrowsecurity and not exists (
      select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
      where has_table_privilege(r, 'private.account_allowlist',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    ) from pg_class c where c.oid = 'private.account_allowlist'::regclass`) === 't',
  )
  record(
    'private schema 不向 anon/service_role 授权',
    scalar(`select not has_schema_privilege('anon', 'private', 'USAGE')
      and not has_schema_privilege('service_role', 'private', 'USAGE')`) === 't',
  )
  record(
    '私有表没有能让客户端修改 allowlist 的策略',
    count(`select count(*) from pg_policies where schemaname = 'private' and tablename = 'account_allowlist'`) === 0,
  )

  // 3. 无可信 allowlist 时，连已有合法 Auth UID 也默认拒绝。
  const gateA = JSON.parse(scalar('select public.account_access()::text', { asUser: A_ID }) ?? 'null')
  record(
    'allowlist 默认空，account_access 只返回 allowed 和 uid',
    count('select count(*) from private.account_allowlist') === 0 &&
      gateA?.allowed === false && gateA?.uid === A_ID &&
      Object.keys(gateA ?? {}).sort().join(',') === 'allowed,uid',
  )
  record('空 allowlist 下 A/B 十二张表全部不可见', visibleTotal(A_ID) === 0 && visibleTotal(B_ID) === 0)
  const emptyGateErrors = rpcRejectedFor(A_ID)
  record('空 allowlist 下三个业务 RPC 全部明确拒绝', emptyGateErrors.every((error) => error === DENIED_MESSAGE),
    emptyGateErrors.join(' · '))
  record(
    '默认拒绝后 A/B 完整数据库镜像保持原样',
    ownerImage(A_ID) === beforeGateA && ownerImage(B_ID) === beforeGateB,
  )

  const grantA = query(`insert into private.account_allowlist (user_id) values ('${A_ID}')`)
  if (grantA.code !== 0) throw new Error(firstError(grantA.err))
  const accessA = JSON.parse(scalar('select public.account_access()::text', { asUser: A_ID }) ?? 'null')
  const accessB = JSON.parse(scalar('select public.account_access()::text', { asUser: B_ID }) ?? 'null')
  record('可信 owner 授权 A 后，A allowed=true、B allowed=false',
    accessA?.allowed === true && accessA?.uid === A_ID && accessB?.allowed === false && accessB?.uid === B_ID)
  record(
    '单账号约束拒绝第二行与 singleton=false',
    (expectFailure(`insert into private.account_allowlist (user_id) values ('${B_ID}')`) ?? '').includes('duplicate key') &&
      (expectFailure(`insert into private.account_allowlist (singleton, user_id) values (false, '${B_ID}')`) ?? '')
        .includes('check constraint') &&
      count('select count(*) from private.account_allowlist') === 1,
  )
  const allowlistImage = scalar('select jsonb_agg(to_jsonb(a))::text from private.account_allowlist a')
  const clientGateWrite = expectFailure(
    `insert into private.account_allowlist (user_id) values ('${B_ID}')`, { asUser: A_ID },
  )
  record('授权客户端也不能自行修改 allowlist',
    (clientGateWrite ?? '').includes('permission denied') &&
      scalar('select jsonb_agg(to_jsonb(a))::text from private.account_allowlist a') === allowlistImage)
  record('授权 A 仅可见自己的十二条记录，B 仍完全不可见',
    visibleTotal(A_ID) === 12 && visibleTotal(B_ID) === 0)
  record('A 直接按 B UID 查询根表和父链均得到零行',
    count(`select count(*) from public.day_plans where user_id = '${B_ID}'`, { asUser: A_ID }) === 0 &&
      count(`select count(*) from public.daily_meal_items where daily_meal_id = '0e000000-0000-4000-8000-000000000002'`,
        { asUser: A_ID }) === 0)

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
    '快照的文件形状与本地备份一致（app / format / v3 / DB8）',
    snapshot?.app === 'happy-little-molly' && snapshot?.format === 'local-backup' &&
      snapshot?.version === 3 && snapshot?.db_version === 8,
    `version=${snapshot?.version} db_version=${snapshot?.db_version}`,
  )
  record(
    '快照只含当前 UID 的 W 资料，且不包含任何密码字段',
    Array.isArray(snapshot?.records?.users) && snapshot.records.users.length === 1 &&
      snapshot.records.users[0]?.id === A_ID && snapshot.records.users[0]?.username === 'W' &&
      !JSON.stringify(snapshot).includes('password'),
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
  const { parseBackup } = await import('../src/services/local/backupFormat.ts')
  let parsedSnapshot = null
  let parseError = ''
  try {
    parsedSnapshot = parseBackup(JSON.stringify(snapshot), 8)
  } catch (error) {
    parseError = `${error.message} ${error.details ?? ''}`
  }
  record(
    '真实 SQL 快照通过本地 parseBackup 全量校验',
    parsedSnapshot?.summary.total === 10 && parsedSnapshot?.records.users?.[0]?.id === A_ID,
    parseError || `total=${parsedSnapshot?.summary.total}`,
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
  const beforeRejectImage = ownerImage(A_ID)
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
    [
      '仓库不是数组',
      '备份仓库内容必须是数组',
      { app: 'happy-little-molly', format: 'local-backup', version: 3, records: { day_plans: {} } },
    ],
  ]
  for (const [label, expected, payload] of rejects) {
    const error = expectFailure(`select public.import_local_backup(${jsonb(payload)})`, { asUser: A_ID })
    record(`坏 payload 被拒（${label}）`, error === expected, error ?? '（竟然被接受了）')
  }
  record(
    '所有格式拒绝之后，完整数据库镜像一点没变',
    beforeRejectImage !== null && ownerImage(A_ID) === beforeRejectImage,
  )
  const invalidBusiness = backupFixture()
  invalidBusiness.records.day_plans[0].mode = 'invalid'
  const failedReplace = expectFailure(
    `select public.import_local_backup(${jsonb(invalidBusiness)})`, { asUser: A_ID },
  )
  record(
    '删除和部分插入后遇到业务约束错误，整次替换事务回滚',
    (failedReplace ?? '').includes('check constraint') && ownerImage(A_ID) === beforeRejectImage,
    failedReplace ?? '（竟然被接受了）',
  )

  // 8. B 有自己的完整旧数据，仍不能依赖旧 JWT、元数据或旧 RPC 绕过 allowlist。
  record(
    'B 的三个业务 RPC 均以未授权拒绝，不能导入自己的备份',
    rpcRejectedFor(B_ID).every((error) => error === DENIED_MESSAGE),
  )
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
  const ownUnauthorized = expectFailure(
    `insert into public.food_options (user_id, name) values ('${B_ID}', 'blocked-own')`, { asUser: B_ID },
  )
  const probeUnauthorized = expectFailure(
    `insert into public.sync_test_records (user_id, content) values ('${B_ID}', 'blocked-probe')`, { asUser: B_ID },
  )
  record(
    'B 给自己的根表和诊断表写入也被 RLS 拒绝',
    (ownUnauthorized ?? '').includes('row-level security') &&
      (probeUnauthorized ?? '').includes('row-level security'),
  )
  const bUpdate = count(
    `with affected as (
      update public.food_options set name = 'forged-update' where user_id = '${B_ID}' returning 1
    ) select count(*) from affected`,
    { asUser: B_ID },
  )
  const bDelete = count(
    `with affected as (
      delete from public.sync_test_records where user_id = '${B_ID}' returning 1
    ) select count(*) from affected`,
    { asUser: B_ID },
  )
  const bProfile = count(
    `with affected as (
      update public.profiles set created_at = now() where user_id = '${B_ID}' returning 1
    ) select count(*) from affected`,
    { asUser: B_ID },
  )
  record(
    'B 更新/删除自己的已有数据与资料均被 RLS 过滤为零行，且不影响任何旧行',
    [bUpdate, bDelete, bProfile].every((affected) => affected === 0) &&
      ownerImage(B_ID) === beforeGateB && ownerImage(A_ID) === beforeRejectImage,
    `更新 ${bUpdate} 行 · 删除 ${bDelete} 行 · 资料 ${bProfile} 行`,
  )
  const bCopies = COPY_SIGNATURES.map((signature) =>
    expectFailure(`select ${signature.replace('(date)', `('${FUTURE_DATE}'::date + 1)`)}`, { asUser: B_ID }),
  )
  record(
    'B 的两个旧复制 RPC 看不到自己的旧来源计划，且零写入',
    bCopies.every((error) => error === '昨天没有可复制的计划') &&
      ownerImage(B_ID) === beforeGateB && ownerImage(A_ID) === beforeRejectImage,
    bCopies.join(' · '),
  )
  const renameMetadata = query(
    `update auth.users set raw_user_meta_data = '{"username":"W","allowed":true}'::jsonb where id = '${B_ID}'`,
  )
  record('B 伪造 W 的 user_metadata 不改变 UID 门禁',
    renameMetadata.code === 0 &&
      JSON.parse(scalar('select public.account_access()::text', { asUser: B_ID }) ?? 'null')?.allowed === false)

  // 9. 授权 A 的父链和来源选项必须仍然属于 A。
  const futureGraph = backupFixture()
  futureGraph.records.day_plans[0].plan_date = '2099-06-10'
  futureGraph.records.daily_exercise_items[0].exercise_option_id = futureGraph.records.exercise_options[0].id
  const futureImported = JSON.parse(importBackup(futureGraph, { asUser: A_ID }) ?? 'null')
  record('授权 A 合法的完整父链和来源选项正常放行', futureImported?.total === 10)
  const beforeCrossA = ownerImage(A_ID)
  const beforeCrossB = ownerImage(B_ID)
  const ownershipRejected = (error) =>
    error === '无权访问日期计划' || (error ?? '').includes('row-level security')
  const wrongParents = [
    ['三餐', `insert into public.daily_meals (day_plan_id, meal_type) values
      ('0d000000-0000-4000-8000-000000000002', 'lunch')`],
    ['自定义任务', `insert into public.custom_tasks (day_plan_id, task_time, title) values
      ('0d000000-0000-4000-8000-000000000002', '05:00', 'forged-task')`],
    ['补剂', `insert into public.daily_supplements (day_plan_id, name_snapshot, period) values
      ('0d000000-0000-4000-8000-000000000002', 'forged-supplement', 'morning')`],
    ['运动项', `insert into public.daily_exercise_items (day_plan_id, name_snapshot) values
      ('0d000000-0000-4000-8000-000000000002', 'forged-exercise')`],
    ['例行任务', `insert into public.routine_tasks (day_plan_id, kind, title) values
      ('0d000000-0000-4000-8000-000000000002', 'laundry', 'forged-routine')`],
    ['餐次内容', `insert into public.daily_meal_items (daily_meal_id, food_name_snapshot) values
      ('0e000000-0000-4000-8000-000000000002', 'forged-meal')`],
  ]
  for (const [name, sql] of wrongParents) {
    const error = expectFailure(sql, { asUser: A_ID })
    record(`A 的${name}跨 B 父链被拒绝`, ownershipRejected(error), error ?? '（竟然成功了）')
  }
  const foodCross = expectFailure(
    `update public.daily_meal_items set food_option_id = '0f000000-0000-4000-8000-000000000002'
     where id = '0a000000-0000-4000-8000-000000000001'`, { asUser: A_ID },
  )
  const exerciseCross = expectFailure(
    `update public.daily_exercise_items set exercise_option_id = '07000000-0000-4000-8000-000000000002'
     where id = '09000000-0000-4000-8000-000000000001'`, { asUser: A_ID },
  )
  record(
    'A 的餐次引用 B 食物选项被服务端拒绝',
    foodCross === '餐次的食物选项不属于当前账号',
    foodCross ?? '（竟然成功了）',
  )
  record(
    'A 的运动项引用 B 运动选项被服务端拒绝',
    exerciseCross === '健身项目的选项不属于当前账号',
    exerciseCross ?? '（竟然成功了）',
  )
  const reassigned = expectFailure(`update public.day_plans set user_id = '${B_ID}'
    where id = '0d000000-0000-4000-8000-000000000001'`, { asUser: A_ID })
  record('A 的 UPDATE 不能把已有根记录改属 B', (reassigned ?? '').includes('row-level security'))
  const reassignedMeal = expectFailure(`update public.daily_meals
    set day_plan_id = '0d000000-0000-4000-8000-000000000002'
    where id = '0e000000-0000-4000-8000-000000000001'`, { asUser: A_ID })
  record('A 的 UPDATE 不能把已有子记录挂到 B', ownershipRejected(reassignedMeal))
  record('全部跨 owner 直接写入拒绝后，A/B 完整镜像不变',
    beforeCrossA !== null && beforeCrossB !== null &&
      ownerImage(A_ID) === beforeCrossA && ownerImage(B_ID) === beforeCrossB)

  const foreignParentBackup = structuredClone(futureGraph)
  foreignParentBackup.records.custom_tasks[0].day_plan_id = '0d000000-0000-4000-8000-000000000002'
  const parentImportError = expectFailure(
    `select public.import_local_backup(${jsonb(foreignParentBackup)})`, { asUser: A_ID },
  )
  record('RPC 备份跨 B 父链被拒，删除/部分插入也完整回滚',
    ownershipRejected(parentImportError) && ownerImage(A_ID) === beforeCrossA &&
      ownerImage(B_ID) === beforeCrossB)
  const collidedBackup = structuredClone(futureGraph)
  collidedBackup.records.food_options[0].id = '0f000000-0000-4000-8000-000000000002'
  collidedBackup.records.daily_meal_items[0].food_option_id = collidedBackup.records.food_options[0].id
  const collisionError = expectFailure(
    `select public.import_local_backup(${jsonb(collidedBackup)})`, { asUser: A_ID },
  )
  record('RPC 备份不能覆盖 B 的同主键记录，且零写入',
    (collisionError ?? '').includes('duplicate key') && ownerImage(A_ID) === beforeCrossA &&
      ownerImage(B_ID) === beforeCrossB)

  const deletedOptions = query(
    `delete from public.food_options where id = '0f000000-0000-4000-8000-000000000001';
     delete from public.exercise_options where id = '07000000-0000-4000-8000-000000000001'`, { asUser: A_ID },
  )
  record('合法来源选项删除后 SET NULL，餐次和运动名称快照仍保留',
    deletedOptions.code === 0 &&
      scalar(`select (food_option_id is null)::text || '/' || food_name_snapshot
        from public.daily_meal_items where id = '0a000000-0000-4000-8000-000000000001'`,
        { asUser: A_ID }) === 'true/燕麦' &&
      scalar(`select (exercise_option_id is null)::text || '/' || name_snapshot
        from public.daily_exercise_items where id = '09000000-0000-4000-8000-000000000001'`,
        { asUser: A_ID }) === 'true/散步',
    deletedOptions.code === 0 ? '两个选项均已删除，子记录仍在' : firstError(deletedOptions.err))

  // 10. 旧备份身份只是输入资料，不能创建账号或切换 trusted allowlist。
  const authCount = count('select count(*) from auth.users')
  for (const version of [1, 2]) {
    const oldFile = legacyFixture(A_ID)
    const oldOwner = '33333333-3333-4333-8333-333333333333'
    oldFile.version = version
    oldFile.records.users[0] = {
      id: oldOwner,
      ...(version === 1 ? { email: 'untrusted@example.invalid' } : { username: 'untrusted' }),
      password_hash: 'local-fixture-legacy',
      created_at: oldFile.records.users[0].created_at,
    }
    for (const rows of Object.values(oldFile.records)) {
      for (const row of rows) if ('user_id' in row) row.user_id = oldOwner
    }
    const oldResult = JSON.parse(importBackup(oldFile, { asUser: A_ID }) ?? 'null')
    record(`v${version} 旧备份仅恢复业务数据并重归当前 Auth UID`,
      oldResult?.total === 10 && count('select count(*) from auth.users') === authCount &&
        count(`select count(*) from public.day_plans where user_id = '${A_ID}'`, { asUser: A_ID }) === 1 &&
        scalar('select jsonb_agg(to_jsonb(a))::text from private.account_allowlist a') === allowlistImage)
  }
  const afterLegacy = JSON.parse(scalar('select public.export_cloud_snapshot()::text', { asUser: A_ID }) ?? 'null')
  record('旧身份不能改变新快照的 W 资料和 UID，也不会重新导出旧密码',
    afterLegacy?.records.users?.[0]?.username === 'W' && afterLegacy?.records.users?.[0]?.id === A_ID &&
      !JSON.stringify(afterLegacy).includes('password'))
  record('A 的多次完整替换始终保持 B 的旧数据原样', ownerImage(B_ID) === beforeGateB)

  // 11. 授权撤销即时生效；相同 UID/JWT 上下文不能靠旧声明继续访问。
  const beforeRevoked = ownerImage(A_ID)
  const revokeA = query('delete from private.account_allowlist')
  if (revokeA.code !== 0) throw new Error(firstError(revokeA.err))
  const revokedGate = JSON.parse(scalar('select public.account_access()::text', { asUser: A_ID }) ?? 'null')
  record('撤销 allowlist 后同一 UID 立即 allowed=false，十二表均不可见',
    revokedGate?.allowed === false && revokedGate?.uid === A_ID && visibleTotal(A_ID) === 0)
  record('撤销后同一 UID 的三个业务 RPC 均明确拒绝',
    rpcRejectedFor(A_ID).every((error) => error === DENIED_MESSAGE))
  const revokedWrite = expectFailure(
    `insert into public.food_options (user_id, name) values ('${A_ID}', 'revoked')`, { asUser: A_ID },
  )
  record('撤销后的直接写入被 RLS 拒绝，A/B 原数据不变',
    (revokedWrite ?? '').includes('row-level security') &&
      ownerImage(A_ID) === beforeRevoked && ownerImage(B_ID) === beforeGateB)
  const restoreA = query(`insert into private.account_allowlist (user_id) values ('${A_ID}')`)
  record('可信 owner 恢复授权后原数据重新可用',
    restoreA.code === 0 && JSON.parse(summaryOf({ asUser: A_ID }) ?? 'null')?.total === 10 &&
      ownerImage(A_ID) === beforeRevoked)

  // 12. service_role 的管理员表访问不冒充客户端能力；它没有这些应用 RPC 的 EXECUTE。
  const privateCalls = [
    'select public.account_access()', 'select public.cloud_sync_summary()', 'select public.export_cloud_snapshot()',
    `select public.import_local_backup(${jsonb(backupFixture())})`,
    `select public.copy_yesterday_stage3('${FUTURE_DATE}'::date + 1)`,
    `select public.copy_yesterday_stage4('${FUTURE_DATE}'::date + 1)`,
    'select private.is_account_allowed()',
  ]
  for (const role of ['anon', 'service_role']) {
    const errors = privateCalls.map((sql) => expectFailure(sql, { role }))
    record(`${role} 不能执行认证、业务、复制 RPC 或私有 lookup`,
      errors.every((error) => (error ?? '').includes('permission denied')), errors.join(' · '))
  }
  const noUid = expectFailure('select public.cloud_sync_summary()', { role: 'authenticated' })
  record('authenticated 角色缺少 Auth UID 时不能访问业务 RPC', noUid === '未登录云端账号')

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
