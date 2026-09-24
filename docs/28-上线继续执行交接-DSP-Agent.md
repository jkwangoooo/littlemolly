# 幸福小Molly 上线继续执行交接（DSP Agent）

> 交接时间：2026-09-22  
> 项目目录：`D:\WJKHome\小人项目包\littlemolly-main`  
> 必读文档：`docs/26-S6-handoff-for-codex.md`、`docs/27-deploy-runbook-for-codex.md`

---

## 0. 一句话结论

初次上线已经完成并通过线上 HTTP 自检，生产站点可访问。DSP Agent 接手后的首要任务是**只读复核当前状态**，确认无漂移后，再决定是否需要重新部署、接入 GitHub 自动部署或补跑本地验收。

**不要在未复核的情况下重跑迁移、覆盖环境变量或重新部署。**

---

## 1. 当前上线状态

### Supabase

- 项目 ref：`vofgywgccydxtsgiuynu`
- Project URL：`https://vofgywgccydxtsgiuynu.supabase.co`
- 迁移文件：`deploy/supabase-all-migrations.sql`
- 已执行并验证：
  - `12` 张 `public` 基础表
  - `3` 个 RPC：`cloud_sync_summary`、`export_cloud_snapshot`、`import_local_backup`
  - `21` 条 RLS 策略
  - `notify pgrst, 'reload schema';` 已执行
- 当前表清单：
  `custom_tasks`、`daily_exercise_items`、`daily_meal_items`、`daily_meals`、`daily_supplements`、`day_plans`、`exercise_options`、`food_options`、`profiles`、`routine_tasks`、`supplement_templates`、`sync_test_records`

### Supabase Auth

以下配置已通过 Supabase Management API 写入并回读确认：

- `mailer_autoconfirm = true`，即 Confirm email 已关闭
- `external_email_enabled = true`
- `site_url = https://littlemolly-main.vercel.app`
- `uri_allow_list = https://littlemolly-main.vercel.app/**,https://littlemolly-main.vercel.app`

如果交付流程要求人工留痕，可让用户在 Supabase Console 的 Authentication -> URL Configuration 再截图复核，但技术上无需重复配置。

### Vercel

- 账号：`jkwangoooo`
- Team：`jkwangoooos-projects`
- Team ID：`team_yXVK3tIpM7xenj7QBXf0Iq2c`
- Project：`littlemolly-main`
- Project ID：`prj_xjf5dbtVuZ80TUDHgPmpoVvadtez`
- 生产部署 ID：`dpl_3TFYnZtoR6tn1wuDoUsHDRXpmY7w`
- 生产部署状态：`READY`
- `aliasAssigned = true`
- 主生产地址：`https://littlemolly-main.vercel.app`
- Team 生产别名：`https://littlemolly-main-jkwangoooos-projects.vercel.app`
- Deployment URL：`https://littlemolly-main-qrdrtmm27-jkwangoooos-projects.vercel.app`

生产环境变量已配置：

- `VITE_SUPABASE_URL`，target 为 `production`
- `VITE_SUPABASE_ANON_KEY`，target 为 `production`

已确认生产 bundle 内联了 Supabase URL 和 publishable key，未发现 `sb_secret_`、`service_role` 内容。

### 线上 HTTP 自检结果

已对 `https://littlemolly-main.vercel.app` 得到真实响应：

- 首页：`HTTP/1.1 200 OK`
- `<title>`：`幸福小Molly`
- 深链 `/some/deep/link`：`HTTP/1.1 200 OK`
- `/sw.js`：`Cache-Control: no-cache, no-store, must-revalidate`
- `/manifest.webmanifest`：`Cache-Control: no-cache`
- 构建资源 `/assets/index-Diz3wewX.js`：`Cache-Control: public, max-age=31536000, immutable`
- 生产 JS bundle：包含 `vofgywgccydxtsgiuynu.supabase.co` 和 `sb_publishable_`，未包含 secret key 或 service role

---

## 2. DSP Agent 的交接目标

按优先级执行：

1. 只读复核 Supabase、Vercel、线上 HTTP 状态是否与本文档一致。
2. 在本机环境允许时补跑 `npm run verify:pwa`，目标 `49/49`。
3. 如有新需求，再改环境变量或重新部署；不要无理由重复部署。
4. 如需 GitHub -> Vercel 自动部署，完成 GitHub 仓库接入并复测生产域名。
5. 按 `docs/27` §8 格式输出最终报告。
6. 所有凭据只通过环境变量或平台 Secret 注入，不写入仓库。

---

## 3. 凭据要求

DSP Agent **不能把密钥写入仓库或文档**。执行前由用户注入当前进程中，或由 Vercel/Supabase 平台提供。

