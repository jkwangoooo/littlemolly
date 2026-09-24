# 「幸福小Molly」流水线落地 · 继续执行交接

> 日期：2026-09-22
> 项目目录：`D:\WJKHome\小人项目包\littlemolly-main`
> 上游（必读，按顺序）：`docs/26-S6-handoff-for-codex.md`（项目全貌与硬规则）→
> `docs/27-deploy-runbook-for-codex.md`（部署说明书）→ `docs/28-上线继续执行交接-DSP-Agent.md`（上线交接）→
> **`docs/superpowers/specs/2026-09-22-cicd-pipeline-design.md`（已确认的设计定稿）** → 本文
> 状态：**设计已定稿并获确认；实施计划尚未落盘；代码一行未改**

---

## 0. 这份文档是什么

上一轮对话把「上线 + CI/CD 流水线」的**设计**做实了（含大量实测），但**实施计划还没写、代码一行没改**。
本文是给下一轮对话（新会话、无上下文）的接手文档：**只写已经证实的事实、还没做的事、以及必须先处理的两个坑**。

读本文之后，请先读设计定稿 `docs/superpowers/specs/2026-09-22-cicd-pipeline-design.md`（330 行，全部已确认），
它是唯一的需求来源。**本文不重复它的内容**，只补三类信息：① 本轮新测到的事实（含两处对设计文档的更正）；
② 本轮发现的、必须先解决才能进 CI 的两个问题；③ 下一步的确切执行顺序。

---

## 1. 现状总览

| 项 | 状态 |
| --- | --- |
| 设计定稿（`docs/superpowers/specs/2026-09-22-cicd-pipeline-design.md`） | ✅ 330 行，用户已确认 |
| 实施计划（`docs/superpowers/plans/2026-09-22-cicd-pipeline.md`） | ❌ **未创建**（`docs/superpowers/plans/` 目录都还不存在） |
| `.github/workflows/ci.yml` | ❌ 未创建（`.github/` 不存在） |
| `scripts/sync-supabase-migrations.mjs` | ❌ 未创建 |
| `supabase/`（`config.toml` + `migrations/` 六份副本） | ❌ 未创建 |
| `.gitattributes` | ❌ 未创建（**必须在首次 `git add` 之前就位**） |
| `.gitignore` 修正 | ❌ 未改（见 §3.1，是个真 bug） |
| `package.json` 加 `check:migrations` | ❌ 未加 |
| `docs/28` 第 62 行密钥前缀字面量 | ❌ 未抽（见 §3.2） |
| 本机 `git init` | ❌ 未做（`.git` 不存在，`Test-Path .git` → False） |
| GitHub 仓库 `jkwangoooo/littlemolly-main` | ❌ 未创建 |
| 线上（Vercel / Supabase） | ✅ 已在 `docs/28` 记录为已上线；本轮**未再改动任何线上配置** |

**一句话**：设计做完了，实施计划还没写。下一步就是写计划、然后执行。

---

## 2. 已确认的设计（摘要，细节看设计定稿）

- **方案 A**：Vercel Git 集成（前端自动上线）+ **Supabase 官方 GitHub 集成**（迁移自动执行）。
  **CI 里零凭据**——不存 `service_role`，不存数据库连接串。
- **发布口径**：单环境自动发布（`main` → 生产），全套验收必须绿才能合并。
- **迁移真源**：`database/migrations/` 是唯一真源；`supabase/migrations/` 是**逐字节副本**（官方集成只读它），
  由 `scripts/sync-supabase-migrations.mjs --check` 在 CI 里守住一致性。
- **破坏性变更契约**：**只做加法 + 分两次发布**（先合迁移、再合前端）。
  每个**新**迁移文件最后一行固定为 `notify pgrst, 'reload schema';`。
- **不做**：Supabase Branching（付费）、自托管 CI、第二个部署平台、改 `src/` 业务代码、
  改迁移文件内容（只复制）、删 `deploy/supabase-all-migrations.sql`、降级任何一条验收断言。

---

## 3. 本轮新测到的事实（重要，含两处更正）

### 3.1 ⚠️ `.gitignore` 有个真 bug：`.env.example` 现在是被忽略的

**当前 `README`/`DEPLOY.md` 说「只保留 `.env.example`」——实测不成立。**

实测（临时仓库复现，两次独立验证）：

