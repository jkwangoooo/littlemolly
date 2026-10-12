# 幸福小Molly部署指南

本项目部署到 Vercel 前端与 Supabase Auth/Postgres。**认证必须配置 Supabase**；IndexedDB 继续承担业务唯一写入落点，暂时断网可使用已准备的缓存工作区。

**2026-10-13 本地账密改造、自动验收与文档收口已完成；目标 Supabase 项目已应用账号门禁迁移，但 W 账号准备、allowlist 写入、Vercel 环境更新和发布尚未完成。** 线上域名为 `https://molly.lightwavecommunity.site`，现有线上提交和真实项目配置尚未完整验证。操作执行者先读 [本地实施与部署交接](docs/44-账密改造本地实施与部署交接.md)、[部署执行说明](docs/27-deploy-runbook-for-codex.md) 和 [账密改造详细执行文档](docs/43-账密改造详细执行文档.md)。

生产数据库迁移已应用账号门禁迁移；W 准备、真实 W UID、allowlist、完整结构权限核验、Auth 配置、Vercel Production 变量更新、线上浏览器、账号链路和真机验收仍未完成。后文是待执行流程，不能据此判定生产已经完成。

## 1. 发布前核实

1. 核对最终本地实施提交与第 44 份文档的验收记录。本轮类型、静态、构建、浏览器、PWA、同步、SQL，以及认证并发、旧工作区迁移和部署凭据护栏均已通过；目标项目的账号门禁迁移已应用，源码或远端结构变动后按部署执行说明重跑对应检查，失败时停在本地修复。
2. 核实现有 Vercel 项目关联、Supabase 项目 ref、数据库迁移历史和当前线上版本，避免新建或覆盖错项目。
3. 盘点旧本地 owner、旧 Auth UID、云端业务数据和独立备份；明确 W 采用哪个真实 Auth UID及旧数据去向。身份停用与业务删除是两件事，不能因为账号只剩 W 自动删除或合并旧业务数据。
4. 本机已有四项所需凭据。继续使用仓库外受保护的 `C:/Users/Administrator/.happy-little-molly/deploy.env`，或 `MOLLY_DEPLOY_CONFIG` 指定的文件，不重复提供、不把值贴进对话或源码。

| 所需字段 | 用途 |
| --- | --- |
| `VERCEL_TOKEN` | 已有 Vercel 项目、Production 配置与发布 |
| `SUPABASE_DB_URL` | 已授权的数据库管理与只读核验 |
| `VITE_SUPABASE_URL` | 前端 Auth/API 构建期 URL |
| `VITE_SUPABASE_ANON_KEY` | 公开 legacy anon JWT 或 `sb_publishable_` key；沿用现有变量名 |

前端只允许 anon/publishable key，禁止 `service_role` / `sb_secret_` 管理员 key 或密码进入 `VITE_*`、源码、种子和公开文档。

部署脚本在读写配置前核验真实路径，拒绝仓库内路径，以及通过 junction、有效或悬空链接、多级链接指向仓库的路径；链接循环或嵌套过深也会失败。`MOLLY_DEPLOY_CONFIG` 指定的文件同样必须在仓库外。2026-10-13 部署凭据护栏专项 **20/20 通过**；Windows 无文件符号链接权限时，文件链接使用 API 模型夹具，目录 junction 仍实测文件系统。专项不读取真实凭据、不执行部署，不证明生产配置已经可用。

## 2. 数据库迁移

当前目录有 **7 个顺序迁移**，新增文件是 `database/migrations/20261011183805_account_identity_gate.sql`。`deploy/supabase-all-migrations.sql` 是仅供空项目初始化的完整合并文件：

- **空库初始化**：审核目标后按文件名顺序执行全部迁移，或执行完整合并文件。
- **已有项目升级**：先查已执行迁移和实际结构，只执行缺失且已审核的迁移。已执行前六个迁移的项目只需新增门禁迁移，不能盲目重跑完整合并文件。
- 按可信 Supabase SQL Editor 或已授权数据库管理通道操作；权限错误、对象冲突或迁移失败立即停下核对，不用删除表绕过。

迁移后预期 **12 张 public 表、4 个应用 RPC、33 条 public RLS 策略**。其中每张 public 表都有一条 restrictive `account_uid_gate`，原 owner 策略继续生效；`private.account_allowlist` 开启 RLS，无客户端策略和读写权限。

