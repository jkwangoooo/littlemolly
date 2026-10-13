# 幸福小Molly部署执行说明

> 项目：`D:\WJKHome\小人项目包\littlemolly-main`。
> 现行认证方案：[账密改造详细执行文档](43-账密改造详细执行文档.md)；实施结果：[本地实施与部署交接](44-账密改造本地实施与部署交接.md)；当前状态与基线：[开发交接](../HANDOFF.md)。
> 按仓库要求先读 `docs/26-S6-handoff-for-codex.md` 了解历史硬规则，再以本文件、第 43 份和第 44 份文档核对现行认证与发布流程。docs/26 的本地登录、双身份、凭据缺失和旧数量属于历史状态。

**2026-10-13：本地账密改造与自动验收已完成；目标 Supabase 项目已应用账号门禁迁移，但 Auth 管理、allowlist 写入、Vercel 环境更新和发布尚未完成。** 核对最终本地实施提交和第 44 份文档后进入下列步骤。部署目标是 `https://molly.lightwavecommunity.site`，最终仍须核对它指向的实际 Vercel 项目和版本。

| 生产事项 | 当前状态 |
| --- | --- |
| 数据库迁移 | 账号门禁迁移已应用；完整结构、权限与迁移历史待核验 |
| W 账号准备、真实 UID 与 allowlist | 未执行、未验证 |
| Supabase 项目 ref 与 Auth 配置 | 未验证 |
| Vercel Production 环境变量 | 未更新、未验证 |
| 现有线上提交与本次新版发布 | 现有提交未验证，本次未发布 |
| 线上浏览器、账号链路与真机验收 | 未验证 |

## 0. 交接提示词

```text
请接手幸福小Molly的账号改造版部署，项目在 D:\WJKHome\小人项目包\littlemolly-main。
先读 AGENTS.md、docs/26-S6-handoff-for-codex.md、HANDOFF.md、
docs/43-账密改造详细执行文档.md、docs/44-账密改造本地实施与部署交接.md
和 docs/27-deploy-runbook-for-codex.md。

本地认证改造和自动验收已完成，先核对最终实施提交、工作区和第44份文档的验收记录，
以该提交为发布源。源码变更后重跑对应检查；不能部署旧本地密码或双身份绑定版本。
本机四项部署凭据已经存在，沿用仓库外受保护配置，不重复索取或打印具体值。
核实现有 Supabase/Vercel 项目、当前线上版本和迁移历史；已有数据库只执行缺失迁移，
空库才使用完整合并 SQL。保留旧业务数据，先确认旧 owner、目标 W UID及数据去向。

通过可信 Supabase Auth 管理入口准备 W（用户元数据可留空），使用用户已指定的
初始密码并核验真实 Auth UID。密码策略拒绝时报告阻塞，不自动降低策略或换密码。
不要将密码写进源码、种子、VITE_* 或公开文档。实际 Auth 用户存在后才写 UID allowlist，
关闭公开注册及无关身份入口，核实 Site URL、Redirect URLs、RLS、GRANT、四个 RPC
和 PostgREST schema cache。缺少可信 Auth 管理入口时，先完成可执行的只读核验，
明确剩余的具体管理操作，不能使用浏览器匿名注册冒充账号准备。

先设 Vercel Production 构建变量，再构建发布；不运行 vercel login。
发布后真实验证 W 登录、退出重登、新设备恢复、断网重验、旧 UID/JWT 门禁，
以及首页、深链接、PWA 缓存和真机；脚本成功不能替代这些验证。
按第 8 节回报每项真实结果，失败或未验证的项目逐条注明。
```

## 1. 凭据与操作边界

当前本机所需配置已确认存在，不重复向用户索取。默认文件是：

```text
C:/Users/Administrator/.happy-little-molly/deploy.env
```

可用 `MOLLY_DEPLOY_CONFIG` 覆盖。所需字段：

| 字段 | 用途 |
| --- | --- |
| `VERCEL_TOKEN` | 现有项目关联、Production 环境及发布 |
| `SUPABASE_DB_URL` | 已授权数据库管理与只读核验 |
| `VITE_SUPABASE_URL` | 前端 Auth/API 的构建期 URL |
| `VITE_SUPABASE_ANON_KEY` | 前端公开 legacy anon JWT 或 `sb_publishable_` key；沿用现有变量名 |

数据库连接串及 Token不放命令输出、源码、Git、部署包或报告。前端只允许 anon/publishable key，禁止 `service_role` JWT、`service_role` 标识或 `sb_secret_` key 进入前端。本流程不为准备 W 增加管理员 key到环境文件；需要的账号管理操作通过可信管理入口执行。

