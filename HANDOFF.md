# 幸福小Molly：开发交接

## 当前交接摘要（2026-09-14）

- 当前开发方向是本地优先：浏览器 IndexedDB 是唯一业务数据源；Supabase、RLS、跨设备同步和上线迁移均后置，不是当前开发或验收的阻塞条件。
- 当前技术基线是 React + TypeScript + Vite + IndexedDB。服务层已按职责拆为 `src/services/local/`（当前生效）与 `src/services/cloud/`（L6 前冻结、不得被页面引用）；页面只通过服务层读写。会话状态只在 `src/app/App.tsx` 持有，本地会话读写集中在 `src/services/local/sessionStore.ts`。
- 日计划页已是「编排页 + 子组件 + hook」结构：`DayPlanScreen.tsx` 只做编排，展示在 `features/day-plan/components/`，数据读取在 `useDayPlanData`，保存状态机在 `useSaveRunner`；周视图状态判定集中在 `features/week/weekStatus.ts`。IndexedDB 的建表逻辑已收敛为按版本号递增的显式迁移表（`localDb.ts` 的 `STORES` / `MIGRATIONS`，当前 `DB_VERSION = 4`，共 11 张对象仓库）。选项页同样只做编排（`features/preferences/PreferencesScreen.tsx`），读写全部经 `services/local/optionService.ts`，示例数据在 `services/local/optionSeed.ts`；保存状态前缀与文案集中在 `shared/saveStatus.ts`，日计划页与选项页共用一套措辞。
- 已实现本地注册、登录、退出、刷新恢复、Asia/Shanghai 日期、日期模式、固定周视图、工作日准备/执行、三餐多选食物与备注、补剂模板实例化与逐项勾选、健身多选项目与备注、自定义事项、休息日家务（拖地/洗衣）、复制昨天、历史只读和保存失败重试。
- **L0 已完成（2026-09-14），可进入 L1。** 完成报告见 `docs/07-L0-completion-report.md`：六项任务全部落地，现有业务行为零回退，并首次具备可重复的自动化验收。L0-L6 的唯一任务范围、顺序和验收条件见 `docs/05-local-first-execution-plan.md`，接手评估与 L0 拆解见 `docs/06-takeover-assessment-and-plan.md`。
- **L1 已完成（2026-09-14），可进入 L2。** 完成报告见 `docs/08-L1-completion-report.md`：`food_options` / `supplement_templates` / `exercise_options` 三类对象仓库落库（`DB_VERSION` 1→2），选项页支持新增 / 改名 / 排序 / 启停 / 删除并带二次确认，示例选项放在 `services/local/optionSeed.ts`（注册时幂等播种，页面零写死）；同时修掉 L0 遗留的 R9（切日期后保存状态残留）。验收：浏览器 52 项 + 日期规则 48 项 + 本地数据结构 15 项全通过，含真实冷升级（v1 老库 → v2 七张表且老数据可读）。
- **L2 已完成（2026-09-14），可进入 L3。** 完成报告见 `docs/09-L2-completion-report.md`：三餐升级为早/中/晚多选食物 + 备注（`daily_meals`）；补剂从模板生成每日实例、可逐项勾选执行、自定义行可增删（`daily_supplements`）；健身升级为多选项目 + 备注（`daily_exercises`）；全部保存时写入名称快照、改名/停用选项不改写历史；复制昨天只带内容与快照不带状态；`DB_VERSION` 2→3（共 10 张表），迁移含 `backfillSnapshots` 将旧自由文本转为快照项。验收：`npm run typecheck/lint/build` 通过、`check:local-data` 21/21 通过、`verify:local` **66/66** 通过（含 v2→v3 冷升级）。
- **L3 已完成（2026-09-14），可进入 L4。** 完成报告见 `docs/10-L3-completion-report.md`：正常周六/周日自动补齐「拖地/洗衣」两个每日实例（`routine_tasks` 表）、仅勾选完成；临时不上班（工作日人工切休息日，`mode_override=true`）不自动带家务；休息日保留补剂/健身/自定义事项、隐藏衣服/三餐/晨间等工作日准备项；休息日切工作日保留二次确认；`DB_VERSION` 3→4（共 11 张表）。验收：三件套通过、`check:dates` 48/48、`check:local-data` 24/24、`verify:local` **74/74** 通过（含 v3→v4 冷升级）。
- 代码仓库：`git@github.com:jkwangoooo/littlemolly.git`（公开仓库）。本机已重建 `.git` 并接到远端历史，L0 期间的提交依次为 `1802fe8`（接手文档）→ `e8b4ec2`（目录职责整理）→ `b3dcd15`（文档同步）→ `1192cdb`（验收命令）→ `b81bf71`（补入未受版本控制的共享组件）→ `baf78db`（组件拆分与存储层重构）→ `716ee35`（L0 第 2 批记录）→ `4c936e0`（验收脚本自带服务器）→ `cd61dfc`（L0 完成报告）；L1 的提交为 `6408eb0`（选项管理与本地数据结构）。`.env.local`、构建产物、本地依赖和 `.workbuddy/` 均被忽略。
- **推送已完成（2026-09-14）**：本机公钥已加入 GitHub，`git push -u origin main` 成功，分支跟踪已建立，远端 `main` 与本地 `HEAD` 一致、无未推送提交。后续提交按常规 `git push` 即可。
- 下方阶段 1-3 的 Supabase 记录是历史证据，不代表现行本地模式，也不应改变当前 L0-L6 执行顺序。

## 当前待办

1. 进入 **L4：首页导航与移动端交互完善**。补齐底部固定导航「今日 / 本周 / 选项」；统一所有编辑入口为底部面板、保存/取消后回到原页面和滚动位置；优化长列表、面板键盘顶起、确认框、错误提示和空状态；保留桌面宽屏布局。
   - L2/L3 已就绪：面板组件 `MealPanel` / `SupplementPanel` / `ExercisePanel` 已在 `EditorSheet` 编排；休息日视图（家务 + 补剂/健身/自定义事项）已分流。
   - L3 遗留：休息日「准备/执行」tab 语义未区分（休息日无五项准备，两 tab 显示相同内容），L4 统一交互时一并处理。
2. 每次阶段完成后运行 `npm run typecheck`、`npm run lint`、`npm run build`、`npm run check:dates`、`npm run check:local-data`，并运行 `npm run verify:local` 做真实浏览器闭环验收（桌面 1440x900 + 手机 390x844、无横向溢出、控制台无 error/warning）。需要人工核对外观时加 `SHOT_DIR` 落盘截图。
3. 新增对象仓库时按 `localDb.ts` 顶部四步走（`LocalStore` → `STORES` → `DB_VERSION` → `MIGRATIONS`），`check:local-data` 会强制这三处同时改；迁移只追加，不改写既有迁移。（L2/L3 已完成此步骤，后续阶段若再新增表需继续遵循。）
4. R9 已在 L1 修复并纳入验收断言，不再挂账。
5. L1-L5 完成前不恢复云端迁移工作。

## 已有文档