```
.gitignore:8:.env*   .env.example      ← 第 14 行（文件末尾）的 .env* 把第 9 行的 !.env.example 反转了
git check-ignore -q .env.example  → exit 0（= 被忽略）
```

`git status --porcelain` 在 `git add -A` 之后**不出现** `.env.example`，而 `.env.local` 也正确被忽略。

**修法**（已实测：把否定规则移到 `.env*` **之后**即可，忽略语义按「最后匹配者胜」）：

```
node_modules/
dist/
.workbuddy/
.workbuddy-ai/
.vercel/
.vercel-url.txt
.vercel-anon.txt
supabase/.temp/
.env
.env.local
.env.*.local
.env*
!.env.example          ← 必须放在 .env* 之后
*.log
.DS_Store
.npm-cache/
.npm-cache-deploy/
```

修完实测：`git check-ignore -q .env.example` → exit 1（**不**被忽略 ✓）；
`git check-ignore -q .env.local` → exit 0（仍被忽略 ✓）。

> 设计定稿 §5.4 的表里只写了「追加 `.npm-cache/` 等」，**没写这个否定规则顺序问题**。
> 执行时按上面这份完整内容替换，不要只做追加。

### 3.2 ⚠️ 密钥前缀字面的**真实分布**（设计定稿 §2.4 风险 3 写错了）

设计定稿说散落在 `docs/28`、`docs/27:77`、`scripts/verify-sync.mjs:81`。逐文件复扫结果：

| 位置 | 实际内容 | 处置 |
| --- | --- | --- |
| `docs/28-上线继续执行交接-DSP-Agent.md` **第 62 行** | 字面含 `sb_` + `secret_` 前缀 | **要改**。改写为「未发现 secret key / service role 内容」 |
| `docs/27-deploy-runbook-for-codex.md:77` | **不含**该前缀（写的是「跑迁移」，mojibake 让人误读） | 无需改（**设计文档此处是错的**） |
| `scripts/verify-sync.mjs:81` | `FAKE_ANON_KEY`，JWT 形状的**假**夹具 | **不许改**——上方注释已写明「长得像 JWT 是必需的」，改成随便的字符串会让「控制台无 error / warning」那条断言假失败 |
| **`docs/superpowers/specs/2026-09-22-cicd-pipeline-design.md`** | **第 22、42、78、282 行共 4 处**字面含该前缀 | **设计定稿漏了自己**。这份 spec 会被提交，同样要抽掉字面量 |
| `service_role` 字样 | 全仓 36 处（`AGENTS.md` / `DEPLOY.md` / `docs/13·14·15·18·27·28` / `supabase-shim.sql` / 迁移注释等） | **不用改**。它是**角色名**不是密钥值，secret scanning 不据此告警；`DEPLOY.md:164` 已写明「那里建的是角色，不是密钥」 |

复扫命令（可直接复用，排除 `node_modules` / `.workbuddy*` / `.npm-cache*` / `dist` / `.git`）：

```powershell
$excl = @('node_modules','.workbuddy-ai','.workbuddy','.npm-cache','.npm-cache-deploy','dist','.git')
$files = Get-ChildItem -Recurse -File -Force | Where-Object {
  $p = $_.FullName; ($excl | Where-Object { $p -like "*\$_\*" }).Count -eq 0
}
$files | Select-String -Pattern 'sb_secret_'
```

### 3.3 ✅ `deploy/supabase-all-migrations.sql` 的生成逻辑**已证实可逐字节复现**

设计定稿 §5.2 说「该格式可被脚本精确复现」——**本轮已证明**，不是一个待验证的假设。

- 现有文件 **66132 字节**（LF-only，CR=0，行数 1276）
- 生成器输出与之 `Buffer.equals` → **true**
- **头部恰好 915 字节**，精确内容（`RULE = '-- ' + '='.repeat(76)`）：

```
<RULE>
-- 幸福小Molly · Supabase 全部迁移（6 个，按文件名顺序合并成单文件）
<RULE>
--
-- 用法：整份复制 → Supabase 控制台 → SQL Editor → 新建查询 → 粘贴 → Run。
--
-- 为什么可以合并：6 个迁移都没有 begin/commit 事务控制，也没有 psql 元命令，
-- 且都用 create ... if not exists / create or replace，可安全顺序执行。
-- 本文件内容 = database/migrations/ 下 6 个原文件逐字拼接（只多了分隔注释）。
-- 想逐个执行的话，直接用 database/migrations/ 下的原文件，效果相同。
--
-- 顺序不能乱：后面的迁移依赖前面建好的表、函数、触发器。
<RULE>
<空行>
<空行>
```

