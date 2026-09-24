# 部署说明书 · 给 Codex 执行（幸福小Molly）

> 你是**执行者**。用户会把这份文档交给你，让你把项目上线到 **Supabase（后端）+ Vercel（前端）**。
> 项目路径：`D:\WJKHome\小人项目包\littlemolly-main`
> 配套文档：`docs/26-S6-handoff-for-codex.md`（项目全貌与硬规则）、`DEPLOY.md`（给用户看的点击版）。
>
> **先读 §1。那份凭据清单没凑齐之前，不要往下做，也不要假装做完了。**

---

## 交接提示词（用户把下面这段发给 Codex）

> 复制下面整段，把两个 `<...>` 换成真实凭据（还没拿到就先留空，让 Codex 找你要）。

```
请接手「幸福小Molly」项目的上线部署。项目在 D:\WJKHome\小人项目包\littlemolly-main

先读这两份自包含文档，再动手：
1. docs/27-deploy-runbook-for-codex.md  ← 你要照它执行的部署说明书
2. docs/26-S6-handoff-for-codex.md      ← 项目全貌与硬规则

任务：把这个 PWA 部署到 Supabase（后端）+ Vercel（前端）。

我提供给你：
- Supabase 数据库连接串（URI）：<粘贴>
- Vercel Token：<粘贴>

硬性要求：
- 严格按 docs/27 执行，**包括里面的「验证」和「部署后自检」，不许跳步**。
- 不要运行 `vercel login`（交互式会挂起），只用 `--token`。
- 只用 anon key，绝不用 service_role。
- VITE_* 是构建期内联变量：**先设 Vercel 环境变量、再部署**。
- 有一件事你做不了、必须我来做：Supabase 控制台的 Auth 配置
  （关闭 Confirm email、填 Site URL / Redirect URLs）。到那一步停下来提醒我。
- 每一步都用真实输出验证；**没验证过就不要说「已上线」**，失败就如实说失败。
- 凭据不全就停下来找我要，不要跳过、不要假装完成。

做完按 docs/27 §8 的格式给我报告：线上 URL、Supabase 项目 ref（不要贴密钥）、
迁移结果（表数 / 三个 RPC / 策略数）、需要我做的事、未完成或失败的点。
```

---

## 0. 快速路径（凭据齐全时，6 条命令）

```bash
# 前置
npm ci && npm run typecheck && npm run lint

# Supabase：建表 + 策略 + 三个 RPC
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f deploy/supabase-all-migrations.sql
psql "$SUPABASE_DB_URL" -c "notify pgrst, 'reload schema';"

# Vercel：先设两个构建期变量，再部署
npx vercel env add VITE_SUPABASE_URL production < /tmp/molly-url.txt --force --yes --token="$VERCEL_TOKEN"
npx vercel env add VITE_SUPABASE_ANON_KEY production < /tmp/molly-key.txt --force --yes --token="$VERCEL_TOKEN"
npx vercel deploy --prod --yes --token="$VERCEL_TOKEN"
```

> 细节、验证、报错处置在下面各节。**别跳过 §3.2 的验证和 §6 的自检。**

---

## 1. 你无法自己完成的事 + 必须向用户索取的东西

**注册与登录都是账号绑定的交互式授权，你做不到。** 因此：

| 平台 | 你要向用户要 | 用户去哪拿 |
| --- | --- | --- |
| Supabase | **数据库连接串（URI）** | 控制台 → Project Settings → Database → Connection string → **URI** |
| Supabase | 项目已建好（这一步也只能用户做） | <https://supabase.com/dashboard> → New project |
| Vercel | **`VERCEL_TOKEN`** | <https://vercel.com/account/tokens> → Create Token |

### 红线（违反即失败）

- **不要运行 `vercel login`**——它是交互式的，会挂起等待浏览器授权。只用 `--token`。
- **不要打开浏览器去登录 Supabase**。你只用连接串做数据库操作。
- **拿不到凭据就停下来要**，不要「先做一部分然后说完成了」。
- **绝不索取、绝不使用 `service_role` key**。前端只用 **anon key**——它是**公开值**，
  设计上就会暴露给浏览器，不算泄漏（`VITE_SUPABASE_ANON_KEY` 这个名字里的 `VITE_` 就表示「会进产物」）。
- **绝不在没验证过的情况下说「已上线」**（见 §6）。

### 用户做不了、只能你做的部分

- 跑迁移、刷新 schema cache、设 Vercel 环境变量、部署、跑自检 —— 都是你的活。

---

## 2. 前置检查

```bash
cd "D:\WJKHome\小人项目包\littlemolly-main"
node -v          # 需要 ≥ 20
npm ci           # 依赖没装才需要
npm run typecheck && npm run lint
```

预期：两者都通过（当前基线如此）。

