# 幸福小Molly：开发交接

## 当前交接摘要（2026-10-13）

**账密改造源码与本机自动验收已完成，本次尚未执行生产数据库迁移、W 账号准备、Vercel 环境更新或发布。** 现行认证方案以 [账密改造详细执行文档](docs/43-账密改造详细执行文档.md) 为准，实测结果见 [本地实施与部署交接](docs/44-账密改造本地实施与部署交接.md)，部署按 [部署执行说明](docs/27-deploy-runbook-for-codex.md) 操作。本页后续 S1-S6 与更早记录保留历史证据；其中本地注册、双身份绑定、换设备重新注册、Git 不可用和凭据缺失描述不再是当前规则。

- Supabase Auth 是唯一认证来源。页面只有账号和密码，接受 `W` / `w`，内部标识为 `w@molly.local`；初始密码只在可信 Auth 管理入口设置，不进入源码、种子、前端环境变量或报告。
- 资料、业务根表、同步状态和待上传项共用真实 Auth UID。IndexedDB 仍是业务唯一写入落点，`DATA_BACKEND` 恒为 `'local'`；界面只调用 `services/api/`，认证与同步编排动态加载，`cloud/` 保留四个传输模块。
- 首次认证与新设备恢复需网络。未准备工作区先恢复该 UID 的云端数据，再开放业务和上传；恢复失败不当成云端为空。已准备工作区可临时离线编辑，联网身份重验后才补传。
- 普通退出关闭本机工作区并保留本地业务、未上传队列；同账号重登打开原 UID 工作区。旧 localStorage 会话 JSON 不构成认证，旧异步结果不得写入新的工作区。
- IndexedDB 升至 `DB_VERSION = 8`，共 18 张仓库。旧账号、旧同步状态和队列进入隔离范围；活动资料不保留密码认证信息。旧业务继续保全，不猜归属、不自动合并、不因清理账号级联删除。
- 新业务备份为 v3，不含密码或 token；v1/v2 只读兼容，不从备份创建身份。导入按当前已验证 UID 检查完整关联、跨 owner ID 与同日期冲突。
- 当前有 7 个追加 SQL 迁移，末项为 `20261011183805_account_identity_gate.sql`；目标为 12 张 public 表、四个应用 RPC、12 条 restrictive UID 门禁。生产必须核实实际迁移历史，已有库只执行缺失项，空库才使用完整合并 SQL。
- PWA 安装预缓存本轮构建的认证与离线懒加载资源；首次登录后直接断网刷新和首次离线账号页已覆盖。更新安装失败时保留旧首页与旧资源，不因在线取得新首页破坏旧版本离线运行。
- 本机四项部署凭据已存在，继续使用仓库外受保护配置，不重复索取、不输出值。真实 Supabase ref、W 的实际 UID、Auth 配置及现有线上提交尚未核验。

### 当前基线

下列是本轮已确认的实测结果，全部通过，最终命令退出码均为 0。

| 命令 | 当前项数与状态 |
| --- | --- |
| `typecheck` / `lint` | 通过，退出码 0 |
| `build:no-empty` | 通过，退出码 0 |
| `check:dates` | 48/48 |
| `check:local-data` | 75/75 |
| `check:backup` | 96/96 |
| `check:cloud-parity` | 114/114 |
| `check:sync` | 149/149 |
| `check:feedback` | 16/16 |
| `node scripts/验证认证并发.mjs` | 12/12，退出码 0 |
| `node scripts/验证旧工作区迁移.mjs` | 69/69（v6 19 项、v7 50 项） |
| `node scripts/验证部署凭据护栏.mjs` | 20/20 |
| `verify:local` | 172/172，退出码 0 |
| `verify:pwa` | 64/64，退出码 0 |
| `verify:sync` | 195/195，退出码 0 |
| `verify:sql` | 87/87，退出码 0（本机临时 PostgreSQL 串行） |

**项数变了要同步四处**：`README.md` 的命令清单、`scripts/launcher.mjs` 的 `note`、`docs/19-sync-execution-plan.md` §4 的当前基线表、本节当前基线。`verify:sql` 与浏览器验收串行执行，不放进启动器 `all`；反馈 16 项、认证并发 12 项、旧库迁移 69 项和部署凭据护栏 20 项也须交付前单独执行，命令见 `README.md`。本机 SQL 和隔离夹具通过不代表生产迁移、真实 Auth 或真机通过。

### 当前待办

1. 保留本机完整验收证据，完成文件差异与敏感内容复核并记录本地实施提交；将第 44 份文档和现行部署说明交给部署员。本地实现与验收已完成，生产操作仍按后续前置推进。
2. 只读核实现有 Supabase/Vercel 项目、迁移历史、现网版本及旧业务数据。明确 W 的实际 Auth UID 与旧数据去向，完成备份和冲突预览后才处理 owner 迁移或旧身份清理。
3. 通过可信 Auth 管理入口准备/核实 W、用户指定初始密码、确认状态、公开注册限制、所需身份入口与 URL 配置；密码策略拒绝则如实阻塞。实际用户存在后才写受保护的单行 UID allowlist。
4. 核实表、RPC、RLS、GRANT 和旧 UID/JWT 门禁；数据库门禁默认拒绝。确认前置后写入 Vercel Production 构建变量并发布，不能将 `npm run deploy` 的有限成功输出当成全链路验收。
5. 在真实 HTTPS 域名验证登录、退出重登、新设备恢复、断网重验、旧 JWT 门禁、首页、深链接、缓存头与真机 PWA。未上传且已被清除的编辑无法凭账号恢复。

### Git 与发布状态

`账密改造前版本^{}` 指向 `b646e6af9ea5bcacece0da90ef5e7532a619b261`，不移动或重建该保护标签。本轮开始时本地 HEAD 为 `0c28f32017dc57f150a1b551931c9e7ae90a6085`；本次实施提交与时间以最终 Git 记录为准，Git 当前可用。本轮不推送远端。Git 不包含浏览器数据库、Auth 用户和生产数据，源码回退不能代替数据恢复。

现有正式域名为 `https://molly.lightwavecommunity.site`。本轮未执行生产操作，现网提交及所有真实认证/恢复/RLS/真机结果仍需验证。

## 历史交接摘要（2026-09-20）

- **两个缺陷已修复（2026-09-19）：并发建日计划撞唯一索引、换本地账号把数据推到别人的云端。** 完成报告见 `docs/24-two-defect-fixes-report.md`。这两项是 S4 收尾时标为「待用户裁决」的设计缺口，用户指示「直接完成，遇到问题查市面上相似软件的最佳实践」，于是按最佳实践定案并落地（**都改了业务行为**，不属于 S1–S6 任何一段）。
  - **① 读-改-写原子化**：`upsertDayPlan` 早先是「先全表找、找不到就 `put` 一条新的」，读与写隔着事务边界；两个并发调用会同时读到「不存在」，各建一条、各生成一个 id，第二条撞 `day_plans.user_date` 唯一索引，界面报 `Unable to add key to index 'user_date'`（休息日注册必然踩到：`useDayPlanData` 自动建 rest 计划与界面首次写入同时发生）。修法不是加锁，而是给 `localDb.ts` 新增 **`readModifyWrite`（事务内先读后写）**——IndexedDB 的事务在创建那一刻就开始，同一对象仓库上的两个 `readwrite` 事务**串行执行**，于是第二个调用读到的必然是第一个写好的结果。`upsertDayPlan` 改按 `user_date` 唯一索引读；同形状的 `setMealCompleted`（`daily_meals.plan_type` 也是唯一索引）一并改走它。
  - **② 同步状态按本地账号隔离**：绑定是「本地账号 ↔ 云端账号」的关系，而 `sync_state` 早先是**设备级单行**（`id` 恒为 `singleton`）。换本地账号后新账号会读到上一任的绑定，把自己的数据推到**别人的云端账号**里，界面上还显示「已连接」。修法：`sync_state` 改成**一行一个本地账号**（主键就是本地账号 id，`readSyncState` 只可能读到当前账号那一行——「读到别人的绑定」在结构上不成立）；`sync_outbox` 每条记 `local_user_id`，推送时按 `entriesOfOwner` 过滤；`DB_VERSION` 6→7，`MIGRATIONS[7]` 只做一次搬迁（把老行重新归属到登录中的账号、删掉旧主键那一行、没人登录就删掉）。`status.ts` 的「待上传 N 条」也改成同口径，否则换过账号后会显示一个永远不会减少的数字。
  - **一个连带发现**：注册时的示例选项播种发生在 `writeSession()` **之前**，入队钩子那时读不到会话，这批条目会变成「无归属」而永远推不上去（界面一直显示「待上传 N 条」）。修法是 `WriteOptions` 新增 `owner`，播种显式传自己的 userId——`verify:sync` 里有一条断言专门钉住它。
  - 验收：三件套通过、`check:dates` 48/48、`check:local-data` **62/62**、`check:backup` 62/62、`check:cloud-parity` 66/66、`check:sync` **96/96**、`verify:local` **119/119**、`verify:pwa` 43/43、`verify:sync` **56/56**。四条新断言都做过**反证**（把实现退回旧写法后立刻失败）：并发用例报出用户看到的那句 `Unable to add key to index 'user_date'`；换账号用例报出 `换账号测试食物` 出现在 A 的云端；v7 搬迁用例报出「行数 2，主键=["singleton","verify-rekey-user"]」。
