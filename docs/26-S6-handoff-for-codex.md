# 幸福小Molly · S6 交接文档（给 Codex）

> 这份文档是**自包含**的：你没看过之前的对话，读完这一份就能接手。
> 项目路径：`D:\WJKHome\小人项目包\littlemolly-main`
> 交接时间：2026-09-20（2026-09-21 全量复验并补记 `verify:sql` 的假失败修复）。上一份阶段报告是 `docs/25-S5-completion-report.md`。

---

## 0. 一句话状态

**S1–S5 全部完成，本机九套验收全绿。只剩 S6（部署与真机验收）。**

S6 唯一的阻塞是**真实 Supabase 凭据**（项目里没有 `.env.local`）。
**代码侧的部署配置（S6-T1 / T2）已于 2026-09-20 落地**——`vercel.json` 与 `public/_headers`
都已就位，并有四条断言守着（`verify:pwa` 49 项）。所以现在**真的没有代码可写了**，
剩下的三件事（T3 / T4 / T5）全部需要凭据或真机。拿到凭据后按 §5.2 执行。

如果你要解决的就是这件事，直接跳到 **§5**。

---

## 1. 项目是什么

一个**本地优先 + 云端可选**的个人日程 PWA（React 19 + TypeScript + Vite + IndexedDB + Supabase）。

- **本地 IndexedDB 恒为唯一写入落点**。云端只是可选上行通道——`capabilities.ts` 的
  `DATA_BACKEND` 是常量 `'local'`，不是配置。
- 每次写入自动进待上传队列并被推送到云端（S4）。
- 另有两个**用户手动触发**的整体替换：「上传本地数据到云端」/「从云端恢复到本地」（S5）。
- **不做自动下载**（一期范围边界）。所以界面绝不能说「已同步」。
- **本地账号是应用身份**，云端账号是侧挂的绑定关系（决策 D5）。账号名被映射成合成邮箱
  `<账号>@molly.local`（`src/services/cloud/identity.ts`）。

数据规模：13 张 IndexedDB 仓库（10 张用户数据 + `users` + 两张设备状态表），`DB_VERSION = 7`。
云端 10 张业务表，全部开了 RLS。

---

## 2. 当前基线（**全部实测**，改完之后必须仍然全绿）

| 命令 | 项数 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | — | `tsc -b` |
| `npm run lint` | — | `eslint .` |
| `npm run check:dates` | 48 | 日期引擎 |
| `npm run check:local-data` | 62 | IndexedDB 结构 |
| `npm run check:backup` | 62 | 备份格式 |
| `npm run check:cloud-parity` | **78** | 页面接口清单 / 传输层 / 云端 SQL 的对应关系（10 组） |
| `npm run check:sync` | **113** | 同步规则的纯函数回归（14 组） |
| `npm run verify:local` | 125 | 真实浏览器闭环（自带临时 dev server + 无头浏览器） |
| `npm run verify:pwa` | 49 | 跑**生产构建产物** + 部署配置 |
| `npm run verify:sync` | **74** | 假云端 + CDP 拦截 |
| `npm run verify:sql` | **39** | **起临时 PostgreSQL 真跑六个迁移**（需本机 PostgreSQL 16+） |

`npm run build` 也要能过。**`verify:sql` 故意不在 `all` 里**——它需要本机装 PostgreSQL。

**项数变了要同步四处**：`README.md` 的命令清单、`scripts/launcher.mjs` 的 `note`、
`docs/19-sync-execution-plan.md` §4 的基线表、`HANDOFF.md` 的「当前基线」一句话。

---

## 3. 环境准备

```bash
cd "D:\WJKHome\小人项目包\littlemolly-main"
npm install          # 依赖已装的话可跳过
```

本机运行时（沙箱管理的版本，优先用绝对路径）：
- Node `C:\Users\Administrator\.workbuddy-ai\binaries\node\versions\22.22.2-2\node.exe`
- Python `C:\Users\Administrator\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe`
- PostgreSQL 16 在 `C:/Program Files/PostgreSQL/16/bin`（`verify:sql` 需要它；
  可用 `MOLLY_PG_BIN` 指定别的 bin 目录）

