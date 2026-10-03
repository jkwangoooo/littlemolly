# 幸福小 Molly：Codex 接手架构与迁移基线

> 状态：Codex 接手基线（2026-10-03）
> 
> 本文是后续代码改造的执行入口。它不替代产品需求、数据契约或部署文档；当本文与既有验收硬规则冲突时，以 `AGENTS.md`、`docs/26-S6-handoff-for-codex.md` 和数据/同步契约为准。

## 1. 接手结论

项目当前已经具备可维护的四层目录，不需要一次性推倒重排：

```text
src/
  app/       应用入口、路由级组合、全局样式
  features/  面向用户能力的垂直切片
  services/  数据访问、同步和外部系统适配
  shared/    无业务归属的 UI、类型、日期、反馈和运行时工具
```

本次接手采用“先固定边界，再渐进迁移”的方式。目录搬迁本身不是目标，稳定的依赖方向、可验证的行为和可回滚的单步变更才是目标。

## 2. 依赖方向

允许的依赖方向：

```text
app -> features -> services/api -> services/local | services/sync
app -> shared
features -> shared
services -> shared
services/sync -> services/cloud
```

禁止：

- `features` 直接引用 `services/local`、`services/cloud`、`localDb`、IndexedDB 或 Supabase SDK。
- `shared` 反向依赖具体 feature。
- `services/cloud` 被页面或组件直接引用。
- 业务组件直接控制礼花、宠物或全局反馈表现；业务只发布已发生的事实事件。
- 在 React effect 中启动全局同步调度器。

## 3. 命名与文件布局

### 3.1 文件命名

- React 组件和页面使用 PascalCase：`DayPlanScreen.tsx`、`FeedbackHost.tsx`。
- hooks、服务、规则和工具使用 camelCase：`useDayPlanData.ts`、`feedbackBus.ts`。
- 类型集中在 `shared/types/` 或靠近所属领域的 `*.types.ts`；不为单个组件创建没有复用价值的类型目录。
- 新增 Markdown 文件使用中文说明命名，并保留数字前缀以维持执行顺序。
- 不通过大小写或缩写表达层级含义；目录职责优先于文件名。

### 3.2 Feature 垂直切片

每个 feature 只拥有自己的页面、交互组件、文案和 feature hooks：

```text
features/<能力>/
  <能力>Screen.tsx
  components/
  hooks/          # 只有在该能力确实有多个 hook 时创建
  <能力>Labels.ts
```

跨能力复用的组件才进入 `shared/components/`。运动实验页 `motion-lab` 是独立演示入口，不参与主业务依赖。

### 3.3 Services 门面

页面只从 `services/api/` 导入：

- `authService.ts`
- `dayPlanService.ts`
- `optionService.ts`
- `backupService.ts`
- `syncService.ts`

门面负责稳定接口和动态转发；本地实现放在 `services/local/`，同步编排放在 `services/sync/`，云端传输仅放在 `services/cloud/` 的四个允许模块中。

## 4. 迁移策略

迁移按以下顺序执行，每一步都必须保持可构建：

1. **边界清理**：移除页面对底层服务和表现组件的直接耦合，先补门面或事件契约。
2. **反馈编排**：由 `shared/feedback/` 统一消费反馈事件，处理去重、日期过滤、优先级和互斥。
3. **跨业务扩展**：将保存失败、备份导入和云端状态接入同一事件契约，但保持本地保存与云端状态文案分离。
4. **目录收敛**：只有在无静态检查、构建和验收脚本依赖后，才移动或重命名文件。
5. **清理历史痕迹**：历史交接文档保留为记录；当前执行状态写入新的中文接手文档和 `HANDOFF.md`，不删除旧证据。

每个迁移单元必须满足：

- 修改前将目标文件备份到 `.codex/backup/<说明>/`；仅访问历史 Workbuddy 证据时保留其旧路径。
- 同一文件一次只做一个编辑操作。
- 先跑 `npm run typecheck`，再跑 `npm run build`；涉及同步、PWA 或数据层时追加对应验收。
- 不将“已写入本地”描述为“已同步到云端”。

## 5. 当前反馈模块状态

反馈基础设施已经存在：

- `feedbackTypes.ts` 定义模式切换、普通完成和保存失败事件。
- `feedbackBus.ts` 按 `actionId` 去重并提供订阅生命周期。
- `FeedbackHost.tsx` 承载礼花、宠物回应、普通完成提示和保存失败播报。
- `DayPlanScreen.tsx` 在本地写入成功后发布模式切换与普通完成事件，保存失败时发布失败事实。

普通完成提示的完整迁移尚未完成。下一步应在单文件可验证编辑条件下完成：

- 将 `completion` 的显示状态、计时器和 `aria-live` 节点移入 `FeedbackHost`。
- 删除 `DayPlanScreen` 对 `completion` 的订阅、计时器和展示状态。
- 规则：庆祝优先；礼花期间普通提示不打断；切换日期或打开选项面板时丢弃旧提示。
- 迁移后更新 `docs/38-反馈编排架构改造方案.md` 的阶段状态和验收记录。



```bash
npm run typecheck
npm run build
npm run lint
```

若 Node 因机器内存不足导致 lint 或浏览器验收崩溃，必须记录为环境失败，不得写成代码通过。源码改动的最低验收仍是 typecheck + build；涉及同步或部署配置时追加 `verify:sync` 或 `verify:pwa`。

## 8. 不做的事情

- 不为了形式把所有文件重命名成另一套风格。
- 不删除历史文档、演示 H5 或云端冻结实现。
- 不引入新的状态管理库、事件库或 UI 框架，除非有明确的跨模块需求和验收覆盖。
- 不把架构迁移与视觉重做、数据库迁移、Supabase 部署混在同一个不可回滚批次中。