- **S4 已完成（2026-09-20）：自动上传——本地写 → 自动推到云端。** 完成报告见 `docs/23-S4-completion-report.md`。T1–T7 全部落地。① **映射层**（`sync/mapper.ts`，纯函数）：本地行 → 云端行只做三件事——按字段契约清洗（顺带剔除云端遗留列 `day_plans.exercise_content` / `daily_meals.plan_content`，本地老记录上还留着它们）、把四张带 `user_id` 的表重写成 `cloud_user_id`、只发本地形状里存在的字段；`ROW_MAPPERS` 的类型是 `Record<UserDataStore, RowMapper>`，漏一张表编译不过。② **推送执行**（`sync/outbox.ts`）：读队列 → **先排序再截批次**（直接 `slice` 会把「删除在前、写入在后」的层级顺序切碎，云端会留下悬空引用）→ upsert 的**回主表读当前行**（队列里只有引用，没有数据副本；读不到就作废出队）→ **先发完全部 delete 再发全部 upsert** → 成功出队并写 `last_push_at`，失败整批 `attempts + 1` 并把原因写进 `sync_state`。③ **调度器**（`sync/pushQueue.ts`）：四个触发点（队列变更 1.5s 防抖 / `online` / 回前台 / 启动）、`navigator.locks` 跨标签互斥（不支持时降级为单标签单飞）、失败退避 1s→2s→…→60s（**成功即清零**，退避只活在内存里，不做持久化）。未绑定时**直接返回、连队列都不读**。④ **启动接线在 `src/main.tsx` 而不是 App 的 effect**：调度器是全局单例，放进 effect 会撞上 StrictMode 的「挂载 → 卸载 → 再挂载」——清理函数与动态 `import()` 的完成顺序不保证，可能出现「第二次挂载刚拿到停止函数，就被第一次挂载的清理函数把监听器摘掉」，调度器静默失效而界面一切正常。`cloudSyncConfigured` 为假时**不调用**，否则启动阶段就会把 supabase 那个 chunk 拉下来。⑤ **状态如实显示**：`SyncCard` 按「待上传 N 条 / 最后上传：X 前 / 上传失败：<原因>」三项分开显示，**队列排空也不说「已同步」**（那只证明本机变更都发出去了，不证明云端与本地一致）；S3 那句「当前版本只记录变更，还没有开始上传」**已删除**。相对时间（「3 分钟前」）抽到纯函数 `shared/date/relativeTime.ts`，超过 7 天返回 `null` 由调用方改显绝对时间，未来时间戳显示「刚刚」而不是负数。⑥ **新增 `npm run verify:sync`（49 项）**：假云端与页面**同源**（用同一个空闲端口既跑 Vite 又当 `VITE_SUPABASE_URL`，于是整条链路没有跨域，不需要伪造 CORS 头，也不需要 `--disable-web-security` 这类会改变被测行为的开关），用 CDP `Fetch` 域按 `/auth/v1/*` 与 `/rest/v1/*` 两个前缀拦下来，由脚本内存里的假云端应答。⑦ **`stage5` 迁移 + 列级对齐断言（T6）**：新增只追加迁移 `database/migrations/202609200001_stage5_sync.sql`，给 `daily_meal_items` / `daily_exercise_items` / `routine_tasks` 补服务端 `updated_at` 与 `set_updated_at` 触发器（`stage4` 只覆盖了 7/11）。**注意这一批的用意不是「与本地字段对齐」，方向恰好相反**——`updated_at` 是云端自己的列，本地契约里没有也不该有：`docs/18 §5.4` 的多设备 last-write-wins 需要一份**来自数据库触发器**、可比较可审计的变更时间，若让客户端上报，两台机器的时钟偏移会直接决定谁覆盖谁。`check:cloud-parity` 从 60 项扩到 **68 项**：新增「每张云端表都有 `updated_at` 列 / 都挂了 `set_updated_at` 触发器 / 都有至少一条策略」，以及一组**列级对齐**——本地字段契约里的每个字段在云端都有同名列、云端多出的列都能被省略（有默认值或可空）、带 `user_id` 的云端表与映射层的 `USER_SCOPED_STORES` 完全一致、每张用户数据仓库都有推送映射。写这组之前先用临时探针把两侧逐表对齐，纠正了两处错判：**推送方向本来就没有缺列**（`stage4` 建的三张子表与本地契约逐字段完全一致，反倒是 `day_plans.exercise_content` / `daily_meals.plan_content` / `daily_meals` 与 `custom_tasks` 的 `created_at`、`updated_at` 这六列云端有、本地没有），真正缺 `updated_at` 的只有那三张子表。断言做过反证：临时移走 `stage5` 后立刻以这三张表的名字失败，不是空断言。解析器读 `create table` **加** `alter table … add column` 两处（只读前者会得出「云端缺 10 列」的假失败，实测踩过），并留了一条自检「`day_plans` 共 18 列」钉住解析能力。⑧ **云端遗留适配器清理（T7，删了 8 个文件 1156 行）**：`cloud/` 下的 `authService`(113) / `dayPlanService`(634) / `optionService`(204) / `backupService`(56) / `optionSeed`(65) / `syncTestRecordService`(42) / `parity`(34) / `types`(8) 在 S1 之后**零消费者**，整批删除，只留同步传输层四模块 `errors` / `identity` / `rpc` / `supabase`。计划里写的是「改造为同步传输层（保留 upsert 原语）」，实际做成删除——原语不需要搬，`sync/outbox.ts` 早就自己实现了 upsert（`from(store).upsert(rows, { onConflict: 'id' })`）与 delete（`.delete().in('id', ids)`），没复用那批适配器里的任何函数。**删除的硬证据**：删前删后各构建一次，产物**逐字节同尺寸**（`index` 295.23 kB、`supabase` 221.11 kB、`accountLink` 1.83 kB、`pushQueue` 3.11 kB、`syncState` 0.67 kB、`status` 0.66 kB，只有内容哈希变了），说明它们本来就没进任何 chunk。因为 `.git` 在本机不可用（无法回滚），删除前把整个 `cloud/` 备份到 `.workbuddy-ai/backup/cloud-l6-adapters/`（12 个文件 1344 行，逐行一致）。契约随之换定位：`contracts.ts` 从「两侧等价」改成**页面接口清单**，`check:cloud-parity` 第 1 组改为断言「本地实现 + 四个门面都导出」，新增第 2 组钉住「云端目录只剩四模块 + L6 适配器已删除」——将来谁想加回一个「云端 xxxService」都得先改这条断言。验收：三件套通过、`check:dates` 48/48、`check:local-data` 51/51、`check:backup` 62/62、`check:cloud-parity` **66/66**、`check:sync` **85/85**、`verify:local` **114/114**、`verify:pwa` **43/43**、`verify:sync` **49/49**。
- **S3 已完成（2026-09-19）：云端账号绑定与连接——能连上云端账号，但还不动数据。** 完成报告见 `docs/22-S3-completion-report.md`。① **绑定 ≠ 登录**（决策 D5 的直接后果）：`sync/accountLink.ts` 自己调 `supabase.auth.signInWithPassword` / `signUp`，**刻意不复用 `cloud/authService.ts`**——那个模块成功后会把云端用户写进本地会话镜像，用在这里等于把用户从本地账号挤出去（本地数据还在，但「当前登录」变了，所有按 `user_id` 过滤的查询立刻落空）。两者共用的只有「账号名 → 合成邮箱」这一条规则，已抽到 `cloud/identity.ts`。② **三种绑定情形**：`sync/bindingRules.ts` 的 `judgeBindingCase(cloudCount, localCount)` 是纯函数（云端空 → `cloud-empty`、两边都有 → `both-sides`、本地空 → `local-empty`，两边都空归到 `cloud-empty`），由 `check:sync` 钉死边界。③ **云端探测不新增 SQL**：S3 用 PostgREST 的 `head: true` 计数四张带 `user_id` 的根表（`cloud/rpc.ts`），天然受 RLS 限制；方案里那个 `cloud_sync_summary()` RPC 属于 S5-T4，S3 不为一个布尔提前建迁移。④ **状态聚合纯本地**：`sync/status.ts` 只读 `sync_state` / `sync_outbox` / 本地表，**一个请求都不发**——「云端现在多少条」只在用户主动点连接时才去问，这是「未配置云端时整轮交互零跨域请求」在 S3 之后仍然成立的关键。⑤ **懒加载是结构性的**：新增门面 `api/syncService.ts`，每个函数都 `await import()` 取实现；`SyncCard` 在 `cloudSyncConfigured === false` 时**连面板都不挂载**。S4 起产物是四个 chunk——`index`（295 kB，只出现 supabase 的**文件名**即动态 import 预载表）、`supabase`（221 kB，`accountLink` 与 `pushQueue` 共用）、`accountLink`（1.8 kB）、`pushQueue`（3.1 kB）、`syncState` / `status`（各 0.7 kB）。⑥ **绑定流程的最后一步在 S4 补上**：`bindCloudAccount` 现在会清空 `sync_outbox`——队列是**增量**不是全量，从没改过的记录压根不在队列里，推上去只会得到一份「看起来成功、实际残缺」的云端数据。⑦ **断开连接**清 `sync_state` + `sync_outbox`（同一事务），不动本地数据也不动云端数据，确认框写明「丢的是队列、不是数据」；用户看了确认框决定不连时走 `abandonCloudSession()`，**只断云端会话、不清队列**。验收：三件套通过、`check:dates` 48/48、`check:local-data` 51/51、`check:backup` 62/62、`check:cloud-parity` **60/60**、`check:sync` **54/54**、`verify:local` **114/114**、`verify:pwa` 43/43；主 chunk 仍 0 命中 `supabase`，**未绑定云端账号时运行时零跨域请求**。
- **S2 已完成（2026-09-19）：本地变更追踪——写入自动进队列，但还不推送。** 完成报告见 `docs/21-S2-completion-report.md`。① **两个设备状态仓库**：`sync_outbox`（待上传队列，索引 `seq` 与 `store_record`）与 `sync_state`（同步状态；**当时是设备级单行，v7 起改为一行一个本地账号**，见本页顶部），`DB_VERSION` 5→6，`MIGRATIONS[6]` 只建表、不做数据搬迁（老用户升级后不会凭空多出待上传项——历史数据要上云必须由人点「本地上传云端」，S5 才做）。② **仓库三分类**：`recordSchemas.ts` 新增一张穷尽表 `Record<LocalStore, 'user'|'meta'|'device'>`，派生出 `USER_DATA_STORES`（10）/ `META_STORES`（`users`）/ `DEVICE_STORES`（两张 `sync_*`）/ `ALL_STORES`（13）；`BACKUP_STORES` 改为「`SCHEMA_STORES` 去掉设备仓库」，仍是原来的 11 张（**不能**写成 `[...USER_DATA_STORES]`——那会连 `users` 一起丢掉，而它是备份外键校验的父记录，后果是应用自己导出的文件自己读不回来）。③ **写入钩子**：`put` / `remove` / `runTransaction` 新增 `{ track?: boolean }`，默认在同一事务里追加队列记录（`upsert` / `delete`），`track:false` 留给 outbox 自身、迁移搬迁与 S5 的云端恢复；`clear` 命中用户数据仓库时要求显式 `track:false`（不静默漏记一批删除）。④ **队列规则抽成纯函数** `outboxRules.ts`：压缩（同一 `(store, record_id)` 只留最后一条，`attempts > 0` 的不动）、批内去重（先删后写收敛成 `upsert`）、依赖层级排序（写入父表→子表、删除子表→父表）、序号生成。⑤ **新增 `npm run check:sync`**（49 项纯函数回归）。验收：三件套通过、`check:dates` 48/48、`check:local-data` **51/51**、`check:backup` 62/62、`check:cloud-parity` **58/58**、`check:sync` **49/49**、`verify:local` **112/112**（含真实 v5→v6 冷升级与「注册播种 / 删除食物都进队列且只含用户数据仓库」的运行时证据）、`verify:pwa` 43/43；本地产物仍 0 命中 `supabase|GoTrueClient|PostgREST`，**运行时仍零跨域请求**。
- **S1 已完成（2026-09-19）：数据架构从「构建期二选一」切换到「本地恒为落点 + 云端可选」。** 完成报告见 `docs/20-S1-completion-report.md`。① 新增 `src/services/capabilities.ts` 取代 `services/backend.ts`：`DATA_BACKEND` 恒为 `'local'`、`supportsLocalBackup` 恒为 `true`、`cloudSyncConfigured` 从构建期 env 读；Supabase 的两个环境变量**只在这里读一次**，`cloud/supabase.ts` 从它取值。② 四个门面（`api/*`）从 `export * from '@backend/xxx'` 改成直连 `../local/xxx`，`vite.config.ts` 的 `resolve.alias` 整块删除——别名没了，`@backend` 只能出现在门面目录这个坑也一起没了。③ 文案随能力声明收口：`SAVE_STATUS_PREFIX` 恒为「本地保存状态：」，`ACCOUNT_TEXT` / `STORAGE_WHY` 去掉云端分支，`BackupCard` 去掉 `available` 开关（本地备份恒可用），删掉 `BACKUP_UNAVAILABLE_NOTE`。④ `dev:cloud` / `build:cloud` 与 `dist-cloud/` 删除，`scripts/launcher.mjs` 重新编号（12 项）。⑤ **判据替换**：`check:cloud-parity` 重写为八组断言（新增「`@backend` 已移除」「env 只有一处来源」「`cloud/` 无人引用」），`verify:local` 新增「未配置云端时整轮交互零跨域请求」（CDP `Network` 域统计）。验收：三件套通过、`check:dates` 48/48、`check:local-data` 34/34、`check:backup` 62/62、`check:cloud-parity` **56/56**、`verify:local` **106/106**、`verify:pwa` 43/43；本地产物仍 0 命中 `supabase|GoTrueClient|PostgREST`。
- **架构方向已升级（2026-09-19）：不再是「本地单机」，而是「本地优先 + 云端同步」。** 方案见 `docs/18-sync-architecture-plan.md`，任务线见 `docs/19-sync-execution-plan.md`（S1–S6）。已锁定的五条决策：① 产物隔离判据替换为「未绑定云端时运行时零跨域请求」；② **一期不做自动下载（增量 pull）**，只有自动上传 + 两个手动整体替换；③ Cloudflare 只做 Pages 静态托管，不引入 Workers；④ 先只上 Vercel；⑤ 本地账号是应用身份，云端账号侧挂绑定、不迁密码。**S1、S2、S3、S4 已完成；S5 的代码与 SQL 已全部落地**（`stage6` 迁移的三个 RPC、`sync/replaceCloud.ts` / `replaceLocal.ts` / `replaceRules.ts`、`check:sync` 第 13、14 组、`check:cloud-parity` 第 ⑩ 组、`npm run verify:sql`），**只剩「在真实 Supabase 项目上跑一次完整往返」未做**——那需要真实凭据。
- **登录凭据已从「邮箱 + 密码」换成「账号 + 密码」（2026-09-19）。** `AppUser.email` → `AppUser.username`。账号规则集中在 `src/shared/authRules.ts`（新注册 3–20 位字母 / 数字 / 下划线、大小写不敏感；**登录不校验格式**，因为 v5 之前注册的账号是从邮箱原样迁过来的，形如 `molly@example.com`，这批用户继续用原字符串登录）。`users` 对象仓库的字段与唯一索引都由 `DB_VERSION` 4→5 的迁移（`localDb.ts` 的 `renameUsersToUsername`）同时换名，老记录**原样**搬迁、不做「取 @ 前面那段」的加工。备份文件格式同步升到 **v2**（`source_user.email` → `username`），**v1 旧备份仍可导入**：`parseBackup` 读入时归一字段名，之后走完全相同的校验路径（不存在为老文件放宽校验的第二条分支）。云端侧 Supabase Auth 只认邮箱或手机号，账号被映射成合成邮箱 `<账号>@molly.local`，真实账号名存 `user_metadata.username`（域名定下后不能改，理由见 `cloud/authService.ts` 顶部注释）。验收见下方 `verify:local` 一项。
- 当前开发方向是**本地优先 + 云端同步**：浏览器 IndexedDB 是唯一写入落点；云端是可选的上行通道（自动上传 + 两个手动整体替换），未配置或未绑定云端账号时行为与本地单机完全一致。
- 当前技术基线是 React + TypeScript + Vite + IndexedDB。服务层自 S1 起分四层：`src/services/capabilities.ts`（能力声明）、`src/services/contracts.ts`（契约，函数名只写一遍、签名从本地实现取）、`src/services/api/`（门面，**页面只 import 这里**，直连 `local/`）与 `src/services/local/`（唯一实现）。`src/services/cloud/` 从 S3 起不再是「冻结的种子」，而是**同步层的传输通道**：只允许被 `src/services/sync/` 引用（`check:cloud-parity` 静态断言这一点，并断言同步门面必须用动态 `import()`）。会话存储是后端无关的 `src/services/session.ts`，会话状态只在 `src/app/App.tsx` 持有。
- 日计划页已是「编排页 + 子组件 + hook」结构：`DayPlanScreen.tsx` 只做编排，展示在 `features/day-plan/components/`，数据读取在 `useDayPlanData`，保存状态机在 `useSaveRunner`；周视图状态判定集中在 `features/week/weekStatus.ts`。IndexedDB 的建表逻辑已收敛为按版本号递增的显式迁移表（`localDb.ts` 的 `STORES` / `MIGRATIONS`，当前 `DB_VERSION = 7`，共 13 张对象仓库：10 张用户数据 + `users` + 两张设备状态表）。新增仓库要同时改五处（`LocalStore` / `STORES` / `DB_VERSION` / `MIGRATIONS` / `recordSchemas.ts` 的 `STORE_KIND` 与 `RECORD_SCHEMAS`），`localDb.ts` 顶部注释有完整清单。选项页同样只做编排（`features/preferences/PreferencesScreen.tsx`），读写全部经 `services/local/optionService.ts`，示例数据在 `services/local/optionSeed.ts`；保存状态前缀与文案集中在 `shared/saveStatus.ts`，日计划页与选项页共用一套措辞。
- 已实现本地注册、登录、退出、刷新恢复、Asia/Shanghai 日期、日期模式、固定周视图、工作日准备/执行、三餐多选食物与备注、补剂模板实例化与逐项勾选、健身多选项目与备注、自定义事项、休息日家务（拖地/洗衣）、复制昨天、历史只读和保存失败重试。
- **L0 已完成（2026-09-14），可进入 L1。** 完成报告见 `docs/07-L0-completion-report.md`：六项任务全部落地，现有业务行为零回退，并首次具备可重复的自动化验收。L0-L6 的唯一任务范围、顺序和验收条件见 `docs/05-local-first-execution-plan.md`，接手评估与 L0 拆解见 `docs/06-takeover-assessment-and-plan.md`。
- **L1 已完成（2026-09-14），可进入 L2。** 完成报告见 `docs/08-L1-completion-report.md`：`food_options` / `supplement_templates` / `exercise_options` 三类对象仓库落库（`DB_VERSION` 1→2），选项页支持新增 / 改名 / 排序 / 启停 / 删除并带二次确认，示例选项放在 `services/local/optionSeed.ts`（注册时幂等播种，页面零写死）；同时修掉 L0 遗留的 R9（切日期后保存状态残留）。验收：浏览器 52 项 + 日期规则 48 项 + 本地数据结构 15 项全通过，含真实冷升级（v1 老库 → v2 七张表且老数据可读）。
- **L2 已完成（2026-09-14），可进入 L3。** 完成报告见 `docs/09-L2-completion-report.md`：三餐升级为早/中/晚多选食物 + 备注（`daily_meals`）；补剂从模板生成每日实例、可逐项勾选执行、自定义行可增删（`daily_supplements`）；健身升级为多选项目 + 备注（`daily_exercises`）；全部保存时写入名称快照、改名/停用选项不改写历史；复制昨天只带内容与快照不带状态；`DB_VERSION` 2→3（共 10 张表），迁移含 `backfillSnapshots` 将旧自由文本转为快照项。验收：`npm run typecheck/lint/build` 通过、`check:local-data` 21/21 通过、`verify:local` **66/66** 通过（含 v2→v3 冷升级）。
- **L3 已完成（2026-09-14），可进入 L4。** 完成报告见 `docs/10-L3-completion-report.md`：正常周六/周日自动补齐「拖地/洗衣」两个每日实例（`routine_tasks` 表）、仅勾选完成；临时不上班（工作日人工切休息日，`mode_override=true`）不自动带家务；休息日保留补剂/健身/自定义事项、隐藏衣服/三餐/晨间等工作日准备项；休息日切工作日保留二次确认；`DB_VERSION` 3→4（共 11 张表）。验收：三件套通过、`check:dates` 48/48、`check:local-data` 24/24、`verify:local` **74/74** 通过（含 v3→v4 冷升级）。
- **L4 已完成（2026-09-15），可进入 L5。** 完成报告见 `docs/11-L4-completion-report.md`：底部固定导航「今日/本周/选项」上线（`BottomNav` 共享组件，三页统一接线，移除各页顶部重复主入口）；「执行今天/准备明天」保留为日页顶部页签；BottomSheet/ConfirmDialog 打开时锁定 body 滚动、关闭恢复（滚动位置不漂移）；三餐/补剂/健身已是带勾选选项行（L2 达标）；桌面宽屏布局保留（导航与内容区同宽居中）。验收：三件套通过、`check:dates` 48/48、`check:local-data` 24/24、`verify:local` **77/77** 通过（两次连续），截图人工核对手机/桌面观感。
- **L5 已完成（2026-09-15），可进入 L6。** 完成报告见 `docs/12-L5-completion-report.md`：写入前字段契约校验（`recordSchemas.ts`，`put` / `runTransaction` 入库前 `assertRecord`，坏数据落不了库）；跨仓库原子事务 `runTransaction`（导入备份与复制昨天「要么全生效要么全不生效」）；异常恢复四处加固（`onblocked` 明确报错 / 打开失败清缓存可重试 / `onversionchange` 让出连接 / 请求级错误 `guardRequest` 上抛，修掉「写失败被当成成功」）；本地数据导出与导入（选项页「本地数据备份」卡片，检查 → 二次确认 → 单事务替换当前账号数据，`user_id` 重映射支持换设备搬家，格式错误一条不写，空备份拒绝）。验收：三件套通过、`check:dates` 48/48、`check:local-data` 27/27、`check:backup` **55/55**（新建）、`verify:local` **104/104** 通过（含备份往返、非法备份不覆盖、运行时契约守卫生效、清空站点数据后换设备搬家）。
- **L6 阶段一已完成（2026-09-16），行为基线与 L5 完全一致（`verify:local` 104/104），阶段二待启动。** 完成报告见 `docs/14-L6-completion-report.md`：① **服务门面与后端切换**——新增 `services/contracts.ts`、`services/backend.ts`、`services/api/*`（authService / dayPlanService / optionService / backupService / backupFormat），页面导入从 `services/local/*` 换成 `services/api/*`，函数名与签名一字未改；后端由构建模式决定（`npm run build:cloud` / `dev:cloud`），两种后端产物互不污染（本地构建 0 命中 `supabase|PostgREST|GoTrueClient`，云端构建 0 命中 `indexedDB|happy-little-molly-local`）。② **云端适配器补全**——`cloud/authService`（Supabase Auth + profiles + 注册后播种示例）、`cloud/sessionStore` 语义并入后端无关的 `services/session.ts`、`cloud/optionService`、`cloud/dayPlanService`（从「只覆盖主记录」补到与本地逐条等价，含 meals/items/supplements/exercise items/custom tasks/routine tasks）、`cloud/backupService`（云端模式明确拒绝并说明，不假装成功）、`cloud/parity.ts`（编译期断言：云端少一个函数或签名不一致 `typecheck` 直接失败；**这一批适配器已在 S4-T7 整批删除**，见本文档顶部的 S4 条目与 `docs/23` §2.6）。③ **云端 SQL 对齐**——新增只追加迁移 `database/migrations/202609160001_stage4_local_parity.sql`：补齐 7 张缺失表（三餐内容项 / 补剂实例 / 健身项 / 家务 / 三类选项）并全部启用 RLS、接上历史日期触发器与 `updated_at` 触发器，新增 `copy_yesterday_stage4` RPC 覆盖新增表，引用选项的外键一律 `on delete set null`（否则「删选项」会被历史计划挡住）。④ **迁移与冲突方案**——`docs/13-L6-cloud-migration-and-conflict-plan.md`（仓库→表映射、不变量落点、上行迁移需受控豁免历史日期触发器、冲突与断网策略、回滚）。验收：三件套通过、`check:dates` 48/48、`check:local-data` 27/27、`check:backup` 55/55、`check:cloud-parity` **50/50**（新建）、`verify:local` **104/104**。
- **PWA 外壳已完成（2026-09-16），`verify:local` 97/97，`verify:pwa` 42/42。** 完成报告见 `docs/16-pwa-shell-completion-report.md`：① **安装要素**——`public/manifest.webmanifest`（standalone / 192+512 any+maskable 图标），index.html 补 `rel=manifest`、`apple-touch-icon` 180、`mobile-web-app-capable`、`apple-mobile-web-app-capable`、`apple-mobile-web-app-status-bar-style`；四张 PNG 图标由 `npm run icons` 用本机 Chrome 无头渲染 `favicon.svg` 生成（满幅不透明：iOS 会把透明像素渲染成黑底）。② **手写 service worker**（`public/sw.js`，无第三方依赖）——应用壳预缓存（构建产物文件名带内容哈希，装的时候从 index.html 解析）、HTML/manifest 网络优先 + 3 秒超时回退、静态资源缓存优先、**只处理同源 GET（跨域一律不缓存）**、缓存名带构建戳、activate 清旧缓存。③ **dev 不注册**——`src/shared/pwa/serviceWorker.ts` 用 `import.meta.env.PROD` 早退，原因见该文件注释（`verify-local.mjs` 的冷升级与清空数据两个用例依赖请求真的发到服务器），因此新增 `scripts/verify-pwa.mjs` 跑生产产物，而不是改既有用例。④ **更新策略保守**——不 `skipWaiting`、不 `clients.claim`，新版本停在 waiting，页面提示「新版本已下载，刷新后生效」，用户点刷新才接管。⑤ **存储与安装**——启动时请求一次 `navigator.storage.persist()`（先 feature-detect、幂等），「选项」页新增「存储与安装」卡片显示用量 / 是否持久化 / 是否独立窗口，iOS 给「分享 → 添加到主屏幕」步骤，Android 用 `beforeinstallprompt` 出按钮；文案只说事实，不写「已同步」「已保护」。
- **真机反馈修复（2026-09-16 第四轮）：抽屉的「保存 / 取消」被底部导航盖住 → 已修。** 根因是层级——底部导航 `z-index: 30`，而抽屉遮罩只有 `20`、居中遮罩只有 `10`；两者都钉在视口底边，操作区（767→820）正好落在导航（顶边 791）那一条里。已改为遮罩压在导航之上（居中 50 / 抽屉 60，层级表写在 `styles.css` 弹层段开头），并修掉窄屏 `.bottom-sheet` 简写 `padding` 吃掉 `env(safe-area-inset-bottom)` 的隐患。`verify:local` 新增两条断言（95 → **97**，含按钮中心的命中测试），`verify:pwa` **42/42** 未回退。详见本节末「真机反馈修复（2026-09-16 第四轮）」。
- 代码仓库：`git@github.com:jkwangoooo/littlemolly.git`（公开仓库）。本机已重建 `.git` 并接到远端历史，L0 期间的提交依次为 `1802fe8`（接手文档）→ `e8b4ec2`（目录职责整理）→ `b3dcd15`（文档同步）→ `1192cdb`（验收命令）→ `b81bf71`（补入未受版本控制的共享组件）→ `baf78db`（组件拆分与存储层重构）→ `716ee35`（L0 第 2 批记录）→ `4c936e0`（验收脚本自带服务器）→ `cd61dfc`（L0 完成报告）；L1 的提交为 `6408eb0`（选项管理与本地数据结构）。`.env.local`、构建产物、本地依赖和 `.workbuddy/` 均被忽略。
- **推送已完成（2026-09-14）**：本机公钥已加入 GitHub，`git push -u origin main` 成功，分支跟踪已建立，远端 `main` 与本地 `HEAD` 一致、无未推送提交。后续提交按常规 `git push` 即可。
- 下方阶段 1-3 的 Supabase 记录是历史证据，不代表现行本地模式，也不应改变当前 L0-L6 执行顺序。

