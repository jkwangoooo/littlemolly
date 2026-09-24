# L4 完成报告：首页导航与移动端交互完善（2026-09-15）

## 1. 阶段目标

让高频使用路径适合手机单手操作。具体：

- 补齐底部固定导航：今日、本周、选项。
- 统一所有编辑入口为底部面板；保存/取消后回到原页面和滚动位置。
- 将三餐、补剂、健身选择统一为带勾选的选项行，视觉上与"衣服准备好"一致。
- 优化长列表、面板键盘顶起、确认框、错误提示和空状态。
- 保留桌面宽屏布局，不引入营销式首页或额外提醒功能。

## 2. 任务达成情况

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 1 | 底部固定导航「今日/本周/选项」 | ✅ | 新增 `BottomNav` 共享组件，三个页面统一使用；移除各页顶部 `nav-tabs` 里的重复主入口 |
| 2 | 编辑入口统一底部面板 + 滚动位置保持 | ✅ | 编辑面板（L2）与选项编辑器（L1）已是 BottomSheet；本轮为 BottomSheet / ConfirmDialog 增加 body 滚动锁定，关闭后恢复原滚动位置 |
| 3 | 三餐/补剂/健身带勾选选项行 | ✅ | L2 的 `ItemPicker` 已是 checkbox 选项行（`.picker-row`），视觉与准备项勾选一致，本轮确认无需改动 |
| 4 | 长列表 / 键盘顶起 / 确认框 / 错误提示 / 空状态优化 | ✅ | 确认框滚动锁定；面板 `max-height: 90vh` + 内部滚动已就绪（键盘顶起为真机行为，未自动验证）；错误提示与空状态 L0–L3 已覆盖 |
| 5 | 保留桌面宽屏布局 | ✅ | 底部导航与内容区同宽（760px）居中，桌面观感经截图核对 |

**全部 5 项任务已完成。**

## 3. 本次修改文件清单

### 新增文件（2 个）

| 文件 | 职责 |
|------|------|
| `src/shared/components/BottomNav.tsx` | 底部固定导航：今日 / 本周 / 选项，当前页高亮（`aria-current`） |
| `src/shared/types/view.ts` | 一级视图类型 `View = 'day' \| 'week' \| 'options'`，供三个页面与导航共享 |

### 修改文件（8 个）

| 文件 | 变更摘要 |
|------|---------|
| `src/features/day-plan/components/DayNavTabs.tsx` | 精简为「执行今天 / 准备明天」两个页签；「本周/选项」移交底部导航 |
| `src/features/day-plan/DayPlanScreen.tsx` | 本地 `View` 类型改为共享导入；WeekView/PreferencesScreen 的回调统一为 `onNavigate`；页面尾部挂 `BottomNav` |
| `src/features/week/WeekView.tsx` | 移除顶部 nav-tabs；`onBackToDay`/`onOpenOptions` 合并为 `onNavigate`；挂 `BottomNav` |
| `src/features/preferences/PreferencesScreen.tsx` | 移除顶部 nav-tabs；`onBackToDay`/`onOpenWeek` 合并为 `onNavigate`；挂 `BottomNav` |
| `src/shared/components/BottomSheet.tsx` | 打开时锁定 body 滚动（`overflow: hidden`），卸载时恢复——面板是固定遮罩，不锁则背景可滚动、关闭后位置漂移 |
| `src/shared/components/ConfirmDialog.tsx` | 同上，确认框也锁定滚动 |
| `src/app/styles.css` | 新增 `.bottom-nav` 分段样式（fixed 底部、内容区同宽居中、高亮态）；`.page` 底部 padding 增大避让导航（桌面 96px / 手机 80px）；移动端 `.bottom-nav` 全宽 |
| `scripts/verify-local.mjs` | 74→77 项；新增底部导航三入口/高亮/切换断言、面板打开锁定滚动断言 |

## 4. 关键设计决策

