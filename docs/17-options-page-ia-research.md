# 选项页信息架构调研：多维护理界面怎么做（2026-09-16）

> 背景：用户反馈「所有选项都对到一个界面不加整理，显得非常杂乱」。
> 本文**只做调研与方案设计，不含代码改动**。所有结论都标注了出处，最后给出推荐方案与待确认项。

## 0. 一句话结论

现状的问题不是「选项太多」，而是**把三类清单的行内操作（每行 5 个按钮）和三类系统设置平铺在同一个滚动区里**。
权威做法指向同一件事：**概览页只放「有状态摘要的入口行」，每个清单进各自的子屏，行内只留最常用的动作**。
这与 Android 的 Settings 模式（概览 + 子屏、15 项以上必须分组）、Apple HIG（任务特定选项放到它影响的地方）、
NN/g 的渐进披露（实际最多两层）三条独立来源一致。

## 1. 现状诊断（实测，非估算）

在 390×844 视口上量「选项」页（数据为默认示例：5 种食物 / 3 种补剂 / 4 个健身项目）：

| 指标 | 实测值 |
| --- | --- |
| 内容高度 / 可视高度 | **2865px / 694px → 约 4.1 屏** |
| 按钮总数 | **71 个** |
| 选项行 | 12 行，**每行 5 个按钮**（上移 / 下移 / 改名 / 停用 / 删除） |
| 单个选项行高度 | **平均 102px**（一行只显示一个名称，其余全是按钮） |

分区占比：

| 分区 | 高度 | 按钮数 | 性质 |
| --- | --- | --- | --- |
| 常用食物 | 612px | 26 | 候选清单 |
| 固定补剂 | 520px | 16 | 候选清单（按时段分 3 组） |
| 健身项目与动作 | 527px | 21 | 候选清单 |
| 本地数据备份 | 527px | 5 | 系统/数据 |
| 存储与安装 | 330px | 2 | 系统/数据 |
| 账号与同步 | 159px | 1 | 系统/数据 |

三类候选清单占 1659px（58%），三张系统卡片占 1016px（35%）。**两类东西的用途完全不同，却共用同一个层级。**

四个具体问题：

1. **行内动作过载**：5 个按钮平铺在每一行，12 行就是 60 个按钮。视觉噪音主要来自这里，而不是选项数量本身。
2. **没有层级**：清单（会被反复维护）与系统设置（装一次就不用管）在同一层，用户无法「先看清单，需要时再找设置」。
3. **排序交互占用两个按钮位**，而且每次只能移动一格；这是最不划算的一处占用。
4. **「停用」与「删除」并排**：两者语义完全不同（可逆归档 vs 不可逆删除），风险等级也不同，却给了同样的视觉权重。

## 2. 权威依据

### 2.1 什么该进「设置区」，什么该留在原地

Apple HIG（设置）：

> **尽量减少提供的设置数量。** 虽然用户乐意控制 App，但过多的设置会让用户感觉使用体验不够友好，同时很难找到特定设置。
> **如果可能，首选让用户无需前往设置区域，即可修改任务特定的选项。** ……如果用户可以调整设置，比如显示或隐藏当前视图的某一部分、
> **重新排列一系列项目或者过滤列表**，请将这些选项放在其影响的屏幕上……
> **将通用、不常更改的设置放在自定义设置区域中。**

Android（Settings 模式）：

> **Don't include frequently accessed actions.** These should be contextual to the feature they most affect.
> Do include infrequently accessed preferences.

**对本项目的含义**：维护候选清单本身是低频活动，放在「选项」区是成立的；
但「重新排列 / 过滤某个清单」属于**任务特定**操作，Apple 明确建议放在它影响的那个屏幕上——
所以排序与筛选应当出现在**该清单自己的子屏**里，而不是和「账号」「备份」混在同一层。

### 2.2 概览页 + 子屏，以及一个具体阈值

Android（Settings 模式）：

> Provide an overview: Users can quickly see the most important and frequently used settings and their values.
> **For 15 or more settings, group related settings under a subscreen.**
> Use subscreens to simplify multiple settings or extensive categories, helping users focus on fewer choices.
> For complex or deep settings hierarchies, add search functionality.
> Group settings in smaller relevant groups. **Use visual or intrinsic containment and headings between groups instead of individual items.**
> Use the primary label to provide the name of the item, and **optionally use secondary text for status**.
> Use consistent terms: **the label of the setting that opens a group must match the subscreen title.**

