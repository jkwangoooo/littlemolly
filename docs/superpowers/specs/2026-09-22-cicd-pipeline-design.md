# 「幸福小Molly」持续交付流水线 · 设计定稿

> 日期：2026-09-22
> 项目：`D:\WJKHome\小人项目包\littlemolly-main`
> 上游文档：`docs/26-S6-handoff-for-codex.md`（项目全貌与硬规则）、`docs/27-deploy-runbook-for-codex.md`（部署说明书）、`docs/28-上线继续执行交接-DSP-Agent.md`（上线交接）
> 状态：**设计已确认（方案 A），待转实施计划**

---

## 1. 目标与不变量

### 1.1 目标

把「后期版本更新」从「每次都必须有人在场、带 token、手工直传」变成一条**零凭据、零本地依赖**的流水线：

> 改代码 → `git push` → CI 全套验收 → 合并 `main` → **前端自动上线 + 数据库自动迁移**。

### 1.2 不变量（一条都不放松）

1. 本地 IndexedDB 恒为唯一写入落点；`capabilities.ts` 的 `DATA_BACKEND` 仍是常量 `'local'`。
2. 云端仍是可选上行通道；`VITE_*` 仍是**构建期内联**变量。
3. 只用 anon / publishable key。仓库与 CI 中**不出现** `service_role`，也**不出现**长期 `sb_secret_`。
4. `vercel.json` 的四组 headers/rewrite 口径**一字不改**；不加 `public/_redirects`；不加 `dist/404.html`。
5. 「绝不伪装成功」的文案纪律不受部署方式影响。
6. 九套验收仍是唯一防线：**一个都不降级、一个都不跳过**。跑不了的项必须**明确标为「仅本机」**，不能静默跳过（静默跳过在 CI 上与通过长得一模一样 —— 这是 `verify:sql` 顶部注释里已经写明的原则）。

---

## 2. 现状复核（2026-09-22 实测）

### 2.1 线上状态（走 Clash 代理 `127.0.0.1:7897`；直连因 DNS 污染不通）

| 检查项 | 实测结果 | 与 `docs/28` 是否一致 |
| --- | --- | --- |
| 首页 | `200` | ✅ |
| `<title>` | UTF-8 字节 `E5-B9-B8-E7-A6-8F-E5-B0-8F-4D-6F-6C-6C-79` = `幸福小Molly` | ✅ |
| `/sw.js` | `Cache-Control: no-cache, no-store, must-revalidate` | ✅ |
| `/manifest.webmanifest` | `Cache-Control: no-cache` | ✅ |
| `/assets/index-Diz3wewX.js` | `Cache-Control: public, max-age=31536000, immutable`（哈希与文档一致） | ✅ |
| `/index.html` | `Cache-Control: no-cache` | ✅ |
| 深链 `/some/deep/link` | `200`（非 404） | ✅ |
| 生产 bundle（294,753 字节） | 含 `vofgywgccydxtsgiuynu.supabase.co` 与 `sb_publishable_`；`sb_secret_` 0 处、`service_role` 0 处 | ✅ |

### 2.2 本机验收（本会话实测）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（退出码 0） |
| `npm run lint` | 通过（退出码 0） |
| `npm run check:dates` | **48/48** |
| `npm run check:local-data` | **62/62** |
| `npm run check:backup` | **62/62** |
| `npm run check:cloud-parity` | **78/78** |
| `npm run check:sync` | **113/113** |
| `npm run verify:pwa` | **49/49** |

> `docs/28` §10.1/§10.2 记的两项「只读沙箱下失败」在本会话**已不成立**：`typecheck` 正常通过，`verify:pwa` 真实跑出 49/49。

### 2.3 环境事实（实测，与既有文档的差异在此更正）