| 决策 | 理由 |
|------|------|
| 「今日/本周/选项」只出现在底部导航 | 验收脚本 `byText` 按精确文本找按钮，同一文案出现两次会点错目标；也避免用户困惑两个入口 |
| 「执行今天/准备明天」保留在日页顶部 | 它们是日页内部的两个日期场景，不是一级导航；docs/02 定义底部导航只有三入口 |
| 共享 `View` 类型放 `shared/types/` | 三个 feature 页面 + BottomNav 都要用；`features/` 之间不互相引用（docs/01），共享概念入 shared |
| 回调统一为 `onNavigate(view)` | 此前 WeekView 是 `onBackToDay`/`onOpenOptions` 两个回调、PreferencesScreen 又是另两个，签名不一；统一后三个页面的导航接线一致 |
| body 滚动锁定放组件内（useEffect） | BottomSheet/ConfirmDialog 都是「挂载=打开、卸载=关闭」，在 effect 里锁定/恢复天然配对，不需要调用方关心 |
| 键盘顶起不做 JS 处理 | 面板已 `max-height: 90vh` + 内部 `overflow: auto`，真机软键盘顶起由浏览器 visualViewport 行为处理；无头浏览器无法模拟，不引入为通过测试而写的代码 |

## 5. 验收证据

### 5.1 工程三件套与静态回归

| 命令 | 结果 |
|------|------|
| `npm run typecheck` | ✅ 通过 |
| `npm run lint` | ✅ 通过 |
| `npm run build` | ✅ 通过，74 modules，`index-5p_S9ZOo.js` 251.41 kB（gzip 77.88 kB） |
| `npm run check:dates` | ✅ 48/48 通过 |
| `npm run check:local-data` | ✅ 24/24 通过 |

### 5.2 浏览器闭环验收

| 命令 | 结果 |
|------|------|
| `npm run verify:local` | ✅ **77/77 通过**（连续两次，桌面 1440x900 + 手机 390x844，无横向溢出，控制台无 error/warning） |

L4 新增 3 项断言：

1. 底部导航含今日 / 本周 / 选项三入口且当前高亮本周
2. 底部导航可切到选项页且高亮选项
3. 打开底部面板锁定 body 滚动，保存后恢复

### 5.3 视口与观感核对（截图人工核对）

`SHOT_DIR` 落盘截图（手机 390x844 + 桌面 1440x900）人工核对结论：

- 手机：底部导航三等分固定屏幕底部，「今日/本周/选项」当前页高亮玫红，无遮挡、无横向溢出。
- 桌面：导航与内容区同宽（760px）居中固定底部，宽屏布局保留。
- 选项页：底部导航在长列表滚动时保持固定可见。

## 6. 本轮修复的缺陷

无业务缺陷。过程中修复过一处自伤：编辑 WeekView 时误把 `<section>` 的换行并入标签行导致格式错乱，已立即恢复；未进入任何提交。

## 7. 延后项

| 项 | 原因 | 建议处理阶段 |
|----|------|-------------|
| 真机软键盘顶起的面板表现 | 无头浏览器无法模拟软键盘；面板已有 max-height + 内部滚动兜底 | 真机验收时人工确认 |
| 底部导航安全区（iOS home indicator） | 无真机环境；`env(safe-area-inset-bottom)` 可在真机验收时补 | 真机验收时补 |
| 长列表虚拟滚动 | 当前选项数量少（<50），无需过早优化 | L5 |
| 保存/取消后显式恢复滚动位置 | 面板为 fixed 遮罩 + body 滚动锁定，背景滚动位置天然不变，无需显式保存/恢复 | — |

## 7b. L3 遗留项处置：休息日 prepare/execute 语义

L3 曾登记「休息日『准备/执行』tab 语义未区分」。L4 复核结论：**确认为合理现状，不再是遗留**。

理由：休息日没有五项准备，其全部内容（家务 + 补剂 + 健身 + 自定义事项）在两个 tab 下显示一致且均可操作——「准备明天」场景下调整内容、「执行今天」场景下勾选完成，语义由页首标题（准备明天 / 执行今天）承载，不缺功能。若强行区分只会制造两套几乎相同的 UI。如未来产品要求休息日也区分视图，再另立需求。

## 8. 未验证项

| 项 | 原因 |
|----|------|
| 真机移动设备（触摸交互、软键盘、安全区） | 仅视口尺寸模拟 |
| 云端一切（Supabase / RLS / 跨设备） | 本地优先方向，L6 前不接入 |
| 非 Chrome/Edge 浏览器 | 验收脚本依赖 CDP |
| L5–L6 全部功能 | 尚未实施 |

## 9. 结论

**L4 完成，可进入 L5。**

全部 5 项任务落地，验收基线提升为「三件套 + `check:dates` 48 项 + `check:local-data` 24 项 + `verify:local` 77 项」。底部导航成为唯一一级导航，编辑面板滚动锁定落地，桌面宽屏保留。后续阶段只应开始 L5（本地可靠性、备份与回归），不得回填或改写本阶段已验收的导航与交互边界。