- 分隔块：`HASH = '-- ' + '#'.repeat(76)`，每块 = `HASH\n-- ##  <文件名>\nHASH\n\n<正文逐字>`
- 块之间：**第 2 个文件起**每块前面多一个 `\n`（第 1 个不多）

**推论**：`scripts/sync-supabase-migrations.mjs` 的默认模式重新生成 `deploy/` 单文件时，
**必须输出与现有文件完全相同的字节**，否则等于引入一次无意义的大 diff。写脚本时把上面这段当契约，
写完先跑 `--check` 自证 66132 字节不变。

参考实现见 `.workbuddy-ai/probe-gen.cjs`（本轮验证用的原型，逻辑可直接搬进正式脚本）。

### 3.4 ✅ Supabase CLI 的迁移文件名规则（用来确认副本命名不变）

读 `supabase/cli` 源码 `apps/cli-go/pkg/migration/file.go`：

```go
migrateFilePattern = regexp.MustCompile(`^([0-9]+)_(.*)\.sql$`)
```

- 文件名必须匹配 `^数字_任意.sql$`。现有六个文件名（`202608270001_stage1_auth_sync.sql` 等）**全部匹配**，
  故副本**原样保留文件名**即可，顺序也与真源一致（`list.go` 用 `strconv.ParseUint` 解析数字前缀，超 20211209000000 才保留）。
- 该文件里同时定义了「pipeline 不兼容语句」黑名单：`CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY` /
  `REINDEX ... CONCURRENTLY` / `VACUUM` / `ALTER SYSTEM` / `CLUSTER`。
  **本轮实测六个迁移命中数全部为 0**；`begin|commit|rollback` 语句 0 处；psql 元命令（行首 `\`）0 处。
  ⇒ 合并单文件 / 官方集成执行都不会踩到这些限制。

### 3.5 ✅ `supabase init` 实测产物

用 `npx supabase@latest init`（CLI **2.117.0**）在临时目录跑通，退出码 0，产出：

```
supabase/config.toml          15628 字节，416 行，CR=0（纯 LF）
supabase/.temp/cli-latest     （CLI 版本缓存，须 gitignore）
```

- 文件头 `project_id = "<目录名>"` —— 在项目里生成后会是 `project_id = "littlemolly-main"`，
  **这行是可接受的**（只是本地区分标识）。
- `[db.seed] sql_paths = ["./seed.sql"]` 是模板默认值，但**不生成 `supabase/seed.sql`** 即可让 seed 步空转
  （设计定稿 §5.3 已定：不生成 seed）。
- 生成后**不要手改 `[auth]` 段**：模板里 `site_url = "http://127.0.0.1:3000"`、
  `additional_redirect_urls = ["https://127.0.0.1:3000"]`、`enable_confirmations = false`。
  官方集成**默认忽略 API/Auth/seed 配置**，所以这些本地值不会污染生产；但启用集成后**必须回读生产 Auth 配置**
  确认 `site_url` 仍是 `https://littlemolly-main.vercel.app`、`mailer_autoconfirm` 仍是 `true`。

> `supabase init` 会用 `--force` 覆盖已有 `config.toml`，**执行前确认 `supabase/` 目录不存在**。

### 3.6 ✅ `.gitattributes` 与 EOL 语义（`core.autocrlf = true` 下实测）

拟用内容（LF-only 写入）：

```
* text=auto eol=lf
*.cmd text eol=crlf
*.bat text eol=crlf
*.png binary
```

实测输出（临时仓库）：

```
[i/lf  w/lf  attr/text=auto eol=lf   .gitattributes]
[i/lf  w/lf  attr/text=auto eol=lf   a.ts]
[i/lf  w/lf  attr/text=auto eol=lf   b.sql]
[i/lf  w/lf  attr/text eol=crlf      launch.cmd]     ← warning: LF will be replaced by CRLF ...
```

`git check-attr -a` 结果：`*.ts`/`*.sql`/`*.md` → `text: auto` + `eol: lf`；`*.cmd` → `text: set` + `eol: crlf`。