四个应用 RPC 为 `account_access`、`cloud_sync_summary`、`export_cloud_snapshot`、`import_local_backup`，均 `security invoker`、空 `search_path`，只授予 authenticated 执行权限。原有复制 RPC 与触发器也需核对权限，不能只看四个名称存在。

迁移允许在 W 尚未创建时执行，门禁初始为空并拒绝所有业务访问。它不会创建账号、重设密码或决定旧数据归属。

## 3. 可信准备 W

在已授权的 Supabase Auth 管理入口创建或核实唯一目标账号：

1. 登录界面账号 `W`，内部 Auth 邮箱 `w@molly.local`；用户名元数据可设为 `W`。
2. 使用用户已指定的初始密码，在可信管理入口设置并检查项目密码策略。若策略拒绝则如实报告，不能自行降低策略或替换密码。
3. 核实并记录实际 Auth UID；保留同一 UID，避免因删号重建而丢失资料关联。
4. 确保管理创建的身份满足邮箱确认要求；不使用前端公开注册来准备账号，也不把“关闭 Confirm email”当成必需步骤。
5. Auth 用户真实存在后，把实际 UID 写入受保护的 `private.account_allowlist`，核对恰好一行且关联 `w@molly.local`。
6. 写入门禁后复核公开注册限制、本项目不需要的匿名/其他身份入口、密码策略，以及使用真实上线域名的 `Site URL` 与 `Redirect URLs`，最后刷新 PostgREST schema cache。

旧 UID 即使已有未过期 JWT，也必须受 RLS 门禁限制。需要停用旧 Auth 身份时按已确认的保留与迁移方案处理，不能顺带删除其业务数据。

用数据库管理员连接确认表、策略或数据存在，只证明结构和管理访问可用。真实 Auth/RLS 验收必须使用受限角色或真实用户 JWT 的应用请求；旧 UID 对查询应读不到业务数据，写入和受保护 RPC 应被拒。门禁 UID、owner 与子表父链都要分别核验。

## 4. Vercel 发布

沿用已有 `.vercel/project.json` 项目关联和本机受保护 Token，不运行交互式 `vercel login`。若关联缺失，先核实预期 team/project 后在可信管理通道关联；不能默认新建同名项目。

数据库及 W 完成准备、权限核验通过后运行：

```bash
npm run deploy
```

脚本依次执行类型、静态、生产构建、PWA 检查；只读核验数据库结构和 W 门禁；写入 Production 的 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`；发布并检查基本 HTTP 与缓存规则。它不执行迁移或 Auth 管理操作，前置不满足会失败。

`VITE_*` 是构建期内联变量，**先配置再发布，变更后必须重新构建部署**。本次统一账号需求下，不发布无 Auth 配置的“纯本地登录版”。不要把脚本的“部署完成”输出当成完整账号链路已验收。

## 5. 线上验收

| 检查 | 必须验证的结果 |
| --- | --- |
| 首页与深链接 | 正常渲染新版登录界面和 SPA，静态资源类型正确 |
| PWA 缓存 | SW/manifest/index `no-cache`，assets `immutable`，不缓存跨域 Auth/API 响应 |
| W 登录 | 正确密码成功，错误密码失败，显示唯一 W 身份并完成工作区准备 |
| 退出后重登 | 同一 Auth UID、业务数据与待上传队列保持，不能再次注册或补建身份 |
| 新设备/清缓存 | 使用测试设备及已上传样本，认证后恢复同 UID 数据；恢复失败不开业务页 |
| 断网与重验 | 已准备缓存可保存，暂不上传，联网身份重验后补传 |
| 旧身份门禁 | 旧 UID/JWT、匿名与伪造 owner 对表和 RPC 的读写被拒 |
| RLS 与 GRANT | 逐表 owner/子表父链、restrictive 门禁、函数及 private 权限均符合预期 |
| 业务备份 | v3 无凭据，v1/v2 只恢复业务，历史日期数据往返可用 |
| 真机 | 安装、独立窗口、软键盘、抽屉按钮和安全区实际可用 |

清缓存测试先确认云端样本和独立备份存在，优先在新浏览器或测试设备执行。未经上传且被清除的本地编辑不能凭账号恢复。

## 6. 回报

逐项报告部署状态、线上 URL、已发布提交/版本、项目 ref、迁移、表/RPC/RLS/GRANT、Vercel 环境配置、缓存头，以及登录、重登、恢复和真机结果。未验证就写「未验证」，失败就写实际原因；本地假云端通过不等于生产通过。
