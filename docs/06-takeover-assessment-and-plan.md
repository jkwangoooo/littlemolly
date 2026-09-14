# 幸福小Molly：接手盘点与推进计划

- 日期：2026-09-14
- 状态：**L0、L1 已完成**，可进入 L2；完成报告见 `docs/07-L0-completion-report.md`、`docs/08-L1-completion-report.md`
- 位置：本文件为接手评估与执行清单；阶段范围与顺序的唯一依据仍是 `docs/05-local-first-execution-plan.md`。

## 1. 本次接手做了什么

阅读范围：`HANDOFF.md`、`README.md`、`docs/00`–`docs/05`、`database/migrations/` 全部三个迁移、`src/` 全部 18 个文件、构建与 lint 配置。

基线实测（Windows 本机，先补齐依赖再跑）：

| 命令 | 结果 |
| --- | --- |
| `npm install --no-audit --no-fund` | 成功，新增 182 个包（接手时工作目录缺 `node_modules`） |
| `npm run typecheck` | 通过，无输出 |
| `npm run lint` | 通过，无输出 |
| `npm run build` | 通过，`dist/assets/index-JSqaJRMs.js` 219.61 kB（gzip 68.50 kB） |

结论：**代码基线是干净可构建的**，`HANDOFF.md`「当前交接摘要」描述的本地优先方向与代码实际行为一致。

## 2. 项目现状理解

### 2.1 产品是什么

睡前 10 分钟规划第二天，次日按计划执行并勾选。使用者是单个用户（Molly），第一版是移动端优先的网页应用。

### 2.2 现行开发方向

本地优先：浏览器 IndexedDB 是唯一业务数据源，不读 `.env.local`、不连 Supabase；云端（RLS、跨设备同步、上线）整体后置到 L6。页面只通过 `services/` 读写，未来整体替换服务实现。

### 2.3 已完成 / 未完成

已完成（可用）：本地注册登录退出与刷新恢复、`Asia/Shanghai` 日期引擎、周一至周日固定周视图、工作日/休息日默认判断与人工覆盖、历史日期只读、执行今天/准备明天切换、五项准备勾选与 `n/5` 进度、三餐文本、晨间专注、健身决定、自定义事项增删改、复制昨天、保存失败重试。

未完成（L2–L5）：

| 缺口 | 阶段 |
| --- | --- |
| 三餐多选快照、补剂每日实例、健身多选 | L2 |
| 周末拖地洗衣、休息日自由规划规则 | L3 |
| 底部导航「今日/本周/选项」、移动端交互统一 | L4 |
| 备份导入导出、核心规则全量回归 | L5 |
| Supabase 适配器与上线验收 | L6（冻结） |

已完成（L1）：食物 / 补剂 / 健身三套选项仓库、选项管理页（新增 / 改名 / 排序 / 启停 / 删除 + 二次确认）、示例选项种子与账号隔离，详见 `docs/08-L1-completion-report.md`。

## 3. 与文档不一致或文档未记录的发现

按处理优先级排列。R1 建议在开工前先解决。

**R1 — 当前工作目录不是 Git 仓库（高）**

`HANDOFF.md` 称 `main` 已推送首次提交 `634dd7b` 到 `git@github.com:jkwangoooo/littlemolly.git`，但本目录没有 `.git`，`git rev-parse` 报「not a repository」。含义：目前所有改动没有版本控制保护，也无法回滚。而 `docs/04` 的工作协议明确要求「实施前检查 Git 状态并保留既有改动」。**建议先建立版本控制基线，再动任何代码。**

**R2 — Supabase 遗留代码仍在 `services/` 根目录（中）**

`supabase.ts`、`dayPlanService.ts`、`syncTestRecordService.ts`、`shared/types/sync.ts` 是阶段 1–3 的云端实现，本地模式下已是死代码；页面实际调用的是 `localDayPlanService.ts`。同时 `features/auth-sync/AuthSyncScreen.tsx` 现在实际是「登录 + 进入日计划」的入口，名称与职责已不符。这正是 L0 第一条任务要清理的对象，但要**保留云端实现备用**（没有 Git 历史，直接删会永久丢失），建议移动到 `src/services/cloud/` 并标注「L6 前冻结」。

