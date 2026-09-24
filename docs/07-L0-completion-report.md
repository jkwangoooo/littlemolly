# L0 完成报告：本地基线整理与契约固定

- 日期：2026-09-14
- 阶段：L0（`docs/05-local-first-execution-plan.md`）
- 提交：`1802fe8` → `e8b4ec2` → `b3dcd15` → `1192cdb` → `b81bf71` → `baf78db` → `716ee35` → `4c936e0` → 本报告所在提交
- 结论：**L0 完成，可进入 L1。**

## 1. 一句话结论

本地模式的遗留命名与边界已清理干净，服务接口、存储升级机制、状态与验收都固定了下来；现有业务行为零回退，且第一次有了可重复执行的自动化验收（浏览器 23 项 + 日期规则 48 项）。

## 2. 任务完成情况

| 编号 | 任务 | 状态 | 证据 |
| --- | --- | --- | --- |
| L0-1 | 建立版本控制基线 | 已完成 | 重建 `.git` 并接上远端历史；公钥授权后 `git push -u origin main` 成功，远端与本地一致 |
| L0-2 | 云端实现归档 | 已完成 | 4 个 Supabase 文件移入 `src/services/cloud/` 并加冻结说明；核对无页面引用，且未被打入产物 |
| L0-3 | 遗留命名通用化 | 已完成 | `AuthSyncScreen` → `features/auth/AuthScreen.tsx`；错误标准化统一为 `shared/errors.ts`；`types/sync.ts` → `types/save.ts` |
| L0-4 | 固定服务契约 | 已完成（含一处有意收窄） | IndexedDB 建表收敛为按版本号递增的迁移表；`LocalStore` 联合类型不预先扩展，理由见 §6 |
| L0-5 | 补齐空状态 / 加载状态 / 只读状态 | 已完成 | 未来空日期引导、读取占位、自定义事项空态、周视图第四态「已完成」；只读与重试沿用既有实现 |
| L0-6 | 可重复验收 | 已完成 | `npm run verify:local`（23 项）+ `npm run check:dates`（48 项），均零第三方依赖 |

## 3. 实际证据

### 3.1 工程三件套

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，无输出 |
| `npm run lint` | 通过，无输出 |
| `npm run build` | 通过，53 modules，`index.js` 223.09 kB（gzip 70.08 kB）、`index.css` 5.98 kB |

### 3.2 浏览器闭环验收 `npm run verify:local`：23/23 通过

覆盖：登录页 → 注册 → 周视图固定 7 天 → 历史日只读且无模式切换 → 模式切换确认与生效 → 恢复默认清除人工覆盖 → **未来空日期显示「准备这一天」引导** → 目标日确认为工作日 → 三餐编辑保存 → **计划保存后引导自动消失** → 准备项勾选与进度 1/5 → 健身面板保存 → 自定义事项新增 / 编辑 / 删除二次确认 → 复制昨天带内容不带准备勾选 → **复制昨天不改目标日模式与人工覆盖** → 刷新后会话与本地内容恢复 → 桌面 1440x900 无横向溢出（`scrollWidth=1425`）→ 手机 390x844 无横向溢出（`scrollWidth=390`）→ 退出登录 → 控制台无 error / warning。

脚本自带临时 Vite 开发服务器（空闲端口 + `--strictPort`），结束时按 PID 回收，跑完端口已确认释放。

### 3.3 日期规则回归 `npm run check:dates`：48/48 通过

直接导入 `src/shared/date/dateUtils.ts`（Node 22.18+ / 24 原生剥离类型，不需要构建产物）。覆盖：

- 一周七天固定、升序、无重复、首日为周一（含 7 个跨月 / 跨年 / 闰年样例）；跨年周 `2027-01-01 → 2026-12-28 至 2027-01-03`、`2028-01-01 → 2027-12-27 至 2028-01-02`。
- `addDays` 的月末、年末、闰日进位与回退。
- `defaultModeForDate` 周一至周五 `work`、周六周日 `rest`（docs/05 要求「默认模式」判定）。
- `classifyDate` 的 today / tomorrow / future / history，含跨年。
- `parseDateKey` 拒绝 `2026-02-30`、`2027-02-29`、`2026-13-01`、非补零格式与空串，确保非法日期不会被静默滚动成别的日期。

### 3.4 结构卫生核对

- TSX 类名与 `styles.css` 双向比对：无缺定义、无死样式。
- `src/` 全量扫描 `console.log` / `TODO` / `FIXME` / `@ts-ignore` / `@ts-nocheck` / `eslint-disable` / `any` 零命中。
- 产物中检索 `supabase` / `PostgREST` / `GoTrueClient` / `copy_yesterday_stage3` 均 0 命中，确认冻结的云端层被 tree-shaking 剔除。

## 4. 结构变化

整理前 `DayPlanScreen.tsx` 是 58 行、最长单行 **2109 字符**，`WeekView.tsx` 最长单行 1323 字符。整理后：

