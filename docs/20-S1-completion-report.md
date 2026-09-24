# S1 完成报告：架构切换与能力声明

> 完成日期：2026-09-19
> 任务来源：`docs/19-sync-execution-plan.md` §5 S1（方案依据：`docs/18-sync-architecture-plan.md`）
> 结论：**S1 全部任务落地，业务行为零回退，全部检查与验收全绿。可进入 S2。**

---

## 1. 任务达成

| 任务 | 状态 | 落地内容 |
| --- | --- | --- |
| S1-T1 能力声明 | ✅ | 新增 `src/services/capabilities.ts`；删除 `src/services/backend.ts` |
| S1-T2 门面直连本地 | ✅ | 四个门面改指 `../local/*`；`vite.config.ts` 移除 `@backend` 别名 |
| S1-T3 文案与卡片收口 | ✅ | 保存状态前缀、账号说明、存储说明、备份卡全部去掉后端分支 |
| S1-T4 构建与启动器收口 | ✅ | 删除 `dev:cloud` / `build:cloud` / `dist-cloud/`；启动器重新编号为 12 项 |
| S1-T5 判据替换 | ✅ | `check:cloud-parity` 重写为八组断言；`verify:local` 新增零跨域断言 |
| S1-T6 文档同步与全量验收 | ✅ | `README.md`、`HANDOFF.md`、`docs/19` 更新；全量验收通过 |

### 1.1 具体改动

**新增**

- `src/services/capabilities.ts` —— 取代 `backend.ts`。`DATA_BACKEND` 恒为 `'local'`；`cloudSyncConfigured` 从构建期 env 读；`supportsLocalBackup` 恒为 `true`。**Supabase 的两个环境变量只在这里读一次**，`cloud/supabase.ts` 改为从它取值。

**删除**

- `src/services/backend.ts`（旧模型的核心：按 `import.meta.env.MODE === 'cloud'` 二选一）
- `dist-cloud/`（云端构建产物，541 KB，已随构建模式一起废弃）
- `package.json` 的 `dev:cloud` / `build:cloud` 两个脚本
- `vite.config.ts` 的 `resolve.alias`（`@backend/*` 相对替换）
- `preferencesLabels.ts` 的 `BACKUP_UNAVAILABLE_NOTE`、`BackupCard` 的 `available` 开关

**改写**

- 四个门面 `api/{authService,dayPlanService,optionService,backupService}.ts`：`export * from '@backend/xxx'` → `export * from '../local/xxx'`
- `src/shared/saveStatus.ts`：`SAVE_STATUS_PREFIX` 去掉后端分支，恒为「本地保存状态：」
- `preferencesLabels.ts`：`ACCOUNT_TEXT` / `STORAGE_WHY` 去掉云端分支
- `scripts/check-cloud-parity.mjs`：判据重写（见 §2.2）
- `scripts/verify-local.mjs`：新增网络监听与零跨域断言
- `scripts/launcher.mjs`：12 项任务，重新编号

**未动**

- `src/services/local/*` 全部实现
- `src/services/cloud/*`（四个适配器 + `parity.ts` + `supabase.ts` 的注释与环境变量来源除外）—— 作为**冻结的种子**保留，S4 改造成同步传输层
- `src/features/**` 的业务逻辑（只改了三处文案常量与一个组件 prop）
- `database/migrations/*`（S1 不涉及云端 SQL）

---

## 2. 关键决策

### 2.1 为什么直接删掉 `@backend` 别名，而不是保留它

别名存在的唯一理由是「同一份产物里只进一个后端」。后端不再互斥之后，它只剩下成本：相对替换的解析基准是引用方所在目录，所以 `@backend/` 只能出现在 `src/services/api/` 下，换一处引用就指错——为此外加了一条静态断言去守。门面直接写 `../local/xxx` 之后，别名、断言、以及「凭记忆把别名加回去」这个隐患一起消失。

### 2.2 判据替换：从「产物不含」到「运行时不连」

旧保证「本地产物 0 命中 `supabase`」在运行时共存后不再成立。新判据是**未绑定云端账号时，整轮交互零跨域请求**，并落在两处：

