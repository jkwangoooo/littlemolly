# PWA 外壳完成报告：移动端持久化（manifest / service worker / 存储状态）

- 日期：2026-09-16
- 范围：`docs/15-next-session-handoff-and-prompt.md` §4「待办 A：移动端持久化（PWA 层）」
- 基线：进入本任务时 `verify:local` 94/94、`check:dates` 48/48、`check:local-data` 27/27、`check:backup` 55/55、`check:cloud-parity` 50/50

## 1. 结论

**待办 A 完成。** 应用现在有完整的 PWA 外壳（manifest、四张 PNG 图标、手写 service worker），
dev 模式仍然**不注册** service worker，`verify:local` 保持 **94/94** 不变；新增的 `verify:pwa`
跑生产构建产物，**35/35 通过**。本地与云端两种构建产物互不污染的性质未被破坏。

本地数据是否留得住，现在多了一层真实的保障（安装到主屏幕 → 独立存储分区 + 缓存的应用壳），
但**没有变成「数据安全了」**：`persist()` 只是请求，备份仍是唯一的兜底路径，这一点在界面文案与
本报告里都保持同样的说法。

## 2. 任务达成

| # | 要求 | 结果 |
| --- | --- | --- |
| 1 | manifest + index.html 安装元信息 | `public/manifest.webmanifest`（name / short_name / start_url / scope / display: standalone / theme_color / background_color / 3 个 icons）；index.html 补 `rel=manifest`、`apple-touch-icon` 180、`mobile-web-app-capable`、`apple-mobile-web-app-capable`、`apple-mobile-web-app-status-bar-style`、`apple-mobile-web-app-title` |
| 2 | 图标 192 / 512 / maskable / 180 | `npm run icons`（`scripts/generate-icons.mjs`）用本机 Chrome 无头渲染 favicon.svg 生成四张 PNG，脚本自校验 IHDR 尺寸；无新增依赖 |
| 3 | service worker 应用壳预缓存 | `public/sw.js`：HTML/manifest 网络优先 + 3 秒超时回退，静态资源缓存优先，缓存名带构建戳，activate 清旧缓存，只处理同源 GET，新版本提示不静默替换 |
| 4 | 只在生产构建注册 | `src/shared/pwa/serviceWorker.ts` 用 `import.meta.env.PROD` 早退；dev 下 `getRegistrations()` 为空（`verify:pwa` 第 2 项断言） |
| 5 | `navigator.storage.persist()` | `src/shared/storage/storageStatus.ts`：先 feature-detect，启动时请求一次（幂等），与 `estimate()` 的用量一起记入模块快照 |
| 6 | 安装引导与存储状态卡片 | `src/features/preferences/components/StorageCard.tsx`：用量 / 是否持久化 / 是否独立窗口三行事实；iOS 给「分享 → 添加到主屏幕」步骤；Android 用 `beforeinstallprompt` 出安装按钮 |
| 7 | `scripts/verify-pwa.mjs` + `npm run verify:pwa` | 35 项，跑 `dist/`，自建零依赖静态服务器（空闲端口），`Storage.clearDataForOrigin` 显式列出 `indexeddb,local_storage,cache_storage,service_workers` |

「明确不做」的六项（SPA 路由、后台同步/推送、改业务服务层、改数据库结构、懒加载重构、动 docs/01 不变量）均未触碰。

## 3. 新增 / 修改文件

**新增（8 个）**

- `public/manifest.webmanifest`
- `public/sw.js`（手写 service worker）
- `public/icons/icon-192.png`、`public/icons/icon-512.png`、`public/icons/icon-maskable-512.png`、`public/apple-touch-icon.png`
- `src/shared/pwa/serviceWorker.ts`（注册 + 更新状态）
- `src/shared/storage/storageStatus.ts`（持久化请求与快照）、`src/shared/storage/installPrompt.ts`（`beforeinstallprompt` 捕获）
- `src/shared/components/UpdateNotice.tsx`、`src/shared/hooks/useServiceWorkerUpdate.ts`
- `src/features/preferences/components/StorageCard.tsx`
- `scripts/generate-icons.mjs`、`scripts/verify-pwa.mjs`、`scripts/lib/find-browser.mjs`

**修改（10 个）**