- `docs/00-product-scope.md`：功能边界和第一版验收。
- `docs/01-architecture-data-contract.md`：模块边界、推荐技术基线、数据不变量。
- `docs/02-ui-interaction-spec.md`：页面和交互规则。
- `docs/03-delivery-roadmap.md`：五个开发阶段及各阶段验收。
- `docs/04-stage-orchestration.md`：新窗口实施提示词、总指挥验收协议。
- `docs/05-local-first-execution-plan.md`：现行 L0–L6 任务线、顺序与验收门槛（**现行方向的唯一依据**）。
- `docs/06-takeover-assessment-and-plan.md`：接手评估、风险项 R1–R9、L0 执行清单与状态。
- `docs/07-L0-completion-report.md`：L0 完成报告（任务达成、证据、缺陷、延后项与未验证项）。
- `docs/08-L1-completion-report.md`：L1 完成报告（选项管理与本地数据结构：任务达成、证据、缺陷、延后项与未验证项）。
- `docs/09-L2-completion-report.md`：L2 完成报告（计划内容实例化：三餐多选、补剂实例化、健身多选、名称快照、v2→v3 冷升级；任务达成、证据、缺陷、延后项与未验证项）。
- `docs/10-L3-completion-report.md`：L3 完成报告（休息日与自由规划：拖地/洗衣每日实例、临时不上班不带家务、隐藏工作日准备项、v3→v4 冷升级；任务达成、证据、缺陷、延后项与未验证项）。

## 阶段 1 已完成内容

- 初始化 React + TypeScript + Vite 工程和最小模块目录。
- 接入 Supabase 客户端、邮箱登录/注册、持久会话恢复和退出登录。
- 建立统一 `services/` 数据服务层；页面不直接调用数据库。
- 新增 `profiles`、`sync_test_records` 只追加迁移；两个用户私有表启用 RLS，策略以 `auth.uid()` 限制读写。
- 同步验证界面支持创建、编辑、重新读取测试记录，并显示“正在保存 / 已保存 / 保存失败”。未配置云端时显示明确配置错误，不使用 `localStorage`。

## 修改文件

- `package.json`、`package-lock.json`、`vite.config.ts`、`tsconfig*.json`、`eslint.config.js`、`index.html`、`.gitignore`、`.env.example`
- `src/main.tsx`、`src/app/App.tsx`、`src/app/styles.css`、`src/features/auth-sync/AuthSyncScreen.tsx`
- `src/services/supabase.ts`、`src/services/authService.ts`、`src/services/syncTestRecordService.ts`
- `src/shared/types/sync.ts`、`src/vite-env.d.ts`
- `database/migrations/202608270001_stage1_auth_sync.sql`、`README.md`

## 实际运行的命令

- `npm install --cache /private/tmp/happy-little-molly-npm-cache --prefer-offline --no-audit --no-fund`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run dev -- --host 127.0.0.1`

类型检查、ESLint 和 Vite 生产构建均通过。开发服务器地址为 `http://127.0.0.1:5173/`。

## 浏览器验证结果

- 真实 Codex In-app Browser 桌面视口 `1440x900`：页面加载成功，标题与配置提示可见，主区域宽度 620px，未出现横向溢出。
- 真实浏览器手机视口 `390x844`：页面加载成功，标题与配置提示可见；DOM 内容正常。
- 因未配置 Supabase，无法在浏览器中完成登录、创建、编辑、刷新恢复或失败保存的真实云端交互。

## Supabase 验证结果

- 当前目录没有 `.env.local`，也没有真实 Supabase URL/anon key；未执行真实云端迁移、写入、刷新读取或双账号 RLS 隔离验证。
- 迁移执行方式：Supabase Dashboard SQL Editor 执行 `database/migrations/202608270001_stage1_auth_sync.sql`，或配置 Supabase CLI 后执行 `supabase db push`。

## 未验证项与阻塞项

- 阻塞：缺少真实 Supabase 项目凭据和测试账号，因此阶段 1 不能声称云端验收完成。
- 待补验：真实登录/会话刷新、记录写入/编辑/刷新恢复、断网时“保存失败”、第二账号 RLS 隔离，以及在真实 Supabase 项目执行迁移。

## 总指挥阶段 1 验收（2026-08-27）

- 结论：部分完成，等待云端验收；暂不进入阶段 2。
- 已通过：工程结构检查、`npm run typecheck`、`npm run lint`、`npm run build`、无配置状态的桌面/手机浏览器加载、控制台无错误、迁移中 RLS 与 `auth.uid()` 策略静态检查。
- 未通过/未完成：未配置 Supabase 项目凭据，无法证明真实登录、云端写入、编辑后刷新恢复、断网保存失败、双账号隔离和真实迁移执行。
- 放行条件：按 `docs/04-stage-orchestration.md` 的阶段 1 清单补齐上述云端与浏览器证据，并再次提交验收。

## 下一步建议

配置 `.env.local`（只使用 anon/publishable key），执行迁移并按 `README.md` 验收步骤完成真实云端和双账号测试；全部通过后再依据阶段协议进入阶段 2。

## 阶段 1 云端验收续测（2026-08-28）

### 本次修改文件

- `HANDOFF.md`（仅补充本次验收记录）；未修改业务代码、迁移或阶段 2 及之后的任何内容。