凭据配置文件必须位于仓库外。`scripts/deploy.mjs` 在读取或写入前核验真实路径，拒绝仓库内路径，以及通过 junction、有效链接、悬空文件/目录链接或多级链接指向仓库的路径；链接循环或嵌套过深同样报错。`MOLLY_DEPLOY_CONFIG` 不能绕过这些检查。

凭据护栏专项命令为 `node scripts/验证部署凭据护栏.mjs`，2026-10-13 本地结果为 **20/20 通过**。Windows 无文件符号链接权限时，文件链接场景使用 API 模型夹具，真实目录 junction 仍使用文件系统测试，脚本会如实输出此差异。专项只使用测试凭据，不读取真实配置或执行部署；通过结果不证明真实凭据、远端配置或生产部署有效。

已有会话和明确授权可继续使用；未经授权的平台注册/登录仍由用户完成。不要运行交互式 `vercel login`，沿用 Token。Auth 管理入口不可用时如实报告需要的具体操作，不能将本地构建或数据库表存在说成 W 已准备。

## 2. 源码与本地验收门槛

核对 W 单账号、Supabase Auth 唯一认证、统一 UID、无公开注册/二次绑定、首次恢复门控、旧身份隔离与退出保留队列。将结果与第 43 份文档逐项对应，不能只看 typecheck 通过。

本轮完整记录见第 44 份文档，已完成的验收不必仅为文档核对重复执行。源码变更或需要重验时，在依赖已装的项目目录依次运行：

```bash
npm run typecheck
npm run lint
npm run build:no-empty
npm run check:dates
npm run check:local-data
npm run check:backup
npm run check:cloud-parity
npm run check:sync
npm run check:feedback
node scripts/验证部署凭据护栏.mjs
node scripts/验证认证并发.mjs
node scripts/验证旧工作区迁移.mjs
npm run verify:local
npm run verify:pwa
npm run verify:sync
npm run verify:sql
npm run build:no-empty
```

SQL 验收与浏览器验收串行，数量以 `HANDOFF.md` 当前基线及实际输出为准。认证并发、旧工作区迁移与部署凭据护栏为独立专项，不在启动器 `all` 中，须另跑。本轮分别为 12/12、69/69、20/20；`verify:local`、`verify:pwa`、`verify:sync`、`verify:sql` 分别为 172/172、64/64、195/195、87/87，均通过。失败时先修本地，不执行生产迁移、账号变更或发布。`verify:sql` 是临时 PostgreSQL，不证明真实 Supabase Auth、PostgREST 或现网。

`verify:pwa` 末尾会生成无 Auth 配置的测试构建，重验后最后一次 `build:no-empty` 必须使用正常配置。本机 `dist/` 会保留历史块，只用于本地核验；发布继续采用 Vercel 从已核验源码执行普通 `build` 的路线，不直接上传累积产物或改用 `--prebuilt`。

核实 Git 工作区与已保护基线。`账密改造前版本` 指向提交 `b646e6af9ea5bcacece0da90ef5e7532a619b261`；不能移动该标签。本机 Git 当前可用，旧“Git 不可用”只作历史背景。实际发布源码是否包含未提交改动必须明确报告，不能用 HEAD 冒充产物版本。

## 3. 核实项目与数据

1. 用已有受保护配置核实 Supabase project ref与 API URL一致；检查 `.vercel/project.json` 的真实 team/project，确认目标域名关联。
2. 记录当前部署与本次将发布的源码版本；现有线上版本未核实就标未验证。
3. 盘点数据库迁移历史和实际表、函数、策略。列出确切待执行文件，不把“合并 SQL在仓库”当成已执行。
4. 盘点旧本地 owner、旧云端 UID、业务范围、独立备份和 W 是否已存在。明确目标 UID及迁移/保留方案，不通过账号名称推断数据归属。

不能因为“清除旧账号名”删除 Auth 用户或级联删除业务；服务端门禁可以先阻止旧 UID访问，业务迁移与身份停用按确认的方案执行。数据库门禁切换会让旧客户端被拒，发布时要记录这一预期与操作顺序。

## 4. 迁移与 W 准备

### 4.1 执行审核后的迁移

当前有 **7 个顺序迁移**，完整顺序为：