- `index.html`（安装元信息）、`src/main.tsx`（早期挂安装事件监听、注册 SW、请求持久化、挂更新提示）
- `src/features/preferences/PreferencesScreen.tsx`（挂 StorageCard）、`preferencesLabels.ts`（新增存储与安装文案段）
- `src/app/styles.css`（`.storage-card` / `.storage-facts` / `.update-notice`）
- `src/vite-env.d.ts`（声明 `__BUILD_STAMP__`）、`vite.config.ts`（`define` 注入构建戳）
- `scripts/verify-local.mjs`（浏览器定位改为共用 `scripts/lib/find-browser.mjs`）
- `package.json`（`verify:pwa`、`icons`）、`README.md`（命令、说明与真机验收步骤）

## 4. 关键设计决策

### 4.1 dev 不注册 SW，是为了不动已经验收过的用例

`verify-local.mjs` 有两个用例依赖「请求真的发到服务器」：冷升级用例用 CDP 把 `/src/main.tsx`
的响应换成空模块来先造 v1 老库；清空站点数据用例用 `Storage.clearDataForOrigin`。
dev 下只要注册了 SW，这两招都会被缓存挡住。因此约束落在**应用侧**（`import.meta.env.PROD` 早退），
另开一个跑生产产物的 `verify:pwa`，而不是回头修改那两个用例。

### 4.2 缓存名由构建戳决定，不手写版本号

`vite.config.ts` 在构建开始时取 `Date.now()` 注入 `__BUILD_STAMP__`，页面注册时拼成
`/sw.js?build=<戳>`，SW 从自己的 URL 里取这个戳命名缓存。手写的版本号一定会忘记改；
而构建戳一变就是一次新安装，activate 按前缀清掉上一版缓存。dev 不注册，所以这个值只影响生产构建。

### 4.3 更新策略保守：不 `skipWaiting`、不 `clients.claim`

新版本装好后停在 waiting，当前页面继续用旧版本跑完。用户可能正在编辑一份计划，
静默换版本等于让他的输入凭空消失。界面只提示「新版本已下载，刷新后生效」，
用户点了刷新才 `postMessage(SKIP_WAITING)`，并在 `controllerchange` 后重新加载。

### 4.4 只碰同源 GET

`fetch` 处理器的第一件事就是 `method !== 'GET'` 与 `origin !== 自己的源` 时直接 return，
交给浏览器默认处理。跨域响应一旦进缓存，就等于在本地伪造云端状态：断网时会「读得到上一次的数据」，
而用户以为那是云端实时结果。`verify:pwa` 有一条断言检查缓存里没有任何跨域条目。

### 4.5 图标用浏览器渲染，不引入图像库

本机没有 ImageMagick，为了四张静态图装一个图像库不划算。验收脚本本来就依赖本机 Chrome，
于是复用同一个内核：`chrome --headless=new --window-size=N,N --screenshot=...`。
产物满幅不透明（iOS 会把带透明像素的 apple-touch-icon 渲染成黑底，Android 会裁掉 maskable 的四角），
maskable 的 M 再缩小到 0.82 倍以保证落在安全区内。

### 4.6 存储状态只说事实

`persist()` 返回 false 是正常结果而不是错误；拿到了也只是降低被清理的概率。
所以卡片写「未获得（浏览器暂未批准）」「这个浏览器不支持申请」，不写「已保护」「已同步」；
`verify:pwa` 有一条断言专门检查卡片文案里不出现「已同步」。

### 4.7 iOS 安全区：装到主屏幕之后才真正显形的问题

底部固定导航与底部面板都贴着屏幕下沿，而 `index.html` 的 viewport 原本没有 `viewport-fit=cover`，
`.bottom-nav` 也没有让出安全区——**装上主屏幕后没有浏览器工具栏兜底，导航会直接压在 Home 指示条上**，
也就是说「安装」这件事本身把这个问题变严重了。本任务顺手修掉：

- `viewport-fit=cover`（没有它 `env(safe-area-inset-*)` 恒为 0，写了也没用）；
- `.page` 上下内边距、`.bottom-nav` 下内边距、`.bottom-sheet` 下内边距、`.update-notice` 的 `bottom`
  全部改成 `calc(原值 + env(safe-area-inset-*, 0px))`，窄屏覆盖值也跟着改；