### 实际执行的命令

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git status --short`、`git rev-parse --show-toplevel`、`git diff --check`
- `command -v supabase`、`supabase --version`
- `npm run dev -- --host 127.0.0.1`

类型检查、ESLint 与生产构建均通过。当前目录不是 Git 仓库，故 `git diff --check` 无可检查的版本库差异；未初始化或修改 Git。系统未安装 Supabase CLI。

### 配置和迁移结果

- 已检查项目根目录：只有 `.env.example`，不存在 `.env.local`；没有读取、记录或暴露任何真实 Supabase URL、anon/publishable key、service role 或 secret key。
- 未能连接真实 Supabase 项目，因此未实际执行 `database/migrations/202608270001_stage1_auth_sync.sql`，也不能证明其在真实空库执行结果。
- 静态审查确认迁移包含 `profiles` 与 `sync_test_records`，二者均启用 RLS；私有记录的 select/insert/update/delete 策略均以 `auth.uid()` 限制 `user_id`。真实策略安装、空库执行及重复执行仍待验证。

### 登录、会话和同步结果

- 阻塞：缺少 `.env.local` 配置和测试账号，未能执行注册或登录，也未能验证刷新后的会话恢复。
- 同样未能验证测试记录的创建、编辑、刷新后从 Supabase 读取，以及“从云端重新读取”。
- 保存状态逻辑仍由阶段 1 页面实现：请求开始显示“正在保存”，仅 Supabase 成功返回后显示“已保存”，异常路径显示“保存失败”。本次没有真实可达/不可达 Supabase 会话，不能将该静态结果当作真实成功或失败验收。

### 双账号 RLS 隔离结果

- 未验证：没有第二测试账号或真实数据库连接，无法验证第二账号无法读取或修改第一账号记录。
- 数据库策略静态检查通过，但必须在真实数据库中以两个账号补验，不能只依赖前端过滤。

### 浏览器结果

- 真实 Codex In-app Browser 桌面视口 `1440x900`：页面标题和“缺少 Supabase 配置”提示正常显示，`scrollWidth=1440`，无横向溢出，控制台无错误。
- 真实 Codex In-app Browser 手机视口 `390x844`：同一提示正常显示，`scrollWidth=390`，无横向溢出，控制台无错误。
- 因没有 Supabase 配置，登录、创建、编辑、云端重新读取和保存失败控件在该安全配置状态下不可操作，故这些交互的桌面/手机验收尚未完成。

### 阶段结论

- 阶段 1 部分完成，等待补验；不得进入阶段 2。
- 放行前需提供 `.env.local` 的真实 URL 与 anon/publishable key（不提交、不输出），在真实 Supabase 项目执行迁移，并完成两账号、刷新恢复、不可达服务失败状态及桌面/手机完整交互验收。

## 阶段 1 云端验收续测（2026-08-28，第 2 次）

### 测试时间与本次修改

- 测试时间：2026-08-28（Asia/Shanghai）。
- 本次修改 `HANDOFF.md`，并对阶段 1 迁移增加幂等保护；没有修改认证、同步界面或任何阶段 2 及之后的业务文件。
- 没有可用测试账号，故无可记录的账号标识；没有创建或传输密码。

### 环境与迁移

- 项目根目录仍不存在 `.env.local`，只有不含真实值的 `.env.example`；`.gitignore` 已明确忽略 `.env.local` 与 `.env.*.local`。
- 因缺少真实 Supabase Project URL 和 anon/publishable key，未创建伪造或空白配置，也未执行真实数据库迁移。
- 当前机器没有 Supabase CLI；无法在真实空数据库执行 `database/migrations/202608270001_stage1_auth_sync.sql`。
- 迁移、两表 RLS、`auth.uid()` 策略的静态审查结果保持不变；真实执行、策略安装和重复执行结果仍未验证。

### 认证、同步、保存状态与 RLS

- 注册、登录、刷新会话恢复和退出登录未验证：缺少真实云端配置与测试账号。
- 创建、编辑、从云端重新读取和刷新恢复未验证：没有真实 Supabase 写入通道。
- “正在保存 / 已保存 / 保存失败”未完成真实浏览器验收：没有可登录会话，不能合法触发保存请求或不可达服务测试。
- 双账号 RLS 隔离未验证：没有账号 A、账号 B 或真实数据库连接；不得以静态策略或前端过滤替代真实行为证明。

### 工程检查

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `git diff --check`：跳过，原因是当前目录不是 Git 仓库；未初始化或修改 Git。
- 敏感配置扫描未发现源码中的 `service_role`、secret key 或 `localStorage` 同步实现；文档中的安全说明除外。

### 阶段结论

- 阶段 1 部分完成，等待补验；不得进入阶段 2。
- 要继续验收，必须先由项目所有者在本机提供未提交的 `.env.local`（仅 URL 与 anon/publishable key）并准备两个测试账号，之后再执行真实迁移与完整桌面/手机浏览器验收。

## 阶段 1 云端验收续测（2026-08-28，第 3 次）

### 本次修改与测试时间

- 测试时间：2026-08-28（Asia/Shanghai）。
- 本次修改 `HANDOFF.md`，并对阶段 1 迁移增加幂等保护；没有修改认证、同步界面或任何阶段 2 及之后的业务文件。
- 未记录或传输任何密码、Supabase 密钥或其他敏感凭据。

### 配置、迁移和安全检查

- 项目根目录不存在 `.env.local`，仅有 `.env.example`；`.gitignore` 包含 `.env.local` 与 `.env.*.local`。
- 因未提供真实 Supabase Project URL、anon/publishable key 和两个测试账号，未创建空白/伪造配置，未连接真实项目，也未执行迁移。
- 未读取、输出或使用 `service_role`、secret key 或其他敏感凭据。
- `database/migrations/202608270001_stage1_auth_sync.sql` 静态审查确认包含 `profiles`、`sync_test_records`，两表启用 RLS；私有表的读、写、删策略均使用 `auth.uid()` 与 `user_id` 限制所有者访问。本次将函数改为 `create or replace`，并在触发器/策略创建前加入 `drop ... if exists`，使迁移在已有阶段 1 对象时可安全重跑；真实空库执行、重复执行和策略安装结果仍未验证。

### 认证、同步、保存状态与双账号隔离

- 注册、登录、会话刷新恢复和退出登录：未验证，原因是没有真实配置和测试账号。
- 创建、编辑、从云端重新读取、刷新恢复：未验证，原因是没有真实 Supabase 写入通道。
- “正在保存 / 已保存 / 保存失败”：代码路径静态确认成功仅在 Supabase 请求成功后显示“已保存”，异常路径显示“保存失败”；没有真实会话，不能将其记录为云端验收证据。
- 保存失败（不可达服务/断网）：未验证。
- 双账号 RLS 隔离（账号 B 不能读取、修改或删除账号 A）：未验证；不得用静态策略或前端过滤替代真实数据库行为证明。

### 工程检查与浏览器

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `git diff --check`：无法执行，原因是当前目录不是 Git 仓库；未初始化或修改 Git。
- 敏感配置/同步实现扫描：未发现源码中的 service role、secret key 或 `localStorage`/`sessionStorage` 同步实现（文档安全说明除外）。
- 本次在无配置安全状态重复检查浏览器：桌面 `1440x900` 和手机 `390x844` 的 `scrollWidth` 分别为 `1440`、`390`，控制台无错误；登录、创建、编辑、错误状态和云端恢复仍未验证。

### 阶段结论

- **阶段 1 部分完成，等待补验；不得进入阶段 2。**
- 放行前必须由项目所有者在本机提供未提交的 `.env.local`（仅 Project URL 与 anon/publishable key）并准备账号 A、账号 B，然后在真实 Supabase 空库执行迁移，完成认证、刷新恢复、同步、失败保存、双账号 RLS 和桌面/手机完整浏览器验收。

## 阶段 1 最终云端验收（2026-08-31）

### 配置与迁移

- 项目所有者已在本机配置未提交的 `.env.local`，仅使用 Project URL 与 anon/publishable key；项目根 URL 格式正确，未记录、输出或使用任何 secret/service role key。
- 已在真实 Supabase 项目 `happy-little-molly` 的 SQL Editor 成功执行 `database/migrations/202608270001_stage1_auth_sync.sql`。
- 迁移创建/更新 `profiles`、`sync_test_records`、更新时间触发器及 RLS 策略。静态复核确认两张用户私有表启用 RLS，读/写/删策略均以 `auth.uid()` 和 `user_id` 限制所有者。

### 认证与真实同步

- 账号 A（`8950***@qq.com`）成功登录；刷新页面后会话仍存在。
- 账号 A 创建记录“阶段1验收-账号A-创建”后显示“已保存”，将其编辑为“阶段1验收-账号A-已编辑”后再次成功保存。
- 刷新页面后，已编辑内容从 Supabase 恢复；手动点击“从云端重新读取”后仍读取到账号 A 的 2 条既有记录。
- 账号 A 成功退出，页面回到登录界面；重新登录后会话及其私有记录正确恢复。
- 项目所有者在断网状态下保存新记录，页面实际显示“保存失败”；恢复网络后再次保存，页面显示“已保存”。失败不被误报为成功。

### 双账号 RLS 隔离

- 账号 B（`yjh3***@gmail.com`）登录后仅读取到自身记录“222”，未读取到账号 A 的“阶段1验收-账号A-已编辑”及“333”。
- 账号 A 重新登录后仅读取到自身记录，未读取账号 B 的“222”。账号 B 因不能读取账号 A 记录，界面不存在可编辑或删除账号 A 记录的目标；数据库更新/删除策略同时以 `auth.uid()` 限制所有者。

### 浏览器与工程检查

- 已登录浏览器流程在桌面 `1440x900` 和手机 `390x844` 完成复核。两种视口均无横向溢出（`scrollWidth` 等于视口宽度），控制台无错误；手机可看到同步记录与全部操作按钮。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- 当前目录不是 Git 仓库，无法执行 `git diff --check`；未初始化或修改 Git。

### 阶段结论

- **阶段 1 完成，可进入阶段 2。**
- 阶段 2 应只开始日期引擎与周视图，继续保持用户私有数据走 Supabase 服务层并由 RLS 保护。

## 阶段 2 实施记录（2026-08-31）

### 本次完成内容

- 新增 `src/shared/date/dateUtils.ts`：以 `Asia/Shanghai` 派生业务日期，日期键使用 UTC 日历运算，支持今天、明天、未来、历史判断，以及固定周一至周日七天生成。
- 新增 `database/migrations/202608310001_stage2_day_plans.sql`：创建私有 `day_plans`，`(user_id, plan_date)` 唯一，模式仅允许 `work`/`rest`，启用 RLS 并以 `auth.uid()` 限制读写删。
- 迁移中的数据库触发器以 `(now() at time zone 'Asia/Shanghai')::date` 拒绝插入、更新或删除历史日期计划；前端服务层也会先拒绝历史写入。
- 新增 day plan 服务层、单日日期模式页和固定本周视图。登录后默认进入日期页面，保留认证、退出和会话恢复；阶段 1 同步验证服务保留但不再作为主页面。
- 工作日/休息日按周一至周五/周六周日默认；模式切换须确认，支持恢复默认并清除 `mode_override`。历史日期只显示“历史计划仅供查看”。
- 未实现三餐、补剂、健身、衣服、晨间事项、时间线、复制昨天、选项管理或完成状态。

### 修改文件

- `src/features/auth-sync/AuthSyncScreen.tsx`
- `src/features/day-plan/DayPlanScreen.tsx`
- `src/features/week/WeekView.tsx`
- `src/services/dayPlanService.ts`
- `src/shared/date/dateUtils.ts`、`src/shared/date/index.ts`
- `src/shared/types/dayPlan.ts`
- `src/app/styles.css`
- `database/migrations/202608310001_stage2_day_plans.sql`
- `README.md`、`HANDOFF.md`

### 本地验证

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `git diff --check`：未执行成功，原因是当前目录不是 Git 仓库；未初始化或修改 Git。
- 本地 Vite 服务在 `http://127.0.0.1:5174/` 启动后，未登录状态的真实 In-app Browser 桌面 `1280px` 与手机 `390x844` 视口均无横向溢出，控制台无错误。由于当时没有已登录浏览器会话，阶段 2 登录后页面与真实写入仍待验证。

