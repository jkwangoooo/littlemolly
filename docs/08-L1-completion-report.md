# L1 完成报告：选项管理与本地数据结构

- 日期：2026-09-14
- 阶段：L1（`docs/05-local-first-execution-plan.md` §5）
- 提交：`6408eb0`（本报告与 L1 代码、回归脚本同一提交）
- 结论：**L1 完成，可进入 L2。**

## 1. 一句话结论

三类可复用选项（常用食物 / 固定补剂 / 健身项目）已经按用户隔离落进 IndexedDB，选项页能新增、改名、排序、启停、删除并带二次确认，示例选项放在服务层而不是页面里；同时补上了 L0 报告的 R9，并第一次给出了「老库冷升级不丢数据」的自动化证据。

## 2. 任务完成情况

| 编号 | 任务（docs/05 L1） | 状态 | 证据 |
| --- | --- | --- | --- |
| L1-1 | 新增 `food_options`、`supplement_templates`、`exercise_options` 本地对象仓库 | 已完成 | `localDb.ts`：`DB_VERSION` 1→2、`LocalStore` 扩到 7 类、`STORES` 三条定义（均带 `user_id` 索引）、`MIGRATIONS[2]` 登记三表。浏览器冷升级实测 `version=2` 且七张表齐备 |
| L1-2 | 每类支持新增、重命名、排序、启用/停用 | 已完成 | `optionService.ts`：`createOption` / `renameOption` / `moveOption` / `setOptionActive`，全部按 `user_id` 过滤。浏览器实测新增落末位、上移换位、改名只改目标项、停用保留在清单 |
| L1-3 | 补剂模板包含名称与早/中/晚时段 | 已完成 | `SupplementTemplate.period` + `SUPPLEMENT_PERIODS`；新增面板强制选时段；补剂排序 = 时段 → `sort_order`，跨时段不给换位。实测新增「中」时段补剂后清单为 `维生素 D、鱼油、测试补剂、钙片` |
| L1-4 | 选项页支持空状态、编辑、删除或停用确认 | 已完成 | `PreferencesScreen` + `components/OptionSection`（空态）/ `OptionRow` / `OptionEditor`（`BottomSheet`）/ `ConfirmDialog`（停用与删除各一句独立文案）；整页零选项时另有「载入示例选项」入口 |
| L1-5 | 默认提供少量可编辑的示例选项，且不写死在页面逻辑中 | 已完成 | 种子在 `services/local/optionSeed.ts`，注册时幂等播种；`npm run check:local-data` 静态断言 `src/app`、`src/features` 中零命中任何示例名称 |

### 验收对照（docs/05 L1「验收」）

| 验收项 | 结论 | 依据 |
| --- | --- | --- |
| 新增和修改立即生效 | 已验（同源口径） | L2 的选择器尚不存在，因此选项页显示的「启用 N 项」直接取自 L2 将要调用的 `listSelectableOptions()`，两边同源；新增 / 改名 / 停用后该计数与清单立即刷新 |
| 停用项不出现在新计划选择器中 | 已验（同源口径） | 同上：停用后 `listSelectableOptions()` 结果减少，页面计数由 `启用 6 项 · 停用 0 项` 变为 `启用 5 项 · 停用 1 项`；真正的选择器 UI 属 L2 |
| 刷新后数据保留 | 已验 | 刷新后清单顺序、停用状态、可用数量、补剂分组全部与刷新前一致 |
| 不同本地账号互不可见 | 已验 | 用第二个账号注册后，只能看到自己的 5 / 3 / 4 条示例，看不到第一个账号新增或改名的任何选项 |

## 3. 实际证据

### 3.1 工程三件套

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，无输出 |
| `npm run lint` | 通过，无输出 |
| `npm run build` | 通过，64 modules，`index-*.js` 236.25 kB（gzip 73.72 kB）、`index-*.css` 6.65 kB（gzip 2.03 kB） |

### 3.2 浏览器闭环验收 `npm run verify:local`：52/52 通过