- `env()` 不被支持时那些是无效声明、整行被丢弃，回落到原有数值，因此对桌面浏览器零影响。

**这一条是可自动验收的**：Chrome 152 支持 `Emulation.setSafeAreaInsetsOverride`，
`verify:pwa` 给一个 34px 的底部安全区，断言导航的 `padding-bottom` 变成 34px、页面变成 114px。
最初以为「安全区只能真机验」，实测 CDP 能模拟，于是把推断变成了断言。

## 5. 验收证据

### 5.1 工程三件套与静态回归（全部复现）

```
npm run typecheck        → 通过（无输出）
npm run lint             → 通过（无输出）
npm run build            → 91 modules，dist/assets/index-*.js 275.63 kB（gzip 85.71 kB）、css 9.34 kB
npm run check:dates      → 48/48 通过
npm run check:local-data → 27/27 通过
npm run check:backup     → 55/55 通过
npm run check:cloud-parity → 50/50 通过
npm run verify:local     → 94/94 通过
```

模块数与体积相比 L6 阶段一的 85 modules / 269.00 kB 增加到 91 / 275.63 kB（+6.63 kB），
来自存储卡片、SW 注册与更新提示三处新代码，属预期增长。

### 5.2 双向产物体检

```
npm run build                                 → 0 命中 supabase|PostgREST|GoTrueClient|copy_yesterday
npx vite build --mode cloud --outDir dist-cloud → 135 modules / 489.90 kB（gzip 141.83 kB），0 命中 indexedDB|happy-little-molly-local
```

两种产物都带上了 PWA 外壳（`sw.js` / `manifest.webmanifest` / `icons/`）。

### 5.3 `npm run verify:pwa`：35/35 通过

```
PASS  生产构建产出完整应用壳（sw.js / manifest / 图标）
PASS  dev server 上渲染出登录页（确认 dev 页面确实跑起来了）
PASS  dev 模式下没有注册任何 service worker  → registrations=0, controller=null
PASS  生产构建首屏渲染登录页
PASS  manifest 字段齐全  → display=standalone, start_url=/, scope=/
PASS  manifest 的 icons 含 192/512 any 与 512 maskable  → 3 个
PASS  index.html 含 iOS / Android 安装所需 meta 与 apple-touch-icon
PASS  manifest 与 HTML 里引用的每个图标都能取到且是图片  → 8 个全部 200
PASS  service worker 注册成功并 activated  → active=.../sw.js?build=1789546623411
PASS  刷新后页面由 service worker 接管
PASS  Cache Storage 里存在应用壳缓存（缓存名带构建戳）  → molly-shell-1789546623411
PASS  应用壳缓存包含 HTML / JS / CSS / manifest / 图标  → 共 9 条
PASS  缓存里没有任何跨域条目（Supabase 之类一律不缓存）  → 9 条全部同源
PASS  生产首屏（含 SW 注册）控制台无 error / warning
PASS  CDP 模拟断网后刷新仍渲染登录页
PASS  关掉服务器后刷新仍渲染登录页（应用壳来自缓存）
PASS  断网时仍能注册并进入日计划页（IndexedDB 离线可写）
PASS  断网时读得到已写入的本地数据（示例食物与补剂来自 IndexedDB）
PASS  恢复网络后刷新，会话与数据仍在
PASS  重新构建后新版本处于 waiting（当前页面仍在跑旧版本，未被静默替换）
PASS  页面出现「新版本已下载」提示
PASS  新版本装好但未接管前，旧缓存仍在（不提前清理）
PASS  用户确认刷新后新版本接管（active 的构建戳已更新）
PASS  旧缓存被清理，只剩当前版本的应用壳  → molly-shell-1789546652172
PASS  选项页有存储状态卡片，三行事实都有值  → 用量=907 KB / 可用 10 GB / 持久化=未获得（浏览器暂未批准） / 运行方式=浏览器标签页
PASS  卡片文案不夸大（不出现「已同步」这类不成立的结论）
PASS  未安装时如实显示为浏览器标签页
PASS  浏览器给出安装入口时，卡片提供「安装到主屏幕」按钮  → beforeinstallprompt 已被捕获，按钮已渲染
PASS  独立窗口状态下卡片显示「独立窗口（已安装到主屏幕）」  → display-mode:standalone=true
PASS  独立窗口下给出「已安装」说明而不是继续引导安装
PASS  独立窗口首屏可正常渲染（已安装后的观感，截图已落盘）
PASS  桌面 1440x900 无横向溢出  → scrollWidth=1425, innerWidth=1440
PASS  手机 390x844 无横向溢出  → scrollWidth=390, innerWidth=390
PASS  iOS 安全区：底部导航与页面为 Home 指示条让出空间  → viewport-fit=cover=true, 导航 padding-bottom=34px, 页面 padding-bottom=114px
PASS  更新流程与存储卡片段控制台无 error / warning

结果：35/35 通过
```