### 实施完成时的待验收项（已由下方最终验收覆盖）

- 必须在真实 Supabase 项目执行阶段 2 新迁移，验证历史写入触发器、RLS 双账号隔离、模式写入和恢复默认后刷新读取。
- 必须以已登录状态在桌面和手机浏览器验证今日、明日、历史日期、确认取消、两种切换文案、本周七天与跨月/跨年周。
- 下一阶段只能在上述阶段 2 验收通过并记录后开始；下一阶段为工作日规划闭环。

## 阶段 2 最终云端验收（2026-08-31）

### 迁移与测试角色

- 项目所有者已在真实 Supabase SQL Editor 执行 `database/migrations/202608310001_stage2_day_plans.sql`；本次未读取、输出或提交 `.env.local`、密码、匿名 key、service role 或其他 secret。
- 以账号 A 创建并保存未来日期模式覆盖；以独立账号 B 验证同一真实项目中的 RLS 隔离。账号标识未记录。

### 日期模式、刷新与周视图

- 业务日期为 2026-08-31（周一）：默认显示“工作日”；2026-09-05（周六）默认显示“休息日”。
- 账号 A 将 2026-09-01（周二）从默认工作日切换为休息日：确认框包含“恭喜幸福小Molly，今天不上班”；取消后页面未变化，确认保存后显示“已保存”和“人工覆盖默认模式”。刷新后再次从云端读取该覆盖。
- 账号 A 将 2026-09-05（周六）切换为工作日：确认框包含“幸福小Molly，今天要上班哦”；保存并刷新后覆盖仍存在。执行“恢复默认”后显示“休息日 / 按星期自动判断”，刷新后仍正确，证明 `mode_override` 已清除。
- 2026-08-30 历史日期只显示“历史计划仅供查看”，没有切换或恢复默认操作。
- 本周显示跨月的 2026-08-31 至 2026-09-06，固定 7 天。账号 A 的未来已保存计划显示“待准备”；点击 2026-09-01 后进入对应单日页。

### 数据库历史只读与双账号 RLS

- SQL Editor 实测：对今天之前 `day_plans` 的 `INSERT`、将未来计划更新为历史日期、删除历史计划，均被数据库触发器拒绝。
- 账号 B 的本周及 2026-09-01 单日页未读取到账号 A 的计划，显示自身默认“工作日 / 按星期自动判断”，且没有恢复默认入口；这来自 Supabase 服务端读取，而非前端过滤。
- SQL Editor 在模拟账号 B 的已认证声明后尝试更新账号 A 的 2026-09-01 记录，返回 `EXPECTED_RLS_BLOCKED`，即受影响行数为 0。账号 A 重新登录后，其“休息日 / 人工覆盖默认模式”记录仍存在。

### 浏览器与工程检查

- 已登录真实 In-app Browser 在桌面 `1440x900` 和手机 `390x844` 完成检查：两种视口的 `scrollWidth` 均等于视口宽度，本周均为 7 个日期项，控制台无 error/warning。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `git diff --check`：无法执行，原因是当前目录不是 Git 仓库；未初始化、提交、重置或修改 Git。

### 未验证项与阶段结论

- 阶段 2 范围内的云端保存、刷新恢复、历史数据库只读、双账号 RLS、跨月周视图及桌面/手机页面均已完成验收。未进行专门的跨年周浏览器样例，但日期工具已按固定周一至周日和日历日期计算实现；该项可在后续回归中补充。
- **阶段 2 完成，可进入阶段 3。** 后续阶段只应开始工作日规划闭环，不得回填或改写本阶段已验收的日期与权限边界。

## 阶段 3 实施记录（2026-08-31）

### 阶段结论

- **阶段 3 部分完成，等待云端验收。** 本地工程检查和未登录浏览器检查已通过；新迁移尚未由项目所有者在真实 Supabase 执行，故不能宣称新增表/RLS/RPC、已登录规划流、刷新恢复或双账号隔离已通过。
- 未实现阶段 4 的补剂模板或具体补剂实例、休息日拖地洗衣、食物/补剂/健身选项管理，也未开始阶段 5 发布工作。

### 本次修改文件

- `database/migrations/202608310002_stage3_workday_planning.sql`
- `src/shared/types/dayPlan.ts`
- `src/services/dayPlanService.ts`
- `src/features/day-plan/DayPlanScreen.tsx`
- `src/app/styles.css`
- `README.md`
- `HANDOFF.md`

### 核心实现

- 新迁移为 `day_plans` 追加五项准备状态、晨间/健身计划与执行状态；新增结构化 `daily_meals`、`custom_tasks` 表，不使用万能 JSON。
- 两个从属表启用 RLS，读写均通过引用的同一 `day_plans.user_id = auth.uid()` 约束；数据库触发器以上海日期拒绝历史从属数据的新增、更新与删除。
- `copy_yesterday_stage3(date)` 在数据库端一次性复制三餐、晨间、健身、自定义事项，并清空五项准备/所有完成状态；目标日既有模式与 `mode_override` 保持不变。
- 首页提供“执行今天 / 准备明天 / 本周”；历史日为只读。本周点击日期仍回到完整日页，工作日/休息日确认切换与恢复默认沿用。
- 工作日准备页有五项独立勾选和严格 `n/5` 进度，三餐、晨间、健身、自定义事项从 React 底部面板编辑；执行页的完成状态与准备状态分离。复制/删除使用 React 确认弹层，未使用浏览器原生 `confirm`。

