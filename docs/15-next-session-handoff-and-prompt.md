# 新对话接手文档与实施提示词（2026-09-16）

> 用途：在新窗口继续执行「幸福小Molly」的后续工作。本文件是**自包含**的——新窗口只读本文件 + `HANDOFF.md` 即可开工。
> 与 `docs/04-stage-orchestration.md` 的关系：那一份是旧五阶段路线的编排协议（现已由 `docs/05` 的 L0–L6 取代），格式沿用它的「提示词 + 验收清单」写法。

## 0. 一句话现状

L0–L5 全部完成，**L6 阶段一（服务门面 / 云端适配器 / 云端表结构对齐 / 迁移与冲突方案）已完成并推送**；当前生效后端仍是本地，行为基线与 L5 一字未变。**待办 A（移动端持久化 / PWA 层）也已完成（2026-09-16）**，报告见 `docs/16-pwa-shell-completion-report.md`。剩下的工作只有一条：

| 待办 | 能不能现在做 | 提示词 |
| --- | --- | --- |
| ~~**A. 移动端持久化（PWA 层 + 存储状态）**~~ | **已完成**（见 `docs/16`） | §4（保留作历史记录） |
| **B. L6 阶段二（真实项目验收 + 上行迁移）** | 需要真实 Supabase 项目凭据 | §5 |

## 1. 开工前必读（按顺序）

1. `HANDOFF.md` 顶部「当前交接摘要」——唯一现行方向；下方历史阶段记录仅作证据。
2. `docs/05-local-first-execution-plan.md`——L0–L6 任务线、顺序、验收门槛；§7 是「当前下一步」。
3. `docs/13-L6-cloud-migration-and-conflict-plan.md`——两种后端共存方式、仓库→表映射、上行迁移方案。
4. `docs/14-L6-completion-report.md`——L6 阶段一做了什么、有哪些未验证项。
5. `docs/01-architecture-data-contract.md`——数据契约与 7 条不变量（**不可违反**）。
6. 本文件。

## 2. 当前代码事实（2026-09-16 核对）

- **技术基线**：React 19 + TypeScript 5.7 + Vite 6 + 浏览器 IndexedDB（`DB_VERSION = 4`，11 张对象仓库）。无路由库。
- **服务层三层结构**：
  ```
  src/services/contracts.ts   契约：函数名只写一遍，签名用 Pick<typeof import('./local/xxx'), 键名> 取
  src/services/backend.ts     当前后端（DATA_BACKEND / isCloudBackend / supportsLocalBackup）
  src/services/session.ts     会话存储（后端无关）
  src/services/optionExamples.ts  示例选项清单（两侧播种共用）
  src/services/api/           门面：页面只 import 这里（authService/dayPlanService/optionService/backupService/backupFormat）
  src/services/local/         本地实现（默认）
  src/services/cloud/         云端实现（supabase/errors/parity/authService/optionService/optionSeed/dayPlanService/backupService）
  ```
- **后端由构建模式决定**：`npm run build` / `dev` 走本地；`npm run build:cloud` / `dev:cloud` 走云端。`vite.config.ts` 把 `@backend/*` 指到 `../local/` 或 `../cloud/`（**相对替换**，所以 `@backend/` 只允许出现在 `src/services/api/` 下）。`tsconfig.app.json` 的 `paths` 恒指向 `src/services/local/*`。
- **等价性由编译器保证**：`cloud/parity.ts` 用契约类型断言四个云端模块，云端少一个函数或签名不一致 → `typecheck` 失败。**不要去改契约绕开它。**
- **PWA 外壳（2026-09-16 完成，见 `docs/16`）**：`public/manifest.webmanifest` + 四张 PNG 图标（`npm run icons` 生成）+ 手写 `public/sw.js`（应用壳预缓存、HTML/manifest 网络优先 3 秒超时回退、静态资源缓存优先、只处理同源 GET、缓存名带构建戳）；注册与更新状态在 `src/shared/pwa/serviceWorker.ts`，**只在生产构建注册**（`import.meta.env.PROD`）；存储持久化与安装提示在 `src/shared/storage/`；「选项」页的「存储与安装」卡片在 `src/features/preferences/components/StorageCard.tsx`。构建戳由 `vite.config.ts` 的 `define` 注入为 `__BUILD_STAMP__`。
- **Git**：`main` 分支，远端一致。PWA 外壳的提交见 HANDOFF 顶部摘要。
- **本机环境**：Windows + Git Bash（每次调用 Bash 前先 `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Program Files/nodejs:$PATH"`）。没有 `psql`、没有 Docker、没有 agent-browser。项目目录 `D:/WJKHome/小人项目包/littlemolly-main`。