## 历史待办（2026-09-20）

> **新窗口接手先读**：`docs/19-sync-execution-plan.md` §7（当前进度与各阶段报告索引）+ §4（验收基线，含 `verify:sql` 的口径）+ `docs/24-two-defect-fixes-report.md`（两处业务缺陷的定案）+ `docs/23-S4-completion-report.md`（S4 报告）。
> **S5 已完成（2026-09-20）**，报告见 `docs/25-S5-completion-report.md`：六个迁移与三个 RPC 现在由 `npm run verify:sql` 在临时真库上验收，**不再只是静态检查**；那份报告的 §6「未验证项」就是剩下的全部工作（真实凭据 + 真机清单）。
> `docs/15-next-session-handoff-and-prompt.md` 是 **L6 时代的接手文档**，里面的验收基线（`cloud-parity` 50/50、`verify:local` 104/104）**已经过期**，只当历史背景读，不要照着它核现状。
> 下面三条待办互相独立。

1. **S4：自动上传（增量推送）** —— **已完成（2026-09-20）**，报告见 `docs/23-S4-completion-report.md`。
   - **已落地（T1–T7）**：`sync/mapper.ts`（本地行 → 云端行）、`sync/outbox.ts`（出队与批次切分）、`sync/pushQueue.ts`（防抖 / 互斥 / 退避）、`src/main.tsx` 启动接线、`SyncCard` 状态与文案、`npm run verify:sync`（S4 时为 49 项，两处缺陷修复后为 56 项，**S5 起 74 项**）、`database/migrations/202609200001_stage5_sync.sql`（三张子表补服务端 `updated_at`）与 `check:cloud-parity` 的列级对齐断言、以及云端遗留适配器清理（删 8 个文件 1156 行）。当前基线 `check:cloud-parity` **78 项**。
   - **T6 的一处易误读点**：`stage5` 补的 `updated_at` **不是**为了和本地契约对齐，而是服务端时间戳（`docs/18 §5.4` 的 LWW 依据）。**别把这三列加进 `recordSchemas.ts`**——加了就会变成上报本机时钟，正好破坏它存在的理由；`check:cloud-parity` 第 ⑨ 组的「云端多出的列都能被省略」会拦住这种改法。
   - **T7 的一处易误读点**：`cloud/` 现在**只有四个模块**（`errors` / `identity` / `rpc` / `supabase`）。那批 L6 页面后端适配器是**删除**不是保留，备份在 `.workbuddy-ai/backup/cloud-l6-adapters/`（`.git` 不可用，所以另存一份）。想加回任何「云端 xxxService」前，先读 `docs/23` §2.6。
   - 现成可用：`outboxRules.ts` 的 `sortChangesForPush` / `layerOf` / `compactionVictims` / `BATCH_LIMIT` 是纯函数可直接用；`cloud/rpc.ts` 的 `callRpc` **S5 起已有调用方**（`replaceCloud.ts` 调 `import_local_backup`、`replaceLocal.ts` 调 `export_cloud_snapshot`）；`sync_state` 读写与 `device_id` 在 `sync/syncState.ts`；绑定与三种情形判定在 `sync/accountLink.ts` + `sync/bindingRules.ts`；替换的纯规则在 `sync/replaceRules.ts`。
   - 关键约束：推送前必须按 `record_id` **回主表读当前行**（队列里只有引用，没有数据副本）；`users` 永远不进队列，`cloud_user_id` 只能从 `sync_state` 取；写 `sync_state` / 写队列一律传 `{ track: false }`；**绑定与断开都会清空 `sync_outbox`**（队列是增量不是全量）。
   - **已修复（2026-09-19）**：`sync_state` 曾是**设备级单行**，没有记住「这个绑定是在哪个本地账号下建立的」，于是换本地账号后新账号的改动会被推送到上一个账号绑定的云端账号里。现已改成**一行一个本地账号**（主键 = 本地账号 id），队列条目记 `local_user_id` 并在推送时过滤，`DB_VERSION` 6→7 做一次只追加搬迁。产品语义就此定为「**绑定是本地账号级的**」——A 退出、B 登录再切回 A 时，A 仍然是已连接状态。见 `docs/24` §3。
   - **已修复（2026-09-19）**：休息日注册报 `Unable to add key to index 'user_date'`。根因是 `upsertDayPlan` 的读-改-写与 `useDayPlanData` 自动建 rest 计划并发。现由 `readModifyWrite`（事务内先读后写）消除。见 `docs/24` §2。
   - **同类残余（已知，未修）**：`saveMeals` 仍是「读现有三餐 → 逐条写回」，两次并发提交理论上会撞 `daily_meals.plan_type` 唯一索引。之所以没顺手改：它要写三餐 + 内容项共十几条记录，收进一个事务需要一个「事务内读 + 批量写」的更强原语，收益与风险不匹配；`signUp` 的「先查重再写」同理（UI 已禁用提交按钮）。要动之前先读 `docs/24` §5。