| 事实 | 证据 |
| --- | --- |
| `gh` CLI **已登录** `jkwangoooo`，scopes `gist, read:org, repo, workflow` | `gh auth status` |
| **本机 `git` 写操作可用** | 临时目录 `git init/add/commit` 全部退出码 0；全局身份 `JKWang <jkwangoooo@gmail.com>` |
| 工作目录**尚未 `git init`**（`.git` 不存在） | `Test-Path .git` → False |
| 网络：直连不通，代理 `127.0.0.1:7897` 通 | `curl` 直连 `000`；代理 `200`；github.com / api.github.com / registry.npmjs.org / api.vercel.com 全部可达 |
| 本机 Chrome 存在 | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| 本机 PostgreSQL 16.14 | `psql --version`；`C:\Program Files\PostgreSQL\16\bin` |
| 未注入任何平台凭据 | `VERCEL_TOKEN` / `SUPABASE_DB_URL` / `SUPABASE_MCP_TOKEN` 全部 missing |
| Vercel CLI 无缓存凭据 | `%APPDATA%\com.vercel.cli\Data` 下只有 `config.json` / telemetry，**无 `auth.json`** |

**推论**：仓库创建与推送**不需要用户提供任何新凭据**（`gh` 已登录）。Vercel / Supabase 控制台的接入动作需要在场操作或凭据注入。

### 2.4 三个必须先处理的风险

1. **`.npm-cache/` 与 `.npm-cache-deploy/` 各 567 MB**（合计约 1.1 GB），而**根目录 `.gitignore` 并未忽略它们**（只有 `.vercelignore` 忽略了）。照原样提交会把 1.1 GB 推进 `main`。
2. **`deploy/supabase-all-migrations.sql` 是幂等的**（实测：`create table if not exists` 12 处、`drop policy if exists` 21 处、`create or replace function` 15 处、`drop trigger if exists` 20 处；`drop table` / `truncate` / `drop column` 0 处；17 处 `delete from` 全部位于 `import_local_backup` 函数体内）。**结论：对已有数据重复执行是安全的**，不需要为此犹豫。
3. **密钥前缀字样散落**：`docs/28-上线继续执行交接-DSP-Agent.md`（新落盘，正文里字面含 `sb_secret_`）、`docs/27-deploy-runbook-for-codex.md:77`、`scripts/verify-sync.mjs:81`。公开仓库前需抽掉这些字面前缀，否则 GitHub secret scanning 会误报。

---

## 3. 方案选型

### 3.1 三套候选

| | 前端自动上线 | 数据库自动迁移 | 仓库需存凭据 | 成本 |
| --- | --- | --- | --- | --- |
| **A（选定）** 两个官方 Git 集成 | Vercel Git 集成 | **Supabase 官方 GitHub 集成**（Migrate 步） | **零** | 0 元 |
| B 集成 + Actions push | Vercel Git 集成 | Actions 内 `supabase db push --db-url` | `SUPABASE_DB_URL`（长期明文连接串） | 0 元 |
| C 只做前端 | Vercel Git 集成 | 仍手动 / 由 Agent 代跑 | 零 | 0 元 |

### 3.2 选 A 的理由

Supabase 侧迁移由平台自己执行 ⇒ **我们的 Actions 里一个 Supabase 凭据都不存**：既没有 `service_role`，也没有长期 DB 连接串。

B 方案那个连接串在功能上等价于数据库 Owner 权限，放进公开仓库的 Actions secret 是长期负债；它换来的只是「迁移字段名可以自己拼」这一点便利，不划算。

C 方案不满足既定目标（后期更新要全自动）。

### 3.3 方案 A 依据的官方文档结论

| 问题 | 官方答案（原文引用见「依据」列） |
| --- | --- |
| Vercel 后期更新形态 | 接入 Git 仓库后：推 `main` → 生产部署，PR → Preview Deployment；回滚用「Promote 上一个 deployment」，无需重新构建 |
| 迁移自动化路径 | 官方 GitHub 集成：推/合并到生产分支自动执行**新迁移**；或自己在 Actions 里 `supabase db push` |
| 免费版可用性 | **「You can deploy directly from GitHub on any plan」** —— 直接部署免费；付费的是每个 PR 一套独立数据库（Branching） |
| 官方集成只读哪个目录 | `supabase/migrations/`（配置里唯一自由度是「working directory」，指向含 `supabase/` 的那一层） |
| 生产部署是否改 Auth 配置 | **不会**。原文：「All other configurations, including API, Auth, and seed files, are **ignored by default**」 |
| 每个 PR 是否自动建库 | **不会**。新分支 schema 由 migrations 建，构建时不执行数据/存储迁移，数据为空 |
| Branching 计费 | 无固定费用，按用量；默认 Micro Compute **$0.01344/小时**起；**不受 Spend Cap 保护** |