```text
src/
  app/          App.tsx（会话门禁）、styles.css（9 个编号分区）
  features/
    auth/       AuthScreen.tsx（仅表单）
    day-plan/   DayPlanScreen.tsx（361 行纯编排）
                components/  DateHeading、DayNavTabs、SaveStatusBar、ModeCard、
                             PrepList、ExecuteList、CustomTaskList、EditorSheet、EmptyDayHint
                dayPlanLabels.ts、useDayPlanData.ts、useSaveRunner.ts
    week/       WeekView.tsx、weekStatus.ts
  services/
    local/      localDb（显式迁移表）、sessionStore、authService、dayPlanService
    cloud/      L6 前冻结，不参与运行时不进产物
  shared/       components/、errors.ts、date/、types/
scripts/        verify-local.mjs、check-date-rules.mjs
```

约定：`features/` 之间不互相读写内部状态；页面只经 `services/` 读写；会话只由 `app/App.tsx` 持有，读写统一走 `sessionStore`；编排页只串流程，展示进 `components/`，文案进 `*Labels.ts`。

## 5. 本阶段发现并修复的缺陷

| 编号 | 问题 | 处置 |
| --- | --- | --- |
| R2 | Supabase 遗留代码混在 `services/` 根目录，实际是死代码但删了会永久丢失 | 移入 `services/cloud/` 归档并加冻结说明 |
| R4 | `onupgradeneeded` 用散装 `if (!contains)`，新增仓库时老库不会升级 | 收敛为 `STORES` + `MIGRATIONS` 版本表；四步流程写入文件头注释 |
| R5 | 周视图缺 docs/02 要求的第四种状态「已完成」 | 新增 `weekStatus.ts`，判定顺序：历史 > 未规划 > 今天执行中 > 已完成 > 待准备 |
| R6 | 本地与云端两套错误标准化，本地版会丢 `code/details/hint` | 统一为 `shared/errors.ts` |
| — | 拆分时写出非法标识符 `const target-meal`，自定义事项漏挂勾选处理 | 改为 `const meal` 并补 `toggleTask()` |
| — | `signUp` 返回类型收紧后 `AuthScreen` 类型不兼容 | 改为直接 await 后给固定文案 |
| — | `App.tsx` 硬编码事件名 `'molly-auth-change'`，与常量存在漂移风险 | 改为导入 `AUTH_CHANGE_EVENT` |
| — | 验收脚本固定连 `127.0.0.1:5173`，该端口常被别的服务占用，会**验收错误对象** | 改为申请空闲端口自建服务器 |
| — | 两个共享弹层组件在某次丢失 `.git` 期间从未被提交，远端一直缺文件 | 首次纳入版本控制 |

## 6. 有意延后与未做的事

- **`LocalStore` 联合类型不预先扩展**（L0-4 的原始措辞是「扩展为含未来 7 类仓库的联合类型，先不建表」）。理由：那会留下 7 个无人使用的空接口，反而掩盖真实契约。改为与 L1 的实际建表同时落地——`localDb.ts` 顶部已写明新增仓库必须走满的四步。
- **R3（本地对象仓库少于 `docs/01` 数据契约）**：属 L1/L2 主体工作量，不在 L0 范围。
- **R8（`@supabase/supabase-js` 仍是生产依赖）**：运行时用不到，已被 tree-shaking 剔除；L6 恢复云端时自然需要，仅记录。
- **加载态未做自动断言**：IndexedDB 读取近乎瞬时，占位文案一闪而过，硬断言只会引入不稳定用例。已实现并在真机确认，但**不作为自动化验收项**，这里如实标注。
- **跨年周无法通过浏览器验收**（周视图只显示当前一周，没有翻页入口），因此改用 `check:dates` 在日期工具层覆盖，而不是改动页面行为去制造样例。

## 7. 新发现，建议下阶段处理

**R9（低）：切换日期后保存状态文案会残留上一天的结论。** `useSaveRunner.resetForDateChange` 有意只清 `retryRef` 与 `saveError`、不重置 `status`，因此在 A 日期保存后再切到空白的 B 日期，顶部仍显示「本地保存状态：已保存」。此时 `canRetry` 为 false、也没有错误横幅，所以只是文案误导，不会误报成功或失败。因为 L0 约定「不改任何业务行为」，本次未改；建议在 L1 触碰保存层时一并处理（切日期回到「尚未修改」）。

## 8. 未验证项

- L1–L6 全部功能。
- 云端相关一切（本地优先方向下本就不在本轮范围）。
- 跨浏览器差异：验收只跑本机 Chrome/Edge 的无头内核，未在 Safari / Firefox 验证。
- 真实移动设备：视口用 `Emulation.setDeviceMetricsOverride` 模拟，未在真机验证。

## 9. 下一步

L1 进入条件已满足。建议按 `docs/05` 开始 **L1：选项管理与本地数据结构**，第一步是把 `food_options`、`supplement_templates`、`exercise_options` 三类对象仓库按 `localDb.ts` 的四步流程落库，并同时定稿 `LocalStore` 联合类型与选项服务接口；选项改名 / 停用必须保存名称快照，不得改写历史计划。