> 本机 **`.git` 不可用**（提交不了、也推不了 GitHub）。这不影响部署——
> `vercel deploy` 是**直接上传本地目录**的，不依赖 git。
> 另外：**本机没装 `vercel` / `supabase` CLI**，用 `npx` 临时拉即可（首次会自动下载）。

---

## 3. Supabase

### 3.1 跑迁移

`deploy/supabase-all-migrations.sql` 是 `database/migrations/` 下 6 个迁移按文件名顺序
合并成的**单文件**（已在真库验证：退出码 0 / 12 张基表 / 三个 RPC / 21 条策略）。

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f deploy/supabase-all-migrations.sql
```

或用 Supabase CLI：

```bash
npx supabase db push --db-url "$SUPABASE_DB_URL"
```

**怎么看输出**：

- 退出码必须是 **0**。
- 会刷出一批 `NOTICE: trigger "..." for relation "..." does not exist, skipping` /
  `NOTICE: policy "..." ... does not exist, skipping`——那是 `drop ... if exists` 的正常提示，
  **不是错误**，不要为此中断。
- **只有 `ERROR:` 才是失败**。有 `ERROR:` 就停下，把原文贴给用户。

### 3.2 验证（**必须做**，别只看退出码）

```bash
# 表：期望 12
psql "$SUPABASE_DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"

# 函数：期望包含三个 RPC
psql "$SUPABASE_DB_URL" -tAc "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1"

# RLS 策略：期望 21
psql "$SUPABASE_DB_URL" -tAc "select count(*) from pg_policies where schemaname='public'"
```

三个 RPC 必须是：`cloud_sync_summary` / `export_cloud_snapshot` / `import_local_backup`。
**数字对不上就如实报给用户**，不要含糊过去。

### 3.3 刷新 PostgREST 的 schema cache（**最容易忘**）

新建的函数不会立刻出现在 API 里，忘了这一步前端会报
`Could not find the function 'public.import_local_backup(payload)' in the schema cache`。

```bash
psql "$SUPABASE_DB_URL" -c "notify pgrst, 'reload schema';"
```

### 3.4 Auth 配置（**你做不了，交给用户**）

这两件事必须在 Supabase 控制台点，没有可靠的 CLI：

1. **关闭 Confirm email**：Authentication → Sign In / Providers → Email → 关掉 *Confirm email*。
   不关的话 `signUp` 拿不到会话（本项目没配 SMTP）。
2. **填域名**：Authentication → URL Configuration → `Site URL` 与 `Redirect URLs`
   填第 4 步拿到的 Vercel 域名。

→ **明确告诉用户「请你去做这两步，做完告诉我」**，然后继续。不要跳过、也不要自己编。

---

## 4. Vercel

### 4.1 先设两个**构建期**环境变量（必须先于部署）

```bash
# 值写进临时文件再重定向——不要用 echo 管道（会把密钥留在 shell history 里）
printf '%s' "$VITE_SUPABASE_URL"      > /tmp/molly-url.txt
printf '%s' "$VITE_SUPABASE_ANON_KEY" > /tmp/molly-key.txt

npx vercel env add VITE_SUPABASE_URL      production < /tmp/molly-url.txt --force --yes --token="$VERCEL_TOKEN"
npx vercel env add VITE_SUPABASE_ANON_KEY production < /tmp/molly-key.txt --force --yes --token="$VERCEL_TOKEN"

rm -f /tmp/molly-url.txt /tmp/molly-key.txt
```

> `VITE_SUPABASE_URL` 取 Project URL，**结尾不要带斜杠**。

**为什么必须在部署之前**：`VITE_*` 是 Vite 的**构建期内联**变量——构建时被替换成字面量写进 JS。
先部署后设变量，产物里就没有云端能力。**改了变量也要重新部署才生效。**

### 4.2 部署

```bash
npx vercel deploy --prod --yes --token="$VERCEL_TOKEN" > /tmp/molly-deploy-url.txt 2> /tmp/molly-deploy-err.txt
code=$?
if [ $code -eq 0 ]; then
  echo "部署成功，URL："; cat /tmp/molly-deploy-url.txt
else
  echo "部署失败："; cat /tmp/molly-deploy-err.txt