**要点**：
1. 本机 `core.autocrlf = true`，所以**必须**在加完 `.gitattributes` 后执行 `git add --renormalize .`。
2. 加完属性后，`.cmd` 在工作区**不会立刻**变 CRLF；`Remove-Item launch.cmd; git checkout -- launch.cmd` 之后才是 CRLF。
   **但这对 CI 完全无影响**——CI 读的是仓库 blob（LF/CRLF 由属性决定），与工作区换行无关。
3. 解析 `git ls-files --eol` 输出时注意格式是 `i/<eol>  w/<eol>  attr/<...>  \t<path>`（**path 前是制表符**），
   按列切分，不要用 `$NF -split '/'` 取扩展名。

### 3.7 ✅ 提交体量（**预测值**，提交时以实测为准）

按修正后的 `.gitignore` 模拟遍历（排除 `node_modules` / `dist` / `.workbuddy*` / `.npm-cache*` / `.vercel*` / `.env.local`）：

- **171 个文件 / 1.67 MiB**
- 顶层分布：`(root)` 17 · `database` 6 · `deploy` 1 · `docs` 30 · `public` 8 · `scripts` 14 · `src` 95
- 根目录文件：`.env.example` `.gitignore` `.vercelignore` `AGENTS.md` `DEPLOY.md` `HANDOFF.md` `README.md`
  `eslint.config.js` `index.html` `launch.cmd` `package-lock.json` `package.json` `tsconfig.app.json`
  `tsconfig.json` `tsconfig.node.json` `vercel.json` `vite.config.ts`
- 二进制 4 个：`public/apple-touch-icon.png`、`public/icons/icon-{192,512,maskable-512}.png`

> 设计定稿 §6 第 4 步写的是「169 个文件 / 1.65 MB」，那是写 spec 时的估算。
> 差别来自之后新增的文档（含本文件与 plan）。**以 `git ls-files | Measure-Object` 的实测为准**。

### 3.8 ✅ 本机环境与依赖事实

| 项 | 实测值 |
| --- | --- |
| Node / npm | `v24.14.0` / `11.9.0`（与 CI 固定的 Node 24 一致） |
| git | `2.53.0.windows.1`；身份 `JKWang <jkwangoooo@gmail.com>`；`init.defaultBranch = main`；`core.autocrlf = true` |
| gh CLI | `2.89.0`，已登录 `jkwangoooo`（scopes `gist, read:org, repo, workflow`）——建仓 + push **不需要新凭据** |
| github.com | **直连可用**（`git ls-remote https://github.com/jkwangoooo/littlemolly HEAD` 退出码 0）；代理 `127.0.0.1:7897` 也可用 |
| `package-lock.json` | lockfileVersion 3，233 个 packages；**含 23 条 linux 原生可选依赖**（`@esbuild/linux-*` 12 条、`@rollup/rollup-linux-*` 10 条、`@napi-rs/lzma-linux-x64-gnu`）⇒ `npm ci` 在 `ubuntu-latest` 上不缺平台包（A4 的主要子假设已静态成立） |
| `npm config get cache` | `C:\Users\Administrator\AppData\Local\npm-cache`（**不是**项目里的 `.npm-cache*`） |
| 无 `.npmrc` / `.yarnrc` | 确认不存在（CI 不会被本机 npm 配置影响） |
| WSL / Docker | WSL Ubuntu 26.04 有，但**没有 node / psql / chrome**；Docker 不存在 ⇒ **Linux-only 行为无法在本机彩排，只能靠真 CI 证伪** |

---

## 4. ⚠️ 必须先处理的两个阻塞问题

### 4.1 `scripts/verify:sync` 现在**必然失败**（本机复现 4 次，退出码 2）

这是本轮最重要的发现，**它直接决定 CI 能不能绿**。

**症状**（`npm run verify:sync`，稳定复现，与 Vite 依赖缓存冷热无关）：

```
FAIL  注册后进入日计划页
FAIL  注册播种的条目记在新账号名下（无归属的条目永远推不上去）  → 播种 0 条，归属=[]
FAIL  未绑定云端账号时同步卡说明未连接  → NO_SYNC_CARD
验收脚本异常： Error: 请先登录。          ← exit code 2
```

**根因**（已定位，含证据）：`scripts/verify-sync.mjs` 的 `goto()` 用**固定等待**：

```js
const goto = async () => {
  await cdp.send('Page.navigate', { url: appUrl })
  await sleep(2600)          // ← 太短
  await evaluate(HELPERS)
}
```