### 实际执行的命令与结果

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `npm run dev -- --host 127.0.0.1 --port 5174`：5174/5175 已被占用，Vite 实际运行于 `http://127.0.0.1:5176/`。

### 实际浏览器与 Supabase 验证证据

- 本地 In-app Browser 未登录状态：桌面 `1280px`，`scrollWidth=1280`，控制台无 error/warning；登录页正常显示。
- 本地 In-app Browser 未登录状态：手机 `390x844`，`scrollWidth=390`，控制台无 error/warning；无横向溢出。
- 未读取、输出、提交、索取 `.env.local`、账号密码、anon key、service role 或其他 secret。
- 未执行本阶段新迁移，未进行登录账号 A/B、真实写入、刷新恢复、复制 RPC、历史从属数据拒绝或 RLS 云端验证。

### 项目所有者下一步与风险

- 在真实 Supabase SQL Editor 仅执行新增 `database/migrations/202608310002_stage3_workday_planning.sql`，不要改写阶段 1/2 迁移；随后以账号 A/B 做新增表及 RPC 的 RLS 验收。
- 登录后完成一份明日工作日计划，刷新恢复；逐项确认五项进度、执行完成勾选、模式切换、历史只读、删除确认与复制不带状态。在桌面 `1440x900`、手机 `390x844` 检查面板、长表单、确认框和控制台。
- 当前实现尚未经过真实 Supabase 类型生成或云端执行，主要风险是 SQL 函数/策略在目标项目上的安装与运行差异；云端验收前不得进入阶段 4。

## 阶段 3 修复记录（2026-09-03）

### 本次修改

- `src/features/day-plan/DayPlanScreen.tsx`
  - 修正休息日改为工作日确认文案为“幸福小Molly，今天要上班哦”；工作日改休息日仍为“恭喜幸福小Molly，今天不上班”。
  - 新增集中式 `runSave` 重试机制：保存失败会保留最近一次完整保存请求；顶部“重试”会再次发送同一请求；成功后清除重试引用并按原流程关闭编辑面板，失败继续保留面板输入并显示“保存失败”。切换日期时清除旧请求，避免跨日期误重试。

### 实际验证

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- 本地 Vite 服务：`http://127.0.0.1:5177/`。
- 未登录 In-app Browser 桌面视口：`scrollWidth=1280`，控制台 error/warning 为空。
- 未登录 In-app Browser 手机视口 `390x844`：`scrollWidth=390`，控制台 error/warning 为空。
- 未执行 SQL 迁移，未读取、输出或索取 `.env.local`、密码、anon key、service role 或其他 secret。

### 阶段结论与待办

- **阶段 3 部分完成，等待云端验收。** 本次仅修复文案与保存重试，不改变阶段边界，也未开始阶段 4。
- 仍待项目所有者在真实 Supabase 执行 `database/migrations/202608310002_stage3_workday_planning.sql`，并以账号 A/B 验证登录保存、失败后重试成功/再次失败、刷新恢复、复制昨天不带执行状态、历史从属数据保护及 RLS 隔离。

## 阶段 3 保存重试补全（2026-09-03）

### 本次修改

- `src/features/day-plan/DayPlanScreen.tsx`
  - 复制昨天、确认删除自定义事项、恢复默认日期模式全部改为通过统一 `runSave` 执行。
  - 复制失败后，“重试”会重新调用复制 RPC，并在成功后重新读取目标日计划、三餐与自定义事项。
  - 删除失败后，“重试”会重新提交同一删除请求；仅服务端删除成功后才从页面移除事项。
  - 恢复默认失败后可通过同一“重试”再次提交；所有用户触发的云端写入现在共享保存中、成功、失败与内存中的重试请求机制。

### 实际验证

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- 本次未执行 SQL 迁移、未连接或写入真实 Supabase，也未读取、输出或索取任何凭据。

### 阶段结论与待办

- **阶段 3 部分完成，等待云端验收。** 本次仅补全阶段 3 保存重试覆盖，不进入阶段 4。
- 待项目所有者后续在真实 Supabase 执行已有的阶段 3 新迁移，并验证：复制 RPC 失败后重试、删除失败后重试、恢复默认失败后重试、编辑面板失败后输入保留并重试、刷新恢复、历史保护和账号 A/B RLS 隔离。

## 阶段 3 云端验收阻断修复（2026-09-03）

### 本次修改

- `src/services/dayPlanService.ts`
  - 新增统一 `normalizeSupabaseError`，将 Supabase 返回的普通错误对象标准化为带 `code`、`message`、`details`、`hint`、`status` 的 Error。
  - `getDayPlan`、`listDayPlans`、`upsertDayPlan`、三餐/自定义事项读写、删除和复制 RPC 统一经过该错误标准化，避免真实数据库错误被吞成未知错误。
- `src/features/day-plan/DayPlanScreen.tsx`
  - 错误提示统一显示真实消息，并附带错误码、详情和修复提示（若 Supabase 返回）。
  - 未改变既有 `runSave`、编辑面板输入保留和重试请求引用逻辑。
- 未新增迁移；未修改阶段 1/2 迁移；未进入阶段 4。

### 实际运行的检查

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `npm run dev -- --host 127.0.0.1`：沙箱首次绑定端口返回 EPERM；经授权后 Vite 成功启动，地址 `http://127.0.0.1:5173/`。

### 真实 Supabase 只读核验

- 在项目 `happy-little-molly` SQL Editor 执行只读查询，确认 `public.day_plans.morning_focus` 存在且为 `text NOT NULL DEFAULT ''`。
- 确认 `daily_meals`、`custom_tasks` 和 `copy_yesterday_stage3(date)` 已存在。
- 确认 `day_plans_reject_historical`、`day_plans_set_updated_at` 触发器已存在。
- 确认 `day_plans` 的 `SELECT`、`INSERT`、`UPDATE`、`DELETE` RLS 策略已存在。
- 未执行任何迁移、写入、删除或修改 SQL。

### 浏览器验证

- 本地应用桌面与手机未登录页面均可加载，控制台 error/warning 为空；当前 Chrome/In-app Browser 中没有账号 A 的已登录应用会话，因此无法在本轮重放晨间事项保存、刷新恢复或断网重试。
- 未读取、输出或索取 `.env.local`、Supabase URL/key、anon key、service role key 或密码。

### 未完成项与下一步

- 仍需项目所有者在已有账号 A 登录会话中再次保存“阶段3晨间事项”。若仍失败，页面现在会显示具体 Supabase `code/message/details/hint`，据此继续判断 PostgREST schema cache、RLS 或请求数据问题。
- 尚未完成账号 B、历史保护、复制昨天、删除、恢复默认及完整 RLS 的真实浏览器验收。

### 阶段结论

- **阶段 3 部分完成，等待云端验收。**

## 本地优先执行线（2026-09-13）