**R3 — 本地对象仓库少于数据契约（中）**

`localDb.ts` 的 `LocalStore` 只有 `users`、`day_plans`、`daily_meals`、`custom_tasks`。`docs/01` 契约里还有 `food_options`、`supplement_templates`、`exercise_options`、`daily_supplements`、`daily_meal_items`、`daily_exercise_items`、`routine_tasks` 七类。这是 L1/L2 的主体工作量，L0 只需把接口形状定下来。

**R4 — 没有显式 IndexedDB 版本迁移（中）**

`DB_VERSION = 1`，`onupgradeneeded` 用 `if (!storeNames.contains(x))` 的散装写法。L1 新增对象仓库时必须升级版本号，否则老用户浏览器里的库不会新增表。建议在 L0 就把升级逻辑收敛成一个按版本号递增的迁移列表，L1 直接往里加。

**R5 — 周视图缺少「已完成」状态（低）**

`docs/02` 要求周视图显示「未规划 / 待准备 / 执行中 / 已完成」四种状态，`WeekView.tsx` 目前只输出前三种（有 plan 且非今天一律「待准备」）。需要一条明确的完成判定规则（例如当天计划存在且所有准备项或执行项勾满）。

**R6 — 错误标准化有两套实现（低）**

`dayPlanService.ts`（云端版）的 `normalizeSupabaseError` 会保留 `code/details/hint/status`；`localDayPlanService.ts`（本地版）只把非 Error 包成 message，会丢掉元信息。而页面用的是本地版。L0 应统一成一个通用命名、行为一致的实现。

**R7 — 加载态与空状态不完整（低）**——**已在 L0-5 解决**

`DayPlanScreen` 原来用 `{!loading && ...}` 直接隐藏内容，没有加载占位；未来空日期没有 `docs/02` 要求的「准备这一天」引导。现已补：读取占位文案、未来空日期引导块（不落库、任意真实写入后自动消失）、自定义事项空态；周视图第四态见 R5。休息日与选项模块的空状态仍留待 L3 / L1 各自补齐。

**R8 — `@supabase/supabase-js` 仍是生产依赖（低）**

当前运行时用不到，靠 tree-shaking 剔除。L0 不必动，L6 恢复云端时自然需要；仅记录。

## 4. 推进方式（我建议的工作协议）

沿用项目既有协议，不改动：

1. 一次只做一个阶段，不提前实现后续阶段功能。
2. 每阶段结束跑 `npm run typecheck`、`npm run lint`、`npm run build`，并在桌面 `1440x900` 与手机 `390x844` 视口做真实交互检查（无横向溢出、控制台无 error）。
3. 每阶段结束更新 `HANDOFF.md`：已完成事实、证据、未验证项、下一步、精确文件清单。
4. 阶段报告里明确区分「已验证」与「未验证」，未做到的不写成已完成。
5. 数据库迁移只追加，不改写阶段 1/2/3 已有迁移。

## 5. 阶段执行状态

### L0 执行清单（可直接开工）

目标：清理本地模式的遗留命名与边界，把服务契约、存储升级机制和状态补齐固定下来，作为 L1 的稳定起点。**L0 不改任何业务行为。**