## 3. 验收基线（改动后必须复现这组数字）

| 命令 | 基线 | 说明 |
| --- | --- | --- |
| `npm run typecheck` / `lint` / `build` | 通过 | 三件套 |
| `npm run check:dates` | 48/48 | 日期引擎 |
| `npm run check:local-data` | 27/27 | 本地结构与契约 |
| `npm run check:backup` | 55/55 | 备份格式 |
| `npm run check:cloud-parity` | 50/50 | 后端一致性 |
| `npm run verify:local` | **95/95** | 真实浏览器闭环，约 2.5 分钟 |
| `npm run verify:pwa` | **42/42** | PWA 层，跑生产产物 + 自建静态服务器，约 2 分钟 |
| 本地构建体积 | 91 modules / 276.86 kB（gzip 86.12 kB） | 含 PWA 外壳与移动端交互修复 |
| 云端构建体积 | 135 modules / 489.90 kB（gzip 141.83 kB） | `npx vite build --mode cloud --outDir dist-cloud` |

**双向产物体检**（改服务层后必做）：
- 本地：`npm run build` 后在 `dist/assets/*.js` 检索 `supabase|PostgREST|GoTrueClient|copy_yesterday` → 应 0 命中。
- 云端：`npx vite build --mode cloud --outDir dist-cloud` 后检索 `indexedDB|happy-little-molly-local` → 应 0 命中。

## 4. 待办 A：移动端持久化（PWA 层）

**为什么做**：当前完全没有 PWA 要素（无 manifest、无 service worker、未调 `persist()`），iOS Safari 对未安装站点有「7 天无交互即清空可写存储」的规则（ITP），而添加到主屏幕的 Web App 使用独立存储分区、不计入该计时。这是移动端本地数据不被清掉的关键一环。

**把以下内容完整发送到新窗口**：