**含义**：本项目「选项」页实际有 6 个可管理对象（3 清单 + 3 系统卡片），且每个对象内部都有多个动作——
按 15 项阈值的原则，**应当做概览页 + 子屏**，并在概览行的副标题里显示状态（如「启用 5 项」）。
子屏标题必须与入口标签一致（「常用食物」→ 子屏也叫「常用食物」）。

### 2.3 渐进披露最多两层，且拆分点要选对

NN/g《Progressive Disclosure》：

> 1. Initially, show users only a few of the most important options. 2. Offer a larger set of specialized options upon request.
> ……在实践里，**超过两层的披露设计通常可用性很差**，用户容易在层级间迷路。
> 你要做对两件事：**初始与次要的拆分要选对**（常用功能必须在初始层；初始层也不能塞太多）；**从初始层进入次要层的路径要显而易见**（机制简单、标签有明确的信息气味）。
> 披露越多越简单，但**拆成太多步，用户会被多余的导航拖住**——1 屏 vs 5 屏是伪二选一，2 屏往往才是最优。

**含义**：概览页 → 清单子屏 = 两层，正好在推荐上限内，**不要再往下做第三层**（例如「子屏 → 单个选项详情」）。

### 2.4 移动端用「折叠分组」，不要用页签

NN/g《Tabs, Used Right》：

> **Accordions are particularly useful on mobile devices, where they work better than tabs due to the limited screen space.**
> The fewer tabs, the better. 选项卡溢出列表时会退化成轮播，隐藏的选项卡更难被发现。
> If you don't find distinct groupings, tabs are likely the wrong interface control… a single-page layout with subheadings would be more appropriate.

**含义**：如果不想做子屏，退而求其次是**可折叠分组**，而不是顶部页签。
本项目已经有 3 个底部一级入口（今日 / 本周 / 选项），再加页签会在移动端造成两层导航竞争。

### 2.5 行内动作：什么时候该收进溢出菜单

PatternFly（Overflow menu 设计指南）：

> Use an overflow menu when a **space constraint** makes it impossible to display all additional options in a horizontal layout…
> **commonly used when a UI switches from a desktop to a mobile device.**
> **Do not use an overflow menu when there are 2 or fewer actions available.**
> Avoid having **more than 3 actions** fully displayed within a toolbar.
> Do not use an overflow menu to hide additional content（那是 expandable section 的职责）。

**含义**：每行 5 个动作，在手机上属于典型的空间受限场景 → **应当收进溢出菜单**（保留 1 个高频动作在行内即可）。
反过来，如果某行只剩 2 个动作，就不该用溢出菜单——这是**判断收还是放的标准**，不是凭感觉。

### 2.6 排序：拖拽可以，但必须留无障碍替代

Cloudscape（Drag-and-drop 模式）：

> 拖拽分「补充性（complementary）」与「必需性（essential）」；**必需时一定要提供清晰的示能（drag handle）与替代完成方式**。
> Accessible drag-and-drop：**必须提供不用拖拽也能完成同一动作的方式**（单次点击即可完成，含键盘与触屏）。

**含义**：把「上移 / 下移」两个按钮换成**拖拽手柄 + 菜单里的「上移 / 下移」**，
既省掉行内两个按钮位，又保留无障碍替代（且顺带支持键盘）。只做拖拽、砍掉替代方式是不合格的。

### 2.7 拆分表单：一件事一屏

GOV.UK《Structuring forms》：

> **Start with one thing per page**……一页只放一件事（一条信息 / 一个决定 / 一个问题），
> 有助于用户理解要求、专注当前问题、在陌生流程中找到路、**在移动设备上使用**、以及从错误中恢复。
> 用户研究会告诉你什么时候可以把页面合并（例如需要快速来回切换的内部服务）。

**含义**：**备份**是一段多步流程（生成 → 下载/复制 → 粘贴/选文件 → 检查 → 二次确认 → 导入），
在一页里塞了 527px 且步骤线性，属于「应该独立成屏」的典型；账号这类单值信息则不值得单独成屏。

## 3. 三个候选方案