| 编号 | 任务 | 主要改动文件 | 完成判据 |
| --- | --- | --- | --- |
| L0-1 | 建立版本控制基线：确认远端 `jkwangoooo/littlemolly` 是否可推送；`git init` + 关联 remote + 首次提交当前状态，或至少本地 `git init` 提交一次（不改文件内容） | `.git/`（新增） | 有可回滚的历史提交；工作区干净 |
| L0-2 | 云端实现归档：`supabase.ts`、`dayPlanService.ts`、`syncTestRecordService.ts`、`shared/types/sync.ts` 移入 `src/services/cloud/` 并加冻结说明；确认无页面引用残留 | 上述 4 个文件、引用方 | 本地层与云端层目录分离；构建仍通过 |
| L0-3 | 遗留命名通用化：`normalizeSupabaseError` → `normalizeDataError`（统一保留 `code/details/hint/status`）；`AuthSyncScreen` → `AuthScreen` 并移入 `features/auth/`；`shared/types/sync.ts` 的 `SaveStatus` 迁到中性位置 | `localDayPlanService.ts`、`AuthSyncScreen.tsx`、`types/` | 本地代码中不再出现 Supabase 字样（云端目录除外） |
| L0-4 | 固定服务契约：为日计划 / 三餐 / 自定义事项 / 选项 / 每日实例分别定义类型与统一服务入口；`LocalStore` 类型扩展为含未来 7 类仓库的联合类型（先不建表）；IndexedDB 升级逻辑收敛为按版本号递增的迁移列表，`DB_VERSION` 保持 1、行为不变 | `localDb.ts`、`localDayPlanService.ts`、`shared/types/` | 接口签名单点定义；现有功能行为零回退 |
| L0-5 | 补齐状态：日页加载占位、未来空日期「准备这一天」引导、历史日期只读提示一致性；周视图补第四种「已完成」状态 | `DayPlanScreen.tsx`、`WeekView.tsx`、`styles.css` | 三态可见；无回退 |
| L0-6 | 可重复验收：为准备进度、默认模式判定、复制规则（不复制准备/完成状态、不改目标日 mode）补最小自动化测试或逐条可复现的验收步骤，写入 `README.md` | 测试文件、`README.md` | 有人能照着一步步复现并得出通过/不通过 |

L0 验收：`npm run typecheck` / `lint` / `build` 全通过；桌面与 390px 手机无横向溢出、控制台无 error；现有功能行为不回退；`HANDOFF.md` 已更新。

### L0 执行状态（2026-09-14 更新）

| 编号 | 状态 | 说明 |
| --- | --- | --- |
| L0-1 | 已完成 | 本地 `.git` 已重建并接上远端历史 `7f35041`；公钥已授权，`git push -u origin main` 成功，远端 `main` 与本地一致，分支跟踪已建立 |
| L0-2 | 已完成 | 云端实现已移入 `src/services/cloud/` 并加冻结说明；已核对无页面引用，且未被打入产物 |
| L0-3 | 已完成 | `AuthSyncScreen` → `features/auth/AuthScreen.tsx`；错误标准化统一为 `shared/errors.ts`；`types/sync.ts` → `types/save.ts` |
| L0-4 | 已完成 | IndexedDB 升级逻辑已收敛为按版本号递增的迁移表（`DB_VERSION` 仍为 1）；「预先扩展 `LocalStore` 联合类型」**有意未做**——会留下 7 个无人使用的空接口，改为与 L1 实际建表同时落地，`localDb.ts` 顶部已写明四步流程 |
| L0-5 | 已完成 | 周视图补第四种「已完成」状态；新增未来空日期「准备这一天」引导（不落库、任意真实写入后自动消失）、读取占位、自定义事项空态 |
| L0-6 | 已完成 | `npm run verify:local`（23 项真实浏览器检查，自带临时服务器并自动回收）+ `npm run check:dates`（48 项日期规则回归），均零第三方依赖；验收步骤已写入 `README.md` |

补充：本批额外修掉了 R2（云端遗留）、R4（无显式迁移）、R5（周视图缺完成态）、R6（两套错误标准化）。R3（对象仓库少于数据契约）属 L1/L2 主体工作量，按 L0-4 的说明与建表同步进行。R1 已通过版本控制基线解决，推送也已于 2026-09-14 打通。

新发现 **R9（低）**：切换日期后保存状态文案残留上一天的结论（`useSaveRunner.resetForDateChange` 有意不重置 `status`），切到空白日期仍显示「已保存」。因 L0 约定不改业务行为，本次未改，建议 L1 触碰保存层时一并处理。详见 `docs/07-L0-completion-report.md` §7。

### L1 执行状态（2026-09-14 更新）