```text
你负责「幸福小Molly」的移动端持久化改造：加一层 PWA 外壳并让存储状态可见。只做本任务，不要顺手改业务逻辑。

工作目录：D:/WJKHome/小人项目包/littlemolly-main

开工前必须阅读：
- HANDOFF.md（顶部「当前交接摘要」是唯一现行方向）
- docs/15-next-session-handoff-and-prompt.md（本任务的定义与验收清单）
- docs/05-local-first-execution-plan.md（§7 当前下一步）
- docs/01-architecture-data-contract.md（7 条数据不变量，不可违反）

技术基线与硬性约束（不要擅自更改）：
- React 19 + TypeScript + Vite 6，浏览器 IndexedDB 是默认业务数据源（DB_VERSION = 4，11 张对象仓库）。
- 页面只 import src/services/api/ 门面；不得绕过门面直连 services/local，也不得让界面层引用云端 SDK。
- 保持零第三方运行时依赖（现有只有 react / react-dom / @supabase/supabase-js）。Service worker 请手写，不要引入 vite-plugin-pwa / workbox —— 这个壳很小，可读可控比省几行代码重要。
- 每次改完跑：typecheck / lint / build / check:dates / check:local-data / check:backup / check:cloud-parity / verify:local，基线数字见 docs/15 §3。verify:local 必须仍是 94/94。

本任务范围：
1. manifest：public/manifest.webmanifest（name、short_name、start_url、scope、display: standalone、theme_color、background_color、icons 192/512 各一份 + maskable 一份）。index.html 里补 <link rel="manifest">、apple-touch-icon（180×180 PNG）、以及 mobile-web-app-capable / apple-mobile-web-app-status-bar-style 这两个 meta。
2. 图标：现有 public/favicon.svg 只有 296 字节。用它生成 PNG 图标（192/512/180 + 一张 maskable，注意 maskable 需要留安全边距）。本机没有 ImageMagick、也不应为此装依赖——可以用本机 Chrome 无头模式把 SVG 渲染成 PNG：chrome --headless=new --disable-gpu --hide-scrollbars --window-size=512,512 --screenshot=out.png file:///...svg。生成脚本放 scripts/ 下，产物提交进 public/，脚本本身可重复执行。
3. Service worker：只做「应用壳」预缓存。
   - 预缓存构建产物（HTML、JS、CSS、图标、manifest）。
   - 策略：HTML/manifest 用 network-first + 3 秒超时回退缓存；静态资源 cache-first。
   - 缓存名带构建戳（不要手写版本号，用构建时间或资源哈希）；activate 时清掉旧缓存。
   - **绝对不要缓存 Supabase / 任何跨域 API 请求**，只处理同源 GET。
   - 更新策略要保守：新 SW 接管后提示「有新版本」，不要静默把正在编辑的页面换掉。
4. 关键约束（踩过就会废掉现有验收）：**service worker 只在生产构建注册，dev 模式不注册**（用 import.meta.env.DEV 判断）。
   原因：scripts/verify-local.mjs 走的是 Vite dev server，它有两个用例依赖「请求真的发到服务器」——
   （a）冷升级用例用 CDP Fetch 域把 /src/main.tsx 的响应换成空模块来先造一个 v1 老库，如果 SW 从缓存返回真正的入口模块，这一招直接失效；
   （b）清空站点数据用例用 Storage.clearDataForOrigin。
   dev 不注册是唯一能让 94 项基线完全不受影响的干净做法。不要试图修改这些既有用例来迁就 SW。
5. navigator.storage.persist()：应用启动、数据库打开之后请求一次（先 feature-detect，iOS 上可能返回 false，属正常）；结果与 navigator.storage.estimate() 的用量一起记录。
6. 安装引导与存储状态：在「选项」页加一张卡片，显示当前存储用量 / 是否已获得持久化 / 是否已在独立窗口运行（display-mode: standalone）。
   iOS 上系统不支持程序化安装，只能引导用户「点分享 → 添加到主屏幕」；文案必须写实话：
   对本地保存数据的应用，安装不是「体验更好」，而是「不装的话系统可能在一周后清掉数据」。不要写成营销腔。
   Android 上可用 beforeinstallprompt 事件给出安装按钮。
7. 新增验收脚本 scripts/verify-pwa.mjs + npm run verify:pwa：
   - 先 npm run build，再用一个零依赖的静态服务器托管 dist/（不要用固定端口，参考 verify-local.mjs 里申请空闲端口的做法），
     然后通过 CDP 检查：manifest 可读取且字段齐全、图标 URL 都能 200、SW 注册成功且处于 activated、
     Cache Storage 里存在应用壳、用 Network.emulateNetworkConditions 断网后刷新仍能渲染出登录页、
     修改构建后旧缓存被清理。
   - 清理数据时 Storage.clearDataForOrigin 必须显式列出 storageTypes（indexeddb、local_storage、cache_storage、service_workers），
     不要只依赖 'all' —— 它在不同 CDP 版本下覆盖范围不一致。

明确不做：不做 SPA 路由、不做后台同步/推送、不改任何业务服务层函数、不改数据库结构、不引入懒加载重构、不动 docs/01 的不变量。

验证要求：
- 三件套 + 五个 check 脚本 + verify:local 95/95（必须复现，不能只跑新的那个）。
- verify:pwa 全绿，并在最终回复里给出它实际检查了多少项。
- 桌面 1440x900 与手机 390x844 视口无横向溢出、控制台无 error/warning（沿用 verify-local.mjs 的口径）。
- 用本机 Chrome 无头模式核对安装后的独立窗口观感（至少截图核对图标与首屏）。

需要真机实测、不得凭推断写结论的项（在报告里单列）：
- iOS 上「添加到主屏幕」之后是否真的拿到独立存储分区、是否真的不计入 7 天计时。
  这一条在桌面浏览器上无法验证，只能实机核对；无法核对就明确写成未验证项，不要写成已完成。
- iOS 上 navigator.storage.persist() 的实际返回值。

收尾必须：
- 更新 HANDOFF.md（已完成 / 证据 / 未验证项 / 下一步 / 精确文件清单）。
- 新增 docs/16-<本任务>-completion-report.md，格式照 docs/12、docs/14。
- 在最终回复里给出：修改文件清单、跑过的命令与真实输出、未验证项、剩余风险。
- 不要用覆盖式或破坏性 Git 操作；完成后按项目惯例提交并推送（提交信息用中文，说明范围与验收数字）。
```

