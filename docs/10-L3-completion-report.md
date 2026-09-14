# L3 完成报告：休息日与自由规划（2026-09-14）

## 1. 阶段目标

完成周末和临时不上班场景，不改变工作日规则。具体：

- 正常周六、周日自动出现「拖地」「洗衣」两个每日实例，仅需完成勾选。
- 工作日切换为休息日时，不自动加入拖地、洗衣。
- 休息日保留补剂、健身和自定义事项；隐藏不适用的工作日准备项。
- 休息日切换为工作日时，恢复完整工作日规划入口，并保留二次确认。
- 明确模式切换后已有内容的保留规则，并在界面给出一致提示。

## 2. 任务达成情况

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 1 | 周六/周日自动带家务 | ✅ | `ensureRestDayRoutines` 在数据加载时补齐「拖地 / 洗衣」两个每日实例 |
| 2 | 临时不上班不带家务 | ✅ | 判定「正常休息日」为 `mode === 'rest' && !mode_override`；人工覆盖时不补齐 |
| 3 | 休息日保留补剂/健身/自定义事项 | ✅ | 执行区 `mode === 'rest'` 时只显示补剂 + 健身；自定义事项始终显示 |
| 4 | 休息日隐藏工作日准备项 | ✅ | 准备区（衣服 / 三餐 / 晨间）只在 `mode === 'work'` 且 prepare tab 渲染 |
| 5 | 休息日切工作日保留二次确认 | ✅ | 沿用既有 `ConfirmDialog`，文案「幸福小Molly，今天要上班哦」 |
| 6 | 切换后内容保留规则 | ✅ | 家务数据保留不删除；临时不上班只隐藏，恢复默认后重新出现；复制昨天不碰家务 |

**全部 6 项任务已完成。**

## 3. 数据模型变更

### IndexedDB 迁移（v3 → v4）

`DB_VERSION` 由 3 提升至 4，新增一张对象仓库：

| 仓库 | 用途 | 主键 / 索引 |
|------|------|-------------|
| `routine_tasks` | 休息日固定家务（拖地 / 洗衣）的每日实例 | 自增 `id`，索引 `day_plan_id` |

迁移逻辑 (`MIGRATIONS[4]`)：只建表、不做数据搬迁（`stores: ['routine_tasks']`）。

### 类型变更

`dayPlan.ts` 新增：
- `RoutineKind`：`'mop' | 'laundry'`（拖地 / 洗衣）
- `RoutineTask`：`{ id, day_plan_id, kind, title, completed }`

家务是「每日实例」而非全局模板（docs/01 不变量 7）：只在正常休息日自动补齐，用户勾选完成，不修改任何全局选项。

## 4. 本次修改文件清单

### 新增文件（1 个）

| 文件 | 职责 |
|------|------|
| `src/features/day-plan/components/RoutineList.tsx` | 休息日家务列表（拖地 / 洗衣），只展示完成勾选 |

### 修改文件（8 个）

| 文件 | 变更摘要 |
|------|---------|
| `src/services/local/localDb.ts` | `DB_VERSION` 3→4；`STORES` 新增 `routine_tasks`；`MIGRATIONS[4]` 建表 |
| `src/services/local/dayPlanService.ts` | 新增 `listRoutineTasks` / `ensureRestDayRoutines` / `setRoutineCompleted`；复制昨天注释明确不碰家务 |
| `src/shared/types/dayPlan.ts` | 新增 `RoutineKind` / `RoutineTask` |
| `src/features/day-plan/useDayPlanData.ts` | load 时对正常休息日自动补齐家务（含创建 rest 计划）；新增 `routines` 状态 |
| `src/features/day-plan/DayPlanScreen.tsx` | 按 `mode` 分流渲染：休息日显示家务 + 补剂/健身/自定义事项，隐藏工作日准备项；新增 `toggleRoutine` |
| `src/features/day-plan/components/ExecuteList.tsx` | 新增 `mode` 参数，休息日隐藏三餐与晨间 |
| `src/features/day-plan/dayPlanLabels.ts` | 新增 `ROUTINE_TITLE` / `REST_NO_ROUTINE_NOTE` |
| `src/app/styles.css` | 新增 `.rest-note` 样式 |
| `scripts/verify-local.mjs` | 52→74 项；新增 L3 断言（家务实例化、临时不上班、隐藏准备项、勾选、恢复默认）+ v3→v4 冷升级 |
| `scripts/check-local-data.mjs` | 15→24 项；新增 v4 迁移断言 + `routine_tasks` 索引断言 |

## 5. 关键设计决策