**`.git` 在本机不可用**（`git rev-parse` 报 not a git repository，且 git 写操作被沙箱拦）。
=> **没有回滚**。删除文件前先 `cp -r` 到 `.workbuddy-ai/backup/<说明>/` 并核对行数。

---

## 4. 改之前必须知道的硬规则（违反就会坏，而且验收不一定报得出来）

### 4.1 数据层

- **IndexedDB 迁移只追加**，绝不改写旧版本迁移。新增仓库要同时改五处：`LocalStore` 类型、
  `STORES` 定义、`DB_VERSION`、`MIGRATIONS` 登记、`recordSchemas.ts` 的 `STORE_KIND` 与
  `RECORD_SCHEMAS`（`localDb.ts` 顶部注释有完整清单）。三分类表是 `Record<LocalStore, ...>`，
  漏一张编译不过。
- **界面层只 import `src/services/api/` 门面**，不得直接引用 `localDb` / `indexedDB` / 云端 SDK
  （`check:local-data` 会扫）。
- **Supabase 环境变量只在 `src/services/capabilities.ts` 读一次**，其他文件从它取值。
- `services/cloud/` **只有四个模块**：`errors` / `identity` / `rpc` / `supabase`。
  它们是同步层的传输通道，只允许被 `services/sync/` 引用，且 `api/syncService.ts` 必须
  用 `await import()` 转发（`check:cloud-parity` 第 2、6 组断言）。
  **不要加回任何「云端 xxxService」**——那批 L6 适配器已整批删除（1156 行），
  理由见 `docs/23` §2.6。
- **并发读-改-写一律走 `readModifyWrite`**，不要「先查再写」。IndexedDB 事务在创建那刻就开始，
  同一仓库的 readwrite 事务串行；跨两次调用会撞唯一索引（实测报
  `Unable to add key to index 'user_date'`）。
- 备份导入**必须先全量校验**：`parseBackup` 返回即代表整份可用，此前一条都没写。

### 4.2 同步层

- 四个写入口 `put` / `remove` / `runTransaction` / `readModifyWrite` 带 `{ track?, owner? }`，
  默认同事务内追加 `sync_outbox`；`track:false` 只给三类：outbox 自身、迁移搬迁、云端恢复。
- 队列条目带 `local_user_id`。推送/计数/清空先过 `entriesOfOwner(entries, owner)`，
  **owner 为 `null` 时返回空数组**（不是全部）。
- `runTransaction` 的 `clear` 命中用户数据仓库时**必须显式 `track:false`**，否则抛错。
- 推送三条铁律：① 推送前按 `record_id` **回主表读当前行**（队列只有引用）；
  ② **先发完全部 delete 再发全部 upsert**，且**先排序再截断**；
  ③ 失败就是**整批失败**，不做「部分成功」。
- **调度器是全局单例，接线点必须在 `src/main.tsx`**，不能放 React effect（会撞 StrictMode
  的「挂载→卸载→再挂载」，调度器静默失效而界面一切正常）。
- `sync/status.ts` 必须**纯本地**：「云端现在多少条」只在用户主动点按钮时才去问。
- **绑定云端账号 ≠ 登录**（决策 D5）：`sync/accountLink.ts` 自己调 `supabase.auth.*`，
  不复用任何会把云端用户写进本地会话镜像的路径——那样用户会被「换成」云端账号，
  本地数据一条没丢但所有按 `user_id` 过滤的查询全部落空（看起来像「数据全没了」）。

### 4.3 文案纪律（这是产品原则，不是措辞偏好）

- **绝不伪装成功**。本地保存 ≠ 云端同步成功，两套文案永远分开。
- 队列排空也**不说「已同步」**——那只证明本机变更都发出去了，不证明云端与本地一致。
- 整体替换**说「替换」，不说「同步」**；「不可撤销」必须出现，且要说清哪一边会丢。
- 完成后只说**已经发生的事**（哪一边被换成了什么、多少条）。

### 4.4 字段改名 / 字段级改动的全链路（一个都不能漏）