断网做了两层：先按提示词用 `Network.emulateNetworkConditions` 模拟，再把静态服务器**真的关掉**
（这是更强的证据——模拟断网未必拦得住 service worker 自己发出的请求，而关掉服务器一定拦得住）。
服务器随后在**同一个端口**恢复，换端口就换了源，缓存与 IndexedDB 就不是同一份数据了，验证会变成假的。

### 5.4 截图人工核对（`SHOT_DIR`）
`01-app-login`、`02-app-standalone-first-screen`、`02b-app-standalone-storage-card`、
`03-icons-preview`、`04-options-desktop`、`05-options-mobile`、`06-storage-card-mobile`。
已逐张核对：四张图标形状与安全区正常、maskable 的 M 明显小于 any 版；
独立窗口首屏无地址栏、登录页排版正常；选项页桌面与手机均无横向溢出；存储卡片三行对齐、文案完整。

「已安装」这一支用 `--app=<url>` 真的开了一个应用窗口来验，不是打桩：
CDP 的 `Emulation.setEmulatedMedia` **不支持** `display-mode`（实测 `matchMedia` 仍为 false），
而 `--app=` 下 `matchMedia('(display-mode: standalone)')` 为真，这是目前唯一能自动化的真实路径。

### 5.5 真机验证用的线上部署（2026-09-16）

真机安装必须走 HTTPS，所以把**生产构建产物**（`dist/`，不是源码）作为静态站点发布了一次：

- 链接：`https://f033473469da4daf849ebd353b47443f.sg2.agentos-app.run`
- **为什么发布 `dist/` 而不是项目源码**：dev server 刻意不注册 service worker，
  发布源码让沙箱跑 dev 的话，手机上既装不上也验不了离线，这个真机环节就白做了。
- 发布后先量了响应头，确认服务端给出的 MIME 正确：
  `manifest.webmanifest` → `application/manifest+json`、`sw.js` → `text/javascript`、
  `assets/*.js` → `text/javascript`、图标 → `image/png`。MIME 不对的话 manifest 解析不了、
  worker 也注册不上，这两项都是「看起来发布了、其实装不上」的典型原因。
- 又对着**线上链接**跑了一次一次性冒烟（脚本跑完即弃，未进仓库）：**8/9 通过**。
  首屏、manifest、图标、SW activated、刷新后受控、应用壳缓存完整且全同源、断网刷新仍能打开——
  全部通过；唯一一条 FAIL 是断网段控制台的 `ERR_INTERNET_DISCONNECTED`，即上面 6.1 第 4 条记录的
  network-first 正常代价，不是缺陷。
- 这条链接是当前构建的静态快照，随时可以下线；它只用于真机安装验收，不是正式发布。

## 6. 缺陷、延后项与未验证项
### 6.1 本次发现并修掉的问题

1. **应用壳缓存会被非壳导航污染（设计缺陷，在写成断言之前先修掉）**：初版 `networkFirst`
   把所有导航请求都写进 `index.html` 那个缓存键。只要访问一次不存在的路径，404 页面就会被写进应用壳，
   下次断网打开应用看到的就是那个 404。已改为只有 `/` 与 `/index.html` 两种导航共用一个键，
   其它路径只走网络不写缓存。
2. **`verify:pwa` 首轮 3 项失败**：
   - dev 首屏断言用了固定等待，而 Vite 首次访问要预构建依赖，页面还没渲染就断言了 → 改为轮询等文案出现；
   - `display-mode` 模拟无效（见 5.4）→ 改为真的开应用窗口；
   - 控制台出现一个 404 → 定位到验收用的图标预览页没有 favicon 链接，Chrome 于是回退请求 `/favicon.ico`。
     已给预览页补 favicon，并让控制台断言输出报错来源 URL（原来只说「404」，无法定位）。