| 变量 | 用途 | 要求 |
| --- | --- | --- |
| `VERCEL_TOKEN` | Vercel CLI/API 操作 | 使用用户新生成的有效 token；只允许 `--token`，禁止 `vercel login` |
| `VITE_SUPABASE_URL` | 前端构建期内联 | 使用 Project URL，不带尾部斜杠 |
| `VITE_SUPABASE_ANON_KEY` | 前端构建期内联 | 只允许 publishable/anon key，禁止 `service_role` |
| `SUPABASE_DB_URL` | 数据库迁移/查询 | 仅在需要迁移或 SQL 验证时使用 |
| `SUPABASE_MCP_TOKEN` | Supabase Management API | 可选；用于 Auth 配置、数据库 query 和项目级只读复核 |

此前会话中粘贴的 Vercel token 做 API 调用时返回过 `403 invalidToken`。DSP Agent 如要继续操作 Vercel，应让用户新生成 token，不要复用过期或已撤销的值。此前粘贴过的 Supabase PAT 应按安全流程轮换。

---

## 4. 硬规则，不允许违反

1. 本地 IndexedDB 永远是唯一写入落点；云端是可选上行通道。
2. 绝不使用 `service_role`。前端只能使用 publishable/anon key。
3. `VITE_*` 是构建期内联变量：必须先在 Vercel 设置，再部署；改了值必须重新部署。
4. 禁止运行交互式 `vercel login`，只能使用 `vercel --token=...`。
5. 不要添加 `public/_redirects`。
6. 不要生成或部署 `dist/404.html`。
7. 不要无依据修改 `vercel.json` 的四组 headers/rewrite 口径。
8. 没拿到真实输出，不得宣称“已上线”或“同步成功”。
9. 失败就如实报告；不能用本地保存成功冒充云端同步成功。
10. `.git` 在本机不可用。删除文件前先备份到 `.workbuddy-ai/backup/<说明>/`。

---

## 5. 建议的首要复核命令

### 5.1 项目基础检查

```powershell
Set-Location "D:\WJKHome\小人项目包\littlemolly-main"
node -v
npm -v
```

### 5.2 TypeScript 与 lint

```powershell
npm run typecheck
npm run lint
```

当前环境如果因为只读沙箱导致 `tsbuildinfo` 写入 `EPERM`，改用：

```powershell
npx tsc -p tsconfig.app.json --noEmit --incremental false --pretty false
npx tsc -p tsconfig.node.json --noEmit --incremental false --pretty false
npm run lint
```

### 5.3 PWA 回归

```powershell
npm run verify:pwa
```

目标：`49/49` 通过。  
如果当前会话因沙箱禁止创建子进程而报 `spawn EPERM`，不要把它判为产品失败；需要在可写、允许子进程的本地终端或用户环境中重跑。

### 5.4 其他项目检查

```powershell
npm run check:dates
npm run check:local-data
npm run check:backup
npm run check:cloud-parity
npm run check:sync
```

---

## 6. Supabase 复核

### 6.1 数据库结构复核

如果本机有 `psql` 且用户提供 `SUPABASE_DB_URL`：

```powershell
psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f deploy/supabase-all-migrations.sql
psql "$env:SUPABASE_DB_URL" -c "notify pgrst, 'reload schema';"
psql "$env:SUPABASE_DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
psql "$env:SUPABASE_DB_URL" -tAc "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1"
psql "$env:SUPABASE_DB_URL" -tAc "select count(*) from pg_policies where schemaname='public'"
```

预期：

- 表数：`12`
- RPC 包含：`cloud_sync_summary`、`export_cloud_snapshot`、`import_local_backup`
- RLS 策略数：`21`

如果本机没有 `psql`，优先使用 Supabase SQL Editor、Supabase MCP 或用户提供的 Management API token 做同等查询。不要凭猜测报告成功。

### 6.2 Auth 复核

通过 Supabase Management API 回读：

```text
GET https://api.supabase.com/v1/projects/vofgywgccydxtsgiuynu/config/auth
Authorization: Bearer <SUPABASE_MCP_TOKEN>
```

确认：

```json
{
  "mailer_autoconfirm": true,
  "external_email_enabled": true,
  "site_url": "https://littlemolly-main.vercel.app",
  "uri_allow_list": "https://littlemolly-main.vercel.app/**,https://littlemolly-main.vercel.app"
}
```

---

## 7. Vercel 复核与重新部署

### 7.1 复核环境变量

```powershell
npx vercel env ls production --token="$env:VERCEL_TOKEN"
```

