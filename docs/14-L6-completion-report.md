# L6 阶段一完成报告：服务门面、云端适配器与云端表结构对齐

> 范围说明：L6 共四项任务（适配器、映射与约束、迁移与冲突方案、真实上线验收）。
> 本报告覆盖前两项与第三项的方案定稿；**第四项（真实上线验收）与上行迁移实现依赖真实的 Supabase 项目凭据，本机不具备，明确延后到阶段二**，详见 §6。
> 当前生效后端仍是**本地**，L0–L5 的行为基线一条未动（`verify:local` 94/94）。

## 1. 结论

L6 阶段一达成三件事：

1. **页面不再认识任何后端。** 新增 `services/contracts.ts` + `services/api/` 门面，页面导入从 `services/local/*` 换成 `services/api/*`，**函数名、参数、返回值一字未改**；后端由构建模式决定（`npm run build` 走本地，`npm run build:cloud` 走云端）。
2. **云端适配器从「只覆盖主记录」补到与本地逐条等价。** 新增认证、选项、会话、备份四个云端模块，重写日计划模块；`cloud/parity.ts` 用类型断言把「等价」变成编译期约束。
3. **云端表结构补齐并对齐约束。** 新增只追加迁移 stage4，补上缺失的 7 张表、RLS、历史日期触发器与 `updated_at` 触发器，并把 `copy_yesterday` 升级为覆盖新增表的 `copy_yesterday_stage4`。

## 2. 任务达成

| docs/05 L6 任务 | 状态 | 落点 |
| --- | --- | --- |
| 为本地服务实现等价的 Supabase 适配器，不改页面业务接口 | 完成 | `services/contracts.ts`、`services/api/*`、`cloud/{authService,optionService,dayPlanService,backupService}.ts`、`cloud/parity.ts` |
| 将本地对象仓库映射到云端表、RLS 和历史日期约束 | 完成 | `database/migrations/202609160001_stage4_local_parity.sql`；映射表与不变量落点见 `docs/13` §3–§4 |
| 编写本地数据到云端的迁移和冲突处理方案 | 完成（方案定稿，未执行） | `docs/13` §5–§6 |
| 登录、跨设备同步、断网失败、RLS 双账号、真实上线验收 | **延后（缺凭据）** | 见 §6；清单见 `docs/13` §7.2 |

## 3. 新增 / 修改文件

**新增（11）**

- `src/services/contracts.ts` — 契约。函数名只写一遍，签名用 `Pick<typeof import('./local/xxx'), 键名>` 从本地实现取；键名数组同时是运行时值，供回归脚本导入。
- `src/services/backend.ts` — 当前后端（由 `import.meta.env.MODE` 决定）、`supportsLocalBackup`、`BACKEND_LABEL`。
- `src/services/session.ts` — 会话存储（后端无关）。由原 `services/local/sessionStore.ts` 提升而来，新增「值没变就不广播」的保护，避免云端认证状态回调与 App 重读会话形成自激循环。
- `src/services/optionExamples.ts` — 示例选项清单，本地与云端两侧播种共用。
- `src/services/api/{authService,dayPlanService,optionService,backupService}.ts` — 门面，各两行：`export * from '@backend/x'` + `export type * from '@backend/x'`。
- `src/services/api/backupFormat.ts` — 备份格式（纯数据层，无后端之分）。
- `src/services/cloud/errors.ts` — 云端错误标准化（原本内联在旧 `cloud/dayPlanService.ts` 里，三处适配器都要用）。
- `src/services/cloud/authService.ts` — Supabase Auth + 会话镜像 + 注册后播种示例。
- `src/services/cloud/optionService.ts` — 三类选项的增删改、排序、启停，逐条复刻本地规则。
- `src/services/cloud/optionSeed.ts` — 云端示例播种（幂等，按名称去重）。
- `src/services/cloud/backupService.ts` — 云端模式下明确拒绝本地备份并说明原因。
- `src/services/cloud/parity.ts` — 等价性断言（编译期）。
- `database/migrations/202609160001_stage4_local_parity.sql` — 云端表结构对齐（只追加）。
- `scripts/check-cloud-parity.mjs` — 后端一致性回归（50 项）。
- `docs/13-L6-cloud-migration-and-conflict-plan.md`、`docs/14-L6-completion-report.md`。

**修改（13）**