`Page.navigate` 返回 ≠ 页面可用。实测这台机器上应用真正挂载出 `.page` 需要 **最多约 9.7 秒**
（探针里 `pageReadyAfter=9657ms`），而 `goto()` 只等 2600ms。于是：

- `document.body.innerText` 为空 ⇒ 找不到「账号」label ⇒ `fill()` 返回 `NO_LABEL:账号`
- 找不到「注册」按钮 ⇒ 没注册 ⇒ 没有会话 ⇒ 后面 `write()` 抛 `请先登录。`
- 与 `node_modules/.vite` 是否预热**无关**：清掉缓存重跑照旧失败；预热后重跑照旧失败

**已验证的修法**（探针实测通过，**74/74**）：

```js
const goto = async () => {
  await cdp.send('Page.navigate', { url: appUrl })
  // 固定等待会假失败：Page.navigate 返回时应用还没挂载完（实测最长约 9.7s）。
  // 改轮询「页面真的渲染出来了」，超时上限 30s。
  for (let i = 0; i < 120; i += 1) {
    const ready = await cdp
      .send('Runtime.evaluate', { expression: `document.querySelector('.page') ? 'YES' : 'NO'`, returnByValue: true })
      .then((o) => o.result.value)
      .catch(() => 'NO')
    if (ready === 'YES') break
    await sleep(250)
  }
  await evaluate(HELPERS)
}
```

用这个版本跑 `.workbuddy-ai/` 下的临时探针 → **`结果：74/74 通过`，退出码 0**。

**关于「能不能改验收脚本」的边界**：设计定稿 §9 写的是「不改九套验收脚本的**断言内容**」。
上面这处改的是**等待策略（测试脚手架）**，不是断言、不是断言强度，**项数不变、判据不变**。
但它是本轮唯一必要的脚本改动，请在写计划时**明确写进计划并让用户看到**，不要默默改。

**同类风险（同一个坑，另两个脚本）**：

| 脚本 | `goto` 的等待 | 本机现状 |
| --- | --- | --- |
| `verify-local.mjs` | `await sleep(2200)` | 实测**119/119 通过**（冷缓存 200.2s / 热缓存 191.2s）——但同样是固定等待，属于同一类脆弱点 |
| `verify-pwa.mjs` | 已有轮询（`document.body.innerText.includes('账号')`，60 次 × 500ms） | 49/49 通过 |
| `verify-sync.mjs` | `await sleep(2600)` | **必然失败**（见上） |

**为什么这件事必须在写计划时就定下来**：CI 的 runner 一定比本机慢，`verify-local` 的 2200ms 在 CI 上
有很高概率同样假失败。建议**两个脚本都用同一种轮询替换固定等待**（`verify-pwa` 已经是这个模式，照抄即可），
并在设计定稿的「本机全量回归」步骤里要求重跑三个浏览器验收确认项数不变（119 / 49 / 74）。

### 4.2 `.gitignore` 的否定规则顺序（见 §3.1）

必须在**首次 `git add` 之前**改完，否则首次提交会把 `.env.example` 漏掉（而 `README` 与 `DEPLOY.md`
都对外宣称它被保留）。改完请用 `git check-ignore -q .env.example` 自证（期望 exit 1）。

---

## 5. 本机验收基线（本轮实测，全绿）

| 命令 | 结果 | 耗时（秒） |
| --- | --- | --- |
| `npm run typecheck` | 退出码 0 | 3.5 |
| `npm run lint` | 退出码 0 | 4.7 |
| `npm run build` | 退出码 0 | 6.1 |
| `npm run check:dates` | **48/48** | 0.5 |
| `npm run check:local-data` | **62/62** | 0.6 |
| `npm run check:backup` | **62/62** | 0.5 |
| `npm run check:cloud-parity` | **78/78** | 0.7 |
| `npm run check:sync` | **113/113** | 0.5 |
| `npm run verify:local` | **119/119** | 191.2（冷缓存 200.2） |
| `npm run verify:pwa` | **49/49** | 79.6（含两次构建） |
| `npm run verify:sync` | ❌ **见 §4.1** | — |
| `npm run verify:sql` | **39/39** | 10.1 |

合计约 **8 分钟**（`verify:sync` 修好之后再加 ~180 秒）。CI 单 job 串行跑完预计 **10–15 分钟**。
设计与文档里的九套项数基线（48/62/62/78/113/119/49/74/39）**未变**，改完 §4.1 之后仍是这九个数。

