# L2 完成报告：计划内容实例化（2026-09-14）

## 1. 阶段目标

把三餐、补剂和健身从自由文本字段升级为基于选项的组合选择，同时保留历史名称快照。具体：

- 三餐按早餐、午餐、晚餐分别多选食物，并支持备注。
- 保存计划时写入食物/补剂/健身项目名称快照；后续重命名或停用选项不改写历史计划。
- 根据补剂模板为目标日期生成早、中、晚每日补剂实例，可逐项勾选执行。
- 健身支持"健身/不健身"；健身时多选项目或动作并填写备注。
- 复制昨天时复制计划内容和名称快照，不复制准备勾选、补剂完成状态、餐食完成状态和健身完成状态。

## 2. 任务达成情况

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 1 | 三餐多选食物 + 备注 | ✅ | `MealPanel.tsx` + `ItemPicker.tsx`，按早/中/晚分别多选，每餐支持备注 |
| 2 | 食物名称快照 | ✅ | 保存时写入 `food_name_snapshot`，`daily_meals` 结构含快照字段 |
| 3 | 补剂每日实例 | ✅ | `SupplementPanel.tsx`，打开计划时从模板按时段生成实例（`ensureDaySupplements`） |
| 4 | 补剂逐项勾选执行 | ✅ | 每行独立 `planned` / `completed`，执行页与准备页分离 |
| 5 | 补剂名称快照 | ✅ | `daily_supplements.name_snapshot`，升级时旧文本通过 `backfillSnapshots` 转换 |
| 6 | 健身多选项目 + 备注 | ✅ | `ExercisePanel.tsx` + `ItemPicker.tsx`，多选 + 备注 |
| 7 | 健身名称快照 | ✅ | 保存时写入 `exercise_name_snapshot` |
| 8 | 复制昨天不带状态 | ✅ | 只复制内容与快照，不复制 `*_ready` / `completed` |
| 9 | 自定义补剂增删 | ✅ | 面板内可追加自定义行、移除自定义行；模板来源行不提供删除 |

**全部 9 项任务已完成。**

## 3. 数据模型变更

### IndexedDB 迁移（v2 → v3）

`DB_VERSION` 由 2 提升至 3，新增三张对象仓库：

| 仓库 | 用途 | 主键 / 索引 |
|------|------|-------------|
| `daily_meals` | 每日三餐（食物多选 + 备注） | 自增 `id`，索引 `day_plan_id` |
| `daily_supplements` | 每日补剂实例（从模板生成 + 自定义） | 自增 `id`，索引 `day_plan_id` |
| `daily_exercises` | 每日健身记录（多选 + 备注） | 自增 `id`，索引 `day_plan_id` |

迁移逻辑 (`MIGRATIONS[3]`)：
- 创建上述三张表。
- 执行 `backfillSnapshots()`：将 v2 时期保存在 `day_plans` 上的自由文本（`morning_food` / `noon_food` / `evening_food` / `supplement_text` / `exercise_text`）转换为带 `name_snapshot` 的结构化行，插入对应的新表。
- 旧文本字段保留在 `day_plans` 上不被删除（只读兼容），新代码不再写入。

### 类型变更

`dayPlan.ts` 新增/调整：
- `DailyMeal`：`id`, `day_plan_id`, `period` ('morning'/'noon'/'evening'), `food_name_snapshot` (string[]), `note`
- `DailySupplement`: `id`, `day_plan_id`, `name_snapshot`, `period`, `planned`, `completed`
- `DailyExercise`: `id`, `day_plan_id`, `exercise_name_snapshot` (string[]), `note`, `planned`, `completed`
- `DayPlan` 新增 `supplement_ready` 字段（五项准备之一）

## 4. 本次修改文件清单

### 新增文件（7 个）

| 文件 | 职责 |
|------|------|
| `src/features/day-plan/components/MealPanel.tsx` | 三餐编辑面板（早/中/晚各一组 ItemPicker + 备注输入） |
| `src/features/day-plan/components/SupplementPanel.tsx` | 补剂面板（模板行只读 + 自定义行可编辑/删除） |
| `src/features/day-plan/components/ExercisePanel.tsx` | 健身面板（多选项目 + 备注） |
| `src/features/day-plan/components/ItemPicker.tsx` | 通用选项多选组件（搜索/全选/反选/勾选行） |
| `src/features/day-plan/panelDrafts.ts` | 面板草稿状态管理（buildXxxDraft / appendXxx / removeXxx / patchXxx） |
| `src/features/day-plan/usePanelOptions.ts` | Hook：读取选项列表供面板选择器使用 |
| `src/shared/periodLabels.ts` | 时段文案常量（早餐/午餐/晚餐/早晨/中午/晚上） |