1. `src/shared/types/*.ts` 2. `src/shared/` 共享规则 3. `local/localDb.ts`（索引 + 迁移，
   **字段改名与索引换名必须同进同退**）4. `local/recordSchemas.ts` 5. `local/backupFormat.ts`
   （格式 + 版本提升 + 旧版本兼容读入）6. `local/backupService.ts` 7. `sync/mapper.ts`
   8. 界面层字段名 + 文案 9. **四套脚本**：`check-local-data` / `check-backup` / `verify-local` /
   `verify-pwa` 10. `README.md` + `HANDOFF.md`（活文档；`docs/0x-*-report.md` 是历史记录，不改）

---

## 5. 你现在要做的：S6

S6 任务表（`docs/19` §5）：

| 任务 | 内容 | 需要凭据？ |
| --- | --- | --- |
| S6-T1 | ~~`vercel.json`：SPA rewrite + `/sw.js` 与 manifest 的 `Cache-Control: no-cache` + `/assets/*` 长缓存~~ **已完成** | 否 |
| S6-T2 | ~~`public/_headers`（同缓存规则），为 Cloudflare Pages 备好~~ **已完成**；**`public/_redirects` 刻意不写** | 否 |
| S6-T3 | Supabase：Auth 的 `Site URL` / `Redirect URLs` 域名白名单；**关闭邮箱验证**（或配好 SMTP）；确认只用 anon key | 是 |
| S6-T4 | 按 `docs/18 §9.3` 跑真实凭据人工清单 | 是 |
| S6-T5 | 文档收口：`README.md`、`HANDOFF.md`、`docs/28-S6-completion-report.md` | 部分 |

### 5.1 T1 / T2 已完成（2026-09-20），别重做

`vercel.json`（仓库根）与 `public/_headers` 都已就位，并由 `verify:pwa` 的四条断言守着
（43 → 49 项）。**改动它们之前先看那四条断言**，它们是：

1. `vercel.json` 里有一条通配 rewrite 指向 `/index.html`（SPA 深链接回退）。
2. 两份配置的缓存口径一致，且 `_headers` 确实进了 `dist/`：`/sw.js` 与 `/manifest.webmanifest`
   与 `/index.html` 一律 `no-cache`，`/assets/*` 一年 `immutable`。
3. 产物里**没有**顶层 `404.html`（有的话会静默关掉 Cloudflare 的内置 SPA 回退，深链接从此 404）。
4. 产物里**没有** `_redirects`。

**关于第 4 条（反直觉，务必先读再动）**：`docs/19` 的计划原文写着要建
`public/_redirects` 含一行 `/* /index.html 200`。**实际刻意不建**，依据是 Cloudflare 官方文档原文：

> Redirects defined in `_redirects` are **always executed, whether or not there is a matching static asset**.

一条 catch-all 因此会把 `/sw.js` 与 `/assets/*` **一起改写**成 `index.html`——
浏览器拿一份 HTML 当 JS 解析，**整站白屏**，而本地怎么跑都看不出来。
Cloudflare Pages 在没有顶层 `404.html` 时自带 SPA 回退，本来就不需要 `_redirects`。
**要加回它，先确认规则不会命中 `/sw.js` 与 `/assets/*`，并同步改掉那条断言。**

另外注意：service worker 与 manifest **绝不能被长缓存**（否则用户永远拿不到新版本），
`/assets/*` 才长缓存（文件名带内容哈希）。

改完跑 `npm run build` + `npm run verify:pwa`（49 项必须全绿）。

### 5.2 拿到凭据后的执行顺序

**第 0 步：建 `.env.local`**（仓库里有 `.env.example`）

```bash
cp .env.example .env.local
```