### 待办 A 的总指挥验收清单

1. `verify:local` 仍是 **94/94**，`verify:pwa` 全新通过——两者都要证据，不能只报新的那个。
2. dev 模式下**没有** service worker 注册（在 dev server 里 `navigator.serviceWorker.getRegistrations()` 应为空）。
3. 生产构建断网刷新仍能打开应用（不是白屏），且断网时读得到已写入的数据。
4. `manifest.webmanifest` 字段齐全、图标全部可访问；iOS 需要的那几个 meta 与 apple-touch-icon 都在。
5. 选项页的存储状态卡片如实显示：用量、是否持久化、是否独立窗口；文案不夸大成「已同步」。
6. SW 不缓存任何跨域（Supabase）请求。
7. 未验证项（iOS 真机安装后的分区豁免、`persist()` 返回值）被明确列出，没有被伪装成已验证。

## 5. 待办 B：L6 阶段二（真实项目验收 + 上行迁移）

**进入条件**：拿到一个真实 Supabase 项目的 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`（**都是可公开值**；绝不要 `service_role` key，绝不要写进源码或提交，只放 `.env.local`）。

**把以下内容完整发送到新窗口**：

```text
你负责「幸福小Molly」L6 阶段二：在真实 Supabase 项目上完成验收，并实现本地数据上行迁移。只做本阶段。

工作目录：D:/WJKHome/小人项目包/littlemolly-main

开工前必须阅读：
- HANDOFF.md（顶部「当前交接摘要」）
- docs/13-L6-cloud-migration-and-conflict-plan.md（本阶段的完整方案，§5 上行迁移、§6 冲突与断网、§7.2 验收清单）
- docs/14-L6-completion-report.md（§6.3 未验证项就是本阶段要消掉的清单）
- docs/05-local-first-execution-plan.md（§7）