- **运行期**（`verify:local`）：`Network.enable` + `Network.requestWillBeSent` 统计非同源请求，断言为 0。覆盖从冷升级造库到「换设备 + 导入备份」的完整一轮。
- **依赖层面**（`check:cloud-parity` 第 6 组）：除 `src/services/cloud` 自身，没有任何模块引用它；`cloud/parity.ts` 是唯一入口且只做类型断言、不产生运行时依赖。

同时保留了产物检索作为**冗余证据**：本地产物仍 0 命中 `supabase|GoTrueClient|PostgREST`。

### 2.3 `cloud/` 为什么保留而不是删除

那批适配器身上带着「本地记录 ↔ 云端行」的字段映射（云端遗留列 `exercise_content` / `plan_content` 不发、`user_id` 要重写为 `auth.uid()`、跨表操作用 RPC），S4/S5 会直接继承。删掉就等于把这部分知识重新写一遍。保留的代价只是一次 `typecheck`，而 `cloud/parity.ts` 的类型断言保证改本地签名时当场报警——契约的定位从「后端可替换性」变成「字段映射的正确性」。

### 2.4 `supportsLocalBackup` 保留为常量而不是让界面写 `true`

界面问的是「这个能力有没有」，不是「当前后端是不是本地」。留一个具名常量，以后若出现「本地库还没建立」这类前置条件，收口点仍然只有一个。

---

## 3. 验收证据

全部在本机执行，2026-09-19。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | ✅ 通过 |
| `npm run lint` | ✅ 通过 |
| `npm run build` | ✅ 96 modules，`dist/assets/index-*.js` 282.96 kB / gzip 88.25 kB |
| `npm run check:dates` | ✅ 48/48 |
| `npm run check:local-data` | ✅ 34/34 |
| `npm run check:backup` | ✅ 62/62 |
| `npm run check:cloud-parity` | ✅ **56/56**（重写后；重写前 50 项） |
| `npm run verify:local` | ✅ **106/106**（原 105，新增零跨域断言） |
| `npm run verify:pwa` | ✅ **43/43**（原 42，新增工作日判定断言） |

**产物检索（冗余证据）**：`dist/assets/*.js` 中 `supabase|GoTrueClient|PostgREST` 命中 **0**；`indexedDB` 命中 1。

**新断言实测输出**

```
PASS  未配置云端时整轮交互零跨域请求  → http://127.0.0.1:1242 之外 0 条
PASS  目标日已确认为工作日（验收结论不依赖当天是周几）  → SWITCHED
PASS  「执行今天」空计划状态一屏放下  → 当天模式=休息日，内容区可视 640px / 内容 640px，余量 23px
PASS  账号卡显示当前登录账号  → 账号与同步 / 退出登录 / 本地模式 · 当前登录：b… / 数据保存在当前浏览器中，账号与计…
```

**行为零回退**：`verify:local` 的 105 项原有断言全部保持通过，覆盖注册登录、周视图、日计划全流程、选项页增改排序启停删、备份往返、账号隔离、换设备搬家、视口无溢出、控制台无 error/warning。

---

## 4. 计划外改动（测试脚本的日期依赖）

S1 执行期间发现并修掉两处**与业务代码无关**的验收脚本缺陷。两处都是同一个根因：**脚本假定「今天 / 明天是工作日」**，而周六 / 周日默认是休息日。

### 4.1 现象与定位

2026-09-19 是周六，`verify:pwa` 跑出 39/42，三条失败：

1. 软键盘弹出时底部抽屉让开键盘 → `打开三餐=NOT_FOUND:三餐已安排`
2. 底部抽屉的「保存 / 取消」仍在可见区域内 → 同上，抽屉没打开
3. 「执行今天」空计划状态一屏放下 → 余量 23px（门槛 24px）

定位依据：