fi
```

- **stdout 就是部署 URL**，stderr 是错误，退出码非 0 即失败。
- **不要加 `--prebuilt`**：它会绕过 Vercel 的构建环境，而我们需要 `VITE_*` 在那边生效。
- 首次部署新项目时 `--yes` 会用默认值（项目名从目录名推断）自动应答，不会卡住。
- 若提示需要 scope/team，补 `--scope <你的 scope>`。

### 4.3 回报

把部署 URL 给用户，并提醒他去 §3.4 填 Site URL / Redirect URLs。

---

## 5. 备选：纯本地部署（用户暂时不配 Supabase）

不设 `VITE_*` 直接部署即可：

```bash
npx vercel deploy --prod --yes --token="$VERCEL_TOKEN"
```

产物是**纯本地模式**：功能完整、数据只存浏览器 IndexedDB、行为与单机完全一致，只是没有云端同步。
这是产品的**既定设计**（`capabilities.ts` 的 `DATA_BACKEND` 恒为 `'local'`），**不是降级**。
之后随时补上环境变量重新部署即可开启云端。

---

## 6. 部署后自检（**你必须跑，别只信「部署成功」**）

```bash
D="https://<第 4.2 步拿到的域名>"

curl -s -o /dev/null -w "首页 HTTP %{http_code}\n" "$D/"
curl -s "$D/" | grep -o "<title>[^<]*</title>"

# 缓存口径（vercel.json 里设的，必须对）
curl -sI "$D/sw.js"                | grep -i "^cache-control"   # 期望 no-cache
curl -sI "$D/manifest.webmanifest" | grep -i "^cache-control"   # 期望 no-cache

# /assets/* 长缓存（文件名从首页 HTML 里取一个 hash 文件）
ASSET=$(curl -s "$D/" | grep -o '/assets/[^"]*\.js' | head -1)
echo "抽查 $ASSET"; curl -sI "$D$ASSET" | grep -i "^cache-control"   # 期望 immutable

# SPA 深链接回退（期望 200，不是 404）
curl -s -o /dev/null -w "深链接 HTTP %{http_code}\n" "$D/some/deep/link"
```

若本机改过源码，再跑一次回归：

```bash
npm run verify:pwa    # 期望 49/49
```

**全部通过才可以说「已上线」。** 任何一项不过，如实报告。

---

## 7. 硬规则（违反会坏，而且验收不一定报得出来）

1. **绝不放 `service_role`**：前端只用 anon key。这个项目没有服务端，放进去等于把整个库交给浏览器。
2. **不伪装成功**：没拿到 URL 并 curl 验证过，就别说「已上线」；失败就说失败，别糊过去。
3. **`VITE_*` 是构建期内联**：先设变量、再部署；改了要重新部署。
4. **不要 `vercel login`**，只用 `--token`。
5. **不要加 `public/_redirects`**、**不要加 `dist/404.html`**：
   `_redirects` 的规则「不管有没有静态资源匹配都会执行」，一条 catch-all 会把 `/sw.js` 与
   `/assets/*` 一起改写成 HTML → **整站白屏**；而 `404.html` 会静默关掉 Cloudflare Pages 的
   内置 SPA 回退。`verify:pwa` 里有 6 条断言专门守这些。
6. **不要改 `vercel.json`**（4 条断言守着它）。要改先读 `docs/26` §5.1。
7. **`verify:sql` 不要与其它验收脚本并行跑**（会撞 60s 超时，报出一串假失败）。

---

## 8. 交付报告（给用户的最终输出，照这个格式）

```
## 部署结果

- 线上地址：https://...        （已 curl 验证：首页 200 / SW no-cache / 深链接 200）
- Supabase 项目 ref：xxxxxx    （不要贴任何密钥）
- 迁移结果：12 张表 · 三个 RPC 齐全 · 21 条 RLS 策略
- 我已完成的：迁移 / schema cache 刷新 / Vercel 环境变量 / 部署 / 自检
- 需要你去控制台做的：① 关闭 Confirm email ② 填 Site URL 与 Redirect URLs
- 未完成或失败的点：（如实列，没有就写「无」）
```

---

## 9. 卡住了怎么办（先查这张表）

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| 迁移报 `permission denied for schema auth` | `stage1` 要在 `auth.users` 上建触发器（`on_auth_user_created`），权限不够 | 让用户在 **Supabase SQL Editor** 里粘贴 `deploy/supabase-all-migrations.sql` 跑一遍（它以 `postgres` 身份运行） |
| 前端报 `Could not find the function ... in the schema cache` | schema cache 没刷新 | 回 §3.3 |
| 注册后没登录 / 拿不到会话 | Confirm email 没关 | 回 §3.4（用户操作） |
| 部署后页面**白屏** | 有人加了 `_redirects` 或 `404.html` | §7.5，删掉再部署 |
| 部署后没有云端功能 | `VITE_*` 没设，或设完没重新部署 | 回 §4.1，设完**重新部署** |
| `vercel` 命令挂起不动 | 你在跑交互式 `login` / 没带 `--yes` | 加 `--token` 与 `--yes` |
| 迁移输出一堆 `NOTICE` | `drop ... if exists` 的正常提示 | **不用管**，只有 `ERROR:` 才算失败 |

---

## 10. 一句话

**先要凭据，再动手；每一步都验证，别只信退出码；拿不到就停，绝不假装。**