L0 结束时是 23 项，本阶段新增 29 项。新增覆盖：

- **数据库冷升级（3 项）**：用 CDP 把入口模块的响应换成空模块，让页面停在「同源但没跑应用」的状态，用原生 IndexedDB 造出一个真正的 v1 老库（四张表 + 一条 users、一条 day_plans）；再放开加载，让应用自己去打开它。实测升级后 `version=2`、七张表齐备，且 v1 写入的老数据在升级后仍可读。
- **选项页结构（6 项）**：三个分区渲染；新账号自动带出 5 / 3 / 4 条示例；补剂按早 / 中 / 晚分组；页面写明「停用只影响以后的新计划」；初始全部启用且计数与清单一致；账号卡显示「本地模式」且不出现任何同步时间或「已同步」字样。
- **选项页增改排序启停删（8 项）**：新增落末位；重名被拒绝且面板保留输入；上移按同组换位；改名只改目标项；停用需二次确认、停用项仍留在清单且行状态为「已停用」；停用后可用数量下降；删除需二次确认且删完即消失。
- **补剂与健身（3 项）**：新增补剂必须选时段，且按 `sort_order` 落到「中」分组；健身分区不参与时段分组。
- **持久化（3 项）**：刷新后清单顺序、停用状态、可用数量、补剂分组全部保持。
- **账号隔离（3 项）**：第二个账号只看到自己的示例选项，看不到第一个账号的任何新增 / 改名项，账号卡显示当前登录邮箱。
- **回归（1 项）**：R9 修复后，切日期把保存状态从「已保存」带回「尚未修改」。
- **视口（2 项）**：选项页在桌面 1440x900（`scrollWidth=1425`）与手机 390x844（`scrollWidth=390`）均无横向溢出。

脚本仍然自带临时 Vite 开发服务器（空闲端口 + `--strictPort`），结束时按 PID 回收；控制台 error / warning 为 0。

### 3.3 新建的本地数据结构回归 `npm run check:local-data`：15/15 通过

L0 只能验证「新装出来是多少张表」，验证不了「旧版本升级时旧表有没有被动过」——那正是 docs/01 硬性规则「迁移只追加」的要害。因此新增 `scripts/check-local-data.mjs`，直接导入 `localDb.ts` 的 `LOCAL_SCHEMA`（`DB_VERSION` / `STORES` / `MIGRATIONS` 的快照，非业务 API）做静态断言：

- `DB_VERSION` 等于迁移表最大版本号；迁移版本号从 1 起连续无缺口。
- v1 迁移保持历史四张表不变、v2 只新增三张选项表（任何改写旧迁移的行为都会立刻失败）。
- 迁移表覆盖的仓库与 `STORES` 清单完全一致、每个仓库只在一个版本引入、主键都是 `id`。
- 三张选项表都带 `user_id` 索引。
- 架构边界：`src/app` 与 `src/features` 中没有直接引用 `localDb` / `indexedDB` / `supabase`。
- 示例选项只存在于服务层：界面层零命中任何示例名称（解析 `optionSeed.ts` 得到的名单）。

### 3.4 日期规则回归 `npm run check:dates`：48/48 通过

本阶段未触碰日期引擎，作为回归确认无回退。

## 4. 结构变化

```text
src/
  features/preferences/
    PreferencesScreen.tsx         仅编排：读取清单、串写入与确认弹层、组装分区
    useOptionLists.ts             清单 + 「启用项数量」（与 L2 选择器同源）
    preferencesLabels.ts          分区标题、按钮、空态、停用/删除确认文案、账号说明
    components/OptionSection.tsx  一个分区（含补剂的分组、空态、启用/停用计数）
    components/OptionRow.tsx      单行：上移 / 下移 / 改名 / 停用 / 删除
    components/OptionEditor.tsx   新增 / 改名底部面板（补剂多一个时段字段）
    components/AccountCard.tsx    本地模式与当前登录说明 + 退出登录
  services/local/
    optionService.ts              选项读写与排序规则（唯一写入入口）
    optionSeed.ts                 示例选项种子（幂等，只依赖 localDb）
  shared/
    types/options.ts              FoodOption / SupplementTemplate / ExerciseOption 与时段常量
    saveStatus.ts                 保存状态前缀与文案（日计划页与选项页共用，避免两套措辞）
    hooks/useSaveRunner.ts        保存状态机（从 features/day-plan 上移到 shared）
scripts/
  check-local-data.mjs            新增：迁移表与架构边界回归
```