填两个值：

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co     # 结尾不要带斜杠
VITE_SUPABASE_ANON_KEY=<anon key>
```

只用 **anon key**，绝不用 service role key（这个项目没有服务端）。

**第 1 步：在 Supabase SQL Editor 里按文件名顺序执行六个迁移**

`database/migrations/` 下按序执行（顺序不能乱，它们有依赖）：

```
202608270001_stage1_auth_sync.sql
202608310001_stage2_day_plans.sql
202608310002_stage3_workday_planning.sql
202609160001_stage4_local_parity.sql
202609200001_stage5_sync.sql
202609200002_stage6_replace.sql
```

> **省事的做法**：用 `deploy/supabase-all-migrations.sql`——这 6 个文件按序合并成的单文件，
> 一次粘贴、一次 Run 即可。它已在本机真库验证过（退出码 0 / 12 张基表 / 三个 RPC / 21 条策略）。
> 完整的人工部署步骤（含 Vercel 与环境变量）见根目录 **`DEPLOY.md`**。

执行前可以先用本机真库验证一遍：`npm run verify:sql`（它会起临时 PostgreSQL 把这六个
**真的跑一遍**）。它跑通 = 迁移本身没有语法/顺序问题。

**第 2 步：Auth 配置**

- Authentication → URL Configuration：`Site URL` 与 `Redirect URLs` 加上你的部署域名。
- **关闭邮箱验证**（或配好 SMTP）。不关的话 `signUp` 拿不到会话——
  适配器会明确报错，不会假装登录成功。

**第 3 步：刷新 PostgREST 的 schema cache**（这一步最容易忘）

新建的函数不会立刻出现在 schema cache 里，前端会报
`Could not find the function 'public.import_local_backup(payload)' in the schema cache`。
Supabase 控制台 → Project Settings → API → **Reload schema cache**，
或者在 SQL Editor 里跑 `notify pgrst, 'reload schema';`。

**第 4 步：跑完整往返**（`docs/18 §9.3` 的 8 条，逐项打勾）

1. 六个迁移在真实项目按序执行成功，表 / 策略 / 触发器齐备。
2. 关闭邮箱验证后：连接云端账号 → 上传 → 退出 → 重新登录 → 状态恢复。
3. **RLS 双账号**：账号 B 看不到账号 A 的任何数据（含子表），直接构造越权查询被拒。
4. **断网**：写入本地成功、上传显示失败、恢复网络后自动补推成功。
5. **历史日期**：上传含历史计划的备份必须成功（这是 GUC 豁免的主路径验证）。
6. **整体替换往返**：本地 → 云端 → 清空本地 → 云端 → 本地，逐项核对历史计划、
   名称快照、准备与执行状态。
7. 真机：Vercel 域名装 PWA，走完整流程；确认底部导航不被 Home 指示条遮挡。
8. 两个部署平台各自冒烟（若上两个）。

**第 5 步：文档收口**

写 `docs/28-S6-completion-report.md`（沿用 `docs/20`–`docs/25` 的体例），
并同步 `README.md`、`HANDOFF.md`、`docs/19` §7（「当前下一步」）。

> `docs/27` 已被**部署说明书**占用（`docs/27-deploy-runbook-for-codex.md`），所以完成报告顺延到 `docs/28`。

---

## 6. 真实项目上的已知风险（本机验不出来，出问题先怀疑这几条）

| 风险 | 症状 | 怎么确认 |
| --- | --- | --- |
| **PostgREST schema cache 没刷新** | `Could not find the function 'public.xxx' in the schema cache` | 见 §5.2 第 3 步 |
| **`stage1` 要在 `auth.users` 上建 trigger**（`on_auth_user_created`） | 权限不足 → 迁移失败 | Supabase 的 SQL Editor 以 `postgres` 运行，通常可行；报错就贴出来判断 |
| **anon 角色的默认授权** | `revoke all ... from public` 收不回 Supabase 给 `anon` 的显式授权 | **不用修**：三个 RPC 内部会因 `auth.uid()` 为空抛「未登录云端账号」，拿不到数据（`verify:sql` 已断言） |
| **自定义 GUC `molly.allow_history`** | `set local molly.allow_history = 'on'` 被拒 | 自定义命名空间的 GUC 在 Supabase 上是允许的；它只在事务内生效（`set local`），不会泄漏 |
| **`export_cloud_snapshot` 的 `to_jsonb` 体积** | 大数据量下 RPC 返回慢 | 免费额度项目数据量小，暂不构成问题 |
| **免费项目长时间无活动会被暂停** | 连接失败 | 不是缺陷，恢复即可 |

---

## 7. 踩过的坑（别重犯）

### 7.1 写验收脚本

- **绝不假定「今天是工作日」**。`defaultModeForDate` 周六 / 周日休息。派生坑（全踩过）：
  休息日不挂工作日准备项；`useDayPlanData` 会为非历史休息日自动建 rest 计划
  （「空计划」根本不空）；布局阈值在休息日量出来会差 1px 假失败。
  正确做法：先判定再分支（`verify-local.mjs` 的 `tomorrowIsRestDay()`），
  或先把目标日切成工作日（`verify-pwa.mjs` 的 `ENSURE_WORKDAY`）。
- **new 断言必须做反证**：刚写完就绿的断言可能「怎么写都绿」。
  把输入临时拿掉再跑，确认它真的红、且失败信息指向预期对象，再放回。
- 批量改脚本后先 `node --check <file>` 再跑。
- **`verify:pwa` 里的两次构建必须走 `npm run build:no-empty`，不许删 `dist/`。**
  Vite 默认会在 build 开始时清空 `dist/`；在受沙箱保护的机器上那是「一轮内递归删掉几十个文件」，
  会被 `safe-delete` 的批量保护拦下（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，阈值 50、**按 turn 累计**）。
  症状极具误导性：脚本在浏览器阶段**全绿**之后倒在最后一步，报「`npm run build` 退出码 1」
  加一段被截断的 Vite 堆栈，看起来像项目自己的 bug。**自己 `rmSync(dist)` 同样中招。**
  正确做法是往已有 `dist/` 上覆盖写——新产物带新内容哈希，旧文件留着不违反任何断言。
- **`runNpm()` 的失败信息只保留最后 500 字符**，会把真正的根因截掉。
  排查构建失败时，先让完整输出落盘再看，别只看抛出来的那行。
- `record(name, ok, detail)` 是三个参数，把期望值当第三参传会静默 FAIL。
- 「不许出现某个写法」的静态断言，先 `replace(/\/\*[\s\S]*?\*\//g, '')` 剥掉块注释再判断。

### 7.2 `verify:sql`（如果你要改它）

- **`query()` 的超时绝不能当成「SQL 被拒」**（2026-09-21 修）。`query()` 用 `spawnSync` 跑 psql
  且带 `timeout: 60_000`，但**漏了 `result.error` 检查**（`run()` 有，`query()` 没有）。
  超时时 `status` 是 `null`，被 `code: result.status ?? 1` 落成 `1` —— 于是 `count()` 得到 0、
  `scalar()` 得到 null、`expectFailure()` 得到「（无错误信息）」，一连串断言以**业务规则错误**
  的形式报红，真正的原因（机器被压满、60s 超时）一个字都看不到。
  **实测**：`verify:sql` 与 `verify:local` / `verify:sync` **并行**跑时命中过
  （两个 Chrome + 两个 Vite + PostgreSQL 抢 CPU），报出 6 条「替换 / 历史豁免」失败；
  单独跑 8 次全绿。修法：`query()` 里显式检查 `result.error || result.signal || result.status === null`
  并**抛错**——基础设施故障就该以基础设施故障的样子失败。
  **反证**：把超时压到 1ms，带修复时报 `psql 未能正常执行（ETIMEDOUT）`；去掉修复时同样条件
  报出一长串假失败。
  → **推论：`verify:sql` 不要与其它验收脚本并行跑。** 串行既更快也更可信。
- **`pg_isready` 没有 `-X` 选项**（那是 `psql` 的）。写错会让就绪探测每次都失败，
  报「启动超时」，而服务器日志证明数据库早就起来了。
- **Windows 版 `psql` 的 stdout 是 CRLF**。多行输出 `split('\n')` 后每行末尾留一个不可见的 `\r`，
  逐行比对会**整片假失败**（打印出来两侧字符串一模一样）。归一放在 `query()` 一处。
- **快照里没有行的表，字段集合是空的**——比对失败看起来像「字段清单与契约分叉」，
  其实是夹具没覆盖到这张表。所以另立了一条「夹具覆盖了快照里的每一张表」把两类失败分开。
  改夹具时**必须给每一张用户数据表都留一条数据**。
- **SQL 走临时文件而不是 `-c` 参数**：Windows 上 Node 传给子进程的 argv 会被转成当前代码页
  （中文机器是 GBK）的窄字节，而 psql 按 `client_encoding` 解码，两边不一致会让中文夹具
  以 `invalid byte sequence for encoding "UTF8"` 失败。

### 7.3 编辑文件

**同一文件的多个 Edit 不要放在同一条消息里**（并行执行、后写回的赢，而每个都返回成功）。
一次一个 Edit，改完用 `grep -c "关键字符串"` 回读确认。这条规律在同一个会话里反复应验过。

---

## 8. 改完怎么验

最小集（改了源码）：

```bash
npm run typecheck && npm run lint
npm run check:dates && npm run check:local-data && npm run check:backup && npm run check:cloud-parity && npm run check:sync
npm run verify:local
```

改了 PWA 外壳 / manifest / 图标 / 注册逻辑 / **部署配置（`vercel.json` / `public/_headers`）**
→ 追加 `npm run verify:pwa`
改了 `services/sync/` / `outboxRules.ts` / `localDb` 写入钩子 / 同步文案 → 追加 `npm run verify:sync`
改了 `database/migrations/` 或三个云端 RPC → 追加 `npm run verify:sql`

交付前跑一次全量：`node scripts/launcher.mjs 12`（`all`），
它不含 `verify:sql`——那项要单独跑（`node scripts/launcher.mjs 11`）。

双击 `launch.cmd` 或 `node scripts/launcher.mjs` 可以开菜单，`--list` 看全部任务。

---

## 9. 文件地图

| 路径 | 是什么 |
| --- | --- |
| `docs/19-sync-execution-plan.md` | **现行执行任务线 S1–S6**（唯一依据）。§4 验收基线、§5 任务表、§7 当前下一步 |
| `docs/18-sync-architecture-plan.md` | 方案定稿。§9.3 是真实凭据人工清单，§10 是五个决策点与已知风险 |
| `docs/25-S5-completion-report.md` | S5 完成报告。**§6「未验证项」就是你现在要做的全部工作** |
| `docs/24-two-defect-fixes-report.md` | 两处业务缺陷的定案（并发建计划 / 换账号串推）。§5 是已知残余 |
| `HANDOFF.md` | 近千行的活交接文档（顶部是最新进度，往下是历史） |
| `README.md` | 命令清单与各验收脚本的详细说明 |
| `src/services/capabilities.ts` | 能力声明。**Supabase 环境变量唯一读取点** |
| `src/services/api/` | 四个门面。页面只许 import 这里 |
| `src/services/local/localDb.ts` | IndexedDB。顶部注释有「新增仓库要改五处」的完整清单 |
| `src/services/local/recordSchemas.ts` | 字段契约 + 仓库三分类。严格模式拒绝未定义字段 |
| `src/services/sync/` | 同步引擎。纯规则在 `outboxRules.ts` / `bindingRules.ts` / `replaceRules.ts`（这三个能被 Node 直接 import 做回归） |
| `database/migrations/` | 六个只追加迁移 |
| `DEPLOY.md` | **部署操作指南**（Supabase + Vercel 逐步点击说明、环境变量、自检清单） |
| `deploy/supabase-all-migrations.sql` | 六个迁移按序合并成的**单文件**，一次粘贴即可（已在真库验证） |
| `vercel.json` | Vercel 部署配置：SPA 回退 + 四条缓存头（S6-T1，已就位） |
| `public/_headers` | Cloudflare Pages 的缓存规则（S6-T2，已就位）。**`public/_redirects` 刻意不存在**，别加 |
| `scripts/` | 九套验收脚本 |

---

## 10. 一句话提醒

这个项目**最容易被改坏的不是功能，是「诚实性」**：本地保存说成云端同步成功、
队列排空说成已同步、替换失败却显示「已替换」——这些在 `typecheck` / `lint` / `build` 下
全部不会报错，只有那套断言会拦。改任何文案或状态显示之前，先问一句：
**这句话是事实吗？说得出证据吗？**
