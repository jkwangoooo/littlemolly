# 幸福小Molly（本地业务开发）

此工程包含账号认证、Asia/Shanghai 日期引擎、日期模式、固定周一至周日周视图，以及工作日规划闭环：五项准备状态、三餐、晨间事项、健身和自定义事项。当前开发模式使用浏览器 IndexedDB 保存账号和业务数据，不依赖 Supabase 或网络；上线前再将服务层整体迁移到云端数据库。

## 启动

1. 安装依赖：`npm install`
2. 启动：`npm run dev`
3. 在页面中注册本地测试账号。数据仅保存在当前浏览器的 IndexedDB 中。

浏览器地址通常为 `http://localhost:5173`。该地址由 Vite 运行输出为准。

## 云端迁移（上线前）

当前版本不读取 `.env.local`，也不会连接 Supabase。上线阶段再将 `src/services/local/` 下的实现替换为云端适配器（参考已冻结的 `src/services/cloud/`），并按文件顺序执行 `database/migrations/202608270001_stage1_auth_sync.sql`、`database/migrations/202608310001_stage2_day_plans.sql`、`database/migrations/202608310002_stage3_workday_planning.sql`，随后补做跨设备、断网和 RLS 验收。

## 验收步骤

1. 注册或登录后在“准备明天”完成五项准备、三餐、晨间、健身和自定义事项；刷新确认从本地数据库恢复。
2. 在“执行今天”确认完成勾选独立于准备状态；本周点击日期可回到完整单日页。
3. 使用“复制昨天”，确认计划内容被复制、五项准备和全部完成状态未复制，且目标日期模式与 `mode_override` 未改变。
4. 使用两个本地账号验证各自的三餐和自定义事项相互不可见；尝试新增、修改、删除历史从属记录必须被服务层拒绝。