| 决策 | 理由 |
|------|------|
| 家务补齐放在 `useDayPlanData.load` 里 | 数据加载流程有 `active` 保护，切换日期时旧 load 结果被丢弃，避免竞态重复写入。曾在 `DayPlanScreen` 用 `useEffect` 实现，出现「洗衣」重复（竞态），改到 load 后消除 |
| 「正常休息日」判定 = `mode === 'rest' && !mode_override` | 复用现有 `mode_override` 区分「本来周末」与「临时不上班」（docs/01 不变量） |
| 家务数据「保留不删除」 | 临时不上班只是隐藏家务，不删数据；恢复默认后家务重新出现，符合「切换不丢已有内容」 |
| 复制昨天不碰 `routine_tasks` | 家务是休息日按日生成的每日实例，复制语义不涉及；目标日家务由 `ensureRestDayRoutines` 独立管理 |
| 家务无编辑面板 | 拖地/洗衣是固定两项、仅勾选完成（docs/00「仅勾选完成」），无需用户安排 |

## 6. 验收证据

### 6.1 工程三件套

| 命令 | 结果 |
|------|------|
| `npm run typecheck` | ✅ 通过 |
| `npm run lint` | ✅ 通过 |
| `npm run build` | ✅ 通过，73 modules，`index-C8M8CvIZ.js` 251.34 kB（gzip 77.75 kB） |

### 6.2 本地数据结构回归

| 命令 | 结果 |
|------|------|
| `npm run check:dates` | ✅ 48/48 通过 |
| `npm run check:local-data` | ✅ 24/24 通过（DB_VERSION=4 自洽、v4 只建表不搬迁、11 张仓库定义一致、`routine_tasks` 带 `day_plan_id` 索引） |

### 6.3 浏览器闭环验收

| 命令 | 结果 |
|------|------|
| `npm run verify:local` | ✅ **74/74 通过**（桌面 1440x900 + 手机 390x844，无横向溢出，控制台无 error/warning） |

L3 新增 8 项断言：

1. 周六默认是休息日且无人工覆盖
2. 正常休息日自动出现拖地 / 洗衣两个实例
3. 休息日隐藏工作日准备项（衣服 / 三餐 / 晨间）
4. 家务可逐项勾选完成
5. 休息日切工作日有二次确认且文案正确
6. 临时不上班（人工切休息日）不自动带家务且显示说明
7. 休息日保留补剂 / 健身 / 自定义事项，隐藏工作日准备项
8. 恢复默认回到正常休息日并重新补齐家务

### 6.4 冷升级验证

v1 → v4 真实冷升级：老库 4 张表升级到 11 张表（含 `routine_tasks`），老数据仍可读，v3 的自由文本搬迁依然生效。

## 7. 本轮修复的缺陷

### 7.1 家务重复补齐（竞态）

**现象**：正常休息日打开时，家务列表出现「拖地、洗衣、洗衣」三条（洗衣重复），且不稳定复现。

**根因**：最初把家务补齐放在 `DayPlanScreen` 的 `useEffect` 里，`ensurePlan()` 内部的 `data.setPlan` 触发重渲染，与 effect 依赖的派生值 `restNeedsRoutines` 交互，在快速切换日期时产生竞态，`ensureRestDayRoutines` 被并发调用两次，第二次读到未提交的中间状态而重复写入。

**修复**：把家务补齐逻辑从 `useEffect` 移到 `useDayPlanData.load` 的数据加载流程中。load 本身有 `active` 标志保护（切换日期时旧结果被丢弃），补齐与加载在同一确定时序内完成，彻底消除竞态。

**附带修复**：渲染层原本无论 `mode_override` 是否 true 都渲染家务列表，改为临时不上班（`mode_override === true`）时不渲染家务、只显示说明文案。

## 8. 延后项

| 项 | 原因 | 建议处理阶段 |
|----|------|-------------|
| 家务的跨设备同步 | 本地优先方向，云端后置 | L6 |
| 拖地/洗衣的自定义（改名、增加其他家务） | 需求固定为两项，暂不做模板化 | 若产品提出再议 |
| 休息日"准备/执行"语义区分 | 休息日无五项准备，当前 prepare 与 execute tab 显示相同内容 | L4 移动端交互统一时一并处理 |

## 9. 未验证项

| 项 | 原因 |
|----|------|
| 云端一切（Supabase / RLS / 跨设备） | 本地优先方向，L6 前不接入 |
| 真机移动设备触摸交互 | 仅视口尺寸模拟 |
| 非 Chrome/Edge 浏览器 | 验收脚本依赖 CDP |
| L4–L6 全部功能 | 尚未实施 |

## 10. 结论

**L3 完成，可进入 L4。**

全部 6 项任务落地，`DB_VERSION` 升至 4（11 张表），验收基线为「三件套 + `check:dates` 48 项 + `check:local-data` 24 项 + `verify:local` 74 项」。休息日家务、临时不上班、模式切换后的内容保留规则均符合 docs/00 与 docs/01 不变量。后续阶段只应开始 L4（首页导航与移动端交互完善），不得回填或改写本阶段已验收的休息日边界。