- `vite.config.ts` — `@backend/*` 别名，按 `mode` 指向 `../local/` 或 `../cloud/`。
- `tsconfig.app.json` — `paths`（`@backend/*` → `src/services/local/*`，让类型检查始终以本地签名为准）。
- `package.json` — 新增 `dev:cloud`、`build:cloud`、`check:cloud-parity`。
- `src/services/cloud/dayPlanService.ts` — **重写**：从「只覆盖主记录、未接线」补到与本地逐条等价（21 个函数）。
- `src/services/local/{authService,optionSeed,dayPlanService,backupFormat}.ts` — 会话导入改到 `../session`；示例清单改从共享文件取；面板输入类型移到共享层并重新导出；新增 `BackupStore` 别名。
- `src/shared/types/dayPlan.ts` — 面板输入类型（`MealInput` / `SupplementInput` / `ExerciseInput`）与家务常量（`ROUTINE_ORDER` / `ROUTINE_TITLES`）提到共享层，两种后端共用。
- `src/shared/saveStatus.ts` — 保存状态前缀随后端变化（「本地保存状态」/「云端保存状态」）。
- 界面层 10 个文件 — 导入路径切到门面；`preferencesLabels.ts` 改从 `services/api/backupFormat` 取 `BackupStore`（不再依赖 `localDb`），账号卡与备份卡文案随后端变化；`BackupCard` 在云端模式下显示不可用说明。
- `scripts/check-local-data.mjs` — 示例清单路径更新；「界面层不得引用云端 SDK」的判据从「提到过 supabase」收紧为「真的引用了」。
- `README.md`、`HANDOFF.md`、`docs/05-local-first-execution-plan.md`。

**删除（1）**

- `src/services/local/sessionStore.ts` — 语义并入 `src/services/session.ts`（不属于任何单一后端）。

## 4. 关键设计决策

### 4.1 「等价」靠编译器而不是靠人看

契约写成 `Pick<typeof import('./local/authService'), 'getSession' | ...>`：**签名不重写**，所以不存在「契约与实现各写一遍慢慢分叉」。
`cloud/parity.ts` 把四个云端模块分别赋给契约类型——**云端少一个函数、参数个数或类型不一致、返回形状不同，`npm run typecheck` 当场失败**。
`check:cloud-parity` 再用源码文本复核一遍导出名，防止有人用 `as any` 绕过断言。

被排除在契约外的只有本地内部导出（`hashPassword`、`LocalUser`）：它们不是页面接口，云端没必要为了凑数也导出。

### 4.2 后端切换放在构建期

理由有两条，都不是洁癖：

- **运行期切换会让两个后端都进同一份产物**，本地用户的包里白白多出 Supabase 的几十 KB，「冻结层不进产物」也就名存实亡；
- 构建期切换才能让「本地构建 0 命中 supabase、云端构建 0 命中 IndexedDB」继续成为**可检出的硬事实**（本次已实测，见 §5）。

实现上没用 `node:path`：`vite.config.ts` 跑在没有 `@types/node` 的类型环境里，所以别名替换值写成**相对路径**（`'../cloud/'`），解析基准是引用方所在目录——这也正是 `@backend/` 只允许出现在 `src/services/api/` 下的原因，回归脚本对这一点有断言。

### 4.3 云端约束不得比本地更严

同一个操作在两种后端下必须得到同样的结果。因此 stage4 的新表**只加本地同样具备的唯一约束**，其余（选项同名去重、补剂「时段 + 名称」去重）留在服务层由适配器复刻。
数据库再来一遍会制造「本地能存、云端报错」这类最难查的分歧。

配套的一条：**引用选项的外键一律 `on delete set null`**。本地删选项是硬删除、历史靠名称快照独立保存（docs/01 不变量 5）；若外键是 `restrict`，「删掉一个不再吃的食物」会被历史计划挡住，两种后端行为立刻分叉。

### 4.4 云端不做假装

- `cloud/backupService.ts` 在云端模式下**先按同一套格式严格解析、再明确拒绝**，抛 `cloud_backup_unsupported`。先解析是为了让「文件本身格式不对」和「后端不支持」分开报；不静默返回空结果，是因为假装成功就是「把本地保存伪装成云端同步成功」的镜像错误。
- 云端 `signUp` 拿不到会话时（项目开了邮箱验证）**直接报错说明**，不写一个空会话假装登录成功。
- 保存状态前缀随后端变化，不说错方向。

### 4.5 上行迁移必须区分「迁移」与「日常编辑」

本地备份里绝大多数是**过去的**计划，而云端触发器一律拒绝写今天之前的日期——直接逐表 insert 在真实数据上必然全数失败。
方案是加一个 `security invoker` 的 `import_local_backup` RPC，在事务内设 `set local molly.allow_history = 'on'`，三个历史日期判定函数见到该开关就放行。
普通写入路径的历史只读规则一个字不放；绝不用 `service_role` 密钥在浏览器直连（那等于把整库权限交给前端）。详见 `docs/13` §5.4。