---

## 6. 下一步执行顺序

### 第 0 步：先修 §4 的两个阻塞问题

1. 修 `.gitignore`（按 §3.1 的完整内容），用 `git check-ignore` 自证。
2. 修 `verify-sync.mjs` 与（建议一并）`verify-local.mjs` 的 `goto()` 等待策略（按 §4.1 的代码），
   重跑 `verify:sync`（期望 74/74）与 `verify:local`（期望 119/119）。
3. 抽掉密钥字面前缀：`docs/28:62` + **`docs/superpowers/specs/2026-09-22-cicd-pipeline-design.md` 的 4 处**
   （见 §3.2）。改完用 §3.2 的复扫命令确认 `sb_secret_` 命中数 = 0。

### 第 1 步：写实施计划

用 **`writing-plans`** 技能写到 `docs/superpowers/plans/2026-09-22-cicd-pipeline.md`
（目录要先建）。格式要求：头部（Goal / Architecture / Tech Stack / REQUIRED SUB-SKILL 行）、
每个任务 bite-sized 且带**完整代码**、**确切路径**、**确切命令与预期输出**、**每步都提交**、**零占位符**。

按设计定稿 §6 展开，任务顺序建议：

1. 仓库卫生：`.gitattributes` + `.gitignore`（第 0 步的第 1 项）
2. `scripts/sync-supabase-migrations.mjs` + `supabase/migrations/` 六份副本 + 重新生成 `deploy/` 单文件
   （契约见 §3.3：**输出必须仍是 66132 字节且逐字节相同**）
3. `supabase/config.toml`（`npx supabase@latest init`，CLI 2.117.0，产物见 §3.5）
4. `package.json` 加 `"check:migrations": "node scripts/sync-supabase-migrations.mjs --check"`
5. 项数同步四处（`README.md` 命令清单、`scripts/launcher.mjs` 的 `note`、`docs/19` §4 基线表、
   `HANDOFF.md`「当前基线」）+ 新增第五处规则（迁移目录一致性）
6. `.github/workflows/ci.yml`（配置要点见 §7）
7. `.gitattributes` 生效后的 `git add --renormalize .`
8. 本机全量回归（`check:migrations` + 五套 check + 三个 verify + `verify:sql`）
9. `git init` + 首次提交 + `gh repo create jkwangoooo/littlemolly-main --public` + push
10. PR 跑 CI，**判定 A1–A4**（见 §8）
11. 线上接入（Vercel / Supabase）+ 线上自检六条（**需要用户在场**）
12. `docs/30-CI-CD-运维手册.md`（发布协议 / 回滚 / 排障 / 四处项数 + 迁移目录同步）+ 同步
    `AGENTS.md` / `README.md` / `HANDOFF.md` / `DEPLOY.md`

> 原设计定稿把运维手册编为 `docs/29`。本文占用 `docs/29`，故运维手册顺延为 **`docs/30`**。

### 第 2 步：执行计划

写完后按 `writing-plans` 的约定，给用户二选一：**Subagent-Driven（推荐）**或 **Inline Execution**。

---

## 7. `ci.yml` 的配置要点（本轮已核实，可照抄）

- **runner**：`ubuntu-latest`（= ubuntu-24.04）。镜像实测：Node.js 22.x（用 `setup-node` 覆盖成 24）、
  Google Chrome 152 在 `/usr/bin/google-chrome`、ChromeDriver 152、PostgreSQL **16.15** 在 `/usr/lib/postgresql/16/bin`。
- **触发**：`pull_request`、`push` 到 `main`、`workflow_dispatch`。
- **并发**：`concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`。
- **Node**：`actions/setup-node@v7.0.0`，`node-version: 24`，`cache: npm`。
- **依赖**：`npm ci`（A4 见 §8）。
- **Chrome**：`browser-actions/setup-chrome@v2.2.0`。
  输入：`chrome-version`（默认 `stable`）、`install-dependencies`、`install-chromedriver`、`no-sudo`；
  输出：`chrome-version` / `chrome-path` / `chromedriver-version` / `chromedriver-path`；`runs.using: node24`。
  **把 `chrome-path` 导出给 `CHROME_PATH`**（`scripts/lib/find-browser.mjs` 的契约就是「`CHROME_PATH` 指向一个可执行文件」）。
  镜像本身也已把 `CHROME_BIN=/usr/bin/google-chrome` 写进 `/etc/environment`，两条路都通。