- 用户已明确：当前优先把本地业务跑通，IndexedDB 作为当前业务数据源；Supabase、RLS、跨设备同步和上线验证后置，不作为当前开发的阻塞条件。
- 当前已有本地认证、日期模式、周视图、工作日准备/执行、三餐文本、晨间事项、健身决定、自定义事项、复制昨天和历史只读。
- 当前主要缺口是选项管理、三餐/健身多选、补剂模板与每日实例、周末拖地洗衣、休息日自由规划、底部选项导航、IndexedDB 版本迁移及导入导出。
- 新的执行顺序和验收门槛见 `docs/05-local-first-execution-plan.md`：L0 本地基线整理，L1 选项管理，L2 计划实例化，L3 休息日，L4 移动端交互，L5 本地可靠性，L6 最后进行云端迁移。
- 下一步只执行 L0；在 L0/L1 的数据契约稳定前，不扩展云端代码或上线验收，也不提前实现后续阶段功能。

## L0 第 1 批：接手盘点与目录职责整理（2026-09-14）

### 背景

- 接手时本目录**没有 `.git`**（尽管更早的交接记录称已推送 `634dd7b`），且缺少 `node_modules`。已先补齐依赖并重建版本控制基线。
- 逐文件比对确认：本目录内容与远端 `main`（`7f35041`）**零差异**，即本目录就是远端最新版的干净副本，不存在分叉。因此以 `git update-ref refs/heads/main 7f35041` + `git reset --mixed` 接上远端历史，而不是新建无关联的 root 提交。

### 本次修改文件

- 新增：`src/services/local/`、`src/services/cloud/`、`src/features/auth/`、`src/shared/errors.ts`、`src/shared/types/save.ts`、`src/services/cloud/types.ts`、`public/favicon.svg`、`scripts/verify-local.mjs`、`package.json` 的 `verify:local` 脚本
- 移动：`services/localDb.ts`、`services/authService.ts`、`services/localDayPlanService.ts` → `services/local/`；`services/supabase.ts`、`services/dayPlanService.ts`、`services/syncTestRecordService.ts` → `services/cloud/`；`features/auth-sync/AuthSyncScreen.tsx` → `features/auth/AuthScreen.tsx`；`shared/types/sync.ts` → `shared/types/save.ts`
- 改写：`src/app/App.tsx`（由会话门禁持有 session）、`src/features/auth/AuthScreen.tsx`（只保留表单）
- 调整：`src/features/day-plan/DayPlanScreen.tsx`（路径与错误文案统一、移除未使用的 `session` 参数）、`src/features/week/WeekView.tsx`（同上）、`index.html`（标题改为「幸福小Molly」、补 favicon 链接）
- 文档：`docs/01-architecture-data-contract.md` 目录边界、`docs/06-takeover-assessment-and-plan.md`、`README.md` 未改

### 实际运行的命令与结果

- `npm install --no-audit --no-fund`：成功，新增 182 个包。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过，37 modules，产物 219.96 kB（gzip 68.60 kB）。
- `git init -b main`、`git remote add origin`、`git fetch`、`git update-ref`、`git reset --mixed`、两次 `git commit`。

### 浏览器验证证据

用本机 Chrome 无头内核经 DevTools Protocol 实测（常驻命令 `npm run verify:local`，脚本 `scripts/verify-local.mjs`，无第三方依赖），**9/9 通过**：

1. 未登录渲染登录页（邮箱 / 密码 / 登录 / 注册）。
2. 注册后进入日计划页，可见「执行今天 / 准备明天」。
3. 「准备明天」勾选第一项后显示「本地保存状态：已保存」，进度 1/5。
4. 刷新后会话恢复，仍停留在日计划页。
5. 刷新后准备勾选从 IndexedDB 恢复（`checkbox.checked = true`）。
6. 桌面 `1440x900` 无横向溢出（`scrollWidth=1425`）。
7. 手机 `390x844` 无横向溢出（`scrollWidth=390`）。
8. 退出登录后回到登录页。
9. 控制台无 error / warning。

### 阶段结论

- **L0 第 1 批完成**（目录与职责整理、死参数清理、错误标准化统一、标题与 favicon 修复），现有业务行为未回退，已由上述 9 项真实浏览器验证覆盖。
- 未完成项：服务契约固定、IndexedDB 显式版本迁移机制、加载与空状态补齐、可重复验收步骤；`DayPlanScreen.tsx`（最长单行 2109 字符）与 `WeekView.tsx`（1323 字符）尚未拆分为可读组件。
- 未验证项：L1-L5 全部功能；云端相关一切（按本地优先方向本就不在本轮范围）。
- 阻塞（已解除）：本机公钥未加入 GitHub 账号，提交仍在本地，尚未推送。**2026-09-14 已授权并推送完成。**

## L0 第 2 批：组件拆分、存储迁移机制与可重复验收（2026-09-14）

### 背景

用户要求「先把整个结构处理好，打扫一下战场，让代码干净整洁、结构清晰、架构规范」。第 1 批解决了目录与职责归属，第 2 批处理**文件内部**的结构问题：单行超长组件、散装建表逻辑、会话与页面耦合、验收不可重复。**本批不改任何业务行为**，全部改动都以第 1 批已通过的 9 项浏览器行为为回归基线。

### 本次修改文件

- 新增 `src/services/local/sessionStore.ts`：会话持久化独立成文件，导出 `AUTH_CHANGE_EVENT`、`readSession`、`writeSession`（写入时派发事件）。
- 新增 `src/shared/components/`：`BottomSheet.tsx`、`ConfirmDialog.tsx`（此前已存在并被使用，但从未纳入版本控制，本批补齐提交）。
- 新增 `src/features/day-plan/components/` 8 个展示组件：`DateHeading`、`DayNavTabs`、`SaveStatusBar`、`ModeCard`、`PrepList`、`ExecuteList`、`CustomTaskList`、`EditorSheet`。
- 新增 `src/features/day-plan/dayPlanLabels.ts`（文案常量）、`useDayPlanData.ts`（按日期读取 plan/meals/tasks）、`useSaveRunner.ts`（保存状态机与重试）。
- 新增 `src/features/week/weekStatus.ts`：`resolveWeekDayStatus()` 与状态文案，**补齐周视图缺失的第四种「已完成」状态**（判定顺序：历史 > 未规划 > 今天执行中 > 已完成 > 待准备）。
- 改写 `src/services/local/localDb.ts`：移除会话职责；建表收敛为 `STORES` 定义表 + `MIGRATIONS`（版本号 → 该版本引入的仓库）映射，`onupgradeneeded` 按版本升序补齐；首次打开时校验实际仓库是否都在 `STORES` 清单内，不一致则告警。**`DB_VERSION` 保持 1，行为不变**。
- 改写 `src/services/local/authService.ts`：从 `./sessionStore` 读写会话，`LocalUser` 与 `hashPassword` 归本文件，`signUp` 返回值由 `Promise<string | null>` 收敛为 `Promise<void>`。
- 改写 `src/app/App.tsx`：会话状态门禁；事件名改为导入 `AUTH_CHANGE_EVENT` 常量，不再硬编码字符串。
- 改写 `src/features/auth/AuthScreen.tsx`：只保留表单，会话由 App 持有；不再接收服务端返回文本。
- 改写 `src/features/day-plan/DayPlanScreen.tsx`：由单行 2109 字符改为 361 行纯编排页（持界面状态、串数据与保存、组装子组件）。
- 改写 `src/features/week/WeekView.tsx`：拆出 `WeekDayCell` 子组件，状态判定外移到 `weekStatus.ts`。
- 改写 `src/app/styles.css`：按 9 个编号分区重排；删除 `.account`、`.scope-note`、`.record` 等已无引用的死样式。
- 扩展 `scripts/verify-local.mjs`：检查项由 9 项增至 20 项，新增 `clickAria` 等助手（无第三方依赖，直接用 Chrome/Edge 无头 + DevTools Protocol）。
- 重写 `scripts/verify-local.mjs` 的运行方式：**脚本自带临时 Vite 开发服务器**。此前它固定连 `127.0.0.1:5173`，一旦该端口上跑着别的服务（或另一个陈旧实例），就会验收错误的对象；现在改为先向系统申请空闲端口、自行拉起本项目 Vite（`--strictPort`）、结束时按 PID 连子进程一起回收。`APP_URL` 仍可覆盖为外部服务。
- `package.json`：新增 `verify:local` 脚本（第 1 批已加，本批扩展脚本内容）。