依据：<https://vercel.com/docs/deployments/environments>、<https://supabase.com/docs/guides/deployment/database-migrations>、<https://supabase.com/docs/guides/deployment/managing-environments>、<https://supabase.com/docs/guides/deployment/branching>、<https://supabase.com/docs/guides/deployment/branching/github-integration>、<https://supabase.com/docs/guides/platform/manage-your-usage/branching>

### 3.4 明确不采用

- **Supabase Branching**（每个 PR 一套独立库）：付费且不受 Spend Cap 保护，本项目单人开发收益不足。
- **自托管 CI**：无必要。
- **第二个部署平台**：现阶段不引入。

---

## 4. 目标流水线

```
push 分支
  └─ GitHub Actions: .github/workflows/ci.yml          ← 卡点，红了不许合并
       ├─ npm ci
       ├─ typecheck / lint
       ├─ check:dates / check:local-data / check:backup / check:cloud-parity / check:sync
       ├─ 迁移双份一致性断言（新增，--check 模式）
       ├─ verify:local (119)   ← Chrome
       ├─ verify:sync  (74)    ← Chrome
       ├─ verify:pwa   (49)    ← Chrome
       └─ verify:sql   (39)    ← GitHub 内置 postgres:16 服务容器，零凭据
合并 / push main
  ├─ Vercel Git 集成        → 生产部署（读 Vercel 里已有的两个 VITE_* production 变量）
  └─ Supabase GitHub 集成   → Migrate 步自动执行 supabase/migrations/ 下未应用的迁移
```

---

## 5. 组件设计

### 5.1 `.github/workflows/ci.yml`（新增）

- **runner**：`ubuntu-latest`
- **触发**：`pull_request`、`push` 到 `main`、`workflow_dispatch`
- **并发**：`concurrency` 按 `github.ref` 分组、`cancel-in-progress: true`
- **Node**：`actions/setup-node`，**显式固定 Node 24**（实测本机 `v24.14.0` / npm `11.9.0`；不固定会在 GitHub 变更默认版本时无声漂移），启用 npm 缓存
- **依赖**：`npm ci`（仓库有 `package-lock.json`）
- **PostgreSQL service**：`services: postgres:16`，环境变量 `MOLLY_PG_BIN=/usr/lib/postgresql/16/bin`
  - `initdb` 拒绝以 root 运行 ⇒ 步骤必须以 runner 用户执行，不得用 `container:` 形式整体跑在 root 下
  - 现有 `PG_ROOTS` 已包含 `/usr/lib/postgresql/16/bin`，故理论上只需环境变量即可命中
- **Chrome**：`browser-actions/setup-chrome` 固定主版本 → 导出 `CHROME_PATH`
  - **不使用 Playwright**：本项目的浏览器驱动是自写的 CDP + 静态服务器，只要求「`CHROME_PATH` 指向一个可执行文件」（`scripts/lib/find-browser.mjs` 的契约）
- **执行顺序**：串行。`verify:sql` **不得**与其它 verify 并行（会撞 `query()` 的 60s 超时，报出一串假失败 —— 见 `docs/26` §7.2）
- **失败产物**：`actions/upload-artifact` 上传 `dist/` 与验收截图目录
- **凭据**：**零**。工作流不读任何 Supabase / Vercel secret

### 5.2 `scripts/sync-supabase-migrations.mjs`（新增）

职责单一：让 `database/migrations/` 这份**唯一真源**与 Supabase 官方集成要求的 `supabase/migrations/` 保持逐字节一致。

| 模式 | 行为 |
| --- | --- |
| 默认（无参数） | 把 `database/migrations/*.sql` 复制到 `supabase/migrations/`；并按既有格式重新生成 `deploy/supabase-all-migrations.sql` |
| `--check` | ① 逐字节比对 `database/migrations/` ↔ `supabase/migrations/`；② 校验 `deploy/` 单文件等于「分隔块 + 各文件正文」的按序拼接。**缺一、多一、内容不一致** 任一情况 → 打印差异并**非零退出** |