```text
database/migrations/202608270001_stage1_auth_sync.sql
database/migrations/202608310001_stage2_day_plans.sql
database/migrations/202608310002_stage3_workday_planning.sql
database/migrations/202609160001_stage4_local_parity.sql
database/migrations/202609200001_stage5_sync.sql
database/migrations/202609200002_stage6_replace.sql
database/migrations/20261011183805_account_identity_gate.sql
```

空库可执行 `deploy/supabase-all-migrations.sql` 完整初始化。已有项目先审核历史，只执行缺失迁移；前六个迁移已完成的项目只执行新增门禁迁移。完整合并文件不是通用可重跑升级脚本，不能因报对象存在而删库、删表。

在可信 SQL Editor或已有授权数据库管理通道执行，错误时停下并保留原始错误。标准迁移新增空 allowlist，默认拒绝全部应用业务访问，不创建 W、不设置密码、不处理旧业务归属。

### 4.2 可信 Auth 管理

1. 核实认证适配层固定内部登录标识对应的 Auth 身份；存在时保留其实际 UID，不重复创建；不存在时通过可信 Auth 管理入口创建，应用显示账号为 W。用户元数据可留空，不需要在 Dashboard 填写 `username`。
2. 在管理入口使用用户已指定的初始密码，并核对项目密码策略。拒绝时如实阻塞，不能自行放宽策略或修改约定密码。
3. 核验真实 UID和身份确认状态，确保密码登录可用。用户密码不进入源码、迁移、种子、部署变量或公开报告。
4. 关闭公开注册及不需要的匿名/其他身份入口。管理创建身份满足确认状态即可，不为旧 signUp流程盲目关闭 Confirm email。
5. 核对 `Site URL` 为真实 HTTPS域名，`Redirect URLs` 只包含所需的受信任地址。

### 4.3 写入受保护 UID 门禁

必须先完成第 4.2 节的可信 Auth 准备并核实用户名 `W` 对应的真实 UID，再由可信 SQL 管理入口将该 UID 写入 `private.account_allowlist`。旧数据方案也必须已经明确。该表为单行结构，外键关联 `auth.users(id)`，不能由前端或备份修改。

核对 allowlist恰好一行、UID属于已经核验的目标 Auth 身份；不能按可修改的 `user_metadata.username` 判断权限、猜测 W 的 UID、把旧本地 UID当成 Auth UID或自动选“第一个用户”。allowlist已有其他 UID时先处理已明确的数据与身份切换，不静默覆盖。应用通过 `getUser()` 验证身份，要求 `account_access()` 返回 `allowed=true` 且 UID 相符。

写入后再复核 Auth 的 Site URL、Redirect URLs、注册限制与密码策略，最后刷新 schema cache：

```sql
notify pgrst, 'reload schema';
```

## 5. 结构、RLS与 GRANT核验

不能只核对总数。预期结构为：

| 对象 | 预期 |
| --- | --- |
| public基表 | 12：profiles、sync_test_records、10张业务表 |
| public RLS策略 | 33：21条原owner策略 + 12条 restrictive account_uid_gate |
| private.account_allowlist | 1张表，RLS开启，无客户端策略及表读写授权；准备W后恰好1行 |
| 应用RPC | account_access、cloud_sync_summary、export_cloud_snapshot、import_local_backup |
| 四个应用RPC权限 | security invoker、空search_path；仅authenticated可EXECUTE |
| private.is_account_allowed() | 无参数，security definer、空search_path，仅按auth.uid()查门禁，不读业务 |
| 历史函数/触发器 | handle_new_user、复制RPC、owner触发器逐项核验客户端授权 |

使用只读查询核对表级 RLS、策略角色/USING/WITH CHECK、表与 schema权限、函数签名及 EXECUTE，确认 private表不能被 authenticated直接读写，anon不能访问业务或四个RPC。

通过受控的真实认证请求验证：

- W命中 allowlist且UID一致，`account_access` 返回 allowed=true。
- 旧 UID/JWT不命中门禁，查询不能读到业务，写入及导出/导入等RPC被拒。
- 伪造 `user_id`、子表父链或引用他人选项被拒；原 owner策略和子表约束仍有效。
- 备份 v3与本地字段一致，v1/v2导入不恢复旧身份，历史日期豁免不泄漏。

直接用管理员数据库连接查到数据不能代替 RLS验证；必须使用受限角色/真实 JWT的应用请求。测试数据与整体替换使用隔离样本并先保留备份，不能破坏用户当前数据。

## 6. Vercel发布