### 实际运行的命令与结果

- `npm run typecheck`：通过，无输出。
- `npm run lint`：通过，无输出。
- `npm run build`：通过，**52 modules**，`dist/assets/index-CUsL8HGz.js` 222.36 kB（gzip 69.79 kB）、`index-BRO3KEwm.css` 5.69 kB。
- `npm run verify:local`：**20/20 通过**。

### 本批过程中修复的真实缺陷

- `DayPlanScreen.tsx` 拆分时出现的非法标识符 `const target-meal = ...`（连字符）与自定义事项缺少勾选处理函数：已改为 `const meal` 并补 `toggleTask()`，接到 `CustomTaskList` 的 `onToggle`。
- `AuthScreen.tsx` 在校验 `signUp` 返回值收紧后仍声明 `let serverMessage: string | null`，类型已不兼容：已改为直接 await 后给固定文案。
- `App.tsx` 硬编码 `'molly-auth-change'`，与 `sessionStore` 中的常量存在漂移风险：已改为导入常量。
- 周视图第四种状态「已完成」缺失（接手盘点 R5）：已补 `weekStatus.ts` 并纳入验收检查。

### 浏览器验证证据（20/20）

覆盖：未登录登录页 → 注册进入日计划页 → 周视图固定 7 天 → 历史日只读且无模式切换 → 模式切换确认与生效 → 恢复默认清除覆盖 → 三餐编辑保存 → 准备项勾选与进度/保存状态一致 → 健身面板保存 → 自定义事项新增/编辑/删除二次确认 → 复制昨天带内容不带准备勾选 → 刷新后会话与本地内容恢复 → 桌面 1440x900 无横向溢出（`scrollWidth=1425`）→ 手机 390x844 无横向溢出（`scrollWidth=390`）→ 退出登录回到登录页 → 控制台无 error / warning。

自带服务器改造后用临时端口 `127.0.0.1:8574` 复跑，仍为 **20/20 通过**，且结束后端口已释放（无残留进程）。

### 结构卫生核对结果

- TSX 中使用的全部类名均在 `styles.css` 有定义；反向核对出的 `status/saving/saved/error/history/selected/week-day` 均为模板字符串拼接使用，**无死样式**。
- 全量扫描 `src/`：无 `console.log`/`console.debug`、无 `TODO`/`FIXME`、无 `@ts-ignore`/`@ts-nocheck`/`eslint-disable`、无 `any`。
- 校验冻结的云端层未被任何页面引用，且未被打入产物（产物中检索 `supabase`/`PostgREST`/`GoTrueClient`/`copy_yesterday_stage3` 均为 0 命中，纯 tree-shaking 剔除）。

### 阶段结论

- **L0 第 2 批完成**，业务行为零回退，由 20 项真实浏览器验证覆盖。
- 本批同时覆盖了 L0 清单中的 L0-2（云端归档确认）、L0-4 的「IndexedDB 升级逻辑收敛为按版本号递增的迁移列表」（类型面扩展留到 L1 落库时一并定稿）、L0-5 的周视图第四态、L0-6（可重复验收，`npm run verify:local`）。
- 未完成项：L0-4 遗留的「为选项/每日实例预留对象仓库联合类型」（建议与新表一起定，避免空接口）、L0-5 遗留的「日页加载占位与未来空日期『准备这一天』引导」。
- 未验证项：跨年周的周视图样例（日期工具已按固定周一至周日实现，可作后续回归补充）；L1-L6 全部内容。
- 阻塞（已解除）：本机公钥未加入 GitHub 账号，`b81bf71`、`baf78db` 两次提交仍在本地，尚未推送。**2026-09-14 已授权并推送完成，远端 `main` 与本地一致。**

## L0 第 3 批：状态补齐与验收加固，L0 收官（2026-09-14）

完整报告见 `docs/07-L0-completion-report.md`，此处只记改动与证据。

### 本次修改文件

- 新增 `src/features/day-plan/components/EmptyDayHint.tsx`：未来空日期引导块，纯展示、不触发写入，因此计划一旦产生便自行消失，不需要额外的关闭状态。
- 调整 `src/features/day-plan/DayPlanScreen.tsx`：新增读取占位文案；引入 `showEmptyDayHint`（`tomorrow` 或 `future` 且无计划时渲染）。**注意 `classifyDate` 对「明天」返回 `tomorrow` 而不是 `future`**，若只判 `future` 会漏掉「准备明天」这个主路径。
- 调整 `src/features/day-plan/components/CustomTaskList.tsx`：自定义事项空态，可写与只读文案分开。
- `src/features/day-plan/dayPlanLabels.ts`：新增 `LOADING_TEXT`、`EMPTY_DAY_TEXT`、`EMPTY_TASKS_TEXT`。
- `src/app/styles.css`：新增 `.loading-note`、`.empty-day`、`.empty-note`。
- 新增 `scripts/check-date-rules.mjs` + `npm run check:dates`：48 项日期引擎回归，直接导入 `src/shared/date/dateUtils.ts`，无需浏览器与构建产物。
- 扩展 `scripts/verify-local.mjs`：20 → 23 项，新增「未来空日期引导」「计划保存后引导自动消失」「复制昨天不改目标日模式与人工覆盖」；并新增可选 `SHOT_DIR` 截图能力（默认关闭，失败只告警不影响结果）。
- `README.md`：验收命令与步骤、`SHOT_DIR` 用法。

### 实际运行的命令与结果

- `npm run typecheck` / `npm run lint`：通过。
- `npm run build`：通过，53 modules，223.09 kB（gzip 70.08 kB）。
- `npm run check:dates`：**48/48 通过**。
- `npm run verify:local`：**23/23 通过**（临时端口 10532，跑完已释放）。

### 说明

- 补齐的引导块本身**不落库**：用户勾选任意准备项或保存任一面板时才创建当天计划，这一条已由「引导出现 → 保存后自动消失」两项检查共同证明。
- 「复制不改目标日模式与人工覆盖」是 `docs/01` 的不变量，此前从未被验收覆盖，本次补上。
- 加载态未纳入自动断言：IndexedDB 读取近乎瞬时，占位一闪而过，硬断言只会制造不稳定用例；已实现并在真机确认，如实标注为未自动验证。
- 跨年周无法用浏览器验收（周视图只显示当前一周、无翻页入口），改为在 `check:dates` 里覆盖日期工具层，避免为了造样例而改动页面行为。

### 阶段结论