| | A. 单页 + 折叠分组 | B. 概览页 + 子屏（推荐） | C. 顶部页签 |
| --- | --- | --- | --- |
| 形态 | 保持一页，三类清单各自可折叠，系统卡片收到「设置」分组下 | 选项页只放 6 行入口（带状态摘要），每类进自己的子屏 | 顶部 segmented control 切换 4 个页签 |
| 行内 5 按钮问题 | **未解决**（仍需单独收） | 解决（行内只留手柄 + ⋯） | 未解决 |
| 一屏放得下 | 折叠后约 1–1.5 屏 | **约 1 屏** | 约 1 屏 |
| 与权威依据 | 符合 NN/g「移动端折叠优于页签」 | **符合 Android 概览+子屏、Apple 任务特定选项、NN/g 两层上限** | 与 NN/g 移动端结论相悖；系统卡片挤到第 4 页签可发现性差 |
| 改动量 | 小 | 中（需要子屏状态与返回） | 小 |
| 主要代价 | 噪音只是被折叠起来，展开后依旧 4 屏 | 每次管理多一次点击（概览 → 子屏） | 页签与底部导航形成两层导航 |

**推荐 B。** 理由：它是唯一同时解决「噪音」与「层级」的方案，而且三条独立来源（Android / Apple / NN/g）都指向它；
A 只是把问题折起来，C 与移动端结论相悖。

## 4. 推荐方案：概览页 + 子屏

### 4.1 选项页（概览）

每行 = 名称 + 状态摘要，点击进子屏（Android：主标签给名称，副文本给状态）：

```
选项
─────────────────────────────
常用食物           启用 5 项  ›
固定补剂      早/中/晚 · 启用 3 项  ›
健身项目与动作     启用 4 项  ›
─────────────────────────────
本地数据备份        最近导出：—  ›
存储与安装    浏览器标签页 · 未获得持久化  ›
─────────────────────────────
账号与同步          8950***@qq.com
                            [退出登录]
```

- 三个清单行在上，系统行在下，中间用分组标题/分隔（Android：用 containment 与标题分组，而不是逐项堆叠）。
- 概览页按钮数从 71 → 约 8 个。
- 概览不展开任何清单，因此约 1 屏；**这是「先看状态、需要时再进去」的入口页**。

### 4.2 清单子屏（以「常用食物」为例）

```
‹ 常用食物                     ＋ 添加
─────────────────────────────
⠿ 燕麦牛奶                   ⋯
⠿ 水煮蛋                     ⋯
⠿ 鸡胸沙拉                   ⋯
⠿ 番茄鸡蛋面       已停用     ⋯
─────────────────────────────
[显示已停用 ✓]
```

- **行内只留两个元素**：拖动排序手柄 + 「⋯」溢出菜单（改名 / 停用 / 删除，其中「上移 / 下移」也放进菜单作为无障碍替代）。
- 行高从 102px → 约 56px，一屏能看 8–10 项（当前 5 项，留足增长空间）。
- 行内**不再出现「删除」**：破坏性动作进菜单，降低误触（Android 也说破坏性动作不该有同等视觉权重）。
- 子屏标题与入口标签一致（Android 的用词一致性要求）。

### 4.3 几条需要一并定下的规则

| 议题 | 建议 | 依据 |
| --- | --- | --- |
| 搜索 / 筛选 | **暂不做**。单类清单 < 20 项时不值得引入；> 20 项再加筛选与搜索 | Android：深层级才加 search；过早引入等于增加复杂度 |
| 排序 | 拖拽为主 + 菜单内「上移 / 下移」为无障碍替代 | Cloudscape：必须提供非拖拽替代 |
| 停用（归档） | 保留在列表里、样式淡化，默认**仍显示**（可用开关隐藏） | 现状即如此，且「停用」是低风险可逆动作，隐藏它反而让人以为被删了 |
| 删除 | 留在溢出菜单 + 二次确认（现状已有确认框） | 破坏性动作降权 |
| 文案 | 不用「管理 / 编辑 / 选项」这类泛词；入口标签 = 子屏标题 | Android 的用词规则 |
| 层级深度 | **最多两层**，不做「子屏 → 单个选项详情」 | NN/g：超过两层可用性明显下降 |

## 5. 落地约束（动手前必须知道）

1. **项目没有路由库**（`docs/01`），所以子屏要用组件内状态实现。现有 `DayPlanScreen` 已有
   `view: 'day' | 'week' | 'options'` 的模式可以扩展；底部导航仍是「今日 / 本周 / 选项」三个入口不变——
   子屏属于「选项」这个二级入口的内部层级，符合 Android「设置属于二级导航」的定位。
2. **验收脚本会需要同步改**：`verify-local.mjs` 对选项页有大量断言（`optionSection` / `optionRow` /
   `optionNames` / `clickOptionButton` / `optionSummary` 等），改成子屏后这些定位需要跟着走。
   这是本次改动**最大的一块成本**，建议一次改到位，别分两次动脚本。