- 文件名**原样保留**（含 `<timestamp>_` 前缀），以保证迁移顺序与真源相同
- 该脚本不触碰 `database/migrations/`，只读它
- CI 中执行 `--check`，把「改了一处漏了另一处」变成红灯

**合并格式（实测，2026-09-22）**：每个文件前是

```
-- ############################################################################
-- ##  <文件名>
-- ############################################################################
<一个空行>
```

随后是该文件正文。一次性核对脚本证实：**六个文件正文与真源两两逐字一致**，唯一差异是「分隔块之后多出的那一个空行」。因此该格式可被脚本精确复现。

**现状更正**：`deploy/supabase-all-migrations.sql` **没有生成脚本**，是手工合并的一次性产物。本次把生成逻辑收进本脚本，消除这个手工步骤（这正是「三处同源」的落点）。

### 5.3 `supabase/` 目录（新增，由 5.2 生成）

- `supabase/migrations/` —— 六个迁移的逐字节副本（供官方集成读取）
- `supabase/config.toml` —— 由 `supabase init` 生成
  - **Auth 段保持默认，不得写入本地地址以外的定制**；生产部署时官方集成**默认忽略** API/Auth/seed 配置
  - 启用集成后必须**回读生产 Auth 配置**确认 `site_url` 与 `mailer_autoconfirm` 未被改动（见 §7 验收）
- **不生成 `supabase/seed.sql`**（无种子数据需求；且数据类变更不会被合并到生产）

### 5.4 `.github/workflows/` 之外需要改的文件

| 文件 | 改动 |
| --- | --- |
| `.gitignore` | 追加 `.npm-cache/`、`.npm-cache-deploy/`、`.vercel-url.txt`、`.vercel-anon.txt` |
| `.gitattributes` | **新增**，内容为 `* text=auto eol=lf` + `*.cmd text eol=crlf` + `*.bat text eol=crlf` + `*.png binary`。理由见下方「换行策略」 |
| `package.json` | 新增脚本 `"check:migrations": "node scripts/sync-supabase-migrations.mjs --check"`，与既有五套 check 并列 |
| `README.md` | 命令清单加一行 `check:migrations` |
| `scripts/launcher.mjs` | 「静态回归五件套」改为六项（或新增独立任务项），`note` 同步 |
| `docs/19-sync-execution-plan.md` | §4 基线表加一行 |
| `HANDOFF.md` | 「当前基线」一句话同步 |
| `docs/28-上线继续执行交接-DSP-Agent.md` | 抽掉第 62 行的字面密钥前缀（改写为「未发现 secret key / service role 内容」）。**实测：仅此 1 处**；`docs/27` 已复扫为干净 |
| `scripts/verify-sync.mjs` | **不改**。第 81 行的 `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` 是 `FAKE_ANON_KEY` 夹具，其上方注释已写明「长得像 JWT 是必需的」——改成随便的字符串会让「控制台无 error / warning」那条断言假失败 |

**换行策略（三条都必须做，少一条就会出问题）**：

1. **必须在首次 `git add` 之前就位** —— 否则首次提交把 CRLF 写进仓库，之后每次 `--check` 都红。
2. 加完 `.gitattributes` 后要执行一次 `git add --renormalize .`，把已在工作区的 CRLF 重新归一为仓库内 LF。
3. **`*.cmd` / `*.bat` 例外，保持 CRLF** —— 根目录的 `launch.cmd` 是双击入口，LF-only 的批处理在某些 `goto` / 标签场景下会出错。这一条例外是刻意加的，不是遗漏。

**本机现状提示（实测）**：`core.autocrlf = true`，工作区文件为 CRLF。因此第 2 条的 `--renormalize` 不是可选项。

### 5.5 发布协议（写进运维手册，是流程而非代码）

一次 schema 变更拆成**两次发布**：

1. **第 1 次**：只合迁移文件（只加列 / 加表）。旧前端不受影响（官方集成只对新迁移执行，且只做加法）。
2. **第 2 次**：合前端代码（开始使用新列）。