- `DayPlanScreen.tsx` 里 `mode === 'work' && isPrepare` 才挂 `PrepList`，**休息日不渲染工作日准备项**，「三餐已安排」这一行根本不存在 → 解释 1、2。
- `useDayPlanData.ts` 对**非历史的正常休息日**会自动补一份 rest 计划并带出拖地 / 洗衣（条件 `mode === 'rest' && mode_override !== true`）→ 今天（周六）本来就不是空计划 → 解释 3。
- `verify-local.mjs` 从 L3 起就有 `tomorrowIsRestDay()` 与「改为工作日 + 确认切换」的处理，注释写明「周五与周六跑出来的结论不一样」；`verify-pwa.mjs` **一处都没有**。PWA 外壳的 42/42 是 2026-09-16（周三）验的，此后 `verify:pwa` 没再跑过。

### 4.2 修法

1. 新增 `ENSURE_WORKDAY` 片段：读 `.mode-card strong`，是休息日就点「改为…」→「确认切换」，否则原样返回。在打开三餐面板前调用，并新增一条断言记录实际走了哪条路径。
2. 「执行今天空计划一屏放下」改为**按当天实际模式分别断言**：`内容区不需要滚动` 不分模式始终要求；`余量 ≥24` 只在该天确实是工作日（空计划）时要求——注释里本来就写了「这条只对空计划成立」。这与 `verify-local` 处理「明天」的方式同源：**按实际模式分别断言，而不是假定**。

### 4.3 结果与遗留

- `verify:pwa` 43/43 全绿（新增 1 条断言，42 → 43）。
- **未验证**：修好的工作日分支今天跑不到（今天是周六）。`ALREADY_WORK` 这条路径要等下个工作日复跑才能确认；本次实测走的是 `SWITCHED`。
- 同类风险已排查：`verify-local.mjs` 无此问题（它自己处理了）。

---

## 5. 缺陷与延后项

| # | 项 | 说明 | 处理 |
| --- | --- | --- | --- |
| 1 | `verify:pwa` 工作日分支未实测 | 见 §4.3 | 下个工作日复跑确认 |
| 2 | `cloud/` 是被冻结的死代码 | 页面不引用，只有 `parity.ts` 引用。`check:cloud-parity` 仍要求它导出契约里的每个名字，因此不会静默腐烂 | S4 改造成同步传输层 |
| 3 | `cloud/backupService.ts` 仍抛 `cloud_backup_unsupported` | 它已不在任何运行路径上（门面直连 local），保留是为了满足契约断言 | S5 由 `sync/replaceLocal` / `replaceCloud` 取代 |
| 4 | `cloud/authService.ts` 的合成邮箱域名 `molly.local` | 域名定下后不能改；老账号（形如 `molly@example.com`）在云端会变成 `molly@example.com@molly.local` | S3 绑定云端账号时按 `docs/13` §5.3 处理：不迁密码，云端账号重建 |

---

## 6. 未验证项

1. **真实 Supabase 项目**：本机无 `.env.local`、无 PostgreSQL，`stage1`–`stage4` 四个迁移从未真实执行。S1 未新增 SQL，因此不受影响；但 S5 的两个 RPC 必须有真实项目才能验收。
2. **`verify:pwa` 的 `ALREADY_WORK` 分支**（§4.3）。
3. **`cloudSyncConfigured === true` 时的行为**：S1 阶段还没有任何代码读它做分支（同步卡在 S3 才做），因此「配置了云端会怎样」尚未定义，也无从验证。

---

## 7. 对下一阶段的影响

- **S2 的入口是干净的**：`localDb.ts` 的 `put` / `remove` / `runTransaction` 是本次唯一要改的写入层文件，S1 没有动过它。
- **S2 要注意的一处耦合**：仓库三分类拆分（`USER_DATA_STORES` / `META_STORES` / `DEVICE_STORES`）会同时影响 `recordSchemas.ts`、`backupFormat.ts` 与 `check:local-data`、`check:backup` 两个脚本。`check:backup` 的 62 项必须保持全绿——它是「设备仓库没有污染备份」的唯一证据。
- **S2 结束时应用仍不该发任何网络请求**，`verify:local` 的零跨域断言会守住这条。