2. ~~**移动端持久化（PWA 层）**~~ —— **已完成（2026-09-16）**，报告见 `docs/16-pwa-shell-completion-report.md`。
   - 现状：manifest / 四张 PNG 图标 / 手写 service worker / 存储状态卡片均已落地；dev 仍不注册 SW，`verify:local` 106/106 未回退，`verify:pwa` 43/43。
   - 遗留（缺条件，不是缺陷）：iOS 真机上「添加到主屏幕后是否真的拿到独立存储分区、是否真的不计入 7 天计时」与 `persist()` 的实际返回值**未验证**，需真机核对；Android 安装按钮的渲染已由 `verify:pwa` 覆盖（无头 Chrome 确实会派发 `beforeinstallprompt`），但**点击后进入的系统安装流程未验证**。
   - 注意：安装只是降低风险，**备份仍是唯一的兜底路径**，这条说法不许在文案里被夸大。
3. **S5 的前置：真实 Supabase 项目凭据。** 本机没有真实项目（无 `.env.local`），因此云端托管侧的配置（PostgREST 的 schema cache、GoTrue 的会话与邮箱验证、Site URL、连接池）仍未验证。**但「SQL 能不能跑」这一层已经在 2026-09-20 补上了**：本机装了 PostgreSQL 16，新增的 `npm run verify:sql`（39 项）会起一个临时集群、按文件名顺序把 `database/migrations/` 里的六个迁移**真的执行一遍**，再断言结构 / 三个 RPC 的真实往返 / 快照字段集合与本地契约逐张对齐 / 替换语义 / 豁免不泄漏 / RLS 双账号隔离。所以「六个迁移只做过静态检查」这句话不再成立。
   - 顺序建议：① 在真实项目按文件名顺序执行六个迁移并核对表 / 策略 / 触发器；② 关闭邮箱验证（或配好 SMTP），否则 `signUp` 拿不到会话（适配器会明确报错，不会假装登录成功）；③ 跑真实链路（注册 / 登录 / 刷新恢复 / 断网失败 / RLS 双账号）；④ 再验 S5 的两个整体替换（含历史日期触发器的受控豁免，方案见 `docs/13` §5）。