- **PostgreSQL**：**不要**把整个 job 放进 `container:`（`initdb` 拒绝 root）。
  用镜像自带的 PG 16.15：先 `sudo systemctl start postgresql.service`（**镜像默认是停的**），
  再给步骤设 `MOLLY_PG_BIN=/usr/lib/postgresql/16/bin`（`verify-sql.mjs` 会优先读它）。
  `PG_ROOTS` 里本来就有这个路径，设环境变量只是让它更早命中。
- **执行顺序**：**严格串行**。`verify:sql` 绝不能与其它 verify 并行（会撞 `query()` 的 60s 超时，报一串假失败）。
- **失败产物**：`actions/upload-artifact@v7.0.1` 上传 `dist/` 与 `SHOT_DIR` 截图目录。
  三个浏览器脚本**都支持 `SHOT_DIR`**（`verify-local` 有多处 `shot()`、`verify-pwa` 有 `shotHere()`、
  `verify-sync` 在 01-bound / 02-after-push / 03-failed 三处截图）。
- **凭据**：**零**。工作流不读任何 Supabase / Vercel secret。
- **不要**注入 `VITE_SUPABASE_*`：那是构建期内联变量，注错了会翻转 `cloudSyncConfigured`，
  破坏 `verify:local` 的「未配置云端时零跨域请求」断言。
  （`verify:sync` 会**自己**用假云端地址起 dev server，`verify:pwa` 自己跑 `build:no-empty`，都不依赖 workflow 的 env。）

---

## 8. 待证伪的四个假设（A1–A4）与判定方式

必须靠**一次真 CI 运行**判定，不许推测。

| 假设 | 内容 | 已静态成立的部分 | 证伪后的处置 |
| --- | --- | --- | --- |
| A1 | 三个浏览器验收能在 Linux + `CHROME_PATH` 下跑通 | 脚本无硬编码 Windows 路径；`taskkill` 只有 win32 分支，非 win32 走 `child.kill()`；`find-browser.mjs` 已含 `/usr/bin/google-chrome`、`/usr/bin/chromium` | 该项在 CI 标为「仅本机」，**断言强度不降级** |
| A2 | `verify:sql` 能在 GitHub 的 PG 16 + **非 root** 下跑通 | `PG_ROOTS` 已含 `/usr/lib/postgresql/16/bin`；脚本直接拉 `postgres` 而非 `pg_ctl start`；用 `-A trust` + 临时端口 | 同上 |
| A3 | 自写 CDP 驱动在 CI 沙箱里不失败 | 三个脚本都**没有**加 `--no-sandbox`，只用 `--headless=new`…… | 同上（若失败，优先怀疑 sandbox） |
| A4 | `npm ci` 不依赖那两个 567 MB 的 `.npm-cache*` | lockfile 含 23 条 linux 原生可选依赖（见 §3.8）；`npm config get cache` 指向用户级缓存，与项目内目录无关 | 调整缓存策略 |

> **A1 的额外前提**：先修好 §4.1。不修的话 CI 一定红，而且红的原因不是 A1，会把判断带偏。

---

## 9. 需要用户在场的动作（AI 不做、也不假装做）

| 动作 | 原因 |
| --- | --- |
| Vercel 控制台 → Connect Git Repository（项目 `littlemolly-main`，生产分支 `main`，框架 Vite，build `npm run build`，output `dist`，两个 `VITE_*` 仍在 production target） | 浏览器交互式 OAuth |
| Supabase 控制台 → Project Settings → Integrations → GitHub Integration → Authorize → 选仓库 → Working directory `.` → Enable | 浏览器交互式 OAuth |
| 启用集成后把 Supabase 的检查设为 **required status check** | 仓库设置 |
| 首次 `git push` 前对「仓库公开」的最终点头 | 不可逆的公开行为 |
| PR 合并 / `git push` 确认 | 账户级发布决定 |

**其余都可代做**：`gh` 已登录（`repo` + `workflow` scope 齐全），建仓 + push 不需要新凭据。

**仍然拿不到的东西**（本轮未解决）：`VERCEL_TOKEN`（旧的已 403 invalidToken，需要新 token）、
`SUPABASE_DB_URL`、`SUPABASE_MCP_TOKEN`。若要做 Supabase 生产端的只读结构核对 / Vercel 环境变量回读，
需要用户提供。**拿到新 token 之前不要假装线上验证过。**

