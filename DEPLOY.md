# 部署指南 · 幸福小Molly

> **目标**：把 PWA 部署到 **Vercel**（前端）+ **Supabase**（云端同步，可选）。
>
> **先说清楚**：这两步都必须用**你自己的账号**——我没有你的 Supabase / Vercel 账号，
> 无法代你注册、登录或点确认。但下面每一步都写到了「点哪里」，照着做大约 **15 分钟**。
> 如果你愿意把 **Vercel Token**（和/或 Supabase 数据库连接串）给我，我可以直接代你跑命令部署。

---

## 0. 部署形态

- **前端**：Vite 构建出的纯静态站点（`dist/`），部署到 Vercel。
- **后端**：Supabase（Postgres + Auth）。**可选**——不配也能跑，只是没有云端同步；
  未配置时应用行为与本地单机完全一致（这是产品的既定设计，不是降级）。
- `vercel.json` 已经写好（SPA 回退 + 缓存头），**不需要改**。

---

## 1. Supabase（约 8 分钟）

### 1.1 建项目

1. 打开 <https://supabase.com/dashboard> → **New project**。
2. 填 Name（随意）、Database Password（**记下来**，本项目其实用不到）、
   Region 选离你近的（如 Singapore / Tokyo）。
3. 等 1–2 分钟项目初始化完成。

### 1.2 跑迁移（建表 / RLS 策略 / 三个 RPC）

1. 左侧 → **SQL Editor** → **New query**。
2. 把 **`deploy/supabase-all-migrations.sql`** 整份粘进去（这是 6 个迁移按序合并成的单文件）。
3. 点 **Run**（或 `Ctrl+Enter`）。
4. 期望结果：`Success. No rows returned`。

> 想逐个执行也可以，直接用 `database/migrations/` 下的 6 个原文件，按文件名顺序跑，效果相同。
>
> **这个合并文件已经在本机真库上验证过**：起临时 PostgreSQL → 应用 auth 垫片 → 整份执行 →
> 退出码 0、**12 张 public 基表**、三个 RPC（`cloud_sync_summary` / `export_cloud_snapshot` /
> `import_local_backup`）齐全、**21 条 RLS 策略**。
> 执行时会有若干 `NOTICE: trigger/policy "..." does not exist, skipping` —— 那是
> `drop ... if exists` 的正常提示，**不是错误**。
>
> 若报错，把错误原文贴给我。**最可能的一条**是 `stage1` 要在 `auth.users` 上建触发器
> （`on_auth_user_created`）时报权限不足——Supabase 的 SQL Editor 以 `postgres` 身份运行，
> 通常可行；真报错就贴出来一起判断。

### 1.3 刷新 PostgREST 的 schema cache（**最容易忘的一步**）

新建的函数不会立刻出现在 API 里，否则前端会报
`Could not find the function 'public.import_local_backup' in the schema cache`。

在 SQL Editor 里再跑一句：

```sql
notify pgrst, 'reload schema';
```

（或者：Project Settings → API → **Reload schema cache**。）

### 1.4 Auth 配置

1. 左侧 → **Authentication** → **Sign In / Providers**：
   - 确认 **Email** 已启用。
   - **关掉 Confirm email**（否则注册后拿不到会话——本项目没有配 SMTP）。
2. 左侧 → **Authentication** → **URL Configuration**：
   - **Site URL**：先填 `http://localhost:5173`，等 Vercel 部署完再回来改成正式域名。
   - **Redirect URLs**：同样加上你的 Vercel 域名。

### 1.5 取两个值（第 2 步要用）

左侧 → **Project Settings** → **API**：

| 字段 | 形如 | 注意 |
| --- | --- | --- |
| **Project URL** | `https://abcdefgh.supabase.co` | **结尾不要带斜杠** |
| **anon / public key** | `eyJhbGciOi...` 一长串 | 只用 anon key |

> **绝不要**把 `service_role` key 放进前端——这个项目没有服务端，放进去等于把整个库交给浏览器。

---

## 2. Vercel（约 5 分钟）

两条路，**选一条**即可。因为本机 `.git` 不可用（提交不了、也推不了 GitHub），
推荐 **路线 B（CLI 直接上传本地目录）**。

### 路线 A：用 Vercel 控制台 + Git 仓库

1. 先把代码推到 GitHub（需要先修好本机 git，或在别的机器上推）。
2. <https://vercel.com/new> → 选你的仓库 → **Import**。
3. Framework Preset 会自动识别为 **Vite**：
   - Build Command：`npm run build`
   - Output Directory：`dist`
4. **在 Deploy 之前**展开 **Environment Variables**，加两个（见 1.5）：

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | 你的 Project URL（不带斜杠） |
   | `VITE_SUPABASE_ANON_KEY` | 你的 anon key |

5. 点 **Deploy**。

### 路线 B：Vercel CLI（不用 git，直接上传当前目录）

在本项目目录里逐条执行：

```bash
# 1. 登录（会打开浏览器让你授权，这一步只能你自己做）
npx vercel login

# 2. 关联 / 新建项目（首次会让你确认项目名、目录等，一路回车即可）
npx vercel

# 3. 写入两个环境变量（Vite 在「构建时」把它们内联进产物，所以必须在部署前设好）
npx vercel env add VITE_SUPABASE_URL production
npx vercel env add VITE_SUPABASE_ANON_KEY production

# 4. 正式部署
npx vercel --prod
```

