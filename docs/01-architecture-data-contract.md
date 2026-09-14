# 幸福小Molly：架构与数据契约

## 文档状态

- 状态：设计基线。
- 本文先定义模块、数据责任和不变量；实际技术服务在开发第 1 阶段确认后写入。

## 推荐技术基线

- 前端：React + TypeScript + Vite，移动端优先的单页网页。
- 数据：托管 PostgreSQL、账号认证和行级权限控制。
- 推荐服务：Supabase Auth + PostgreSQL + RLS。
- 原则：没有真实云端写入和刷新验证，不得显示“已保存”；浏览器本地缓存只可作为离线草稿，不能替代同步成功。

若不采用 Supabase，替代方案必须同时提供账号认证、数据库约束、用户级访问控制和失败可见的保存状态。

## 目录边界

```text
src/
  app/                 应用入口、会话门禁、全局状态、全局样式
  features/
    auth/              登录与注册表单（会话状态由 app 持有）
    day-plan/          单日计划、准备进度、日期模式
    week/              周视图和日期导航
    preferences/       食物、补剂、健身选项管理（L1 起）
  services/
    local/             当前生效的服务实现（IndexedDB）
    cloud/             L6 迁移参考实现，L0-L5 期间冻结、不参与运行时
  shared/
    components/        通用勾选框、底部面板、确认框
    date/              日期与周起始日计算
    errors.ts          服务层统一错误类型与标准化
    types/             跨模块领域类型
database/
  migrations/          只追加的数据库迁移
docs/
```

- 页面不得直接发数据库请求；请求只通过 `services/`。
- 只有 `services/local/` 是当前生效实现。`services/cloud/` 在 L6 之前不得被页面或本地服务引用，它只作为迁移参考保留。
- `features/` 之间不得相互读写内部状态；共享规则放入 `shared/` 或服务层。会话状态只允许 `app/` 持有。
- 不建立“万能计划 JSON”字段。需要筛选、约束或保留历史的对象必须有清晰字段或关联表。

## 数据模型

### 用户与日期计划

| 实体 | 关键字段 | 责任 |
| --- | --- | --- |
| `profiles` | `user_id` | 账号资料，主键与认证用户一一对应 |
| `day_plans` | `id`、`user_id`、`plan_date`、`mode`、`mode_override`、`outfit_ready`、`morning_focus`、`exercise_decision` | 每位用户每天唯一的计划主记录 |
| `custom_tasks` | `day_plan_id`、`time`、`title`、`note`、`completed` | 自定义时间线事项 |
| `routine_tasks` | `day_plan_id`、`kind`、`title`、`completed` | 晨间完成、拖地、洗衣等每日固定或实例化事项 |

`mode` 只能为 `work` 或 `rest`。`mode_override` 记录是否人工改写默认周几判断，避免后续无法区分“原本周末”与“临时不上班”。

### 餐食、补剂与健身

| 实体 | 关键字段 | 责任 |
| --- | --- | --- |
| `food_options` | `id`、`user_id`、`name`、`active`、`sort_order` | 用户维护的常用食物 |
| `daily_meals` | `day_plan_id`、`meal_type`、`note`、`prepared` | 每日早、中、晚三餐的计划与准备状态 |
| `daily_meal_items` | `daily_meal_id`、`food_option_id`、`food_name_snapshot` | 一餐可组合多个食物，并保留历史名称快照 |
| `supplement_templates` | `id`、`user_id`、`name`、`period`、`active` | 固定补剂清单，`period` 为早、中、晚 |
| `daily_supplements` | `day_plan_id`、`name_snapshot`、`period`、`planned`、`completed` | 从模板复制出的每日补剂实例，历史不受模板修改影响 |
| `exercise_options` | `id`、`user_id`、`name`、`active`、`sort_order` | 健身项目或动作 |
| `daily_exercise_items` | `day_plan_id`、`exercise_option_id`、`name_snapshot` | 每日健身多选项 |

## 数据不变量

1. `day_plans` 对 `(user_id, plan_date)` 唯一。
2. 任何从属记录只能引用同一用户的 `day_plans`。
3. 所有用户私有表启用 RLS：仅记录所有者可读、可写、可删。
4. 后端拒绝修改今天之前的计划；前端只读只是额外提示，不是权限边界。
5. 每日补剂与餐食保存名称快照；修改或停用常用选项不得改写历史。
6. 复制计划时只复制内容和选择，不复制 `completed`、`prepared`、`outfit_ready` 等执行状态。
7. 休息日的拖地、洗衣为每日实例，不修改全局模板。

## 保存与冲突

- 编辑后进行防抖保存；保存中的界面明确显示“正在保存”。
- 服务端成功返回后显示“已保存”。
- 失败显示“保存失败”，保留本地待重试草稿，不静默丢弃。
- 同一账户在多设备同时编辑同一天时，第一版采用“最后一次成功保存为准”，但应通过 `updated_at` 告知较新内容；冲突处理升级另立需求。

## 测试边界

- 单元测试：准备进度、日期模式、复制、过去日期只读。
- 集成测试：数据库约束、RLS、模板实例化、保存失败重试。
- 浏览器验收：手机宽度、桌面宽度、刷新恢复、双设备同步、断网失败状态。