3. **不受影响的**：`check:local-data` 的「界面层不直连 localDb / indexedDB / 云端 SDK」、
   `check:cloud-parity`、`check:backup` 都与页面结构无关。
4. **数据层零改动**：本次是纯信息架构与交互调整，`sort_order` / `active` 语义不变，
   「停用不改写历史」等不变量继续成立（`docs/01`）。

## 6. 待确认（需要你拍板）

> **已拍板并实施（2026-09-16，第五轮）**：
> ① 直接做 B（不用过渡版）；② 排序 = 拖拽 + 菜单内上下移；③ 停用项默认显示；
> ④ 备份独立成屏；⑤ 「最近导出时间」暂不做（后面可能接 Supabase，届时再定）。
> 实施结果与验收见本文 §8。

1. ~~**是否采纳 B（概览页 + 子屏）**，还是先做 A（折叠）过渡？~~
2. ~~**排序交互**：拖拽 + 菜单里的上下移（推荐，含无障碍替代），还是保留行内两个按钮？~~
3. ~~**停用项**默认显示还是默认隐藏（用开关切换）？~~
4. ~~**备份**是否独立成屏（它是一段 5 步流程，现在占 527px），还是留在概览页里可展开？~~
5. ~~概览页要不要显示「最近导出备份」这类状态副文本？~~

## 7. 出处

- Apple Human Interface Guidelines — 设置：https://developers.apple.com/cn/design/human-interface-guidelines/settings
- Android Developers — Settings（Mobile 模式指南）：https://developer.android.com/design/ui/mobile/guides/patterns/settings
- NN/g — Progressive Disclosure（Jakob Nielsen）：https://www.nngroup.com/articles/progressive-disclosure/
- NN/g — Tabs, Used Right：https://www.nngroup.com/articles/tabs-used-right/
- GOV.UK Service Manual — Structuring forms：https://www.gov.uk/service-manual/design/form-structure
- PatternFly — Overflow menu 设计指南：https://www.patternfly.org/components/overflow-menu/design-guidelines/
- Cloudscape Design System — Drag-and-drop 模式：https://cloudscape.design/patterns/general/drag-and-drop/

## 8. 实施结果（2026-09-16）

按 §4 的推荐方案落地，改动与实测：

| 指标 | 改前 | 改后 |
| --- | --- | --- |
| 选项页屏数（390×844） | **4.1 屏** | 概览 **一屏**（真实余量 97px） |
| 按钮总数 | **71 个** | 概览 **7 个**（6 个入口 + 载入示例） |
| 单个选项行 | 5 个按钮 / **102px** | 2 个元素（拖拽手柄 + 「…」）/ **62px** |
| 层级 | 三类清单 + 三张卡片平铺 | 概览 → 六个子屏（三层清单 / 备份 / 存储 / 账号），**两层** |

落地要点（与调研结论的对应）：

- **概览只放带状态摘要的入口行**（Android：主标签给名称、副文本给状态）；
  标题与入口标签一致（Android 的用词一致性要求）。
- **每类清单自己的子屏**：行内只留拖拽手柄与溢出菜单（PatternFly：一行超过 3 个动作就该收）；
  **上移 / 下移挪进菜单**作为拖拽的无障碍替代（Cloudscape 的硬性要求）。
- **停用语义说明从概览挪到清单子屏**——它该出现在停用发生的地方，同时给概览腾出字体差异的余量。
- **账号与同步也做成子屏**：概览的每一行都是入口，结构一致；顺带把概览余量从 1px 提到 97px。
- **备份独立成屏**：它是一段 5 步线性流程（GOV.UK：一件事一屏）。
- **拖拽复用服务层现有的 `moveOption` 按位移逐步移动**，不新增批量重排接口——
  门面每加一个函数，本地与云端两侧都要实现且要被 `check:cloud-parity` 检查。

验收：`verify:local` **104/104**（新增 10 条：概览入口与摘要、系统项分组、一屏余量、子屏标题一致性、
行内元素收敛、拖拽换位与复原、停用说明位置等），`verify:pwa` **42/42**，四个 check 脚本全绿。

一处踩坑记录：verify-local 里「概览是否一屏」最初在脚本默认窗口（约 760×500）下量，结论没有意义；
后来改为**显式切到 390×844 再量**，并且余量要单独算——内容比可视区矮时 `scrollHeight` 会被
`clientHeight` 顶住，只看它分不出「刚好塞满」和「还有富余」（这一点在 `docs/16` §8.3 也踩过一次）。