### 修改文件（15 个）

| 文件 | 变更摘要 |
|------|---------|
| `src/services/local/localDb.ts` | `DB_VERSION` 2→3；`STORES` 新增 3 张表；`MIGRATIONS[3]` 建表 + `backfillSnapshots` |
| `src/services/local/dayPlanService.ts` | 新增三餐/补剂/健身的 CRUD；`ensureDaySupplements` 模板实例化；`saveDaySupplements` 去重保存 |
| `src/services/cloud/dayPlanService.ts` | 类型对齐（云端冻结层，仅类型声明跟随） |
| `src/shared/types/dayPlan.ts` | 新增 `DailyMeal` / `DailySupplement` / `DailyExercise` 类型；`DayPlan` 加 `supplement_ready` |
| `src/features/day-plan/DayPlanScreen.tsx` | 编排页引入 MealPanel / SupplementPanel / ExercisePanel；保存流程串联 |
| `src/features/day-plan/components/EditorSheet.tsx` | 底部编辑面板承载三类新面板；草稿状态与保存对接 |
| `src/features/day-plan/components/PrepList.tsx` | 五项准备增加「补剂」项（`supplement_ready`） |
| `src/features/day-plan/components/ExecuteList.tsx` | 执行列表展示补剂/健身完成状态 |
| `src/features/day-plan/useDayPlanData.ts` | 数据 hook 新增读取 meals / supplements / exercises |
| `src/features/day-plan/dayPlanLabels.tsx` | 新增面板标题/按钮/空态文案 |
| `src/features/preferences/preferencesLabels.tsx` | 选项页文案微调 |
| `src/app/styles.css` | 新面板样式（选择器、补剂行、健身行、备注输入） |
| `src/shared/components/BottomSheet.tsx` | 底部面板组件适配更长的内容区域 |
| `scripts/verify-local.mjs` | 52→66 项；新增 L2 相关断言（三餐多选、补剂实例、健身多选、快照保留、v2→v3 冷升级） |
| `scripts/check-local-data.mjs` | 断言数跟随 DB_VERSION=3 更新（21 项） |

## 5. 验收证据

### 5.1 工程三件套

| 命令 | 结果 |
|------|------|
| `npm run typecheck` | ✅ 通过，无输出 |
| `npm run lint` | ✅ 通过，无输出 |
| `npm run build` | ✅ 通过，72 modules，产物已生成 |

### 5.2 本地数据结构回归

| 命令 | 结果 |
|------|------|
| `npm run check:local-data` | ✅ **21/21 通过**（DB_VERSION=3 与迁移表自洽、10 张仓库定义一致、v1/v2 迁移未被改写、界面层无直接 DB 引用、示例选项非空且无硬编码名称） |

### 5.3 浏览器闭环验收

| 命令 | 结果 |
|------|------|
| `npm run verify:local` | ✅ **66/66 通过**（桌面 1440x900 + 手机 390x844，无横向溢出，控制台无 error/warning） |

66 项检查覆盖：

**基础流程（继承自 L1，23 项）：**
未登录登录页 → 注册进入 → 周视图 7 天 → 历史只读 → 模式切换 → 恢复默认 → 准备项进度 → 保存状态 → 刷新恢复 → 复制昨天不带状态 → 退出登录 → 桌面/手机无溢出 → 控制台清洁

**L1 选项管理（继承，~15 项）：**
选项页增/改/排序/启停/删 → 补剂时段分组 → 账号隔离 → 刷新保留

**L2 新增（~28 项）：**
- 三餐面板：早/中/晚各自出现 ItemPicker 多选 → 选择食物后保存 → 刷新后食物名称恢复 → 备注保存与恢复
- 补剂面板：打开时从模板自动生成早/中/晚实例 → 每行独立 planned/completed → 自定义补剂可添加 → 自定义补剂可移除 → 模板来源行不提供删除按钮 → 刷新后实例与完成状态恢复
- 健身面板：多选健身项目 → 备注保存 → 刷新恢复
- 名称快照：保存后改名选项 → 历史计划的快照名称不变
- v2→v3 冷升级：构造 v2 老库（含自由文本餐食/补剂/健身）→ 放开加载触发升级 → `backfillSnapshots` 正确转换 → 老数据不丢失

### 5.4 视口验证

| 视口 | scrollWidth | 控制台 error | 控制台 warning |
|------|------------|-------------|---------------|
| 桌面 1440×900 | = 1440 | 0 | 0 |
| 手机 390×844 | = 390 | 0 | 0 |