4. L4/L5 遗留：真机软键盘顶起与 iOS 安全区（`env(safe-area-inset-bottom)`）待真机验收时人工确认/补齐。
4. 每次阶段完成后运行 `npm run typecheck`、`npm run lint`、`npm run build`、`npm run check:dates`、`npm run check:local-data`、`npm run check:backup`、`npm run check:cloud-parity`、`npm run check:sync`，并运行 `npm run verify:local` 做真实浏览器闭环验收（桌面 1440x900 + 手机 390x844、无横向溢出、控制台无 error/warning、**未配置云端时整轮交互零跨域请求**）。**改动 PWA 外壳、manifest、图标或注册逻辑后另跑 `npm run verify:pwa`**（43 项，跑生产产物）；**改动同步引擎（`services/sync/`、`outboxRules.ts`、`localDb.ts` 的写入钩子、同步文案）后另跑 `npm run verify:sync`**（74 项，假云端 + CDP 拦截）；**改动 `database/migrations/` 或三个云端 RPC 后另跑 `npm run verify:sql`**（39 项，起临时 PostgreSQL 真跑迁移，需本机装 PostgreSQL 16+，可用 `MOLLY_PG_BIN` 指定 bin 目录；它**不放进 `all`**，因为 `all` 要能在任何开发机上跑完）。需要人工核对外观时加 `SHOT_DIR` 落盘截图。S1 起**不再有 `build:cloud`**：只有一个构建，也没有「两种产物互斥检索」这一步。
   **历史基线（2026-09-20）**：`check:dates` 48 · `check:local-data` 62 · `check:backup` 62 · `check:cloud-parity` 78 · `check:sync` 113 · `verify:local` 125 · `verify:pwa` 49 · `verify:sync` 74 · `verify:sql` 39。
   **历史计数记录保留不改**，当前项数与四处更新要求以本文件顶部为准。