先核实既有 `.vercel/project.json`。缺少关联时通过已有Token核实team/project后再关联，不能默认另建新项目。部署脚本默认读取第1节受保护配置：

```bash
npm run deploy
```

当前 `scripts/deploy.mjs` 会：

1. 跑 typecheck、lint、build、verify:pwa。
2. **只读**核对12张public表、四个应用RPC、W的一行门禁、12条 restrictive策略和 invoker属性。
3. 写入Vercel Production两项前端构建变量。
4. 发布生产并检查首页、SW/manifest缓存头、assets长缓存及SPA深链接。

它**不执行数据库迁移或Auth管理**，也没有替代第5节完整RLS/GRANT核验。未满足前置会报错，不能跳过门禁继续发布。

`VITE_*` 在构建时内联，必须先配置再部署；变更后要重建。当前发布流程在Vercel远端构建，不能随手加 `--prebuilt` 绕过该流程。不要运行 `vercel login`，不要发布无Auth配置的本地密码版本。

## 7. 发布后真实验收

1. 同时核对部署URL和正式域名：HTTP正常、实际新版源码、JS/CSS资源类型、SPA深链接。
2. SW、manifest、index的缓存头为 `no-cache`，assets为 `immutable`；SW不缓存跨域Auth/API，旧版本waiting与用户刷新流程可用。
3. W正确密码登录，错误密码拒绝；无公开注册或补建云端身份入口。核对界面工作区UID、Auth UID和allowlist一致。
4. 退出并重登，同UID业务与待上传队列保留；刷新后持久会话真实校验。
5. 在新浏览器或测试设备登录W，首次恢复完成后才进入业务；检查已经上传的样本完整恢复。先确认独立备份，不清除含未上传编辑的唯一设备。
6. 断网使用已准备工作区，保存仍落本地且队列不丢；联网重验身份后上传。过期/撤销会话、门禁拒绝或恢复失败不能当成新的登录成功。
7. 再验证真实旧UID/JWT和伪造owner的读写边界；本地假Auth/假云端结果不能代替。
8. iOS/Android真机核对安装、独立窗口、软键盘、抽屉保存/取消和安全区。

脚本显示“部署完成”只代表其有限检查通过。以上有未完成项时分别标注，不能写“账号系统全部上线验收完成”。

## 8. 交付报告格式

```text
部署结果

- 部署状态：已发布并验收 / 已发布但部分未验证 / 阻塞且未发布
- 线上地址：
- 当前发布提交/源码版本：
- Supabase项目ref：
- 数据库迁移结果：实际执行文件与退出状态
- 表/RPC/RLS/GRANT：实际结果与未验证项
- W与门禁：真实UID核验、可信准备和密码策略结果（不写密码）
- Auth配置：公开注册限制、身份入口、Site URL/Redirect URLs
- Vercel环境：已核对目标Production配置并构建发布 / 未更新
- 首页/深链接/PWA缓存：逐项结果
- W登录、退出重登、新设备恢复、断网重验：逐项结果
- 旧UID/JWT门禁、子表owner验证：逐项结果
- 真机：实际设备与结果 / 未验证
- 用户仍需完成的具体操作：
- 未完成、失败或阻塞点：
```

不要贴Token、数据库URI、用户密码或管理员密钥；不要以本地HEAD代替未提交源码的发布版本。

## 9. 故障处置

| 现象 | 处置 |
| --- | --- |
| verify:local失败或仍见公开注册/双身份 | 回本地修复及第43份文档验收，停止生产部署 |
| 迁移对象冲突 | 审核真实迁移历史，只执行缺失项，不删表重跑 |
| auth schema权限不足 | 在已授权可信SQL Editor执行同一审核迁移，不以低权限绕过 |
| account_access缺失/schema cache错误 | 核实新增迁移与函数权限，刷新PostgREST cache |
| W创建或登录密码策略拒绝 | 报告项目实际拒绝原因，保持用户要求，待可信管理处置 |
| W登录却没有授权 | 核实邮箱、实际Auth UID、单行allowlist，不改客户端放行 |
| 首次恢复失败 | 保留失败状态，不当云端为空、不播种上传 |
| 正式域名仍显示旧壳 | 核对域名部署别名、资源哈希和SW waiting/刷新，不靠删业务缓存处理 |
| 无云端能力或配置错误 | 核对Production构建变量，重建发布 |
| 深链接/资源拿到HTML | 核对既有SPA/缓存配置，禁止public/_redirects和顶层404.html |
| CLI挂起 | 核实Token、非交互参数和项目关联，不运行vercel login |