3. **截图拍错了窗口**：独立窗口的两张截图最初用的是主窗口的 CDP 连接，两张图字节数完全相同。
   已改为用该窗口自己的连接截图，并把「卡片滚进视野」单独拍一张——截首屏是看不到卡片的。
4. **断网时控制台会出现一条 `net::ERR_INTERNET_DISCONNECTED`（观察，不是缺陷）**：
   这是「HTML 网络优先」的正常代价——断网时 worker 仍然会先试网络，失败才回退缓存，
   浏览器会把这次失败记进控制台。应用行为完全正确（页面正常渲染），所以**不要**为了让控制台干净
   把 HTML 改成缓存优先：那会让每次上线都拿不到新版本。
   因此 `verify:pwa` 里的「控制台无 error / warning」断言**刻意只覆盖非断网段**，
   断网段单独断言「页面仍然渲染得出来」。这个覆盖范围是有意的，不是漏测。

### 6.2 延后项
1. **`npm run build:cloud` 会写进 `dist/`**（而不是 `dist-cloud/`）：它等价于
   `tsc -b && vite build --mode cloud`，跑完之后 `dist/` 里就是云端产物，接着跑 `verify:pwa`
   会验错对象。本次按 docs/15 的写法用 `npx vite build --mode cloud --outDir dist-cloud`，
   并在流程末尾重新跑了一次本地 `npm run build` 把 `dist/` 恢复成本地产物。
   这是既有行为，本次未改（改它属于构建脚本范围），但值得单独修一次。
2. `verify-local.mjs` 与 `verify-pwa.mjs` 各自有一份 CDP 连接 / 启动浏览器的辅助代码（约 70 行重复）。
   本次刻意没有合并：把已经稳定在 94/94 的验收脚本与新脚本一起重构，风险大于收益。
   后续若要合并，抽到 `scripts/lib/` 即可（浏览器定位已经这么做了）。
3. L4/L5 遗留：**iOS 安全区已在本次修掉并自动验收**（见 4.7）；剩下「真机软键盘顶起输入框」
   这一条仍未核对——它需要真机与真实输入法，无头环境验不了，照旧挂账。

### 6.3 未验证项（缺条件，不是缺陷）

1. **iOS 上「添加到主屏幕」之后是否真的拿到独立存储分区、是否真的不计入 7 天计时**：
   桌面浏览器无法验证，只能真机核对。**未验证**，不能当作已完成。
2. **iOS 上 `navigator.storage.persist()` 的实际返回值**：iOS Safari 没有这个 API，
   代码里走的是 feature-detect 的「不支持」分支（卡片显示「这个浏览器不支持申请」），
   但真机上到底怎么显示**未验证**。
3. **真机安装观感**：Android Chrome 的安装按钮（`beforeinstallprompt`）在无头 Chrome 里**会**触发，
   因此「按钮被渲染出来」这一环已由 `verify:pwa` 断言覆盖；但**点击之后进入的系统安装流程**未验证
   （无头环境弹不出安装对话框，硬点会挂在 `userChoice` 上，所以脚本只断言按钮存在，不点它）。
   iOS 的分享面板路径无法自动化，完全未验证。
4. **跨浏览器差异**：仅在 Chrome 无头内核上验证过（与既有验收口径一致），未跑 Firefox / Safari。

## 7. 结论

待办 A 的七项要求全部落地，行为基线未回退（`verify:local` 94/94），新增 `verify:pwa` 35/35。
本地数据在移动端的留存路径从「只能导出备份」变成「安装到主屏幕 + 备份」两条，
但**备份仍然是唯一的兜底**：卸载浏览器、手动清理数据、iOS 上始终不安装都会丢，
这条事实在界面文案与本报告里保持同一个说法。

下一步仍是 `docs/15` §5 的待办 B（L6 阶段二：真实项目验收 + 上行迁移），它需要真实 Supabase 凭据；
本机当前没有 `.env.local`，因此本任务只做待办 A，未触碰云端任何代码与迁移。