| 编号 | 任务 | 状态 | 证据 |
| --- | --- | --- | --- |
| L1-1 | 新增三类选项对象仓库 | 已完成 | `DB_VERSION` 1→2、`STORES` 三条定义（带 `user_id` 索引）、`MIGRATIONS[2]`；浏览器冷升级实测 `version=2` 且七张表齐备、v1 老数据可读 |
| L1-2 | 每类支持新增 / 重命名 / 排序 / 启停 | 已完成 | `optionService.ts` 四个写入入口，全部按 `user_id` 过滤 |
| L1-3 | 补剂模板含名称与早 / 中 / 晚时段 | 已完成 | 面板强制选时段；排序 = 时段 → `sort_order`，跨时段不换位 |
| L1-4 | 选项页空状态、编辑、删除或停用确认 | 已完成 | 三个分区各有空态，整页零选项时另有「载入示例选项」；停用与删除各用独立的确认文案 |
| L1-5 | 示例选项可编辑且不写死在页面里 | 已完成 | 种子在 `services/local/optionSeed.ts`，注册时幂等播种；`check:local-data` 静态断言界面层零命中 |

L1 验收（`docs/05` 四项）全部达成，其中「在选择器中生效 / 停用不出现在选择器」按「与 L2 选择器同源」验证——L2 的选择器尚不存在，选项页计数直接取自 L2 将调用的 `listSelectableOptions()`。完整证据、缺陷与未验证项见 `docs/08-L1-completion-report.md`。

本阶段顺带修掉 L0 遗留的 **R9**（切日期后保存状态回到「尚未修改」，已纳入验收断言），并新增两项回归：`npm run check:local-data`（15 项，含「迁移只追加」与架构边界断言）与 `npm run verify:local` 中的冷升级用例。

## 6. L1–L6 概要

- **L1 选项管理与本地数据结构（已完成，见 `docs/08-L1-completion-report.md`）**：新增 `food_options`、`supplement_templates`、`exercise_options` 三类对象仓库；每类支持新增 / 重命名 / 排序 / 启停；补剂模板含名称与早中晚时段；提供少量可编辑示例数据（不写死在页面逻辑里）。
- **L2 计划内容实例化**：三餐按早中晚多选食物 + 备注，保存写名称快照；按模板生成当日补剂实例并可逐项勾选；健身改为多选项目 + 备注；复制只带内容与快照，不带任何准备 / 完成状态。
- **L3 休息日与自由规划**：正常周末自动生成「拖地」「洗衣」两个每日实例（仅勾选）；临时不上班不带入家务；休息日保留补剂 / 健身 / 自定义事项并隐藏工作日准备项；两种切换文案与可见内容正确。
- **L4 首页导航与移动端交互**：底部固定导航「今日 / 本周 / 选项」；所有编辑入口统一底部面板并保持返回位置；三餐 / 补剂 / 健身统一为带勾选的选项行；优化长列表、键盘顶起、确认框、错误提示与空状态。
- **L5 本地可靠性、备份与回归**：IndexedDB 显式版本迁移；schema 校验与事务封装；导出 / 导入（导入前确认，格式错误不覆盖）；核心规则测试；多日期 / 刷新 / 清缓存后的回归。
- **L6 上线迁移准备（后置）**：为本地服务实现等价 Supabase 适配器，页面接口不变；补 RLS 与历史约束；本地数据迁移与冲突方案；最后做登录、跨设备、断网失败、RLS 双账号与上线验收。

## 7. 需要项目所有者决策

1. **是否授权我从 L0 开始执行**（含上面的 L0-1 到 L0-6）。
2. **版本控制怎么处理**：远端 `git@github.com:jkwangoooo/littlemolly.git` 是否仍可用？是「`git init` + 推送覆盖远端」还是「先克隆远端最新，再把我这边的目录覆盖上去」？本目录与远端哪一份是权威？
3. **R2 的处置方式**：云端实现移到 `src/services/cloud/` 保留待 L6，还是直接删除（无 Git 历史时会永久丢失，不建议）。