5. 新增对象仓库时按 `localDb.ts` 顶部四步走（`LocalStore` → `STORES` → `DB_VERSION` → `MIGRATIONS`），`check:local-data` 会强制这三处同时改；迁移只追加，不改写既有迁移。**同时必须在 `recordSchemas.ts` 的 `RECORD_SCHEMAS` 补该仓库字段契约**，否则 `put` 会在运行时抛「未定义字段」；`check:backup` 会比对仓库清单与契约同源。
6. 改动 `localDb` 写入口径（`put` / `remove` / `runTransaction`）时注意：请求级错误必须经 `guardRequest` 上抛，只挂 `transaction.onerror` 会让「写失败」被当成成功。**S2 起这三个口还要多一个 `{ track }` 选项**，改它们之前先读 `docs/19` §5 的 S2 部分。
7. R9 已在 L1 修复并纳入验收断言，不再挂账。

## 已有文档

- `docs/43-账密改造详细执行文档.md`：现行账密改造方案，替代旧本地认证/云端绑定模型；包含身份、数据保全、首次恢复、验收与发布边界。
- `docs/27-deploy-runbook-for-codex.md`：现行生产部署说明，包含真实项目核实、7 个迁移、可信 W 准备、UID 门禁、Vercel 发布和逐项真实验收。

- `docs/00-product-scope.md`：功能边界和第一版验收。
- `docs/01-architecture-data-contract.md`：模块边界、推荐技术基线、数据不变量。
- `docs/02-ui-interaction-spec.md`：页面和交互规则。
- `docs/03-delivery-roadmap.md`：五个开发阶段及各阶段验收。
- `docs/04-stage-orchestration.md`：新窗口实施提示词、总指挥验收协议。
- `docs/05-local-first-execution-plan.md`：L0–L6 任务线、顺序与验收门槛（**已完成，历史依据**）。
- `docs/06-takeover-assessment-and-plan.md`：接手评估、风险项 R1–R9、L0 执行清单与状态。
- `docs/07-L0-completion-report.md`：L0 完成报告（任务达成、证据、缺陷、延后项与未验证项）。
- `docs/08-L1-completion-report.md`：L1 完成报告（选项管理与本地数据结构：任务达成、证据、缺陷、延后项与未验证项）。
- `docs/09-L2-completion-report.md`：L2 完成报告（计划内容实例化：三餐多选、补剂实例化、健身多选、名称快照、v2→v3 冷升级；任务达成、证据、缺陷、延后项与未验证项）。
- `docs/10-L3-completion-report.md`：L3 完成报告（休息日与自由规划：拖地/洗衣每日实例、临时不上班不带家务、隐藏工作日准备项、v3→v4 冷升级；任务达成、证据、缺陷、延后项与未验证项）。
- `docs/11-L4-completion-report.md`：L4 完成报告（首页导航与移动端交互：底部固定导航、面板滚动锁定、带勾选选项行核对、桌面宽屏保留；任务达成、证据、决策、延后项与未验证项）。
- `docs/12-L5-completion-report.md`：L5 完成报告（本地可靠性、备份与回归：写入契约、原子事务、异常恢复加固、导出导入；任务达成、证据、决策、缺陷、延后项与未验证项）。
- `docs/13-L6-cloud-migration-and-conflict-plan.md`：L6 云端迁移与冲突处理方案（两种后端共存方式、11 个仓库 → 云端表映射、七条不变量的云端落点、本地 → 云端上行迁移步骤与历史日期受控豁免、冲突与断网策略、回滚、验收清单与未验证项）。
- `docs/14-L6-completion-report.md`：L6 阶段一完成报告（服务门面与后端切换、云端适配器补全、云端 SQL 对齐、契约与编译器级等价保证；任务达成、证据、决策、缺陷、延后项与未验证项）。
- `docs/15-next-session-handoff-and-prompt.md`：**新对话接手文档与实施提示词**（现状核对、验收基线、两条待办的完整可复制提示词与验收清单、已踩过的坑、本次交接产出）。
- `docs/16-pwa-shell-completion-report.md`：PWA 外壳完成报告（manifest / 图标 / 手写 service worker / dev 不注册 / 保守更新 / 存储状态卡片；任务达成、验收证据、关键决策、缺陷与延后项、未验证项）。
- `docs/17-options-page-ia-research.md`：**选项页信息架构调研 + 实施记录**（现状量化诊断、七条权威依据与出处、三个候选方案对比、推荐的「概览页 + 子屏」方案与落地约束；§8 记录已实施的结果与实测对比）。
- `docs/18-sync-architecture-plan.md`：S1-S6 历史数据架构方案；本地写入与上传纪律继续有效，账号模型及首次恢复规则以第 43 份文档为准。
- `docs/19-sync-execution-plan.md`：S1-S6 任务线与当前基线；本次认证改造的详细执行依据为第 43 份文档。
- `docs/20-S1-completion-report.md`：S1 完成报告（架构切换与能力声明：任务达成、证据、关键决策、缺陷与延后项、未验证项）。
- `docs/21-S2-completion-report.md`：S2 完成报告（本地变更追踪：两个设备状态仓库、仓库三分类、写入钩子、队列规则纯函数化、`check:sync`）。
- `docs/22-S3-completion-report.md`：S3 完成报告（云端账号绑定与连接：绑定 ≠ 登录、三种绑定情形、探测不新增 SQL、状态聚合纯本地、懒加载是结构性的）。
- `docs/23-S4-completion-report.md`：S4 完成报告（自动上传：映射层、推送执行、调度器接线、状态与文案、`stage5` 迁移与列级对齐、云端遗留适配器清理）。
- `docs/24-two-defect-fixes-report.md`：**两处业务缺陷的修复报告**（并发建日计划撞唯一索引、换本地账号把数据推到别人的云端；根因、市面做法、落地、改动清单、已知残余、反证、对 S5 的影响）。
- `docs/25-S5-completion-report.md`：S5 完成报告（双向整体替换：三个 RPC 与三处受控豁免、`replaceCloud` / `replaceLocal` / `replaceRules`、新增 `verify:sql` 真库验收；§6 列出的未验证项就是剩下的全部工作）。

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

## L4：首页导航与移动端交互完善（2026-09-15）

完整报告见 `docs/11-L4-completion-report.md`，此处只记改动与证据。

### 背景

三个页面（日计划 / 周视图 / 选项）各自在顶部渲染一份「今日/本周/选项」导航按钮，移动端单手切换不便，且与 docs/02「底部固定三个入口」不符。L4 把一级导航统一到底部固定栏，并补齐面板滚动锁定。

### 本次修改文件

**新增（2 个）：**
- `src/shared/components/BottomNav.tsx`：底部固定导航，当前页高亮
- `src/shared/types/view.ts`：共享 `View` 类型

**修改（8 个）：**
- `src/features/day-plan/components/DayNavTabs.tsx`：精简为「执行今天/准备明天」两个页签
- `src/features/day-plan/DayPlanScreen.tsx`：WeekView/PreferencesScreen 回调统一为 `onNavigate`；挂 BottomNav
- `src/features/week/WeekView.tsx`：移除顶部 nav-tabs，挂 BottomNav
- `src/features/preferences/PreferencesScreen.tsx`：移除顶部 nav-tabs，挂 BottomNav
- `src/shared/components/BottomSheet.tsx`：打开锁定 body 滚动、卸载恢复
- `src/shared/components/ConfirmDialog.tsx`：同上
- `src/app/styles.css`：新增 `.bottom-nav`；`.page` 底部 padding 避让导航
- `scripts/verify-local.mjs`：74→77 项

### 实际运行的命令与结果

- `npm run typecheck` / `npm run lint`：通过。
- `npm run build`：通过，74 modules，251.41 kB（gzip 77.88 kB）。
- `npm run check:dates`：**48/48 通过**。
- `npm run check:local-data`：**24/24 通过**。
- `npm run verify:local`：**77/77 通过**（连续两次；桌面 1440x900 + 手机 390x844，无横向溢出，控制台无 error/warning）。
- `SHOT_DIR` 截图人工核对：手机/桌面的底部导航位置、高亮、无遮挡均正常。