- **L0 完成。** 六项任务全部落地，业务行为零回退，验收基线为「三件套 + `check:dates` 48 项 + `verify:local` 23 项」。
- 新发现 R9（低）：切换日期后保存状态文案残留上一天结论；因 L0 约定不改业务行为而未改，已登记待 L1 处理。
- 未验证项：L1–L6 功能、云端一切、跨浏览器差异（仅 Chrome/Edge 无头内核）、真机移动设备（仅视口模拟）。

## L2：计划内容实例化（2026-09-14）

完整报告见 `docs/09-L2-completion-report.md`，此处只记改动与证据。

### 背景

L1 已完成选项仓库（`food_options` / `supplement_templates` / `exercise_options`）和选项管理页。但三餐、补剂和健身仍使用自由文本输入，未利用选项仓库的结构化数据。L2 的目标是将这三个面板从文本升级为基于选项的组合选择，同时建立名称快照机制保护历史数据。

### 本次修改文件

**新增（7 个）：**
- `src/features/day-plan/components/MealPanel.tsx`：三餐编辑面板（早/中/晚各一组 ItemPicker + 备注输入）
- `src/features/day-plan/components/SupplementPanel.tsx`：补剂面板（模板行只读 + 自定义行可编辑/删除）
- `src/features/day-plan/components/ExercisePanel.tsx`：健身面板（多选项目 + 备注）
- `src/features/day-plan/components/ItemPicker.tsx`：通用选项多选组件
- `src/features/day-plan/panelDrafts.ts`：面板草稿状态管理
- `src/features/day-plan/usePanelOptions.ts`：Hook：读取选项列表供面板使用
- `src/shared/periodLabels.ts`：时段文案常量

**修改（15 个）：**
- `src/services/local/localDb.ts`：`DB_VERSION` 2→3；新增 `daily_meals` / `daily_supplements` / `daily_exercises` 三张表；`MIGRATIONS[3]` 建表 + `backfillSnapshots`
- `src/services/local/dayPlanService.ts`：新增三餐/补剂/健身 CRUD；`ensureDaySupplements` 模板实例化
- `src/services/cloud/dayPlanService.ts`：类型对齐（冻结层）
- `src/shared/types/dayPlan.ts`：新增 `DailyMeal` / `DailySupplement` / `DailyExercise` 类型
- `src/features/day-plan/DayPlanScreen.tsx`：编排页引入三类新面板
- `src/features/day-plan/components/EditorSheet.tsx`：底部编辑面板承载新面板
- `src/features/day-plan/components/PrepList.tsx`：五项准备增加「补剂」
- `src/features/day-plan/components/ExecuteList.tsx`：执行列表展示补剂/健身完成状态
- `src/features/day-plan/useDayPlanData.ts`：数据 hook 新增 meals/supplements/exercises
- `src/features/day-plan/dayPlanLabels.tsx`：新增面板文案
- `src/features/preferences/preferencesLabels.tsx`：选项页文案微调
- `src/app/styles.css`：新面板样式
- `src/shared/components/BottomSheet.tsx`：适配更长内容
- `scripts/verify-local.mjs`：52→66 项，新增 L2 断言 + v2→v3 冷升级
- `scripts/check-local-data.mjs`：断言数跟随 DB_VERSION=3 更新

### 实际运行的命令与结果

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过，72 modules。
- `npm run check:local-data`：**21/21 通过**。
- `npm run verify:local`：**66/66 通过**（桌面 1440x900 + 手机 390x844，无横向溢出，控制台无 error/warning；含 v2→v3 真实冷升级验证）。

### 本轮修复的缺陷

1. **verify:local 正则崩溃（P0）**：模板字符串内 `/\n+/g` 被解释为含换行的正则字面量 → `SyntaxError`。修复为 `/\\n+/g`。
2. **测试 8c 自定义补剂行定位失败（P1）**：自定义行名称在 `<input value>` 中而非 textContent，`textContent.includes()` 永远匹配不到。改为按按钮存在性区分模板行与自定义行。

### 阶段结论

- **L2 完成，可进入 L3。** 全部 9 项任务落地，DB_VERSION 升至 3（10 张表），验收基线为「三件套 + `check:dates` 48 项 + `check:local-data` 21 项 + `verify:local` 66 项」。
- 名称快照机制已建立并验收：保存时写入快照、改名/停用选项不改写历史、复制昨天不带状态。
- 未验证项：L3–L6 功能、云端一切、跨浏览器差异、真机移动设备。

## L3：休息日与自由规划（2026-09-14）

完整报告见 `docs/10-L3-completion-report.md`，此处只记改动与证据。

### 背景

L2 已完成三餐 / 补剂 / 健身的内容实例化。但休息日（周六 / 周日）和「临时不上班」（工作日人工切休息日）仍缺一套规则：正常休息日应有拖地 / 洗衣两项家务，临时不上班则不带家务；休息日应隐藏工作日专属的衣服 / 三餐 / 晨间，只保留补剂 / 健身 / 自定义事项。

### 本次修改文件

**新增（1 个）：**
- `src/features/day-plan/components/RoutineList.tsx`：休息日家务列表（拖地 / 洗衣），只展示完成勾选

**修改（9 个）：**
- `src/services/local/localDb.ts`：`DB_VERSION` 3→4；新增 `routine_tasks` 表；`MIGRATIONS[4]` 建表（只建表不搬迁）
- `src/services/local/dayPlanService.ts`：新增 `listRoutineTasks` / `ensureRestDayRoutines` / `setRoutineCompleted`
- `src/shared/types/dayPlan.ts`：新增 `RoutineKind` / `RoutineTask`
- `src/features/day-plan/useDayPlanData.ts`：load 时对正常休息日自动补齐家务（含创建 rest 计划）；新增 `routines` 状态
- `src/features/day-plan/DayPlanScreen.tsx`：按 `mode` 分流渲染；新增 `toggleRoutine`
- `src/features/day-plan/components/ExecuteList.tsx`：新增 `mode` 参数，休息日隐藏三餐与晨间
- `src/features/day-plan/dayPlanLabels.ts`：新增 `ROUTINE_TITLE` / `REST_NO_ROUTINE_NOTE`
- `src/app/styles.css`：新增 `.rest-note`
- `scripts/verify-local.mjs`：52→74 项；`scripts/check-local-data.mjs`：15→24 项

### 实际运行的命令与结果

- `npm run typecheck` / `npm run lint`：通过。
- `npm run build`：通过，73 modules。
- `npm run check:dates`：**48/48 通过**。
- `npm run check:local-data`：**24/24 通过**。
- `npm run verify:local`：**74/74 通过**（桌面 1440x900 + 手机 390x844，无横向溢出，控制台无 error/warning；含 v3→v4 冷升级）。

### 本轮修复的缺陷

1. **家务重复补齐（竞态，P1）**：最初把家务补齐放在 `DayPlanScreen` 的 `useEffect`，`ensurePlan` 内的 `setPlan` 触发重渲染与 effect 派生值交互，快速切日期时 `ensureRestDayRoutines` 被并发调用两次，出现「洗衣」重复。改为把补齐逻辑移到 `useDayPlanData.load`（有 `active` 保护），消除竞态。

### 阶段结论

- **L3 完成，可进入 L4。** 全部 6 项任务落地，DB_VERSION 升至 4（11 张表），验收基线为「三件套 + `check:dates` 48 项 + `check:local-data` 24 项 + `verify:local` 74 项」。
- 休息日家务、临时不上班、模式切换后内容保留规则均符合 docs/00 与 docs/01 不变量。
- 未验证项：L4–L6 功能、云端一切、跨浏览器差异、真机移动设备。