边界约定：选项的唯一写入入口是 `optionService`，页面不碰 IndexedDB；`optionSeed` 只依赖 `localDb`，由 `authService` 调用，`optionService` 依赖 `authService` 取当前用户，三者无环。

## 5. 本阶段发现并修复的缺陷

| 编号 | 问题 | 处置 |
| --- | --- | --- |
| R9（L0 遗留） | 切换日期后保存状态文案残留上一天的结论，切到空白日期仍显示「已保存」 | `useSaveRunner.resetForDateChange` 同时把状态归零；新增 1 项验收断言「已保存 → 尚未修改」 |
| 新增 A | 新增面板标题三个分区共用「添加选项」，用户看不出正在往哪一类添加 | 新增 `OPTION_CREATE_TITLE`，分别显示「添加食物 / 添加补剂 / 添加项目」。由验收脚本的断言暴露 |
| 新增 B | 手机 390px 下五个操作按钮挤在一行会折成两行且右侧顶到边缘，可读性差 | 移动端媒体查询里把选项行改为「名称一行、操作一行平分宽度」（截图核对通过） |
| 新增 C | 删除是硬删除，若未来靠「软删除」兜底历史计划会很别扭 | 明确写进 `optionService` 注释：历史安全由 L2 的名称快照保证，不做软删除 |

## 6. 有意延后与未做的事

- **真正的选择器 UI 不在本阶段**。「新增 / 修改立即在选择器中生效」只能验到「选项页计数与 L2 选择器同源」这一步；三餐 / 补剂 / 健身的多选交互属 L2。这是 L1 验收项在阶段划分下的固有边界，不做替代实现。
- **历史计划不受改名 / 停用影响**：当前还没有任何计划引用选项（三餐、健身仍是文本字段），名称快照机制在 L2 落地，本阶段无法构造用例，如实标注。
- **跨时段不换位**：由「同组内取相邻项」+「组边界按钮禁用」共同保证，结构上无法触发跨时段交换，因此没有单独构造点击用例。
- **停用 / 启用没有独立的重排语义**：停用项仍占 `sort_order`，重新启用后回到原位置。这是有意选择（避免启用时跳到末尾），未在界面额外说明。
- **示例选项内容仍是代码常量**：L1 只要求「不写死在页面逻辑里」，放服务层即达标；若将来要服务端下发，替换 `optionSeed` 即可，页面无需改动。

## 7. 未验证项

- 真实移动设备：视口用 `Emulation.setDeviceMetricsOverride` 模拟，未在真机验证。
- 跨浏览器差异：只跑本机 Chrome / Edge 的无头内核，未在 Safari / Firefox 验证。
- 冷升级只覆盖 v1 → v2 这一条真实路径；v2 之后每新增一个仓库，都需要同样跑一遍（`check:local-data` 会强制「加表必须同时改 `STORES`、`DB_VERSION`、`MIGRATIONS`」）。
- 未做容量边界测试：几百条选项时的滚动与性能未验证（本地单人使用场景下判定为低优先）。
- L2–L6 全部功能。

## 8. 下一步

进入 **L2：计划内容实例化**（`docs/05` §5）。关键前提已经就位：

1. 选择器取数只需调用 `listSelectableOptions(kind)`，停用项天然不在结果里。
2. 三餐、补剂、健身从文本升级为选项组合时，**必须写入名称快照**，然后才能让改名 / 停用不改写历史计划（L1 §5 的「新增 C」已按此前提设计）。
3. 复制昨天要复制内容与快照，但不复制准备勾选、补剂完成状态、餐食完成状态和健身完成状态。