### L3 遗留项处置

「休息日 prepare/execute tab 语义未区分」复核后**确认为合理现状**：休息日全部内容在两个 tab 下一致且可操作，语义由页首标题承载，不缺功能，不再挂账（详见 `docs/11` 第 7b 节）。

### 阶段结论

- **L4 完成，可进入 L5。** 全部 5 项任务落地，验收基线为「三件套 + `check:dates` 48 项 + `check:local-data` 24 项 + `verify:local` 77 项」。
- 未验证项：真机软键盘与 iOS 安全区、L5–L6 功能、云端一切、跨浏览器差异。

## PWA 外壳：移动端持久化（2026-09-16）

完整报告见 `docs/16-pwa-shell-completion-report.md`，此处只记改动与证据。
（注：本文件下方的 L5 / L6 细节段未在本机副本中，那两阶段以 `docs/12`、`docs/14` 为准。）

### 背景

在 iOS Safari 上，**没有安装到主屏幕**的站点有一条规则：7 天没有交互就清空可写存储
（IndexedDB / localStorage / Cache / Service Worker 注册）。而这个应用的业务数据全在浏览器 IndexedDB 里。
本任务做的是让应用可安装（PWA 外壳）并把存储状态如实显示出来——安装不是「体验更好」，
而是「不装的话系统可能在一周后清掉数据」。同时它**不能替代备份**。

### 本次修改文件

**新增（13 个）**
- `public/manifest.webmanifest`、`public/sw.js`
- `public/icons/icon-192.png`、`public/icons/icon-512.png`、`public/icons/icon-maskable-512.png`、`public/apple-touch-icon.png`
- `src/shared/pwa/serviceWorker.ts`、`src/shared/storage/storageStatus.ts`、`src/shared/storage/installPrompt.ts`
- `src/shared/components/UpdateNotice.tsx`、`src/shared/hooks/useServiceWorkerUpdate.ts`
- `src/features/preferences/components/StorageCard.tsx`
- `scripts/generate-icons.mjs`、`scripts/verify-pwa.mjs`、`scripts/lib/find-browser.mjs`

**修改（10 个）**
- `index.html`（manifest / apple-touch-icon / 四个安装 meta）
- `src/main.tsx`（渲染前挂 `beforeinstallprompt` 监听、注册 SW、请求持久化、挂更新提示）
- `src/features/preferences/PreferencesScreen.tsx`、`src/features/preferences/preferencesLabels.ts`（存储与安装文案段）
- `src/app/styles.css`（`.storage-card` / `.storage-facts` / `.update-notice`）
- `src/vite-env.d.ts`、`vite.config.ts`（`define` 注入 `__BUILD_STAMP__`）
- `scripts/verify-local.mjs`（浏览器定位改为共用 `scripts/lib/find-browser.mjs`）
- `package.json`（新增 `verify:pwa`、`icons`）、`README.md`

### 实际运行的命令与结果

- `npm run typecheck` / `npm run lint`：通过。
- `npm run build`：通过，**91 modules**，`index-*.js` 275.63 kB（gzip 85.71 kB）、css 9.34 kB。
- `npx vite build --mode cloud --outDir dist-cloud`：通过，135 modules / 489.90 kB（gzip 141.83 kB）。
- `npm run check:dates`：**48/48**；`npm run check:local-data`：**27/27**；`npm run check:backup`：**55/55**；`npm run check:cloud-parity`：**50/50**。
- `npm run verify:local`：**104/104 通过**（未回退；第一轮 94/94，第三轮加了「自定义事项用居中卡片」，第五轮加了选项页信息架构的 10 条）。
- `npm run verify:pwa`：**42/42 通过**（新建；第一轮 34 项，后续轮次陆续加断言）。
- 双向产物体检：本地产物 0 命中 `supabase|PostgREST|GoTrueClient|copy_yesterday`；云端产物 0 命中 `indexedDB|happy-little-molly-local`。
- `npm run icons`：四张 PNG 生成并自校验尺寸（192 / 512 / 512 maskable / 180）。

### 关键约束与决策

1. **dev 不注册 service worker**（`import.meta.env.PROD` 早退）。`verify-local.mjs` 的冷升级用例
   （CDP 把 `/src/main.tsx` 换成空模块造 v1 老库）与清空站点数据用例都依赖「请求真的发到服务器」，
   dev 注册 SW 会让两者失效。因此新增跑生产产物的 `verify:pwa`，**没有改既有用例**。
2. **缓存名带构建戳**：`vite.config.ts` 在构建开始时把 `Date.now()` 注入 `__BUILD_STAMP__`，
   注册地址是 `/sw.js?build=<戳>`，SW 从自己的 URL 取戳命名缓存，activate 按前缀清旧缓存。不手写版本号。
3. **更新保守**：不 `skipWaiting`、不 `clients.claim`。新版本停在 waiting，页面提示「新版本已下载，刷新后生效」，
   用户点刷新才接管——不能静默换掉一个正在编辑的页面。
4. **只碰同源 GET**：跨域（含 Supabase）一律直接 return，不缓存。缓存跨域响应等于在本地伪造云端状态。
5. **应用壳缓存键只认 `/` 与 `/index.html`**：其它路径的导航不写缓存，否则访问一次不存在的路径就会把 404 写进应用壳。
6. **图标用本机 Chrome 无头渲染**，不引图像库；满幅不透明（iOS 会把透明像素渲染成黑底）。

### 本轮修复的缺陷

1. 应用壳缓存会被非壳导航污染（见上条 5）——写成断言之前先修掉。
2. `verify:pwa` 首轮 3 项失败：dev 首屏固定等待太短（改为轮询）、`Emulation.setEmulatedMedia` 不支持
   `display-mode`（改为真的用 `--app=` 开应用窗口）、验收用图标预览页缺 favicon 导致 Chrome 回退请求
   `/favicon.ico` 报 404（补 favicon，并让控制台断言输出报错来源 URL）。
3. 独立窗口截图最初拍的是主窗口（两张图字节数相同）——改为用该窗口自己的 CDP 连接截图。

### 未验证项

- iOS 真机：「添加到主屏幕」后是否真的拿到独立存储分区、是否真的不计入 7 天计时——**未验证**。
- iOS 上 `navigator.storage.persist()` 的实际返回值——**未验证**（代码走「不支持」分支）。
- Android 安装按钮的**渲染**已由 `verify:pwa` 断言覆盖（无头 Chrome 确实会派发 `beforeinstallprompt`）；点击后进入的系统安装流程**未验证**（无头环境弹不出安装对话框）。
- iOS 安全区已在本次修掉并由 `Emulation.setSafeAreaInsetsOverride` 自动验收（导航 34px / 页面 114px）；**真机软键盘顶起输入框**仍未核对（需要真机与真实输入法）。

### 真机验证用的线上部署（2026-09-16）

- 链接：`https://f033473469da4daf849ebd353b47443f.sg2.agentos-app.run`（当前构建的**静态快照**，随时可下线；只用于真机验收，不是正式发布）。
- **2026-09-16 20:36 已重新发布**：线上现为 `7ab8b59` 的产物，含第二轮（缩放锁 / 抽屉让开软键盘）、
  第三轮（固定外壳 + 内容区内部滚动）与第四轮（添加事项改居中卡片）的全部改动。
  重新发布后已核对：`index.html` 带 `user-scalable=no` / `viewport-fit=cover`，引用的资源哈希与本地构建一致；
  CSS 含 `.center-card` / `.editor-body`，JS 含 `vv-keyboard-inset` / `data-editor-card`；
  线上冒烟 8/9（唯一失败项是断网段控制台的 `ERR_INTERNET_DISCONNECTED`，即 `docs/16` §6.1 第 4 条记录的
  network-first 正常代价）。
- 发布的是 `dist/`（生产产物）而不是源码：dev server 刻意不注册 SW，发布源码让沙箱跑 dev 就装不上、也验不了离线。
- 待办：真机核对清单见 `README.md` 验收步骤 13–14；核对结果（尤其 iOS 是否进入独立存储分区、`persist()` 返回值）回来后补进 `docs/16` §6.3。

### 阶段结论

- **待办 A（PWA 层）完成**，行为基线未回退，验收基线为「三件套 + 四个 check 脚本 + `verify:local` 104 项 + `verify:pwa` 42 项」。
- 下一步：`docs/15` §5 的待办 B（L6 阶段二：真实项目验收 + 上行迁移），需要真实 Supabase 凭据；本机无 `.env.local`，本轮未触碰云端任何代码与迁移。

### 追加：真机反馈修复（2026-09-16 第二轮，详见 `docs/16` §8）

用户在手机上实测后反馈三条，已修两条：

1. **「页面不像 APP，双指放大后可任意平移」→ 已修**。viewport 补 `maximum-scale=1, user-scalable=no`；
   新增 `src/shared/appShell/viewportGuards.ts` 拦 iOS 的 `gesturestart/gesturechange/gestureend`
   与两指 `touchstart`（**iOS Safari 从 iOS 10 起忽略 user-scalable，只能靠这一步**）；
   `styles.css` 补 `touch-action: manipulation` / `overscroll-behavior: none` / `-webkit-text-size-adjust`。
   代价：牺牲「放大看小字」的无障碍能力，属刻意取舍。