理由：Vercel 与 Supabase 是两个独立平台，在 merge 时**各自独立触发、无编排**，中间存在时间窗。`recordSchemas.ts` 是严格模式（拒绝未定义字段），若前端先上线而列还没到，同步写入会失败。

配套硬规则：
- **只做加法**：不改列名、不改类型、不删列、不加非空约束（除非有默认值）。
- **每个新迁移文件最后一行固定为** `notify pgrst, 'reload schema';` —— 这样无论集成是否刷新 schema cache，函数都不会出现 `Could not find the function ... in the schema cache`。
- 需要破坏性变更时，**拆成两次发布**：先加新列/新表 → 再切前端 → 最后单独一次删旧列。

---

## 6. 首次落地步骤

### 第 0 步：先证伪四个假设，再动线上任何东西

| 假设 | 内容 | 证伪后的处置 |
| --- | --- | --- |
| A1 | `verify:local` / `verify:sync` / `verify:pwa` 能在 Linux + `CHROME_PATH` 下跑通（脚本中 `taskkill` 有 win32 分支，非 win32 走 `kill`；无硬编码 Windows 路径） | 该项在 CI 中标为「仅本机」，**断言强度不降级** |
| A2 | `verify:sql` 能在 GitHub 的 `postgres:16` 容器 + **非 root** 用户下跑通 | 同上 |
| A3 | 自写 CDP 驱动在 CI 中不因沙箱/权限失败 | 同上 |
| A4 | `npm ci` 在 Linux 上不依赖那两个 567 MB 的 `.npm-cache` | 调整缓存策略 |

**做法**：先在 GitHub 上用一个 PR 把 `ci.yml` 跑起来，以真实输出判定 A1–A4，而不是推测。

### 第 1 步起：按序执行

1. **仓库卫生**：改 `.gitignore`、加 `.gitattributes` + `git add --renormalize .`、抽掉密钥前缀字样（§5.4）
2. **三方一致性脚本 + 首次生成**：写 `scripts/sync-supabase-migrations.mjs`，跑默认模式生成 `supabase/migrations/` 六份副本，并**重新生成 `deploy/supabase-all-migrations.sql`**；用 `--check` 确认三方一致（§5.2）
3. **本机全量回归**：跑 `check:migrations` + 五套 check + 三个 verify，确认没有把既有基线弄红（**这一步在 push 之前**，成本最低）
4. **`git init` + 首次提交 + `gh repo create --public` + push**（实测 169 个文件 / 1.65 MB）
5. **用 PR 把 CI 跑绿**（判定 A1–A4）；**这一步需要用户在场**（提交 / 合并），我只负责写工作流与读输出
6. **Vercel 接 Git**：
   - Project `littlemolly-main` → Settings → Git → Connect Git Repository → 选仓库 → 生产分支 = `main`
   - 复核框架预设 = Vite、Build Command = `npm run build`、Output = `dist`
   - 复核两个 `VITE_*` 仍在 `production` target
   - 接入 Git **本身不触发部署**，需一次 push 触发
   - **实测确认 `littlemolly-main.vercel.app` 仍指向生产**（`aliasAssigned = true`）
7. **复跑线上自检**（六条，见 §7）
8. **Supabase 接 GitHub 集成**：
   - Project Settings → Integrations → GitHub Integration → Authorize → 选仓库 → Working directory = `.` → Enable
   - 确认首次 Push 时 Migrate 步对**已应用的六个迁移**是 no-op（迁移记录表已存在）
   - **回读生产 Auth 配置**：`site_url` 仍为 `https://littlemolly-main.vercel.app`、`mailer_autoconfirm` 仍为 `true`
   - 建议在 GitHub 上把 Supabase 的检查设为 **required status check**
9. **文档收口**：新增 `docs/29-CI-CD-运维手册.md`（发布协议 / 回滚 / 排障 / 四处项数同步规则补「迁移目录同步」一条）；同步 `AGENTS.md`、`README.md`、`HANDOFF.md`、`DEPLOY.md`

### 需要用户在场或授权的动作（我不做，也不假装做）