---

## 10. 硬规则与踩坑（与既有文档一致，重申最容易被违反的）

1. **本地 IndexedDB 恒为唯一写入落点**；`capabilities.ts` 的 `DATA_BACKEND` 是常量 `'local'`。
2. **绝不伪装成功**：本地保存 ≠ 云端同步成功；队列排空也**不说「已同步」**；整体替换说「替换」不说「同步」。
3. **只用 anon / publishable key**，绝不用 `service_role`。
4. **别往 `public/` 加 `_redirects`**，别生成 `dist/404.html`（一条 `/* /index.html 200` 会让整站白屏）。
5. `vercel.json` 与 `public/_headers` **一字不改**。
6. **九套验收一个都不降级、一个都不跳过**。跑不了的项必须**明确标为「仅本机」**——
   静默跳过在 CI 上与通过长得一模一样。
7. **项数变了要同步四处**：`README.md` 命令清单、`scripts/launcher.mjs` 的 `note`、
   `docs/19-sync-execution-plan.md` §4 基线表、`HANDOFF.md` 的「当前基线」。
8. **写验收脚本绝不假定「今天是工作日」**（周六 / 周日是休息日，会派生一堆假失败）。
9. **同一文件一次只发一个 Edit**（并行 Edit 会互相覆盖，且每个都返回成功）。
10. **`.gitattributes` 必须在首次 `git add` 之前就位**，之后要 `git add --renormalize .`。

### 本机工具坑（本轮踩到的）

- `pwsh` 里 `<` 重定向不支持（`The '<' operator is reserved for future use`）；要用 `cmd /c "... < nul"`。
- `pwsh` 的 `Set-Content -Encoding UTF8` 会写 BOM，控制台还会把中文显示成 mojibake。
  写中文文件用 `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`。
- `$raw -join "`n"` 在空结果上会抛 `You cannot call a method on a null-valued expression`；
  取 blob 用 `git cat-file blob <hash> > file` 再读字节。
- `web_search` 工具当前**坏了**（`DeepSeek returned no web_search_tool_result blocks`）。
  用 `web_fetch` + `gh api` + `curl.exe`（配 `HTTPS_PROXY=http://127.0.0.1:7897` 更稳）替代。
- `Get-Content` 读中文文件在 PowerShell 控制台会 mojibake，但**文件本身是 UTF-8 正常的**；
  要判断内容请用 `read` 工具或 `[System.IO.File]::ReadAllText`。

---

## 11. 未决 / 存疑（不要当成结论）

1. **GitHub secret scanning 会不会对 `service_role` 这个角色名告警** —— 判断是「不会」（它是角色名不是密钥值），
   但**未实测**。首次 push 后请看一眼 Security 页签。若告警，逐个把上下文改成「服务端角色」措辞即可。
2. **`verify-local` 的 2200ms 固定等待在 CI 上够不够** —— 本机够（119/119），CI 未验。
   建议照 §4.1 一并改成轮询。
3. **`supabase/config.toml` 里 `project_id` 用目录名** 是否会给官方集成带来影响 —— 判断是「无影响」
   （只是本地区分标识），未实测。
4. **官方集成对已应用的六个迁移是否 no-op** —— 依据文档判断为「是」（迁移记录表已存在），
   **需在启用集成后实测确认**（设计定稿 §6 第 8 步已列此条）。
5. **`--check` 的反证**（故意制造漂移 → CI 红 → 修回 → 绿）**尚未做**，是设计定稿 §7 第 6 条的验收项。

---

## 12. 一句话交接

> 设计已定稿并确认（`docs/superpowers/specs/2026-09-22-cicd-pipeline-design.md`，330 行）。
> 本机九套验收里**八套全绿**，`verify:sync` 因为 `goto()` 固定等待 2600ms 太短而**必然失败**，
> 修法已验证（改轮询 → 74/74）。下一步：先修 `verify-sync` 的等待 + `.gitignore` 的否定规则顺序，
> 再用 `writing-plans` 把设计定稿 §6 展开成 `docs/superpowers/plans/2026-09-22-cicd-pipeline.md`，
> 然后执行到「PR 跑真 CI 判定 A1–A4」为止；线上接入（Vercel / Supabase 控制台）必须用户在场。