> **顺序很重要**：`VITE_*` 是**构建期**变量。先设环境变量、再 `--prod`。
> 如果先部署后设变量，页面里会没有云端能力——重新 `npx vercel --prod` 一次即可。

### 只想要一个能打开的链接、暂时不配云端？

也可以。不加环境变量直接部署，应用会以**纯本地模式**运行（数据只存浏览器 IndexedDB），
行为与单机完全一致。之后随时补上环境变量重新部署，就能开启云端同步。

---

## 3. 部署完的自检（必做）

### 3.1 打开线上地址，确认应用壳正常

- 首屏应渲染登录页，文案是「本地模式」。
- 浏览器 DevTools → Application → **Service Workers**：应有已 activated 的 `sw.js`。
- 刷新一次，Network 里应看到 `sw.js` **不是** `304`/强缓存（`vercel.json` 里设了 `no-cache`）。

### 3.2 回到 Supabase 改 Site URL

把 1.4 里的 **Site URL / Redirect URLs** 改成你的 Vercel 正式域名。

### 3.3 跑真实凭据人工清单

按 `docs/18 §9.3`（也见 `docs/26` §5.2 第 4 步）逐项打勾，重点是：

1. 六个迁移在真实项目上按序执行成功，表 / 策略 / 触发器齐备。
2. 连接云端账号 → 上传 → 退出 → 重新登录 → 状态恢复。
3. **RLS 双账号**：账号 B 看不到账号 A 的任何数据（含子表）。
4. **断网**：写入本地成功、上传显示失败、恢复网络后自动补推成功。
5. **历史日期**：上传含历史计划的备份必须成功（GUC 豁免的主路径）。
6. **整体替换往返**：本地 → 云端 → 清空本地 → 云端 → 本地，逐项核对。
7. **真机**：手机上装 PWA，走完整流程；确认底部导航不被 Home 指示条遮挡。

### 3.4 上线前已在本机确认的事项（就绪检查，2026-09-21）

这些不需要凭据就能查，已经查过，结论如下：

| 检查项 | 结论 |
| --- | --- |
| 源码里读环境变量的地方 | **只有** `src/services/capabilities.ts` 读 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`；别处只用 `import.meta.env.DEV` / `PROD` / `BASE_URL` 这类 Vite 内置量 |
| 会不会把服务端密钥打进前端 | **不会**。全仓源码/配置 0 个真实密钥；`service_role` 只出现在注释与本地测试垫片（那里建的是**角色**，不是密钥） |
| `.env` 会不会被提交 | **不会**。`.gitignore` 忽略 `.env` / `.env.local` / `.env.*.local`，只保留 `.env.example` |
| 不设环境变量能否构建 | **能**，退出码 0，产物里 0 处项目 URL → 干净**纯本地**包 |
| 设了环境变量会不会生效 | **会**。设一个假 URL 构建后，该字符串被内联进 `assets/index-*.js`（入口 chunk） |
| 六个迁移能否一次粘贴执行 | **能**（见 §1.2 的验证结论：12 张表 / 3 个 RPC / 21 条策略） |
| 本机全量验收 | **全绿**：`check:*` 48/62/62/78/113、`verify:local` 119、`verify:pwa` 49、`verify:sync` 74、`verify:sql` 39 |

> **两条推论**：
> ① 环境变量是**构建期内联**的，所以 Vercel 上必须「先设变量、再 Deploy」，且**改了变量要重新部署**才会生效；
> ② 因为不设变量也能正常构建，所以「先发一版纯本地的、再补云端」是完全可行的路线，不存在「必须先配好 Supabase 才能上线」。

---

## 4. 我（AI）能帮你做的部分

| 事项 | 我能否代做 | 需要什么 |
| --- | --- | --- |
| 生成迁移 SQL / 部署配置 / 这份指南 | ✅ 已完成 | — |
| 在本地跑全部验收（含真库 `verify:sql`） | ✅ 已完成（39/39） | 本机 PostgreSQL（已装） |
| 登录 Supabase / Vercel | ❌ | 你的账号，只能你自己操作 |
| 在 Supabase 跑迁移 | ⚠️ 可代跑 | 你的**数据库连接串**（Project Settings → Database → Connection string） |
| 部署到 Vercel | ⚠️ 可代跑 | 你的 **Vercel Token**（vercel.com/account/tokens） |

**如果要我代跑**：把上面的连接串 / Token 发我，我用 CLI 直接执行并回报每一步的真实输出。
**如果自己跑**：照着第 1–3 节做，任何一步报错把原文贴给我，我来判断。

---

## 5. 别忘了

- **备份仍是唯一的兜底路径**。云端同步是一期功能，不是数据保险——界面文案里也一直是这么说的。
- 部署配置改动后要跑 `npm run verify:pwa`（49 项，其中 6 条专门守部署配置）。
- 改动 `database/migrations/` 或三个云端 RPC 后要跑 `npm run verify:sql`（39 项，真库）。