已就位的现状（不要重复造）：
- 服务层已是三层结构，页面只 import src/services/api/ 门面；云端适配器已与本地逐条等价，cloud/parity.ts 做编译期断言。
- 云端是构建期切换：npm run dev:cloud / npm run build:cloud（vite.config.ts 按 mode 把 @backend/* 指到 cloud/）。
- 数据库迁移已有四批，必须**按文件名顺序**执行：
  202608270001_stage1_auth_sync.sql → 202608310001_stage2_day_plans.sql
  → 202608310002_stage3_workday_planning.sql → 202609160001_stage4_local_parity.sql
- 本机**没有 psql、没有 Docker**，所以这四个 SQL 从未真实执行过，只做过静态检查；云端适配器也从未跑过真实请求。

本阶段范围（按这个顺序做，每步给出可核对证据）：
1. 在真实项目执行四个迁移。核对：11 张业务表齐全、每张表启用 RLS 且策略按 auth.uid()、历史日期触发器（day_plans / daily_meals / custom_tasks / daily_meal_items / daily_supplements / daily_exercise_items / routine_tasks）、copy_yesterday_stage4 函数存在。任何一步失败就停下报告，不要跳过去继续。
2. 关闭邮箱验证（或配好 SMTP）。因为 signUp 拿不到会话时适配器会明确报错——这是有意行为，不是缺陷；但开着验证就没法完成后续验收。把这一条写进报告。
3. 真实链路验收：注册 → 登录 → 退出 → 刷新恢复会话；A 设备改今天的计划、B 设备刷新后看到同样内容（跨设备同步）；断网后写入必须显示「云端保存状态：保存失败」且不显示已保存，恢复网络后可继续写；两个账号互相看不到对方任何数据（含子表），并尝试直接构造越权查询确认被 RLS 拒绝。
4. 实现上行迁移（本地备份 → 云端账号），方案见 docs/13 §5：
   - 追加新迁移（不要改写任何既有迁移），新增 security invoker 的 RPC import_local_backup(payload jsonb)，
     事务内 set local molly.allow_history = 'on'；三个历史日期判定函数见到该开关就跳过历史检查。
     为什么必须这么做：本地备份里绝大多数是过去的计划，云端触发器会全数拒绝，直接逐表 insert 在真实数据上必然失败。
   - 绝不要用 service_role 密钥在浏览器直连。
   - 本地 id 是 crypto.randomUUID() 生成的 uuid v4，保留原 id 即可保住父子外键；所有 user_id 重写为 auth.uid()；备份里的 users 记录只用来读来源邮箱，不写入。
   - 把 cloud/backupService.ts 从「明确拒绝」换成真实实现，导出名与签名保持不变；界面文案同步更新（去掉「本地模式专属」的说明）。
5. 补云端验收脚本（现有 verify:local 只覆盖本地后端）。云端脚本必须能证明：迁移覆盖、RLS 双账号隔离、跨设备同步、断网失败可见、上行迁移后逐项核对历史计划与名称快照。
6. 更新 docs/14 的未验证项清单，新增 docs/17-L6-stage2-completion-report.md。

明确不做：不改页面业务接口（签名不变），不改契约绕开 parity，不改本地后端行为，不动 docs/01 的不变量，不引入第三方 ORM / 状态库。

验证要求：
- typecheck / lint / build 通过；check:dates 48/48、check:local-data 27/27、check:backup 55/55、check:cloud-parity 50/50、verify:local 95/95 全部复现（不能因为改的是云端就跳过本地基线）。
- 本地构建产物 0 命中 supabase；云端构建产物（npx vite build --mode cloud --outDir dist-cloud）0 命中 indexedDB / happy-little-molly-local。
- 所有云端结论必须来自真实请求的真实返回。拿不到凭据或某步失败时，明确写成阻塞项，不得伪称通过。

收尾必须：
- 更新 HANDOFF.md 与 docs/05 §7；新增本阶段完成报告。
- 最终回复给出：跑过的命令与真实输出、迁移执行结果、双账号隔离证据、断网行为证据、上行迁移前后对比、未验证项与剩余风险。
- 完成后再提交推送（提交信息用中文，写清范围与验收数字）。
```

### 待办 B 的总指挥验收清单

见 `docs/13` §7.2，逐条对照；其中三条是硬门槛：

1. 四个迁移在真实项目**全部执行成功**，表 / 策略 / 触发器逐项核对过。
2. RLS 双账号隔离有**真实越权尝试被拒**的证据（不能只看界面看不到）。
3. 断网写入显示失败而非成功；上行迁移后历史计划的名称快照与准备/执行状态逐项对得上。

## 6. 已踩过的坑（复用，别重犯）

1. **`indexedDB.open(name)` 不传版本号做「探测」会凭空造出一个空 v1 库**，之后按 `DB_VERSION` 打开会跳过第 1 号迁移，首批仓库永远建不出来。探测前必须先 `indexedDB.databases()`。
2. **新增 IndexedDB 仓库必须走满四步**（`LocalStore` → `STORES` → `DB_VERSION` → `MIGRATIONS`），并在 `RECORD_SCHEMAS` 补字段契约，否则写入被 `assertRecord` 拒。
3. **写入口径的请求级错误必须经 `guardRequest` 上抛**，只挂 `transaction.onerror` 会漏掉仓储层错误，造成「写失败被当成成功」。
4. **`classifyDate` 的「明天」是独立的 `tomorrow`，不是 `future`**；写「未来日期」判断时必须两者都覆盖。
5. **断言要读最小可变区域**：曾经断言了一个恒真的字符串导致假绿。
6. **界面层「不得引用云端 SDK」的判据要匹配真引用**（`from '@supabase'` / `supabase.` / `requireSupabase` / `/services/cloud/`），不要用「提到过 supabase」——那会逼着用户文案绕着产品名写。
7. **`writeSession` 值没变就不要广播**，否则云端认证回调与 App 重读会话会形成自激循环。
8. **隐式 `upsert(onConflict:'id')` 会造出与本地不同的主键**（本地对「带 id 但库里没有」的情况会另造新 id）。改成有 id 走 update、无 id 走 insert。
9. **`vite.config.ts` 不要引入 `node:path`**：本机没有 `@types/node`，装它会把 Node 全局泄漏进浏览器端类型环境。用 Vite 提供的 `mode` + 相对别名替换即可。
10. **`rm -rf` 会被本机的安全删除策略拦下**；清理构建产物前先确认它已在 `.gitignore` 里，别在这上面浪费轮次。
11. **Git Bash 里 `ProgramFiles` / `ProgramFiles(x86)` 可能根本不存在**（Windows 原生环境变量没被导出到 MSYS 环境），而 Chrome 的默认安装路径就挂在它们下面——只按环境变量拼路径会把「本机装了 Chrome」误判成「本机没有浏览器」。浏览器定位已抽到 `scripts/lib/find-browser.mjs` 并补了绝对路径兜底，新脚本直接用它，别再各写一份。
12. **`npm run build:cloud` 会写进 `dist/`**（它等价于 `tsc -b && vite build --mode cloud`），跑完 `dist/` 里就是云端产物，接着跑 `verify:pwa` 会验错对象。要么改用 `npx vite build --mode cloud --outDir dist-cloud`，要么跑完补一次 `npm run build`。
13. **CDP 的 `Emulation.setEmulatedMedia` 不支持 `display-mode`**（实测 `matchMedia` 仍为 false）。要验「已安装 / 独立窗口」这一支，用 `--app=<url>` 真的开一个应用窗口——headless Chrome 下 `display-mode: standalone` 为真。
14. **service worker 的 fetch 处理器里，导航请求不能无脑写进首页缓存键**：那样访问一次不存在的路径就会把 404 页面写进应用壳，下次断网打开应用看到的就是那个 404。只认 `/` 与 `/index.html`。
15. **验收脚本截图要用目标窗口自己的 CDP 连接**：拿主窗口的连接去拍另一个窗口，两张图会长得一模一样（字节数相同），人工核对时会被骗过去。
16. **iOS 安全区不用真机也能验**：Chrome 152 支持 `Emulation.setSafeAreaInsetsOverride`，给一个底部 inset 再断言底部导航的 computed `padding-bottom` 是否跟着变大。前提是 viewport 里有 `viewport-fit=cover`，否则 `env(safe-area-inset-*)` 恒为 0——CSS 看着对、实际什么都没做。

## 7. 本次交接的产出

- 提交：`68f5f33`（L6 阶段一）、`7162b50`（忽略 dist-cloud），远端 `main` 与本地一致。
- 文档：`docs/13`（迁移与冲突方案）、`docs/14`（阶段一完成报告）、本文件。
- 可复用技能：`~/.workbuddy/skills/backend-swap-parity/`（构建期后端切换 + 编译期等价断言的完整做法）；`~/.workbuddy/skills/browser-acceptance-harness/`（零依赖 CDP 验收）。
