# AGENTS.md

> 给在本仓库工作的编码代理（Codex / Claude Code / 其它）。**先读 `docs/26-S6-handoff-for-codex.md`**，
> 那是自包含的接手文档（当前状态、硬规则、待办、踩过的坑、验收命令）。

## 项目

「幸福小Molly」——本地优先 + 云端可选的个人日程 PWA（React 19 + TS + Vite + IndexedDB + Supabase）。

**当前进度**：S1–S5 已完成，本机九套验收全绿；S6 的部署配置（`vercel.json` / `public/_headers`）
也已就位。只剩 S6 的 T3–T5——它们需要**真实 Supabase 凭据**（仓库里没有 `.env.local`）与真机。

## 三条最容易违反的硬规则

1. **本地 IndexedDB 恒为唯一写入落点**；云端只是可选上行通道（`capabilities.ts` 的
   `DATA_BACKEND` 是常量 `'local'`，不是配置）。**Supabase 环境变量只在这里读一次。**
2. **绝不伪装成功**。本地保存 ≠ 云端同步成功，两套文案永远分开；队列排空也**不说「已同步」**；
   整体替换说「替换」不说「同步」，失败就如实报错。这类问题 `typecheck` / `lint` / `build` 全都不报，
   只有那套验收断言会拦。
3. **界面层只 import `src/services/api/` 门面**，不得直接引用 `localDb` / `indexedDB` / 云端 SDK。
   `services/cloud/` 只有 `errors` / `identity` / `rpc` / `supabase` 四个模块，
   且 `api/syncService.ts` 必须用 `await import()` 转发（否则 supabase 会被打进主 chunk）。
4. **别往 `public/` 加 `_redirects`**。Cloudflare 文档说它的规则「不管有没有静态资源匹配都会执行」，
   一条 `/* /index.html 200` 会把 `/sw.js` 与 `/assets/*` 一起改写成 HTML → 整站白屏，
   本地完全看不出来。Pages 无顶层 `404.html` 时自带 SPA 回退，不需要它。

## 改完之后

```bash
npm run typecheck && npm run lint
npm run check:dates && npm run check:local-data && npm run check:backup && npm run check:cloud-parity && npm run check:sync
npm run verify:local
```

改了 PWA 外壳或部署配置（`vercel.json` / `public/_headers`）→ 追加 `verify:pwa`（49）｜
改了 `services/sync/` → 追加 `verify:sync`（74）｜
改了 `database/migrations/` 或三个云端 RPC → 追加 `verify:sql`（39，需本机 PostgreSQL 16+）。

**项数变了要同步四处**：`README.md` 命令清单、`scripts/launcher.mjs` 的 `note`、
`docs/19-sync-execution-plan.md` §4 基线表、`HANDOFF.md` 的「当前基线」。

## 要部署时（Supabase + Vercel）

**先读 `docs/27-deploy-runbook-for-codex.md`**——那是给执行者（你）的部署说明书，
含凭据清单、逐步命令、验证与报错处置。要点：

- **注册/登录只能用户做**；你拿 **Supabase 数据库连接串** + **`VERCEL_TOKEN`** 代跑。
- **不要跑 `vercel login`**（交互式会挂起），只用 `--token`。
- `VITE_*` 是**构建期内联**变量：**先设 Vercel 环境变量、再部署**，改了要重新部署。
- 只用 **anon key**；**绝不**用 `service_role`。
- 迁移用 `deploy/supabase-all-migrations.sql`（6 个迁移合并成的单文件，已在真库验证）。
- **拿不到凭据就停下要**，不要假装部署成功。

## 环境注意

- **`.git` 在本机不可用**，没有回滚。删除文件前先 `cp -r` 到 `.workbuddy-ai/backup/<说明>/`。
- 写验收脚本**绝不假定「今天是工作日」**（周六 / 周日是休息日，会派生一堆假失败）。
- **同一文件一次只发一个 Edit**（并行执行的多个 Edit 会互相覆盖，且每个都返回成功）。