2. **「添加事项抽屉显示不全、点不到保存」→ 已修**。先量后修：注入替身 `visualViewport`（高度 508）后
   抽屉几何完全不变，证实它没让开键盘。原因是 iOS 弹键盘只缩小**可视视口**、不动布局视口，
   而抽屉按 `90vh` 算高度并贴着布局视口底边，加上面板打开时 body 滚动被锁 → 下面那截永远够不到。
   修法：新增 `src/shared/appShell/visualViewport.ts` 把可视视口写成 `--vv-height` /
   `--vv-keyboard-inset` 两个 CSS 变量；遮罩让位、抽屉高度上限跟可视视口走；
   `BottomSheet.tsx` 改成「标题固定 / 中间 `.sheet-body` 独立滚动 / 操作区钉底」，
   使「保存 / 取消」在任何键盘高度下都可见。`verify:pwa` 新增两条断言（替身驱动，`inset=336px`、抽屉 `114→508`、操作区底部 `484`）。
3. **「首页做成固定单页面不可滑动」→ 已实施**（用户选定「固定外壳 + 内容区内部滚动」）。
   `html/body/#root` 拉满高度、`body { overflow: hidden }`；`.page` 变成固定高度纵向 flex 容器；
   新增 `.page-scroll` 作为**唯一**可滚动区域，挂在日计划 / 周视图 / 选项三页（登录页刻意不加，
   否则登录卡会被拉成一整屏高）。窄屏压缩：卡片内边距 18→16、区块间距 16→10、模式卡改回一行、
   日期块改「流式一行」（信息一条没少）、分区标题与「＋ 添加」按钮保持一行。
   实测：页面 `scrollHeight=844` = 视口（页面本身不滚）；「执行今天」内容 494px / 可视 640px，余量 164px。
   准备页内容超一屏时由内容区内部滚动兜底——不藏内容。
   **坑**：`.stack` 是 grid，默认 `align-content: stretch`，容器高度被外壳固定后每行都会被拉伸填满，
   卡片内部出现莫名空白、量高度也全部失真（改哪块都是同一个总数）；加 `align-content: start` 才量到真实高度。
5. **选项页信息架构重构（第五轮）→ 已完成**。按 `docs/17` 的调研结论与用户确认的方案：
   概览页（6 行带状态摘要的入口，分「候选项清单 / 数据与设备 / 账号与同步」三组）+ 六个子屏
   （三类清单 / 备份 / 存储 / 账号）。清单行内只留拖拽手柄与「…」溢出菜单，上移 / 下移挪进菜单
   作为无障碍替代；备份与账号各自独立成屏。实测：选项页从 **4.1 屏 / 71 个按钮** 降到概览 **一屏 / 7 个按钮**，
   选项行从 **102px / 5 个按钮** 降到 **62px / 2 个元素**。拖拽复用服务层 `moveOption` 按位移逐步移动，
   不新增批量重排接口（门面函数两侧都要实现且要被 check:cloud-parity 检查）。
   新增组件 `OptionsOverview` / `OptionListScreen` / `RowMenu` / `useDragOrder`；删除 `OptionSection`。
   验收：`verify:local` 104/104、`verify:pwa` 42/42、四个 check 脚本全绿。
4. **「添加事项的下方抽屉换成中央卡片」→ 已完成（第三轮）**。`BottomSheet` 泛化为 `EditorDialog`
   （新增 `placement: 'bottom' | 'center'`）：自定义事项用居中卡片，三餐 / 补剂 / 健身 / 晨间 / 选项编辑
   仍用底部抽屉。两形态共用「标题固定 / 中间 `.editor-body` 独立滚动 / 操作区钉底」与 body 滚动锁定，
   软键盘让位规则对两者同时生效；根节点统一带 `data-editor-card`，验收脚本不再依赖具体形态。
   `.sheet-body` 更名 `.editor-body`，新增 `.center-card`，`.modal-backdrop` 补键盘让位。
   验收：`verify:local` 104/104（新增「自定义事项编辑用居中卡片」一条）、`verify:pwa` 42/42
   （软键盘断言拆成抽屉 16→508 / 卡片 67→441 两组）。

## 真机反馈修复（2026-09-16 第四轮）：抽屉的「保存 / 取消」被底部导航盖住

### 现象与根因

用户反馈「准备明天」的单项编辑抽屉里确定按钮显示不全，移动端根本看不到确认 / 取消。

先量后修（在手机 390x844 下注入几何探针）：抽屉操作区 **767→820**，而底部导航顶边在 **791**——
按钮下半截（29px）正好落在导航那一条里；在按钮中心做命中测试，两个按钮都返回 `false`（指针被导航接住）。
根因是**层级**：`.bottom-nav` 是 `z-index: 30`，而 `.sheet-backdrop` 只有 `20`、`.modal-backdrop` 只有 `10`。
抽屉钉在视口底边（`align-items: flex-end`），导航也钉在视口底边，两者抢同一条带子——导航在上面，
操作区就被整条盖住。顺带暴露出第二个缺陷：弹层打开时导航**仍可点**，用户会在编辑途中被切走。

另有一处窄屏隐患：`@media (max-width: 480px)` 里 `.bottom-sheet { padding: 16px 18px 24px }`
用简写覆盖了上面那条 `padding-bottom: calc(28px + env(safe-area-inset-bottom))`，
装上主屏幕后按钮会压在 Home 指示条上（34px 安全区被吃掉）。

### 本次修改文件

- `src/app/styles.css`
  - 弹层段开头新增**层级表**注释：内容 < 居中遮罩 50 < 抽屉遮罩 60，底部导航 30 与更新提示条 40 都在遮罩之下；
    `.modal-backdrop` `z-index: 10 → 50`，`.sheet-backdrop` `20 → 60`。
  - 窄屏 `.bottom-sheet` 的 `padding-bottom` 改为 `calc(24px + env(safe-area-inset-bottom, 0px))`。
- `scripts/verify-local.mjs`：新增 **19b** 段两条断言（95 → 97 项），在 390x844 下打开三餐抽屉，
  除量矩形外还在按钮中心做 `document.elementFromPoint` **命中测试**——几何位置对但被别的东西盖住同样算失败。
- `HANDOFF.md`（本节）。

### 实际运行的命令与结果

- `npm run typecheck` / `npm run lint` / `npm run build`：通过（93 modules，css 10.94 kB / js 276.86 kB）。
- 修复前 `npm run verify:local`：**95/97**，两条新断言如实报红
  （`命中测试=[false,false]，操作区 767→820，导航顶边 791` / `导航按钮命中自身=true`）。
- 修复后 `npm run verify:local`：**97/97**（命中测试 `[true,true]`、导航按钮命中自身 `false`）；
  带 `SHOT_DIR` 复跑一次仍 **97/97**（连续两次，截图人工核对抽屉底部）。
- `npm run verify:pwa`：**42/42** 未回退（软键盘让位、iOS 安全区两条断言不受影响）。

### 结论

- **已修复。** 抽屉（以及居中卡片的遮罩）现在压过底部导航，操作区完整可见可点；
  弹层打开期间导航被遮罩盖住，不会误切页。
- 真机上的观感（抽屉是否贴底、按钮与 Home 指示条的间距）仍建议在手机上确认一次——
  自动化只能证明几何与命中，证不了手感。

### 提交与发布状态

- 已提交 `be9ef4c`（`fix(mobile): 抽屉的「保存 / 取消」被底部导航盖住`）并 `git push` 成功：
  `git ls-remote origin main` 返回 `be9ef4c`，远端 `main` 与本地 `HEAD` 一致。
- **线上分享链接已更新（2026-09-16 22:2x）**：`https://f033473469da4daf849ebd353b47443f.sg2.agentos-app.run`
  （仍是同一个链接，内容替换为修复版）。核对方式沿用「比对资源哈希 + 检索新特性标记」：
  线上 `index.html` 引用的 `index-CvlGd0rp.js` / `index-D92bAM6H.css` 与本地 `dist/` 完全一致；
  线上 CSS 含 `z-index:60`（抽屉遮罩）与 `z-index:50`（居中遮罩），且**已无** `z-index:20`（旧抽屉遮罩）。
- 真机复核提示：手机上的 PWA 缓存了旧壳，刷新时可能先提示「新版本已下载，刷新后生效」，
  点一次刷新才接管——看到提示不等于没更新成功。
- **本机 Git 环境异常（非项目问题，供后续会话别踩）**：`.git/refs/remotes/` 写入不落盘。
  `git fetch` 会打印 `* [new branch] main -> origin/main`、`git update-ref refs/remotes/origin/main <sha>` 也返回成功，
  但 `.git/refs/remotes/` 目录始终为空、`git rev-parse origin/main` 报 `unknown revision`，
  于是 `git status` 一直显示 `## main...origin/main [gone]`。**推送本身是成功的**（以 `git ls-remote origin main` 为准），
  这个 `[gone]` 只是本地跟踪引用没写下去，不要据此判断「分支被删」或重做提交。
  与之前记录的「`src/` 被本机某进程删除」同属这台机器的环境异常。