## 5. 验收证据

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm run build` | 通过，85 modules，`index-*.js` 269.00 kB / gzip 83.35 kB |
| `npm run check:dates` | 48/48 |
| `npm run check:local-data` | 27/27 |
| `npm run check:backup` | 55/55 |
| `npm run check:cloud-parity` | **50/50（新建）** |
| `npm run verify:local` | **94/94**（2 分 22 秒，桌面 1440x900 + 手机 390x844，控制台无 error/warning） |

构建体积对比：L5 为 78 modules / 268.32 kB（gzip 83.11 kB），本次为 85 modules / 269.00 kB（gzip 83.35 kB）——门面层只增加约 0.24 kB gzip，说明本地产物确实没把云端实现带上。

**两种产物的互斥检索（实测）**

| 检索词 | 本地产物 `npm run build` | 云端产物 `vite build --mode cloud` |
| --- | --- | --- |
| `supabase` | 0 | 73 |
| `PostgREST` | 0 | — |
| `GoTrueClient` | 0 | 3 |
| `copy_yesterday` | 0 | 1（`copy_yesterday_stage4`） |
| `indexedDB` | — | 0 |
| `happy-little-molly-local` | — | 0 |

云端构建为 129 modules / 483.39 kB（gzip 139.48 kB），本地库（`localDb` 及整个 IndexedDB 实现）完全未进入。

## 6. 缺陷、延后项与未验证项

### 6.1 本次发现并修掉的问题

1. **`check:local-data` 抓到界面层出现产品名。** 新写的云端备份不可用文案里直接点了服务商名字，命中了「界面层没有直接引用 supabase」这条旧断言。两处都改：文案换成用户视角（「云端账号 / 云端数据库」），断言判据从「提到过这个词」收紧为「真的引用了」（`from '@supabase'` / `supabase.` / `requireSupabase` / `/services/cloud/`）。原来的判据会逼着文案绕着产品名写，属于误报。
2. **`saveDaySupplements` 的隐式 upsert 会造出不同的主键。** 本地实现在「行里带 id 但库里没有这条」时会**另造新 id**，而 `upsert(..., {onConflict:'id'})` 会把这个 id 原样插进去。已改为有 id 走 `update`、无 id 走 `insert`，与本地一致。
3. **示例选项清单曾有两份。** 抽成 `services/optionExamples.ts` 由两侧共用，并加断言「两侧播种都不再各写一份清单」。
4. **会话写入会自激。** 云端认证状态回调写镜像 → 广播 → App 重读会话，若「读到空会话又写空会话」也会广播，就形成循环。`writeSession` 现在值没变就不广播。
5. **`vite.config.ts` 一度依赖 `@types/node`。** 改为不引入任何 Node API（用 Vite 提供的 `mode` 与相对别名替换），避免为了一个路径计算去安装 Node 类型、把 Node 全局变量泄漏进浏览器端代码。

### 6.2 延后项（阶段二）

- **上行迁移未实现**：云端模式下备份卡显示「本地模式专属」说明（`supportsLocalBackup`），不提供按钮。落地时替换 `cloud/backupService.ts` 的实现，导出名与签名保持不变。
- **`updated_at` 冲突提示未启用**：docs/01 提到「用 `updated_at` 告知较新内容」，当前是 last-write-wins + 失败可见，没有做「提示对方有更新版本」。启用前需要先定义提示时机。
- **多表写入非原子**：除两个 RPC（复制昨天、将来的导入）外，其余路径是逐表请求，中途失败会留下部分写入。这是 PostgREST 的固有限制，接受它的前提是本项目的编辑模型本身就是「整体替换」。

### 6.3 未验证项（缺条件，非缺陷）

1. **四个 SQL 迁移从未在真实 PostgreSQL 上执行过。** 本机既没有 `psql` 也没有 Docker，stage1–stage4 只经过静态检查与 `check:cloud-parity` 的结构断言（表覆盖、RLS、触发器、外键策略）。函数体语法、触发器行为、RLS 实际拦截效果都需要在真实项目上跑一遍。
2. **云端适配器没有跑过一次真实请求。** 没有 `.env.local`、没有项目 URL 与 anon key，所有云端路径只通过类型检查与回归脚本，未做端到端验证。
3. **`verify:local` 仍只覆盖本地后端**（94 项）。云端链路的验收脚本尚未编写——它必须在有真实项目之后才有意义，否则测的是 mock 而不是契约。
4. **真机软键盘与 iOS 安全区**（L4/L5 遗留）仍未人工核对。

## 7. 结论

L6 阶段一完成：适配器、映射与约束、迁移与冲突方案三项落地，行为基线与 L5 完全一致（94/94 + 55/55 + 48/48 + 27/27 + 50/50，三件套通过），两种后端在产物层面互相隔离且可实测。
**L6 的第四项任务（真实上线验收）与上行迁移实现需要真实 Supabase 项目凭据，是当前唯一的阻塞项**；拿到项目后按 `docs/13` §7.2 的清单执行即可。