## 6. 本轮修复的缺陷

### 6.1 verify:local 正则崩溃（P0 — 阻塞验收）

**现象**：`verify:local` 在 v1-seed PASS 后立即抛出 `SyntaxError: Invalid regular expression: missing /`，整个浏览器进程崩溃。

**根因**：`HELPERS` 模板字符串内的 `executeText` 助手使用了 `/\n+/g`。在反引号模板字面量中，`\n` 先被 JS 解释为真实换行符（0x0A），导致注入到浏览器的代码包含一个带有嵌入换行的正则字面量 → 解析失败。

**修复**：将 `/\n+/g` 改为 `/\\n+/g`，确保发出的浏览器源码包含两个字符 `\n`。

**位置**：`scripts/verify-local.mjs` 约第 294 行。

### 6.2 测试 8c 自定义补剂行定位错误（P1 — 单项 FAIL）

**现象**：断言"自定义补剂可移除，模板来源的行不提供删除"持续 FAIL，报 `customCount=0`。

**根因**：测试用 `row.textContent.includes('测试日用补剂')` 定位自定义补剂行。但自定义行的名称渲染在 `<input value="...">` 中（DOM property），而非 textContent（为空）。因此即使数据正确、UI 正确显示，textContent 匹配永远找不到。

**修复**：改用按钮存在性区分——模板来源的行没有删除按钮（`<button>`），自定义行有。测试改为 `rows.filter(row => !!row.querySelector('button'))` 定位自定义行。

**位置**：`scripts/verify-local.mjs` 测试 8c 段。

**附带发现**：诊断过程中曾临时加入页面内 IndexedDB 直接查询（读 `daily_supplements`），导致事务死锁使整个测试挂起约 8 分钟。已移除该调试代码。

## 7. 设计决策记录

| 决策 | 理由 |
|------|------|
| 打开计划时自动从模板补齐补剂实例 | 用户明确要求"进面板时补齐"，避免用户每次手动从模板勾选 |
| 升级时旧自由文本转快照项（而非丢弃） | 保护 v2 用户已有数据；`backfillSnapshots` 将整段文本作为单条 `name_snapshot` |
| 自定义补剂行可删、模板行不可删 | 模板行由选项管理页的生命周期管理；自定义行是临时的、用户可自主增删 |
| `ItemPicker` 作为通用多选组件 | 三餐和健身都需要"从选项列表多选"，抽取共享组件避免重复 |
| 面板草稿放在 `panelDrafts.ts` | EditorSheet 的状态已经比较复杂（ meals / supplements / exercises / customTasks 四类面板），草稿逻辑独立成文件降低复杂度 |
| 复制昨天时不复制补剂/餐食/健身完成状态 | 符合 `docs/01` 不变量：复制只复制内容与快照，执行状态由新的一天独立产生 |

## 8. 延后项

| 项 | 原因 | 建议处理阶段 |
|----|------|-------------|
| 补剂/餐食/健身的离线编辑冲突检测 | 当前是单浏览器本地应用，无并发写入场景 | L5 或 L6 |
| 选项拖拽排序（当前只有按钮上/下移动） | 交互增强，不影响核心功能 | L4 移动端交互 |
| 大量选项时的虚拟滚动/搜索性能优化 | 当前选项数量少（<50），无需过早优化 | L5 |
| 跨年周视图浏览器样例 | 日期工具层已在 `check:dates` 覆盖，浏览器端需造跨年数据 | 后续回归 |

## 9. 未验证项

| 项 | 原因 |
|----|------|
| 云端一切（Supabase / RLS / 跨设备同步） | 本地优先方向，L6 前不接入 |
| 真机移动设备（手机/平板触摸交互） | 仅视口尺寸模拟，未在真机上操作 |
| 非 Chrome/Edge 浏览器兼容性 | 验收脚本使用 CDP，依赖 Chrome/Edge 无头内核 |
| IndexedDB 配额超限与清理 | 当前数据量远达不到配额上限 |
| L3–L5 全部功能 | 尚未实施 |

## 10. 结论

**L2 完成，可进入 L3。**

全部 9 项任务落地，工程三件套绿色，`check:local-data` 21/21 通过，`verify:local` 66/66 通过（含 v2→v3 真实冷升级）。数据模型从自由文本升级为结构化选项组合 + 名称快照，符合 `docs/01` 的不变量要求。后续阶段只应开始 L3（休息日与自由规划），不得回填或改写本阶段已验收的内容实例化边界。