| 动作 | 原因 |
| --- | --- |
| 在 Vercel 控制台 Connect Git Repository | 浏览器交互式授权 |
| 在 Supabase 控制台 Authorize GitHub / Enable 集成 | 浏览器交互式授权 |
| 需要时的 git push / PR 合并确认 | 账户级操作；`gh` 已登录，但按「不代替用户做发布决定」处理 |
| 首次 push 前对「公开仓库」的最终点头 | 不可逆的公开行为 |

---

## 7. 验收标准

1. PR 触发 `ci.yml` 全绿，含 `verify:sql 39`、`verify:pwa 49`、`verify:local 119`、`verify:sync 74`
2. 合并 `main` → Vercel **自动**生产部署；`aliasAssigned = true`；域名不变
3. 线上自检六条全过：首页 `200` / `<title>` = `幸福小Molly` / `/sw.js` 含 `no-cache` / `/manifest.webmanifest` 含 `no-cache` / `/assets/*.js` 含 `immutable` / 深链 `200`
4. 生产 bundle 仍内联 `vofgywgccydxtsgiuynu.supabase.co` + publishable key，`sb_secret_` 与 `service_role` 均 0 处
5. Supabase 集成启用后，**回读 Auth 配置未被改动**
6. 迁移一致性断言**做反证**：故意制造一处漂移 → CI 红；修回 → 绿
7. 文档更新完毕

---

## 8. 回滚与失败处置

| 场景 | 处置 |
| --- | --- |
| 前端新版本有问题 | Vercel → Deployments → 上一个 `READY` → **Promote to Production**（即时，不重新构建） |
| 迁移失败 | 集成停在 Migrate 步；前端可能已上线。因为只做加法，新/旧前端都能工作 ⇒ 修 SQL 后再合一次 |
| CI 红 | 不许合并；PR 页直接看失败项 |
| 线上白屏 | 检查是否有人加了 `_redirects` / `404.html`（`verify:pwa` 有断言守） |
| 需要紧急绕过 | 仍可 `vercel --token` 直传，但**口径一字不改** |
| schema cache 报缺函数 | 见 §5.5 的 `notify pgrst` 固定行；或控制台 Reload schema cache |

---

## 9. 范围边界（明确不做）

- 不引入 Supabase Branching（付费）
- 不改 `vercel.json` / `public/_headers`
- 不加 `public/_redirects`、不生成 `dist/404.html`
- **不改 `src/` 任何业务代码与文案**
- 不改迁移文件内容（只复制）
- 不删 `deploy/supabase-all-migrations.sql`（保留给人用的单文件路径）
- 不新建第二个部署平台
- 不改九套验收脚本的断言内容（只新增一致性断言与 CI 编排）

---

## 10. 已知取舍与残余风险

| 项 | 取舍 / 风险 | 处置 |
| --- | --- | --- |
| **仓库选 Public** | 全部中文源码、`docs/` 设计文档、产品文案公开，任何人可 fork | 用户已确认接受。若改为 Private：Free 私有仓库有 Actions 额度，可能需在 CI 中去重耗时项 |
| Supabase 集成只读 `supabase/migrations/` | 引入「双份」，理论上可漂移 | `--check` 断言 + `.gitattributes` 换行归一 |
| 两平台无编排 | merge 时前端与迁移各自独立触发，有时间窗 | §5.5 发布协议（只做加法 + 分两次发布） |
| 官方集成可能覆盖 `config.toml` 里的配置 | Branching 的 Configure 步会按 `config.toml` 更新服务配置 | 官方文档称生产部署默认忽略 API/Auth/seed；**仍以 §7 第 5 条实测为准** |
| `verify:sql` 只验 SQL 与契约对应 | 不验真实 Supabase 特有的权限/触发器差异 | 这是 `docs/26` §6 已列出的既有边界，本次不扩大 |
| 首次 push 后 CI 可能红 | 四个假设（A1–A4）尚未证实 | 第 0 步先证伪；证伪则标为「仅本机」而非降级断言 |

---

## 11. 转实施计划

本设计通过后，下一步用 `writing-plans` 生成实施计划，按 §6 的步骤顺序展开为可执行任务，每步带验证命令与预期输出。