必须包含 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`，target 包含 `production`。

### 7.2 只有在值需要变更时才覆盖环境变量

```powershell
npx vercel env add VITE_SUPABASE_URL production --force --yes --token="$env:VERCEL_TOKEN"
npx vercel env add VITE_SUPABASE_ANON_KEY production --force --yes --token="$env:VERCEL_TOKEN"
```

以上命令会让 CLI 从标准输入读取值。不要把真实值写进脚本、文档或 shell history。

### 7.3 重新生产部署

环境变量确认完成后：

```powershell
npx vercel deploy --prod --yes --token="$env:VERCEL_TOKEN"
```

不要使用 `--prebuilt`，不要运行 `vercel login`。部署后记录 stdout 中的可访问 URL，等待 `READY`，再执行 §8 的线上自检。

---

## 8. 部署后自检

```bash
D="https://littlemolly-main.vercel.app"

curl -s -o /dev/null -w "首页 HTTP %{http_code}\n" "$D/"
curl -s "$D/" | grep -o "<title>[^<]*</title>"

curl -sI "$D/sw.js"                | grep -i "^cache-control"
curl -sI "$D/manifest.webmanifest" | grep -i "^cache-control"

ASSET=$(curl -s "$D/" | grep -o '/assets/[^"]*\.js' | head -1)
echo "构建资源 $ASSET"
curl -sI "$D$ASSET" | grep -i "^cache-control"

curl -s -o /dev/null -w "深链 HTTP %{http_code}\n" "$D/some/deep/link"
```

通过标准：

- 首页 HTTP `200`
- 页面标题为 `幸福小Molly`
- `/sw.js` 含 `no-cache`
- `/manifest.webmanifest` 含 `no-cache`
- `/assets/*.js` 含 `immutable`
- 深链返回 `200`，不能是 `404`

### 当前机器网络异常说明

这台机器发生过：

- 系统 DNS 对 `littlemolly-main.vercel.app` 返回污染地址
- `curl.exe` 走 Schannel 时报 `SEC_E_NO_CREDENTIALS`
- 终端进程带有不可用的代理变量 `http://127.0.0.1:9`
- Clash Verge 实际监听 `127.0.0.1:7897`

可先清理进程级代理，再从正常网络环境复核。若必须在当前机器执行，可使用 Node 的 TLS 手动 CONNECT 方式绕过 Schannel 和 DNS 污染，目标 Vercel anycast IP 使用 `76.76.21.21`，代理使用 `127.0.0.1:7897`。自检脚本必须以真实 HTTP status 和 headers 为准，不得用推测代替。

---

## 9. GitHub -> Vercel 一键部署

可以接入 GitHub 自动部署，但当前不是上线必需项。

当前限制：

- 本机项目没有可用 `.git`
- 没有已绑定的 GitHub remote
- 所以不能直接把现有目录推送为 GitHub 仓库

后续如需自动部署：

1. 用户或 DSP Agent 创建 GitHub 仓库。
2. 将源码推送到仓库，确保 `.env.local`、token 和任何 secret 不入库。
3. 在 Vercel 中 Import Git Repository。
4. 保持 Project 为 `littlemolly-main` 或新建项目。
5. 在 Vercel 配好 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 的 `production` 变量。
6. 触发一次生产部署。
7. 复跑 §8 线上自检和 `docs/27` §8 报告。

注意：即使使用 GitHub 一键部署，`VITE_*` 仍然必须在 Vercel 先配置，否则构建产物不会包含 Supabase 配置。

---

## 10. 当前未完成、失败或需要人工确认的点

1. 本轮只读沙箱下，标准 `npm run typecheck` 因 `tsbuildinfo` 写入 `EPERM` 失败；跳过增量输出的 TypeScript 检查已通过。
2. 本轮只读沙箱下，`npm run verify:pwa` 因 `spawn EPERM` 无法重跑；此前该验收已通过 `49/49`。DSP Agent 应在可写环境补一次可复现记录。
3. 此前会话中粘贴的 Vercel token 返回 `403 invalidToken`，后续 Vercel CLI 操作需要用户提供新 token。
4. Supabase PAT 曾用于 Management API 配置 Auth，交付后应轮换。
5. GitHub 自动部署尚未配置；若产品要求持续交付，需要单独完成。
6. 如果 Supabase 控制台要求留存人工操作痕迹，可让用户在 Auth URL Configuration 页面截图确认一次。技术上当前值已通过 API 回读验证。

---

## 11. 最终报告格式

DSP Agent 完成后按 `docs/27` §8 输出：

```text
## 部署报告

- 线上地址：https://...        附 curl 验证：首页 200 / SW no-cache / 深链 200
- Supabase 项目 ref：vofgywgccydxtsgiuynu
- 迁移结果：12 张表 / 三个 RPC 齐全 / 21 条 RLS 策略
- 已完成的：迁移 / schema cache 刷新 / Vercel 环境变量 / 部署 / 自检
- 需要用户去控制台做的：如有，必须明确写；没有则写“无”
- 未完成或失败的点：如实写，没有失败就写“无”
```

报告不得包含任何密钥。不要因为本地命令通过就删除线上自检；线上 HTTP 真实返回才算上线验证完成。