#!/usr/bin/env node
<<<<<<< HEAD
// Real browser, production Auth SDK and IndexedDB. Only HTTP responses are fixtures.
import {
  createAuthFixture, FIXTURE_UID, OTHER_UID, FIXTURE_PASSWORD,
} from './lib/auth-fixture.mjs'
import {
  DB_NAME, startDevServer, stopProcess, launchBrowser, createRecorder, sleep,
} from './lib/browser-harness.mjs'

const { record, finish } = createRecorder()
const ROOT_STORES = ['day_plans', 'food_options', 'supplement_templates', 'exercise_options']
const LEGACY_UID = 'legacy-local-owner'
let server
let browser
let unconfiguredServer
let unconfiguredBrowser
let transientBrowser

const apiHelpers = `(async()=>{
  window.__v={
    auth:await import('/src/services/api/authService.ts'),
    plan:await import('/src/services/api/dayPlanService.ts'),
    options:await import('/src/services/api/optionService.ts'),
    backup:await import('/src/services/api/backupService.ts'),
    dates:await import('/src/shared/date/dateUtils.ts'),
    session:await import('/src/services/session.ts')
  };
  window.__reject=async(work)=>{try{await work();return null}catch(error){return error.message}};
  return true
})()`
const phase = () => browser.evaluate(`window.__v.auth.getAuthState().phase`)
const evaluate = (expression) => browser.evaluate(expression)
const errorOf = (expression) => evaluate(`window.__reject(async()=>${expression})`)
const stableRows = (snapshot) => JSON.stringify(snapshot.rows)
const queueOf = (snapshot) => snapshot.rows.sync_outbox.filter((row) => row.local_user_id === FIXTURE_UID)
const settle = async () => { await sleep(150); await browser.installHelpers() }

async function seedLegacyDatabase() {
  await browser.navigate(`${server.url}favicon.svg`)
  await evaluate(`new Promise((done,reject)=>{
    const request=indexedDB.open(${JSON.stringify(DB_NAME)},1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      const users=db.createObjectStore('users',{keyPath:'id'});
      users.createIndex('email','email',{unique:true});
      const plans=db.createObjectStore('day_plans',{keyPath:'id'});
      plans.createIndex('user_date',['user_id','plan_date'],{unique:true});
      plans.createIndex('user_id','user_id');
      const meals=db.createObjectStore('daily_meals',{keyPath:'id'});
      meals.createIndex('plan_type',['day_plan_id','meal_type'],{unique:true});
      meals.createIndex('day_plan_id','day_plan_id');
      const tasks=db.createObjectStore('custom_tasks',{keyPath:'id'});
      tasks.createIndex('day_plan_id','day_plan_id');
      users.put({id:${JSON.stringify(LEGACY_UID)},email:'W',password_hash:'old-password-hash',created_at:'2020-01-01T00:00:00.000Z'});
      plans.put({id:'legacy-plan',user_id:${JSON.stringify(LEGACY_UID)},plan_date:'2020-01-06',mode:'work',mode_override:false,
        created_at:'2020-01-01T00:00:00.000Z',updated_at:'2020-01-01T00:00:00.000Z',outfit_ready:false,meals_ready:true,
        supplements_ready:false,morning_ready:false,exercise_ready:true,morning_focus:'旧晨间',morning_completed:false,
        exercise_decision:'exercise',exercise_note:'旧备注',exercise_completed:true,exercise_content:'旧健身'});
      meals.put({id:'legacy-meal',day_plan_id:'legacy-plan',meal_type:'breakfast',note:'旧餐备注',completed:true,plan_content:'旧早餐'});
    };
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{request.result.close();done(true)}
  })`)
  await evaluate(`localStorage.setItem('happy-little-molly.session',JSON.stringify({user:{id:${JSON.stringify(LEGACY_UID)},username:'W'}}))`)
}

async function assertRejectedWithoutWrites(name, expression) {
  const before = stableRows(await browser.readDb())
  const problem = await errorOf(expression)
  record(name, Boolean(problem), problem ?? 'request unexpectedly succeeded')
  record(`${name}：库与队列零写入`, stableRows(await browser.readDb()) === before)
}

async function loginAgain(fixture) {
  fixture.offline = false
  await browser.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await evaluate(`window.__v.auth.signIn(' w ',${JSON.stringify(FIXTURE_PASSWORD)})`)
  await browser.ready()
  await settle()
}

async function cacheOffline(fixture) {
  fixture.offline = true
  await browser.cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  await evaluate(`window.__v.auth.retryAuth()`)
}

async function openBubbleEditor(id) {
  await browser.until(`!document.querySelector('[data-editor-backdrop],.bubble-detail-sheet')`)
  await browser.clickBubble(id)
  await browser.until(`!!document.querySelector('.bubble-detail-sheet')`)
  await evaluate(`window.__m.click('编辑',document.querySelector('.bubble-detail-sheet'))`)
  await browser.until(`!!document.querySelector('[data-editor-backdrop]')`)
  await browser.until(`!document.querySelector('.bubble-detail-sheet')`)
  if (id === 'exercise_ready') {
    await browser.until(`Boolean([...document.querySelectorAll('[data-editor-backdrop] label')].find((label) => label.textContent.trim().startsWith('安排'))?.querySelector('select'))`)
  }
}

async function saveEditor() {
  await evaluate(`window.__m.click('保存',document.querySelector('[data-editor-backdrop]'))`)
  await browser.until(`!document.querySelector('[data-editor-backdrop]')`)
  await settle()
}

async function tomorrowRows() {
  return evaluate(`(async()=>{const date=window.__v.dates.addDays(window.__v.dates.getBusinessDateKey(),1);const plan=await window.__v.plan.getDayPlan(date);return {plan,meals:await window.__v.plan.listMeals(plan.id),items:await window.__v.plan.listMealItems(plan.id),supp:await window.__v.plan.listDaySupplements(plan.id),ex:await window.__v.plan.listExerciseItems(plan.id),tasks:await window.__v.plan.listCustomTasks(plan.id)}})()`)
}

async function optionMenu(id, action) {
  await evaluate(`document.querySelector('[data-option-id="'+${JSON.stringify(id)}+'"] .row-menu-trigger').click()`)
  await settle()
  await evaluate(`window.__m.click(${JSON.stringify(action)})`)
  await settle()
}

async function main() {
  unconfiguredServer = await startDevServer({ configured: false })
  unconfiguredBrowser = await launchBrowser({ label: 'local-no-config' })
  await unconfiguredBrowser.navigate(unconfiguredServer.url)
  await unconfiguredBrowser.until(`document.body.innerText.includes('配置')`)
  const missing = await unconfiguredBrowser.evaluate(`(async()=>{const auth=await import('/src/services/api/authService.ts');let error='';try{await auth.signIn('W','unused')}catch(e){error=e.message}return {phase:auth.getAuthState().phase,error}})()`)
  record('缺少 Auth 配置时显示实际原因并封闭业务', missing.phase === 'error' && Boolean(missing.error))
  record('无配置不能进入日程或本地注册', await unconfiguredBrowser.evaluate(`!document.querySelector('.bottom-nav')&&!document.body.innerText.includes('注册')`))
  const noConfigRequests = unconfiguredBrowser.cdp.events.filter((event) => event.method === 'Network.requestWillBeSent').map((event) => event.params.request.url)
  record('无配置没有第三方网络请求', noConfigRequests.filter((url) => /^https?:/.test(url) && new URL(url).origin !== new URL(unconfiguredServer.url).origin).length === 0)
  record('无配置不下载云端 SDK', !noConfigRequests.some((url) => /supabase|authSession/.test(url)))
  await unconfiguredBrowser.close()
  unconfiguredBrowser = null
  await stopProcess(unconfiguredServer.child)
  unconfiguredServer = null

  server = await startDevServer()
  transientBrowser = await launchBrowser({ label: 'local-auth-retry' })
  const transientFixture = createAuthFixture()
  await transientFixture.attach(transientBrowser.cdp)
  transientFixture.rejectGate = 'fixture temporary gate failure'
  await transientBrowser.navigate(server.url)
  await transientBrowser.login()
  await transientBrowser.until(`document.body.innerText.includes('fixture temporary gate failure')`)
  record('首次门禁 500 如实显示且不开放工作区', !await transientBrowser.evaluate(`!!document.querySelector('.bottom-nav')`))
  record('临时门禁失败不写永久认证锁', await transientBrowser.evaluate(`localStorage.getItem('happy-little-molly.auth-lock.v1')===null`))
  await transientBrowser.reload()
  await transientBrowser.until(`document.body.innerText.includes('fixture temporary gate failure')`)
  const requestCounts = { auth: transientFixture.auth.length, gate: transientFixture.rest.filter((row) => row.name === 'account_access').length }
  transientFixture.rejectGate = null
  await transientBrowser.evaluate(`(async()=>{window.__auth=await import('/src/services/api/authService.ts');await window.__auth.retryAuth();return true})()`)
  await transientBrowser.ready()
  record('初始化门禁 500 后 retryAuth 可恢复 ready', await transientBrowser.evaluate(`window.__auth.getAuthState().phase==='ready'`))
  record('重试重新验证 SDK user 与服务端门禁', transientFixture.auth.length > requestCounts.auth && transientFixture.rest.filter((row) => row.name === 'account_access').length > requestCounts.gate)
  await transientBrowser.until(`import('/src/services/api/syncService.ts').then(async sync=>(await sync.readSyncStatus()).pendingCount===0)`)
  transientFixture.gateAllowed = false
  const denied = await transientBrowser.evaluate(`window.__auth.retryAuth().then(()=>null,error=>error.message)`)
  await transientBrowser.until(`window.__auth.getAuthState().phase==='reauth-required'`)
  await transientBrowser.until(`!!document.querySelector('input[type="password"]')`)
  const deniedState = await transientBrowser.evaluate(`({phase:window.__auth.getAuthState().phase,nav:!!document.querySelector('.bottom-nav'),lock:localStorage.getItem('happy-little-molly.auth-lock.v1')})`)
  record('门禁明确 allowed:false 关闭业务并写认证锁', Boolean(denied) && deniedState.phase === 'reauth-required' && !deniedState.nav && Boolean(deniedState.lock), JSON.stringify({ denied, ...deniedState }))
  transientFixture.gateAllowed = true
  record('门禁恢复后 retryAuth 不能绕过明确拒绝', Boolean(await transientBrowser.evaluate(`window.__auth.retryAuth().then(()=>null,error=>error.message)`)))
  await transientBrowser.evaluate(`window.__auth.signIn('W',${JSON.stringify(FIXTURE_PASSWORD)})`)
  await transientBrowser.ready()
  record('明确拒绝后重新输入原账号可清锁恢复', await transientBrowser.evaluate(`window.__auth.getAuthState().phase==='ready'&&localStorage.getItem('happy-little-molly.auth-lock.v1')===null`))
  transientFixture.rejectLogout = true
  record('退出请求失败如实返回错误', Boolean(await transientBrowser.evaluate(`window.__auth.signOut().then(()=>null,error=>error.message)`)))
  record('退出请求失败仍立即关闭工作区', await transientBrowser.evaluate(`window.__auth.getAuthState().phase==='signed-out'&&!document.querySelector('.bottom-nav')`))
  transientFixture.offline = true
  await transientBrowser.reload()
  await transientBrowser.until(`!!document.querySelector('input[type="password"]')`)
  record('退出失败后离线刷新不能恢复缓存工作区', await transientBrowser.evaluate(`!document.querySelector('.bottom-nav')&&Boolean(localStorage.getItem('happy-little-molly.auth-lock.v1'))`))
  await transientBrowser.close()
  transientBrowser = null

  browser = await launchBrowser({ label: 'local' })
  const fixture = createAuthFixture()
  await fixture.attach(browser.cdp)
  await seedLegacyDatabase()
  await browser.navigate(server.url)
  await browser.until(`!!document.querySelector('input[type="password"]')`)
  await browser.installHelpers()
  await evaluate(apiHelpers)
  await evaluate(`(async()=>{const db=await import('/src/services/local/localDb.ts');await db.getAll('legacy_users')})()`)
  const migrated = await browser.readDb()
  record('旧 v1 数据库追加升级至 v8，18 张仓库齐备', migrated.version === 8 && migrated.names.length === 18)
  record('旧账号资料隔离且不保存本地密码', migrated.rows.users.length === 0 && migrated.rows.legacy_users.some((row) => row.id === LEGACY_UID) && !JSON.stringify(migrated.rows).includes('old-password-hash'))
  record('旧账号唯一索引移除', !migrated.indexes.users.includes('email') && !migrated.indexes.users.includes('username'))
  record('旧业务 owner 保持原值，没有同名 W 自动认领', migrated.rows.day_plans.find((row) => row.id === 'legacy-plan')?.user_id === LEGACY_UID)
  record('旧三餐与健身自由文本迁成名称快照', migrated.rows.daily_meal_items.some((row) => row.food_name_snapshot === '旧早餐') && migrated.rows.daily_exercise_items.some((row) => row.name_snapshot === '旧健身'))
  record('旧本地会话不能通过认证门禁', (await phase()) === 'signed-out' && !await evaluate(`!!document.querySelector('.bottom-nav')`))
  record('结构升级不产生上传队列', migrated.rows.sync_outbox.length === 0)
  record('登录表单只含账号密码，账号默认 W', await evaluate(`document.querySelector('input:not([type=password])')?.value==='W'&&!document.body.innerText.includes('注册')`))
  record('认证门面不再暴露本地注册或旧会话入口', await evaluate(`!('signUp' in window.__v.auth)&&!('getSession' in window.__v.auth)`))
  await assertRejectedWithoutWrites('未认证业务写入被拒绝', `window.__v.options.createOption('food',{name:'forbidden'})`)
  record('错误密码被真实 SDK HTTP 认证拒绝', Boolean(await errorOf(`window.__v.auth.signIn('W','wrong-password')`)))
  record('错误密码不创建本地资料', (await browser.readDb()).rows.users.length === 0 && (await phase()) !== 'ready')
  record('密码尾部空格不被前端 trim', Boolean(await errorOf(`window.__v.auth.signIn('W',${JSON.stringify(`${FIXTURE_PASSWORD} `)})`)) && fixture.auth.at(-1)?.body.password === `${FIXTURE_PASSWORD} `)
  const tokensBeforeUnknown = fixture.auth.length
  record('未知账号被拒绝', Boolean(await errorOf(`window.__v.auth.signIn('old-user',${JSON.stringify(FIXTURE_PASSWORD)})`)))
  record('未知账号不触发自动注册', fixture.auth.length === tokensBeforeUnknown && !fixture.auth.some((request) => request.path.endsWith('/signup')))
  fixture.userId = OTHER_UID
  fixture.userMetadata = { username: 'W' }
  record('伪造 W 元数据的旧 UID 被服务端门禁拒绝', Boolean(await errorOf(`window.__v.auth.signIn('W',${JSON.stringify(FIXTURE_PASSWORD)})`)))
  record('旧 UID 被拒后没有创建工作区', !(await browser.readDb()).rows.workspace_state.some((row) => row.id === OTHER_UID))
  fixture.userId = FIXTURE_UID
  fixture.userMetadata = {}
  fixture.rejectGate = 'fixture account gate unavailable'
  record('门禁服务失败不能降级本地成功', Boolean(await errorOf(`window.__v.auth.signIn('W',${JSON.stringify(FIXTURE_PASSWORD)})`)) && (await phase()) !== 'ready')
  fixture.rejectGate = null
  fixture.rejectSnapshot = 'fixture snapshot unavailable'
  record('首次快照失败不被当成空云端', Boolean(await errorOf(`window.__v.auth.signIn('W',${JSON.stringify(FIXTURE_PASSWORD)})`)) && !(await browser.readDb()).rows.workspace_state.some((row) => row.id === FIXTURE_UID))
  fixture.rejectSnapshot = null
  fixture.hold = 'export_cloud_snapshot'
  await evaluate(`window.__login=window.__v.auth.signIn('W',${JSON.stringify(FIXTURE_PASSWORD)}).then(()=>true,error=>error.message);true`)
  await browser.until(`window.__v.auth.getAuthState().phase==='preparing'`)
  record('首次恢复完成前不挂载业务页', !await evaluate(`!!document.querySelector('.bottom-nav')`))
  await assertRejectedWithoutWrites('准备过程中普通写入被拒绝', `window.__v.options.createOption('food',{name:'early-write'})`)
  await fixture.release()
  await browser.ready()
  record('无用户名元数据仍完成真实认证与空工作区准备', await evaluate(`window.__login`) === true && (await phase()) === 'ready')
  record('认证及本地资料统一使用 Supabase UID', await evaluate(`window.__v.auth.currentUser().id`) === FIXTURE_UID && (await browser.readDb()).rows.users.some((row) => row.id === FIXTURE_UID && !('password_hash' in row)))
  record('空云端必须明确准备并标记工作区', (await browser.readDb()).rows.workspace_state.some((row) => row.id === FIXTURE_UID && row.initialized && row.initialized_from === 'empty'))
  record('活动同步状态使用同一 UID，不保留 cloud_user_id', (await browser.readDb()).rows.sync_state.every((row) => row.id === FIXTURE_UID && !('cloud_user_id' in row)))
  record('当前账号读不到隔离旧计划', await evaluate(`window.__v.plan.getDayPlan('2020-01-06')`) === null)

  // Keep automatic uploading from retiring rows while exercising local transactions.
  await cacheOffline(fixture)
  await evaluate(`window.__today=window.__v.dates.getBusinessDateKey();window.__tomorrow=window.__v.dates.addDays(window.__today,1);window.__future=window.__v.dates.addDays(window.__today,8);true`)
  const seedBefore = await evaluate(`Promise.all(['food','supplement','exercise'].map(kind=>window.__v.options.listOptions(kind))).then(rows=>rows.map(list=>list.length))`)
  record('新工作区不自动播种示例选项', seedBefore.every((count) => count === 0))
  await evaluate(`window.__v.options.seedExampleOptionsForCurrentUser()`)
  const seedOnce = await evaluate(`Promise.all(['food','supplement','exercise'].map(kind=>window.__v.options.listOptions(kind))).then(rows=>rows.map(list=>list.length))`)
  await evaluate(`window.__v.options.seedExampleOptionsForCurrentUser()`)
  record('手动示例选项三类齐全且重复执行幂等', seedOnce.every((count) => count > 0) && JSON.stringify(seedOnce) === JSON.stringify(await evaluate(`Promise.all(['food','supplement','exercise'].map(kind=>window.__v.options.listOptions(kind))).then(rows=>rows.map(list=>list.length))`)))
  await evaluate(`(async()=>{window.__food=await window.__v.options.createOption('food',{name:'账号专属早餐'});window.__food2=await window.__v.options.createOption('food',{name:'账号专属午餐'});window.__exercise=await window.__v.options.createOption('exercise',{name:'账号专属健身'});window.__supp=await window.__v.options.createOption('supplement',{name:'账号专属补剂',period:'evening'})})()`)
  record('新增三类选项 owner 都为当前 UID', await evaluate(`[window.__food,window.__exercise,window.__supp].every(row=>row.user_id===${JSON.stringify(FIXTURE_UID)})`))
  await assertRejectedWithoutWrites('同名选项拒绝重复添加', `window.__v.options.createOption('food',{name:'账号专属早餐'})`)
  await evaluate(`window.__v.options.setOptionActive('food',window.__food.id,false)`)
  record('停用选项仍在管理列表且不在新计划选择器', await evaluate(`(async()=>{const all=await window.__v.options.listOptions('food');const active=await window.__v.options.listSelectableOptions('food');return all.some(row=>row.id===window.__food.id)&&!active.some(row=>row.id===window.__food.id)})()`))
  await evaluate(`window.__v.options.setOptionActive('food',window.__food.id,true)`)
  record('重新启用选项恢复可选状态', await evaluate(`window.__v.options.listSelectableOptions('food').then(rows=>rows.some(row=>row.id===window.__food.id))`))
  const move = await evaluate(`window.__v.options.moveOption('food',window.__food2.id,-1)`)
  record('排序操作交换同类相邻项', move && await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.findIndex(row=>row.id===window.__food2.id)<rows.findIndex(row=>row.id===window.__food.id))`))
  record('补剂排序不跨时段', await evaluate(`window.__v.options.moveOption('supplement',window.__supp.id,1)`) === false)
  const ids = await evaluate(`Promise.all(Array.from({length:10},()=>window.__v.plan.upsertDayPlan(window.__future,{mode:'work',mode_override:true}))).then(rows=>rows.map(row=>row.id))`)
  record('并发创建同日计划只有一个 ID', new Set(ids).size === 1)
  record('并发计划实际只写一条', (await browser.readDb()).rows.day_plans.filter((row) => row.id === ids[0]).length === 1)
  await assertRejectedWithoutWrites('历史日期拒绝普通写入', `window.__v.plan.upsertDayPlan('2020-01-01',{morning_focus:'forbidden'})`)
  await evaluate(`window.__v.plan.upsertDayPlan(window.__today,{mode:'work',mode_override:true,morning_focus:'晨间内容',morning_ready:true,morning_completed:true,meals_ready:true,supplements_ready:true,exercise_ready:true,outfit_ready:true,exercise_completed:true})`)
  const meals = await evaluate(`window.__v.plan.saveMeals(window.__today,[
    {meal_type:'breakfast',note:'早餐备注',items:[{optionId:window.__food.id,name:'早餐快照'},{optionId:null,name:'自由早餐'}]},
    {meal_type:'lunch',note:'午餐备注',items:[{optionId:window.__food2.id,name:'午餐快照'}]},
    {meal_type:'dinner',note:'晚餐备注',items:[{optionId:null,name:'自由晚餐'}]}])`)
  record('三餐保存支持多项及自由名称快照', meals.meals.length === 3 && meals.items.length === 4 && meals.items.filter((row) => row.food_option_id === null).length === 2)
  await evaluate(`(async()=>{window.__todayPlan=await window.__v.plan.getDayPlan(window.__today);await window.__v.plan.setMealCompleted(window.__today,'breakfast',true)})()`)
  record('三餐执行状态不改准备状态或内容项 ID', await evaluate(`(async()=>{const plan=await window.__v.plan.getDayPlan(window.__today);const rows=await window.__v.plan.listMealItems(plan.id);const meals=await window.__v.plan.listMeals(plan.id);return plan.meals_ready&&meals.find(row=>row.meal_type==='breakfast').completed&&rows.length===4})()`))
  await evaluate(`window.__v.options.renameOption('food',window.__food.id,'早餐已改名')`)
  record('选项改名不修改日期名称快照', await evaluate(`window.__v.plan.listMealItems(window.__todayPlan.id).then(rows=>rows.some(row=>row.food_name_snapshot==='早餐快照'))`))
  const foodQueueBeforeDelete = queueOf(await browser.readDb())
  await evaluate(`window.__v.options.deleteOption('food',window.__food.id)`)
  record('删除来源选项保留快照并断开可选外键', await evaluate(`window.__v.plan.listMealItems(window.__todayPlan.id).then(rows=>rows.some(row=>row.food_name_snapshot==='早餐快照'&&row.food_option_id===null))`))
  record('删除食物只新增主删除，不回推历史子项', queueOf(await browser.readDb()).filter((row) => !foodQueueBeforeDelete.some((old) => old.id === row.id)).every((row) => row.store === 'food_options' && row.op === 'delete'))
  const supplements = await evaluate(`window.__v.plan.ensureDaySupplements(window.__today)`)
  const supplements2 = await evaluate(`window.__v.plan.ensureDaySupplements(window.__today)`)
  record('补剂模板按时段实例化且重复补齐幂等', supplements.some((row) => row.name_snapshot === '账号专属补剂' && row.period === 'evening') && supplements2.length === supplements.length)
  await evaluate(`(async()=>{window.__savedSupplements=await window.__v.plan.saveDaySupplements(window.__today,[{name:'自定义补剂',period:'morning',planned:false,completed:true},{name:'自定义补剂',period:'morning',planned:true,completed:false}]);return true})()`)
  record('补剂同名同段去重，计划与完成状态分开', await evaluate(`window.__savedSupplements.length===1&&!window.__savedSupplements[0].planned&&window.__savedSupplements[0].completed`))
  await evaluate(`window.__v.plan.setSupplementCompleted(window.__today,window.__savedSupplements[0].id,false)`)
  record('补剂执行勾选不改计划开关', await evaluate(`window.__v.plan.listDaySupplements(window.__todayPlan.id).then(rows=>!rows[0].planned&&!rows[0].completed)`))
  await evaluate(`window.__v.plan.saveExercise(window.__today,{decision:'exercise',note:'健身备注',items:[{optionId:window.__exercise.id,name:'健身快照'},{optionId:null,name:'自由健身'}]})`)
  await evaluate(`window.__v.plan.saveExercise(window.__today,{decision:'rest',note:'今天休息',items:[{optionId:window.__exercise.id,name:'健身快照'},{optionId:null,name:'自由健身'}]})`)
  record('选择休息仍保留已选健身内容', await evaluate(`window.__v.plan.listExerciseItems(window.__todayPlan.id).then(rows=>rows.length===2)`))
  const exerciseQueueBeforeDelete = queueOf(await browser.readDb())
  await evaluate(`window.__v.options.deleteOption('exercise',window.__exercise.id)`)
  record('删除健身来源仍保留名称快照', await evaluate(`window.__v.plan.listExerciseItems(window.__todayPlan.id).then(rows=>rows.some(row=>row.name_snapshot==='健身快照'&&row.exercise_option_id===null))`))
  record('删除健身只新增主删除，不回推历史子项', queueOf(await browser.readDb()).filter((row) => !exerciseQueueBeforeDelete.some((old) => old.id === row.id)).every((row) => row.store === 'exercise_options' && row.op === 'delete'))
  await evaluate(`(async()=>{window.__task=await window.__v.plan.saveCustomTask(window.__today,{task_time:'12:30',title:'账号专属事项',note:'事项备注',completed:true});return true})()`)
  record('自定义事项关联当前账号计划', await evaluate(`(async()=>window.__task.day_plan_id===window.__todayPlan.id&&(await window.__v.plan.listCustomTasks(window.__todayPlan.id)).some(row=>row.id===window.__task.id))()`))
  await assertRejectedWithoutWrites('事项 ID 不能迁到另一天', `window.__v.plan.saveCustomTask(window.__future,{...window.__task,title:'forbidden'})`)
  await assertRejectedWithoutWrites('旧 owner 的子表读取被拒绝', `window.__v.plan.listMeals('legacy-plan')`)
  await evaluate(`new Promise((done,reject)=>{const r=indexedDB.open(${JSON.stringify(DB_NAME)});r.onsuccess=()=>{const db=r.result;const tx=db.transaction('food_options','readwrite');tx.objectStore('food_options').put({id:'other-owner-option',user_id:${JSON.stringify(LEGACY_UID)},name:'其他账号选项',active:true,sort_order:90,created_at:'2020-01-01T00:00:00.000Z',updated_at:'2020-01-01T00:00:00.000Z'});tx.oncomplete=()=>{db.close();done(true)};tx.onerror=()=>reject(tx.error)}})`)
  await assertRejectedWithoutWrites('其他 owner 选项引用被拒绝', `window.__v.plan.saveMeals(window.__today,[{meal_type:'dinner',note:'forbidden',items:[{optionId:'other-owner-option',name:'forbidden'}]}])`)
  await evaluate(`(async()=>{await window.__v.plan.upsertDayPlan(window.__tomorrow,{mode:'rest',mode_override:true});await window.__v.plan.copyYesterday(window.__tomorrow)})()`)
  const copied = await evaluate(`(async()=>{const plan=await window.__v.plan.getDayPlan(window.__tomorrow);return {plan,meals:await window.__v.plan.listMeals(plan.id),items:await window.__v.plan.listMealItems(plan.id),supp:await window.__v.plan.listDaySupplements(plan.id),ex:await window.__v.plan.listExerciseItems(plan.id),tasks:await window.__v.plan.listCustomTasks(plan.id)}})()`)
  record('复制昨天保留目标日期模式', copied.plan.mode === 'rest' && copied.plan.mode_override)
  record('复制内容、名称快照和自定义事项', copied.plan.morning_focus === '晨间内容' && copied.items.length === 4 && copied.ex.length === 2 && copied.tasks[0]?.title === '账号专属事项')
  record('复制后所有准备与执行状态归零', ['outfit_ready', 'meals_ready', 'supplements_ready', 'morning_ready', 'exercise_ready', 'morning_completed', 'exercise_completed'].every((key) => !copied.plan[key]) && [...copied.meals, ...copied.supp, ...copied.tasks].every((row) => !row.completed))
  record('复制保留补剂计划开关', copied.supp.length === 1 && copied.supp[0].planned === false)
  const routines = await evaluate(`(async()=>{window.__rest=window.__v.dates.addDays(window.__today,15);window.__temporary=window.__v.dates.addDays(window.__today,16);await window.__v.plan.upsertDayPlan(window.__rest,{mode:'rest',mode_override:false});await window.__v.plan.upsertDayPlan(window.__temporary,{mode:'rest',mode_override:true});return {normal:await window.__v.plan.ensureRestDayRoutines(window.__rest),again:await window.__v.plan.ensureRestDayRoutines(window.__rest),temporary:await window.__v.plan.ensureRestDayRoutines(window.__temporary)}})()`)
  record('正常休息日家务两条，补齐幂等', routines.normal.length === 2 && routines.again.length === 2)
  record('临时不上班不自动创建家务', routines.temporary.length === 0)
  await evaluate(`window.__v.plan.restoreDefaultDayPlan(window.__temporary,window.__v.dates.defaultModeForDate(window.__temporary))`)
  record('恢复默认模式清除人工覆盖标记', await evaluate(`window.__v.plan.getDayPlan(window.__temporary).then(plan=>!plan.mode_override&&plan.mode===window.__v.dates.defaultModeForDate(window.__temporary))`))

  const exported = await evaluate(`(async()=>{window.__exported=await window.__v.backup.exportBackup();return window.__exported})()`)
  record('新备份为 v3，来源资料仅当前 UID', exported.file.version === 3 && exported.file.records.users.length === 1 && exported.file.records.users[0].id === FIXTURE_UID)
  record('备份不含密码、token、队列或隔离设备状态', !/password_hash|refresh_token|access_token|sync_outbox|sync_state|legacy_users|workspace_state/.test(exported.text))
  record('备份只包含当前 owner，旧账号业务仍隔离', ROOT_STORES.every((store) => (exported.file.records[store] ?? []).every((row) => row.user_id === FIXTURE_UID)))
  await evaluate(`(async()=>{window.__temporaryOption=await window.__v.options.createOption('food',{name:'还原后消失'});await window.__v.backup.importBackup(window.__exported.text)})()`)
  record('导入整体替换当前账号数据', !await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.some(row=>row.name==='还原后消失'))`))
  record('导入保留其他 owner 的隔离业务', (await browser.readDb()).rows.day_plans.some((row) => row.id === 'legacy-plan'))
  await assertRejectedWithoutWrites('非法备份全量校验失败', `window.__v.backup.importBackup('not-json')`)
  await evaluate(`window.__badBackup=structuredClone(window.__exported.file);window.__badBackup.records.day_plans[0].user_id='wrong-owner';true`)
  await assertRejectedWithoutWrites('备份断裂 owner 关联被拒绝', `window.__v.backup.importBackup(JSON.stringify(window.__badBackup))`)
  await evaluate(`new Promise((done,reject)=>{const r=indexedDB.open(${JSON.stringify(DB_NAME)});r.onsuccess=()=>{const db=r.result;const tx=db.transaction('food_options','readwrite');tx.objectStore('food_options').put({id:'foreign-collision',user_id:${JSON.stringify(LEGACY_UID)},name:'隔离选项',active:true,sort_order:0,created_at:'2020-01-01T00:00:00.000Z',updated_at:'2020-01-01T00:00:00.000Z'});tx.oncomplete=()=>{db.close();done(true)};tx.onerror=()=>reject(tx.error)}})`)
  await evaluate(`window.__collision=structuredClone(window.__exported.file);window.__collision.records.food_options.push({id:'foreign-collision',user_id:${JSON.stringify(FIXTURE_UID)},name:'forbidden',active:true,sort_order:90,created_at:'2020-01-01T00:00:00.000Z',updated_at:'2020-01-01T00:00:00.000Z'});true`)
  await assertRejectedWithoutWrites('跨 owner 相同 ID 导入被拒绝', `window.__v.backup.importBackup(JSON.stringify(window.__collision))`)
  await assertRejectedWithoutWrites('跨 owner 选项不能被改名', `window.__v.options.renameOption('food','foreign-collision','forbidden')`)
  await assertRejectedWithoutWrites('跨 owner 选项不能被删除', `window.__v.options.deleteOption('food','foreign-collision')`)
  await evaluate(`window.__oldContext=window.__v.session.captureAuthContext();true`)
  const beforeLogout = await browser.readDb()
  await errorOf(`window.__v.auth.signOut()`)
  record('退出封闭业务并回到登录页', (await phase()) === 'signed-out' && !await evaluate(`!!document.querySelector('.bottom-nav')`))
  const afterLogout = await browser.readDb()
  record('退出保留本地业务及待上传队列', JSON.stringify(beforeLogout.rows.day_plans) === JSON.stringify(afterLogout.rows.day_plans) && JSON.stringify(queueOf(beforeLogout)) === JSON.stringify(queueOf(afterLogout)))
  record('退出后旧身份代次守卫拒绝继续执行', Boolean(await errorOf(`window.__v.session.assertAuthContextCurrent(window.__oldContext)`)))
  const authBeforeRelogin = fixture.auth.filter((row) => row.path.endsWith('/token')).length
  await loginAgain(fixture)
  record('原账号可重新登录且实际再次请求 Auth', fixture.auth.filter((row) => row.path.endsWith('/token')).length > authBeforeRelogin && await evaluate(`window.__v.auth.currentUser().id`) === FIXTURE_UID)
  await cacheOffline(fixture)
  record('重新登录打开原 UID 数据', await evaluate(`window.__v.plan.getDayPlan(window.__today).then(plan=>plan?.morning_focus==='晨间内容')`))

  // UI paths use current selectors and real pointer events for draggable bubbles.
  fixture.offline = false
  await browser.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await browser.reload()
  await browser.ready()
  await evaluate(apiHelpers)
  await browser.installHelpers()
  record('刷新恢复已验证会话', (await phase()) === 'ready')
  // Vite serves lazy modules over HTTP; load this local reader before emulating offline.
  await evaluate(`import('/src/services/api/syncService.ts').then(sync=>sync.readSyncStatus())`)
  await cacheOffline(fixture)
  record('日程底栏同时提供今天与明天入口', await evaluate(`(()=>{const buttons=[...document.querySelectorAll('.bottom-nav button')];return buttons.some(button=>button.textContent.trim()==='今天')&&buttons.some(button=>button.textContent.trim()==='明天')})()`))
  await evaluate(`window.__m.click('明天',document.querySelector('.bottom-nav'))`)
  await settle()
  if (await evaluate(`document.querySelector('.bubble-page-heading')?.innerText.includes('休息日')`)) {
    await evaluate(`window.__m.click('改为工作日')`)
    record('切换模式前要求确认', await evaluate(`!!document.querySelector('.confirm-modal')`))
    await evaluate(`window.__m.click('确认切换')`)
    await settle()
  } else {
    await evaluate(`window.__m.click('改为休息日')`)
    record('切换模式前要求确认', await evaluate(`!!document.querySelector('.confirm-modal')`))
    await evaluate(`window.__m.click('取消')`)
  }
  await browser.clickBubble('meals_ready')
  await browser.until(`!!document.querySelector('[data-editor-open="meals"]')`)
  await evaluate(`window.__m.click('编辑',document.querySelector('.bubble-detail-sheet'))`)
  await browser.until(`!!document.querySelector('.bottom-sheet')`)
  await browser.until(`!!document.querySelector('.bottom-sheet [data-meal="breakfast"]')`)
  record('真实气泡点击能打开三餐编辑面板', await evaluate(`document.querySelector('.bottom-sheet').innerText.includes('早餐')`))
  record('底部编辑面板打开时锁住页面滚动', await evaluate(`document.body.style.overflow==='hidden'`))
  await browser.until(`document.querySelectorAll('[data-meal] .picker-row').length>0`)
  for (const [type, label] of [['breakfast', '早餐'], ['lunch', '午餐'], ['dinner', '晚餐']]) {
    await evaluate(`(()=>{const box=document.querySelector('[data-meal="${type}"] .picker-row input');if(!box.checked)box.click();window.__m.fill('${label}备注','界面${label}备注')})()`)
  }
  await saveEditor()
  const uiMeals = await tomorrowRows()
  record('三餐界面选择与三个备注真实落库', uiMeals.meals.every((row) => row.note === `界面${{ breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }[row.meal_type]}备注`) && uiMeals.meals.every((row) => uiMeals.items.some((item) => item.daily_meal_id === row.id)))
  record('编辑内容不会自动勾选准备或执行', !uiMeals.plan.meals_ready && uiMeals.meals.every((row) => !row.completed))
  record('关闭编辑面板恢复页面滚动', await evaluate(`document.body.style.overflow!=='hidden'&&!document.querySelector('.bottom-sheet')`))
  await browser.longPressBubble('meals_ready')
  await browser.until(`document.querySelector('.rhythm-bubble[data-node-id=meals_ready]')?.getAttribute('data-node-state')==='completed'`)
  await browser.until(`!document.querySelector('.bubble-save-status')`)
  record('真实长按完成准备且不修改餐次执行', (await tomorrowRows()).plan.meals_ready && (await tomorrowRows()).meals.every((row) => !row.completed))
  await sleep(250)
  if (await evaluate(`!!document.querySelector('.pet-message-bubble')`)) await evaluate(`window.__m.click('关闭鼓励消息')`)
  await browser.clickBubble('meals_ready')
  await browser.until(`!!document.querySelector('.bubble-detail-sheet')`)
  await evaluate(`window.__m.click('确认撤销完成',document.querySelector('.bubble-detail-sheet'))`)
  await settle()
  record('详情确认撤销准备真正保存', !(await tomorrowRows()).plan.meals_ready)
  const cancelPoint = await evaluate(`(()=>{const r=document.querySelector('.rhythm-bubble[data-node-id=meals_ready]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await browser.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...cancelPoint })
  await browser.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: cancelPoint.x + 22, y: cancelPoint.y })
  await sleep(650)
  await browser.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: cancelPoint.x + 22, y: cancelPoint.y })
  record('长按移动超过阈值取消完成且不打开详情', !(await tomorrowRows()).plan.meals_ready && !await evaluate(`!!document.querySelector('.bubble-detail-sheet')`))
  await openBubbleEditor('morning_ready')
  await evaluate(`window.__m.fill('5:00-6:30 当天事项','界面晨间内容')`)
  await saveEditor()
  record('晨间编辑保存内容且准备与完成仍独立', (await tomorrowRows()).plan.morning_focus === '界面晨间内容' && !(await tomorrowRows()).plan.morning_ready && !(await tomorrowRows()).plan.morning_completed)
  await openBubbleEditor('exercise_ready')
  await evaluate(`window.__m.fill('安排','exercise');const box=document.querySelector('.picker-row input');if(!box.checked)box.click();window.__m.fill('备注','界面健身备注')`)
  await saveEditor()
  const exerciseRows = await tomorrowRows()
  await openBubbleEditor('exercise_ready')
  await evaluate(`window.__m.fill('安排','rest')`)
  await saveEditor()
  const restRows = await tomorrowRows()
  const exerciseShape = (rows) => rows.map((row) => ({
    exercise_option_id: row.exercise_option_id,
    name_snapshot: row.name_snapshot,
    sort_order: row.sort_order,
  }))
  record('健身界面切换不健身保留项目和备注', restRows.plan.exercise_decision === 'rest' && restRows.plan.exercise_note === '界面健身备注' && JSON.stringify(exerciseShape(restRows.ex)) === JSON.stringify(exerciseShape(exerciseRows.ex)) && restRows.ex.length > 0)
  await openBubbleEditor('supplements_ready')
  await browser.until(`document.querySelectorAll('.panel-row-name').length>0`)
  record('补剂模板行没有名称输入或移除按钮', await evaluate(`[...document.querySelectorAll('.panel-row')].filter(row=>row.querySelector('.panel-row-name')).every(row=>!row.querySelector('input:not([type=checkbox])')&&!row.querySelector('button'))`))
  await evaluate(`(()=>{const row=[...document.querySelectorAll('.panel-row')].find(row=>row.querySelector('.panel-row-name'));window.__templateName=row.querySelector('.panel-row-name').textContent;const box=row.querySelector('input[type=checkbox]');if(box.checked)box.click();window.__m.click('＋ 添加补剂',document.querySelector('[data-period=morning]'))})()`)
  await settle()
  await evaluate(`window.__m.set([...document.querySelectorAll('[data-period=morning] input[aria-label="补剂名称"]')].at(-1),'界面自定义补剂')`)
  await saveEditor()
  record('补剂界面开关与自定义项保存', await evaluate(`window.__v.plan.getDayPlan(window.__v.dates.addDays(window.__v.dates.getBusinessDateKey(),1)).then(plan=>window.__v.plan.listDaySupplements(plan.id)).then(rows=>rows.some(row=>row.name_snapshot===window.__templateName&&!row.planned)&&rows.some(row=>row.name_snapshot==='界面自定义补剂'&&row.planned))`))
  await openBubbleEditor('supplements_ready')
  await browser.until(`!!document.querySelector('input[aria-label="补剂名称"]')`)
  await evaluate(`(()=>{const input=[...document.querySelectorAll('input[aria-label="补剂名称"]')].find(input=>input.value==='界面自定义补剂');window.__m.click('移除',input.closest('.panel-row'))})()`)
  await saveEditor()
  record('自定义补剂移除后实际消失且模板保留', (await tomorrowRows()).supp.every((row) => row.name_snapshot !== '界面自定义补剂') && (await tomorrowRows()).supp.some((row) => row.name_snapshot !== '自定义补剂'))
  await evaluate(`document.querySelector('.bubble-add-task').click()`)
  await browser.until(`!!document.querySelector('.center-card')`)
  await evaluate(`window.__m.click('保存')`)
  record('自定义事项必填校验显示真实输入错误', await evaluate(`!!document.querySelector('[aria-invalid="true"]')`))
  await evaluate(`window.__m.fill('事项名称','界面保存事项');window.__m.fill('时间','19:30');window.__m.click('保存')`)
  await browser.until(`!document.querySelector('.center-card')`)
  record('事项界面保存真正落到当前账号', (await tomorrowRows()).tasks.some((row) => row.title === '界面保存事项'))
  for (let index = 0; index < 3; index += 1) {
    await evaluate(`document.querySelector('.bubble-add-task').click()`)
    await browser.until(`!!document.querySelector('.center-card')`)
    await evaluate(`window.__m.fill('事项名称','清单事项${index}');window.__m.fill('时间','20:0${index}')`)
    await saveEditor()
  }
  await evaluate(`window.__m.click('查看全部',document.querySelector('.my-tasks-entry'))`)
  await evaluate(`window.__m.click('编辑',[...document.querySelectorAll('.my-task-row')].find(row=>row.innerText.includes('界面保存事项')))`)
  await browser.until(`!!document.querySelector('.center-card')`)
  record('事项清单编辑显示原字段', await evaluate(`[...document.querySelectorAll('input')].some(input=>input.value==='界面保存事项')&&document.querySelector('input[type=time]').value==='19:30'`))
  await evaluate(`window.__m.fill('事项名称','界面事项已改名');window.__m.click('添加备注');window.__m.fill('备注','界面事项备注')`)
  await saveEditor()
  record('事项编辑更新原条目且保存备注', (await tomorrowRows()).tasks.some((row) => row.title === '界面事项已改名' && row.note === '界面事项备注') && (await tomorrowRows()).tasks.every((row) => row.title !== '界面保存事项'))
  await evaluate(`window.__m.click('删除',[...document.querySelectorAll('.my-task-row')].find(row=>row.innerText.includes('界面事项已改名')))`)
  record('事项删除前确认且取消保留', await evaluate(`document.querySelector('.confirm-modal').innerText.includes('界面事项已改名')`))
  await evaluate(`window.__m.click('取消')`)
  record('取消删除后事项仍存在', (await tomorrowRows()).tasks.some((row) => row.title === '界面事项已改名'))
  await evaluate(`window.__m.click('删除',[...document.querySelectorAll('.my-task-row')].find(row=>row.innerText.includes('界面事项已改名')))` )
  await browser.until(`!!document.querySelector('.confirm-modal')`)
  await evaluate(`window.__m.click('确认删除')`)
  await settle()
  record('确认删除实际移除事项', (await tomorrowRows()).tasks.every((row) => row.title !== '界面事项已改名'))
  await browser.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  record('减少动态效果偏好应用到气泡动画', await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches&&[...document.querySelectorAll('.rhythm-bubble')].every(node=>getComputedStyle(node).animationName==='none'||parseFloat(getComputedStyle(node).animationDuration)<0.02)`))
  await browser.cdp.send('Emulation.setEmulatedMedia', { features: [] })
  await evaluate(`window.__m.click('选项')`)
  await browser.until(`!!document.querySelector('.options-page')&&document.querySelectorAll('[data-option-entry]').length===6&&!document.querySelector('.bottom-nav')`)
  record('独立选项页六个入口齐备，隐藏日程底栏', await evaluate(`document.querySelectorAll('[data-option-entry]').length===6&&!document.querySelector('.bottom-nav')`))
  await evaluate(`window.__m.openPreference('account')`)
  await settle()
  record('账号页展示当前 W，无注册或二次绑定入口', await evaluate(`document.body.innerText.includes('W')&&!/注册|补建|连接云端账号|断开云端连接/.test(document.body.innerText)`))
  record('本地保存与上传状态没有伪装为已同步', !await evaluate(`document.body.innerText.includes('已同步')`))
  await evaluate(`window.__m.click('返回选项')`)
  await browser.until(`!!document.querySelector('[data-option-entry="food"]')`)
  await evaluate(`window.__m.openPreference('food')`)
  await settle()
  await evaluate(`window.__m.click('＋ 添加食物')`)
  await browser.until(`!!document.querySelector('[data-editor-backdrop]')`)
  await evaluate(`window.__m.fill('名称','界面选项');window.__m.click('添加')`)
  await browser.until(`!document.querySelector('[data-editor-backdrop]')`)
  const uiOption = await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.find(row=>row.name==='界面选项'))`)
  record('食物管理界面创建当前账号选项', uiOption?.user_id === FIXTURE_UID)
  await optionMenu(uiOption.id, '改名')
  await evaluate(`window.__m.fill('名称','界面选项改名');window.__m.click('保存')`)
  await browser.until(`!document.querySelector('[data-editor-backdrop]')`)
  record('选项菜单改名真正保存', await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.some(row=>row.id===${JSON.stringify(uiOption.id)}&&row.name==='界面选项改名'))`))
  await optionMenu(uiOption.id, '停用')
  record('停用选项确认说明保留历史内容', await evaluate(`document.querySelector('.confirm-modal').innerText.includes('保留')`))
  await evaluate(`window.__m.click('确认停用')`)
  await settle()
  record('停用操作改变 active 并显示停用标记', await evaluate(`document.querySelector('[data-option-id="'+${JSON.stringify(uiOption.id)}+'"]').innerText.includes('已停用')`))
  await optionMenu(uiOption.id, '启用')
  record('菜单启用恢复可选', await evaluate(`window.__v.options.listSelectableOptions('food').then(rows=>rows.some(row=>row.id===${JSON.stringify(uiOption.id)}))`))
  const orderBeforeMenu = await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.map(row=>row.id))`)
  await optionMenu(uiOption.id, '上移')
  const orderAfterMenu = await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.map(row=>row.id))`)
  record('菜单上移在库中改变相邻次序', orderAfterMenu.indexOf(uiOption.id) === orderBeforeMenu.indexOf(uiOption.id) - 1)
  const drag = await evaluate(`(()=>{const rows=[...document.querySelectorAll('[data-option-row]')];rows[0].scrollIntoView({block:'center'});const a=rows[0].querySelector('.drag-handle').getBoundingClientRect();const b=rows[1].getBoundingClientRect();return {id:rows[0].dataset.optionId,x:a.x+a.width/2,y:a.y+a.height/2,targetY:b.y+b.height/2+3}})()`)
  const beforeDrag = await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.map(row=>row.id))`)
  await browser.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: drag.x, y: drag.y })
  await browser.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: drag.x, y: drag.targetY })
  await browser.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: drag.x, y: drag.targetY })
  await settle()
  record('真实手柄拖拽排序提交到库', await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.findIndex(row=>row.id===${JSON.stringify(drag.id)}))`) === beforeDrag.indexOf(drag.id) + 1)
  await optionMenu(uiOption.id, '删除')
  await evaluate(`window.__m.click('取消')`)
  record('取消选项删除保留记录', await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.some(row=>row.id===${JSON.stringify(uiOption.id)}))`))
  await optionMenu(uiOption.id, '删除')
  await evaluate(`window.__m.click('确认删除')`)
  await settle()
  record('确认选项删除实际移除', !await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.some(row=>row.id===${JSON.stringify(uiOption.id)}))`))
  await evaluate(`window.__m.click('返回选项')`)
  await browser.until(`!!document.querySelector('[data-option-entry="backup"]')`)
  await evaluate(`window.__m.openPreference('backup')`)
  await settle()
  await evaluate(`window.__m.click('生成备份')`)
  await browser.until(`Boolean(document.querySelector('.backup-text')?.value)`)
  record('备份界面生成当前账号 JSON', await evaluate(`JSON.parse(document.querySelector('.backup-text').value).records.users[0].id===${JSON.stringify(FIXTURE_UID)}`))
  await evaluate(`window.__m.fill('或直接粘贴备份内容','invalid');window.__m.click('检查这份备份')`)
  await settle()
  record('非法备份在界面显示错误且不弹替换确认', await evaluate(`!!document.querySelector('[data-backup-error]')&&!document.querySelector('.confirm-modal')`))
  await evaluate(`window.__m.click('生成备份')`)
  await browser.until(`document.querySelector('.backup-text')?.value.startsWith('{')`)
  await evaluate(`(()=>{const file=JSON.parse(document.querySelector('.backup-text').value);window.__uiDate=window.__v.dates.addDays(window.__v.dates.getBusinessDateKey(),1);file.records.day_plans.find(plan=>plan.plan_date===window.__uiDate).morning_focus='界面备份重读内容';window.__uiBackup=JSON.stringify(file);window.__m.fill('或直接粘贴备份内容',window.__uiBackup);window.__m.click('检查这份备份');return true})()`)
  record('合法备份界面确认明确账号范围和不可撤销替换', await evaluate(`(()=>{const text=document.querySelector('.confirm-modal').innerText;return text.includes('替换')&&text.includes('当前账号')&&text.includes('无法撤销')})()`))
  const backupBeforeCancel = stableRows(await browser.readDb())
  await evaluate(`window.__m.click('取消')`)
  record('取消备份导入库与队列均不变', stableRows(await browser.readDb()) === backupBeforeCancel)
  await evaluate(`(()=>{const file=JSON.parse(window.__uiBackup);file.records.food_options.push({id:'foreign-collision',user_id:${JSON.stringify(FIXTURE_UID)},name:'失败导入回归',active:true,sort_order:90,created_at:'2020-01-01T00:00:00.000Z',updated_at:'2020-01-01T00:00:00.000Z'});window.__m.fill('或直接粘贴备份内容',JSON.stringify(file));window.__m.click('检查这份备份');return true})()`)
  await browser.until(`!!document.querySelector('.confirm-modal')`)
  await evaluate(`window.__m.click('确认导入并替换')`)
  await browser.until(`!!document.querySelector('.status.error')`)
  record('合法格式的冲突备份真实导入失败并提供重试', await evaluate(`document.body.innerText.includes('记录 ID 与其他工作区冲突')&&!!document.querySelector('button.retry:not(:disabled)')&&!document.querySelector('[data-backup-imported]')`))
  const failedImportRows = stableRows(await browser.readDb())
  await evaluate(`window.__m.fill('或直接粘贴备份内容',window.__uiBackup)`)
  await browser.until(`!!document.querySelector('.status.idle')`)
  record('失败后修改备份输入清掉旧保存错误和重试请求', await evaluate(`!document.querySelector('button.retry:not(:disabled)')&&!document.querySelector('.status.error')&&!document.querySelector('.status.saved')`))
  await evaluate(`document.querySelector('button.retry')?.click();true`)
  record('失效重试不会无写入显示已保存', stableRows(await browser.readDb()) === failedImportRows && await evaluate(`!!document.querySelector('.status.idle')&&!document.querySelector('[data-backup-imported]')`))
  await evaluate(`window.__v.options.createOption('food',{name:'界面恢复应清除'})`)
  await evaluate(`window.__m.fill('或直接粘贴备份内容',window.__uiBackup);window.__m.click('检查这份备份')`)
  await browser.until(`!!document.querySelector('.confirm-modal')`)
  await evaluate(`window.__m.click('确认导入并替换')`)
  await browser.until(`!!document.querySelector('[data-backup-imported]')`)
  record('备份确认导入完整替换且如实显示成功', !await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.some(row=>row.name==='界面恢复应清除'))`) && await evaluate(`document.querySelector('[data-backup-imported]').innerText.includes('已替换为备份内容')`))
  await evaluate(`window.__m.click('返回选项')`)
  for (const width of [1440, 390, 320]) {
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 })
    await sleep(200)
    const metrics = await evaluate(`window.__m.metrics()`)
    record(`选项页 ${width}px 无横向溢出`, metrics.scroll <= metrics.width + 1)
  }
  await evaluate(`window.__m.click('返回日程')`)
  await browser.ready()
  await browser.until(`!document.querySelector('.loading-note')`)
  record('320px 气泡中心实际命中气泡而非中央进度区', await evaluate(`(async()=>{const node=document.querySelector('.rhythm-bubble[data-node-id="morning_ready"]');if(!node)return false;node.scrollIntoView({block:'center'});await new Promise(requestAnimationFrame);const rect=node.getBoundingClientRect();return window.innerWidth===320&&document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest('.rhythm-bubble')===node})()`))
  await openBubbleEditor('morning_ready')
  record('备份导入返回同一日期重读新内容', await evaluate(`document.querySelector('.bubble-page-heading small')?.textContent.startsWith(window.__uiDate+' · ')&&document.querySelector('[data-editor-backdrop] textarea')?.value==='界面备份重读内容'`))
  await evaluate(`window.__m.click('取消',document.querySelector('[data-editor-backdrop]'))`)
  await browser.until(`!document.querySelector('[data-editor-backdrop]')`)
  fixture.offline = false
  await browser.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await evaluate(`window.__v.auth.retryAuth()`)
  await browser.until(`import('/src/services/api/syncService.ts').then(async sync=>(await sync.readSyncStatus()).pendingCount===0)`)
  fixture.snapshotOverride = await evaluate(`(async()=>{const file=(await window.__v.backup.exportBackup()).file;file.records.day_plans.find(plan=>plan.plan_date===window.__uiDate).morning_focus='界面云端重读内容';file.records.food_options.push({id:'ui-cloud-option',user_id:${JSON.stringify(FIXTURE_UID)},name:'云端恢复后的选项',active:true,sort_order:90,created_at:'2020-01-01T00:00:00.000Z',updated_at:'2020-01-01T00:00:00.000Z'});return file})()`)
  const restoredFoodCount = fixture.snapshotOverride.records.food_options.filter((row) => row.active).length
  await evaluate(`window.__m.click('选项')`)
  await browser.until(`!!document.querySelector('[data-option-entry="account"]')`)
  await evaluate(`window.__m.openPreference('account')`)
  await browser.until(`!![...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='从云端恢复到本地'&&!button.disabled)`)
  await evaluate(`window.__m.click('从云端恢复到本地')`)
  await browser.until(`!!document.querySelector('.confirm-modal')`)
  await evaluate(`window.__m.click('替换本地数据')`)
  await browser.until(`document.body.innerText.includes('本地已替换为云端内容')`)
  record('云端恢复确认真实替换当前日期内容', await evaluate(`window.__v.plan.getDayPlan(window.__uiDate).then(plan=>plan.morning_focus==='界面云端重读内容')`))
  fixture.snapshotOverride = null
  await evaluate(`window.__m.click('返回选项')`)
  await browser.until(`!document.querySelector('.loading-note')&&!!document.querySelector('[data-option-entry="food"]')`)
  record('云端恢复返回概览重读启用选项数量', await evaluate(`document.querySelector('[data-option-entry="food"] small')?.textContent===${JSON.stringify(`启用 ${restoredFoodCount} 项`)}`))
  await evaluate(`window.__m.openPreference('food')`)
  await browser.until(`!document.querySelector('.loading-note')&&!!document.querySelector('[data-option-kind="food"]')`)
  record('云端恢复打开清单展示新选项', await evaluate(`document.querySelector('[data-option-id="ui-cloud-option"]')?.innerText.includes('云端恢复后的选项')===true`))
  await evaluate(`window.__m.click('返回日程')`)
  await browser.ready()
  await browser.until(`!document.querySelector('.loading-note')`)
  await openBubbleEditor('morning_ready')
  record('云端恢复返回同一日期重读新内容', await evaluate(`document.querySelector('.bubble-page-heading small')?.textContent.startsWith(window.__uiDate+' · ')&&document.querySelector('[data-editor-backdrop] textarea')?.value==='界面云端重读内容'`))
  await evaluate(`window.__m.click('取消',document.querySelector('[data-editor-backdrop]'))`)
  await browser.until(`!document.querySelector('[data-editor-backdrop]')`)
  for (const width of [1440, 390, 320]) {
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 })
    await sleep(200)
    const metrics = await evaluate(`window.__m.metrics()`)
    record(`日程页 ${width}px 无横向溢出`, metrics.scroll <= metrics.width + 1)
  }
  await browser.shot('认证改造-本地日程')

  await cacheOffline(fixture)
  record('已有 SDK 会话与已准备工作区可进入离线缓存', (await phase()) === 'offline-cached')
  const writeCount = fixture.writes().length
  await evaluate(`window.__v.options.createOption('food',{name:'离线编辑保留'})`)
  await sleep(1800)
  record('离线编辑保存本地并保留当前 UID 队列', (await browser.readDb()).rows.food_options.some((row) => row.name === '离线编辑保留' && row.user_id === FIXTURE_UID) && queueOf(await browser.readDb()).length > 0)
  record('offline-cached 不能推送云端', fixture.writes().length === writeCount)
  await errorOf(`window.__v.auth.signOut()`)
  record('离线主动退出仍关闭会话', (await phase()) === 'signed-out')
  await loginAgain(fixture)
  fixture.offline = true
  record('离线退出后仍可在线用原账号重新登录', (await phase()) === 'ready')
  const retainedPlans = (await browser.readDb()).rows.day_plans.length
  fixture.offline = false
  fixture.revoke()
  await errorOf(`window.__v.auth.retryAuth()`)
  record('服务端撤销会话后关闭业务而非退化成本地密码认证', !['ready', 'offline-cached'].includes(await phase()))
  record('会话撤销保留业务数据', (await browser.readDb()).rows.day_plans.length === retainedPlans)
  fixture.offline = true
  await browser.reload()
  await browser.until(`!!document.querySelector('input[type="password"]')`)
  await evaluate(apiHelpers)
  record('撤销会话后离线刷新不能恢复缓存工作区', !await evaluate(`!!document.querySelector('.bottom-nav')`) && await evaluate(`Boolean(window.__v.session.readAuthLock())`))
  await loginAgain(fixture)
  fixture.offline = true
  const recovery = await evaluate(`window.__v.backup.exportBackup()`)
  fixture.rows.clear()
  for (const [store, rows] of Object.entries(recovery.file.records)) {
    if (store !== 'users') for (const row of rows) fixture.put(store, row)
  }
  await browser.navigate('about:blank')
  await browser.cdp.send('Storage.clearDataForOrigin', { origin: new URL(server.url).origin, storageTypes: 'all' })
  fixture.offline = false
  fixture.hold = 'export_cloud_snapshot'
  await browser.navigate(server.url)
  await browser.login()
  await browser.until(`!document.querySelector('input[type="password"]')`)
  record('清缓存后原账号认证仍进入恢复门禁', !await evaluate(`!!document.querySelector('.bottom-nav')`))
  await fixture.release()
  await browser.ready()
  await evaluate(apiHelpers)
  record('清缓存后恢复云端已有数据再开放业务', await evaluate(`window.__v.options.listOptions('food').then(rows=>rows.some(row=>row.name==='离线编辑保留'))`))
  const restored = await browser.readDb()
  record('恢复保留云端记录 ID 与统一 owner', ROOT_STORES.every((store) => restored.rows[store].every((row) => row.user_id === FIXTURE_UID)) && recovery.file.records.day_plans.every((source) => restored.rows.day_plans.some((row) => row.id === source.id)))
  record('恢复单事务写入工作区状态并不回推来源数据', restored.rows.workspace_state[0]?.initialized_from === 'cloud' && restored.rows.sync_outbox.length === 0)
  record('恢复不会播种额外示例覆盖云端快照', restored.rows.food_options.length === recovery.file.records.food_options.length)
  record('夹具没有未处理 HTTP 异常', fixture.errors.length === 0, fixture.errors.join('; '))
  record('整个认证流程没有调用公开注册接口', !fixture.auth.some((request) => request.path.endsWith('/signup')))
  record('浏览器没有未处理 JavaScript 异常', !browser.cdp.events.some((event) => event.method === 'Runtime.exceptionThrown'))
  await browser.shot('认证改造-清缓存恢复')
}

try {
  await main()
} catch (error) {
  console.error(`验收脚本异常： ${error.stack ?? error.message}`)
  process.exitCode = error.name === 'AssertionError' ? 1 : 2
} finally {
  if (browser) await browser.close()
  if (unconfiguredBrowser) await unconfiguredBrowser.close()
  if (transientBrowser) await transientBrowser.close()
  await stopProcess(server?.child)
  await stopProcess(unconfiguredServer?.child)
  finish()
}
=======
// 本地验收脚本：用真实浏览器内核走通「登录 → 规划 → 保存 → 刷新恢复 → 退出」闭环，
// 检查桌面 / 手机视口无横向溢出、控制台无 error / warning。
//
// 用法：
//   npm run verify:local
//
// 脚本自带 Vite 开发服务器：会挑一个空闲端口自行拉起，结束时回收，
// 因此不会误验收「端口上恰好跑着的别的服务」，也不需要另开终端。
//
// 依赖：本机已安装 Chrome 或 Edge。不使用第三方 npm 包，不写入项目目录。
// 可用 CHROME_PATH 指定浏览器可执行文件；用 APP_URL 指向已存在的服务时，脚本不再自行拉起服务器。
//
// 覆盖：数据库冷升级（v1 → v4，含老自由文本搬迁）→ 登录页 → 注册 → 周视图 → 底部导航 →
// 历史只读 → 模式切换与恢复默认 → 未来空日期引导 → 三餐多选 → 准备进度 → 健身多选（切「不健身」不清内容）→
// 补剂实例（打开面板补齐 / 模板行不可删 / 自定义行可删 / 不重复补齐）→ 执行区勾选（与准备区分离）→
// 自定义事项增改删 → 复制昨天（带内容、不带任何状态、不改模式）→
// 休息日家务（正常休息日自动带拖地洗衣 / 临时不上班不带 / 隐藏工作日准备项 / 可勾选）→
// 选项页（增改排序启停删、补剂时段分组、可用数量口径）→ 刷新恢复 → 账号间选项隔离 →
// 桌面与手机视口 → 退出登录 → 控制台干净。

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBrowser } from './lib/find-browser.mjs'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPLICIT_APP_URL = process.env.APP_URL ?? null
/** 设置 SHOT_DIR 可把关键界面截图落盘，用于人工核对观感；不设置则完全不写文件。 */
const SHOT_DIR = process.env.SHOT_DIR ?? null
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 向系统要一个当前空闲的端口，避免撞上已在 5173 跑着的别的服务。 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/** 拉起本项目自己的 Vite 开发服务器，返回 { child, url }。 */
async function startDevServer() {
  const port = await findFreePort()
  const url = `http://127.0.0.1:${port}/`
  const viteBin = join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteBin)) throw new Error(`未找到 Vite（${viteBin}），请先运行 npm install。`)

  const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: PROJECT_ROOT,
    stdio: 'ignore',
  })
  child.on('error', () => {})

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Vite 开发服务器启动后立即退出。')
    const reachable = await fetch(url).then((response) => response.ok).catch(() => false)
    if (reachable) return { child, url }
    await sleep(250)
  }
  stopProcess(child)
  throw new Error('Vite 开发服务器未在预期时间内就绪。')
}

/** 结束自己拉起的进程；Windows 上按 PID 连子进程一起收，不用按进程名通杀。 */
function stopProcess(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill()
  }
}

// 浏览器定位抽到 scripts/lib/find-browser.mjs：Git Bash 里 ProgramFiles 可能不存在，
// 只按环境变量拼路径会把「本机装了 Chrome」误判成「本机没有浏览器」。
// 图标生成脚本与 verify-pwa 共用同一份实现。

async function launchBrowser(browserPath, userDataDir) {
  const child = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const portFile = join(userDataDir, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (existsSync(portFile)) {
      const port = readFileSync(portFile, 'utf8').split('\n')[0].trim()
      if (port) return { child, port }
    }
    await sleep(250)
  }
  child.kill()
  throw new Error('浏览器调试端口未在预期时间内就绪。')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.events = []
    this.handlers = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
      } else if (message.method) {
        this.events.push(message)
        this.handlers.get(message.method)?.(message.params)
      }
    })
  }
  /** 需要即时响应的事件（如 Fetch 拦截）用这里注册；其余事件留在 this.events 里事后统计。 */
  on(method, handler) {
    this.handlers.set(method, handler)
  }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function connect(port) {
  let target
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      target = targets.find((item) => item.type === 'page')
      if (target) break
    } catch {
      // 调试端点尚未就绪
    }
    await sleep(250)
  }
  if (!target) throw new Error('无法连接浏览器调试端点。')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败。')), { once: true })
  })
  return new Cdp(ws)
}

const stamp = Date.now()
const EMAIL = `verify-${stamp}@local.test`
const EMAIL_B = `verify-b-${stamp}@local.test`
/** 清空站点数据之后注册的第三个账号：用来验证「换设备：新账号 + 导入备份」能完整搬家。 */
const EMAIL_C = `verify-c-${stamp}@local.test`
const PASSWORD = 'verify123'
/** 三餐多选：早餐选两项、午餐选一项，用来验证「一餐多项」而不是单个自由文本。 */
const BREAKFAST_FOODS = ['燕麦牛奶', '水煮蛋']
const LUNCH_FOODS = ['鸡胸沙拉']
const MEAL_NOTE = '温牛奶'
/** 健身多选。 */
const EXERCISE_PICKS = ['快走', '瑜伽']
/** 这一天自己加的补剂，名字刻意不与任何模板重合，才能验证「自定义项可删除」。 */
const DAY_SUPPLEMENT = '测试日用补剂'
const TASK_NAME = '测试事项'
const FOOD_NAME = '测试专属食物'
const FOOD_RENAMED = '测试食物已改名'
const TEMP_NAME = '临时待删食物'
/** 备份往返里临时新增的一条食物，导入后应当消失。 */
const BACKUP_EXTRA_FOOD = '备份往返临时食物'
const SUPPLEMENT_NAME = '测试补剂'
const DB_NAME = 'happy-little-molly-local'
/** v1 只包含这四张表；升级到最新版后必须补上后续三张与三张（选项、每日内容）再补一张（家务）且旧数据不丢。 */
const V1_STORES = ['custom_tasks', 'daily_meals', 'day_plans', 'users']
const V2_STORES = ['exercise_options', 'food_options', 'supplement_templates']
const V3_STORES = ['daily_exercise_items', 'daily_meal_items', 'daily_supplements']
const V4_STORES = ['routine_tasks']
const LATEST_VERSION = 4
/** v1 老库里的自由文本内容，v3 迁移应当把它转成一条「名称快照项」。 */
const LEGACY_MEAL_TEXT = '老库早餐内容'
const LEGACY_EXERCISE_TEXT = '老库健身内容'
const SENTINEL_USER = { id: 'verify-sentinel-user', email: 'verify-sentinel@local.test', password_hash: 'x', created_at: '2020-01-01T00:00:00.000Z' }
const SENTINEL_PLAN = {
  id: 'verify-sentinel-plan',
  user_id: SENTINEL_USER.id,
  plan_date: '2020-01-01',
  mode: 'work',
  mode_override: false,
  exercise_decision: 'exercise',
  exercise_content: LEGACY_EXERCISE_TEXT,
}
const SENTINEL_MEAL = {
  id: 'verify-sentinel-meal',
  day_plan_id: SENTINEL_PLAN.id,
  meal_type: 'breakfast',
  plan_content: LEGACY_MEAL_TEXT,
  note: '',
  completed: false,
}

/** 计算「今天」到「本周六」还要往后翻几天（Asia/Shanghai，周一为一周第一天，周六=5）。 */
function daysToSaturday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).formatToParts(new Date())
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'
  const mondayFirst = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0
  return (5 - mondayFirst + 7) % 7
}

const results = []

// 注入到页面的交互辅助函数。重写界面时请保留 .prep-row / .execution-row / .task-row /
// .bottom-sheet / .center-card / .confirm-modal / .mode-card / .progress-head / .option-row /
// .panel-group / .panel-row / .picker-row 这些类名，以及 data-meal / data-period 这两个属性，
// 脚本依赖它们定位 L2 的多选与补剂分组。
// 编辑弹层（抽屉或居中卡片）统一用 data-editor-card 定位，形态换了脚本不必跟着改。
const HELPERS = `
window.__m = {
  byText: (text, tag) => [...document.querySelectorAll(tag || 'button')].find((el) => el.textContent.trim() === text),
  clickText: (text, tag) => { const el = window.__m.byText(text, tag); if (!el) return 'NOT_FOUND:' + text; el.click(); return 'OK' },
  clickContains: (text, tag) => { const el = [...document.querySelectorAll(tag || 'button')].find((node) => node.textContent.includes(text)); if (!el) return 'NOT_FOUND:' + text; el.click(); return 'OK' },
  clickAria: (label, tag) => { const el = [...document.querySelectorAll(tag || 'button')].find((node) => node.getAttribute('aria-label') === label); if (!el) return 'NOT_FOUND:' + label; el.click(); return 'OK' },
  prepRow: (label) => [...document.querySelectorAll('.prep-row')].find((row) => (row.querySelector('strong') || {}).textContent?.includes(label)),

  // ---- L2：编辑面板里的多选选择器 ----
  // 多选是按受控数组整体替换实现的，连续两次点击若挤在同一个 tick 里，
  // 第二次会基于上一次之前的旧数组计算，把第一项吃掉。因此每次点击后都要等一次渲染。
  pickerRows: (scopeSelector) => {
    const scope = document.querySelector(scopeSelector || '.picker');
    if (!scope) return [];
    return [...scope.querySelectorAll('.picker-row')];
  },
  pickerOptions: (scopeSelector) => window.__m.pickerRows(scopeSelector).map((row) => row.textContent.trim()),
  pickerChecked: (scopeSelector) =>
    window.__m.pickerRows(scopeSelector)
      .filter((row) => { const box = row.querySelector('input[type=checkbox]'); return box && box.checked; })
      .map((row) => row.textContent.trim()),
  pick: async (scopeSelector, name) => {
    const row = window.__m.pickerRows(scopeSelector).find((item) => item.textContent.includes(name));
    if (!row) return 'NO_OPTION:' + name;
    const box = row.querySelector('input[type=checkbox]');
    if (!box) return 'NO_CHECKBOX:' + name;
    box.click();
    await window.__m.wait(260);
    return box.checked ? 'CHECKED' : 'UNCHECKED';
  },
  /** 面板分组（三餐按 data-meal、补剂按 data-period）下的行文本。 */
  groupRows: (selector) => {
    const group = document.querySelector(selector);
    return group ? [...group.querySelectorAll('.panel-row, .picker-row')].map((row) => row.textContent.trim()) : [];
  },
  groupChecked: (selector) => {
    const group = document.querySelector(selector);
    if (!group) return [];
    return [...group.querySelectorAll('input[type=checkbox]')].filter((box) => box.checked).map((box) => box.getAttribute('aria-label') || box.parentElement.textContent.trim());
  },
  clickIn: (selector, text) => {
    const scope = document.querySelector(selector);
    if (!scope) return 'NO_SCOPE:' + selector;
    const button = [...scope.querySelectorAll('button')].find((item) => item.textContent.includes(text));
    if (!button) return 'NO_BUTTON:' + text;
    button.click();
    return 'OK';
  },
  lastSupplementInput: () => {
    const inputs = [...document.querySelectorAll('.panel-row input[placeholder]')];
    return inputs.length ? inputs[inputs.length - 1] : null;
  },

  // ---- L2：执行区 ----
  executeRows: () => [...document.querySelectorAll('.execution-row')],
  executeToggle: async (ariaLabel) => {
    const box = [...document.querySelectorAll('.execution-row input[type=checkbox]')].find((item) => item.getAttribute('aria-label') === ariaLabel);
    if (!box) return 'NO_ROW:' + ariaLabel;
    box.click();
    await window.__m.wait(1100);
    const after = [...document.querySelectorAll('.execution-row input[type=checkbox]')].find((item) => item.getAttribute('aria-label') === ariaLabel);
    return after && after.checked ? 'CHECKED' : 'UNCHECKED';
  },
  executeStates: () => [...document.querySelectorAll('.execution-row input[type=checkbox]')].map((box) => ({ label: box.getAttribute('aria-label') || '', checked: box.checked })),
  executeText: () => [...document.querySelectorAll('.execution-row')].map((row) => row.innerText.replace(/\\n+/g, ' ').trim()),

  // ---- L3：休息日家务 ----
  routineRows: () => [...document.querySelectorAll('[data-routine]')],
  routineText: () => window.__m.routineRows().map((row) => row.textContent.trim()),
  routineToggle: async (label) => {
    const box = window.__m.routineRows().map((row) => row.querySelector('input[type=checkbox]')).find((item) => item && item.getAttribute('aria-label') === label);
    if (!box) return 'NO_ROW:' + label;
    box.click();
    await window.__m.wait(1100);
    const after = window.__m.routineRows().map((row) => row.querySelector('input[type=checkbox]')).find((item) => item && item.getAttribute('aria-label') === label);
    return after && after.checked ? 'CHECKED' : 'UNCHECKED';
  },

  // 备份文本域是 textarea，它的 value setter 在 HTMLTextAreaElement.prototype 上，
  // 用 input 的那份会抛 Illegal invocation。这里按标签选原型，两种元素都能设值。
  setValue: (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  },
  fill: (labelText, value) => {
    const label = [...document.querySelectorAll('label')].find((item) => item.textContent.includes(labelText));
    if (!label) return 'NO_LABEL:' + labelText;
    const input = label.querySelector('input, textarea, select');
    if (!input) return 'NO_INPUT:' + labelText;
    if (input.tagName === 'SELECT') { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); }
    else { window.__m.setValue(input, value); }
    return 'OK';
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  text: () => document.body.innerText,
  modeLabel: () => (document.querySelector('.mode-card strong') || {}).textContent || '',
  prepChecked: () => [...document.querySelectorAll('.prep-row input[type=checkbox]')].map((box) => box.checked),
  progress: () => (document.querySelector('.progress-head strong') || {}).textContent || '',
  optionSection: (kind) => document.querySelector('.option-section[data-option-kind="' + kind + '"]'),
  // 选项页现在是「概览 + 子屏」：概览只放入口行，清单在自己的子屏里（docs/17 §4）。
  optionEntry: (kind) => document.querySelector('[data-option-entry="' + kind + '"]'),
  optionEntrySummary: (kind) => {
    const entry = window.__m.optionEntry(kind);
    return entry ? ((entry.querySelector('small') || {}).textContent || '').trim() : 'NO_ENTRY';
  },
  openOptionsOverview: async () => {
    const back = document.querySelector('.topbar-back button');
    if (back) {
      back.click();
      await window.__m.wait(400);
    }
    return 'OK';
  },
  openOptionList: async (kind) => {
    await window.__m.openOptionsOverview();
    const entry = window.__m.optionEntry(kind);
    if (!entry) return 'NO_ENTRY:' + kind;
    entry.click();
    await window.__m.wait(700);
    return 'OK';
  },
  openOptionMenu: (name) => {
    const row = window.__m.optionRow(name);
    if (!row) return 'NO_ROW:' + name;
    const trigger = row.querySelector('.row-menu-trigger');
    if (!trigger) return 'NO_TRIGGER';
    trigger.click();
    return 'OK';
  },
  optionMenuItems: () => [...document.querySelectorAll('.row-menu-item')].map((item) => item.textContent.trim()),
  optionNames: (kind) => {
    const section = window.__m.optionSection(kind);
    if (!section) return [];
    return [...section.querySelectorAll('.option-row strong')].map((el) => el.textContent.trim());
  },
  optionGroupLabels: (kind) => {
    const section = window.__m.optionSection(kind);
    if (!section) return [];
    return [...section.querySelectorAll('.option-group-label')].map((el) => el.textContent.trim());
  },
  optionRow: (name) => [...document.querySelectorAll('.option-row')].find((row) => ((row.querySelector('strong') || {}).textContent || '').trim() === name),
  optionStatus: (name) => { const row = window.__m.optionRow(name); return row ? (row.querySelector('small') || {}).textContent.trim() : 'NO_ROW'; },
  optionSummary: (kind) => { const section = window.__m.optionSection(kind); const el = section && section.querySelector('.option-summary'); return el ? el.textContent.trim() : 'NO_SUMMARY'; },
  optionGroupNames: (kind, label) => {
    const section = window.__m.optionSection(kind);
    if (!section) return [];
    return [...section.querySelectorAll('.option-group')]
      .filter((group) => ((group.querySelector('.option-group-label') || {}).textContent || '').trim() === label)
      .flatMap((group) => [...group.querySelectorAll('.option-row strong')].map((el) => el.textContent.trim()));
  },
  clickSectionContains: (kind, text) => {
    const section = window.__m.optionSection(kind);
    if (!section) return 'NO_SECTION:' + kind;
    const button = [...section.querySelectorAll('button')].find((item) => item.textContent.includes(text));
    if (!button) return 'NO_BUTTON:' + text;
    button.click();
    return 'OK';
  },
  // 行内动作现在收在「…」溢出菜单里：先开菜单再点条目。
  clickOptionButton: async (name, label) => {
    const opened = window.__m.openOptionMenu(name);
    if (opened !== 'OK') return opened;
    await window.__m.wait(150);
    const item = [...document.querySelectorAll('.row-menu-item')].find((node) => node.textContent.trim() === label);
    if (!item) return 'NO_BUTTON:' + label;
    item.click();
    return 'OK';
  },
  accountText: () => { const card = document.querySelector('.account-card'); return card ? card.innerText : 'NO_ACCOUNT_CARD'; },

  // ---- L5：本地备份卡片 ----
  backupSection: () => document.querySelector('.backup-card'),
  backupBox: () => document.querySelector('.backup-text'),
  backupText: () => { const box = window.__m.backupBox(); return box ? box.value : 'NO_BACKUP_BOX'; },
  backupNote: () => { const el = document.querySelector('[data-backup-note]'); return el ? el.textContent.trim() : ''; },
  backupError: () => { const el = document.querySelector('[data-backup-error]'); return el ? el.textContent.trim() : ''; },
  backupImported: () => { const el = document.querySelector('[data-backup-imported]'); return el ? el.textContent.trim() : ''; },
  backupModalOpen: () => !!document.querySelector('.confirm-modal'),
  backupModalText: () => { const el = document.querySelector('.confirm-modal'); return el ? el.innerText.replace(/\\n+/g, ' ').trim() : ''; },
  backupPaste: (value) => { const box = window.__m.backupBox(); if (!box) return 'NO_BACKUP_BOX'; window.__m.setValue(box, value); return 'OK'; },
  backupClear: () => { const button = [...document.querySelectorAll('.backup-card button')].find((item) => item.textContent.trim() === '清空输入'); if (!button) return 'NO_BUTTON'; button.click(); return 'OK'; },
  /** 卡片内按钮：避免与页面其它位置的同名按钮混淆。 */
  backupClick: (label) => {
    const card = window.__m.backupSection();
    if (!card) return 'NO_CARD';
    const button = [...card.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
    if (!button) return 'NO_BUTTON:' + label;
    if (button.disabled) return 'DISABLED:' + label;
    button.click();
    return 'OK';
  },

  /**
   * 读取库结构。库不存在时**绝不能**用无版本号的 open 去「打探」——那样会凭空造出一个空的 v1 库，
   * 应用随后按最新版本打开时 oldVersion=1，第 1 号迁移被跳过，首批仓库再也建不出来。
   * 所以先用 indexedDB.databases() 判断存在性，不存在就如实返回，不碰数据库。
   */
  dbSchema: async () => {
    const listed = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : null;
    if (listed && !listed.some((entry) => entry.name === ${JSON.stringify(DB_NAME)})) {
      return JSON.stringify({ version: 0, names: [], indexes: {}, exists: false });
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(${JSON.stringify(DB_NAME)});
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const names = [...db.objectStoreNames].sort();
        const indexes = {};
        for (const name of names) {
          const store = db.transaction(name).objectStore(name);
          indexes[name] = [...store.indexNames].sort();
        }
        resolve(JSON.stringify({ version: db.version, names, indexes, exists: true }));
        db.close();
      };
    });
  },
};
'ready'
`

function record(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
}
function firstLine(value, limit = 90) {
  return String(value ?? '').split('\n').filter(Boolean).join(' / ').slice(0, limit)
}

async function main() {
  const browserPath = findBrowser()
  const userDataDir = join(tmpdir(), `molly-verify-${stamp}`)
  let child = null
  let devServer = null
  /** 第一个账号导出的备份文本，留到清空站点数据之后做「换设备搬家」验证。 */
  let BACKUP_TEXT = ''

  try {
    let appUrl = EXPLICIT_APP_URL
    if (appUrl) {
      const reachable = await fetch(appUrl).then(() => true).catch(() => false)
      if (!reachable) {
        console.error(`APP_URL 指定的 ${appUrl} 无法访问。`)
        process.exitCode = 1
        return
      }
    } else {
      devServer = await startDevServer()
      appUrl = devServer.url
      console.log(`使用临时开发服务器：${appUrl}`)
    }

    const launched = await launchBrowser(browserPath, userDataDir)
    child = launched.child
    const cdp = await connect(launched.port)
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Page.enable')

    const evaluate = async (expression) => {
      const outcome = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (outcome.exceptionDetails) {
        throw new Error(outcome.exceptionDetails.exception?.description ?? outcome.exceptionDetails.text)
      }
      return outcome.result.value
    }
    const goto = async () => {
      await cdp.send('Page.navigate', { url: appUrl })
      await sleep(2200)
      await evaluate(HELPERS)
    }
    const text = () => evaluate('window.__m.text()')

    if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
    // 截图是可选的人工核对辅助：任何失败都只告警，绝不能让验收结果受影响。
    const shot = async (label) => {
      if (!SHOT_DIR) return
      try {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        writeFileSync(join(SHOT_DIR, `${label}.png`), Buffer.from(data, 'base64'))
      } catch (reason) {
        console.warn(`截图 ${label} 失败（不影响验收）：${reason.message}`)
      }
    }

    // 0. 冷升级：先造一个 v1 老库，再让应用去打开它。
    //    做法是把入口模块的响应换成一个空模块，让页面停在「同源、但没有跑应用」的状态，
    //    这样才能在应用碰到数据库之前，用原生 IndexedDB 建出只会由 v1 代码产生的老库。
    //    由此验证 docs/01 的硬性规则：迁移只追加，老数据在升级后仍然可读。
    cdp.on('Fetch.requestPaused', (params) => {
      const isEntry = params.request.url.includes('/src/main.tsx')
      const task = isEntry
        ? cdp.send('Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }],
            body: '',
          })
        : cdp.send('Fetch.continueRequest', { requestId: params.requestId })
      void task.catch(() => {})
    })
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await cdp.send('Page.navigate', { url: appUrl })
    await sleep(2000)
    const seededV1 = await evaluate(`
      new Promise((resolve, reject) => {
        const request = indexedDB.open(${JSON.stringify(DB_NAME)}, 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('users', { keyPath: 'id' }).createIndex('email', 'email', { unique: true });
          const plans = db.createObjectStore('day_plans', { keyPath: 'id' });
          plans.createIndex('user_date', ['user_id', 'plan_date'], { unique: true });
          plans.createIndex('user_id', 'user_id');
          const meals = db.createObjectStore('daily_meals', { keyPath: 'id' });
          meals.createIndex('plan_type', ['day_plan_id', 'meal_type'], { unique: true });
          meals.createIndex('day_plan_id', 'day_plan_id');
          db.createObjectStore('custom_tasks', { keyPath: 'id' }).createIndex('day_plan_id', 'day_plan_id');
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['users', 'day_plans', 'daily_meals'], 'readwrite');
          tx.objectStore('users').put(${JSON.stringify(SENTINEL_USER)});
          tx.objectStore('day_plans').put(${JSON.stringify(SENTINEL_PLAN)});
          tx.objectStore('daily_meals').put(${JSON.stringify(SENTINEL_MEAL)});
          tx.oncomplete = () => { db.close(); resolve(['users', 'day_plans', 'daily_meals']); };
          tx.onerror = () => reject(tx.error);
        };
      })
    `)
    await cdp.send('Fetch.disable')
    record('可在同源页面上造出带自由文本内容的 v1 老库', Array.isArray(seededV1) && seededV1.length === 3, String(seededV1))
    await goto()

    // 1. 登录页
    await goto()
    const initial = await text()
    record('未登录时渲染登录页', initial.includes('登录') && initial.includes('邮箱'), firstLine(initial))

    // 2. 注册并进入日计划页
    const signedUp = await evaluate(`
      (async () => {
        window.__m.fill('邮箱', ${JSON.stringify(EMAIL)});
        window.__m.fill('密码', ${JSON.stringify(PASSWORD)});
        await window.__m.wait(200);
        return window.__m.clickText('注册');
      })()
    `)
    await sleep(1800)
    const afterSignUp = await text()
    record('注册后进入日计划页', afterSignUp.includes('执行今天') && afterSignUp.includes('准备明天'), signedUp)

    // 2b. 冷升级结果：应用是懒打开数据库的（登录页不读数据），注册写入才真正碰到库，
    //     因此在这里断言 v1 老库已经被应用一路升到最新版，且老数据仍在、老自由文本已被搬迁。
    const upgrade = JSON.parse(await evaluate(`
      (async () => {
        const schema = JSON.parse(await window.__m.dbSchema());
        const sentinel = await new Promise((resolve, reject) => {
          const request = indexedDB.open(${JSON.stringify(DB_NAME)});
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const get = db.transaction('users', 'readonly').objectStore('users').get(${JSON.stringify(SENTINEL_USER.id)});
            get.onsuccess = () => { resolve(get.result ?? null); db.close(); };
            get.onerror = () => reject(get.error);
          };
        });
        return JSON.stringify({ schema, sentinel });
      })()
    `))
    const allStores = [...V1_STORES, ...V2_STORES, ...V3_STORES, ...V4_STORES]
    record(`v1 老库被升级到 v${LATEST_VERSION} 且十一张表齐备`,
      upgrade.schema.version === LATEST_VERSION && allStores.every((name) => upgrade.schema.names.includes(name)),
      `version=${upgrade.schema.version}, tables=${upgrade.schema.names.join(',')}`)
    record('升级后 v1 老数据仍可读',
      upgrade.sentinel?.email === SENTINEL_USER.email,
      `读取到 ${upgrade.sentinel ? upgrade.sentinel.email : 'null'}`)

    // 2c. 验证 v3 自由文本搬迁：单独读取新表确认快照项已生成
    const migration = JSON.parse(await evaluate(`
      (async () => {
        const readAll = (store) => new Promise((resolve, reject) => {
          const request = indexedDB.open(${JSON.stringify(DB_NAME)});
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const all = db.transaction(store, 'readonly').objectStore(store).getAll();
            all.onsuccess = () => { resolve(all.result ?? []); db.close(); };
            all.onerror = () => reject(all.error);
          };
        });
        const mealItems = await readAll('daily_meal_items');
        const exerciseItems = await readAll('daily_exercise_items');
        const mealItem = mealItems.find((row) => row.daily_meal_id === ${JSON.stringify(SENTINEL_MEAL.id)});
        const exerciseItem = exerciseItems.find((row) => row.day_plan_id === ${JSON.stringify(SENTINEL_PLAN.id)});
        return JSON.stringify({
          mealItem: mealItem ? { name: mealItem.food_name_snapshot, optionId: mealItem.food_option_id ?? null } : null,
          exerciseItem: exerciseItem ? { name: exerciseItem.name_snapshot, optionId: exerciseItem.exercise_option_id ?? null } : null,
        });
      })()
    `))
    record('v3 把老库三餐自由文本迁成一条名称快照项',
      migration.mealItem?.name === LEGACY_MEAL_TEXT && migration.mealItem?.optionId === null,
      JSON.stringify(migration.mealItem))
    record('v3 把老库健身自由文本迁成一条名称快照项',
      migration.exerciseItem?.name === LEGACY_EXERCISE_TEXT && migration.exerciseItem?.optionId === null,
      JSON.stringify(migration.exerciseItem))

    // 3. 周视图 + 底部导航
    await evaluate(`window.__m.clickText('本周')`)
    await sleep(1000)
    const week = await evaluate(`
      JSON.stringify({
        days: document.querySelectorAll('.week-day').length,
        text: window.__m.text(),
        bottomNav: (() => {
          const nav = document.querySelector('.bottom-nav');
          if (!nav) return null;
          return [...nav.querySelectorAll('button')].map((button) => ({ text: button.textContent.trim(), active: button.classList.contains('active') }));
        })(),
      })
    `)
    const weekData = JSON.parse(week)
    record('本周视图固定显示 7 天', weekData.days === 7, `week-day 数量 = ${weekData.days}`)
    record('底部导航含今日 / 本周 / 选项三入口且当前高亮本周',
      weekData.bottomNav?.length === 3 &&
        weekData.bottomNav.map((item) => item.text).join(',') === '今日,本周,选项' &&
        weekData.bottomNav.find((item) => item.text === '本周')?.active === true,
      `底部导航=${JSON.stringify(weekData.bottomNav)}`)
    await evaluate(`window.__m.clickText('今日')`)
    await sleep(900)

    // 3b. 底部导航可切换到选项页并高亮
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const optionsNav = await evaluate(`
      JSON.stringify({
        hasOptions: window.__m.text().includes('常用食物'),
        active: (() => {
          const nav = document.querySelector('.bottom-nav');
          if (!nav) return null;
          const button = [...nav.querySelectorAll('button')].find((item) => item.textContent.trim() === '选项');
          return button ? button.classList.contains('active') : null;
        })(),
      })
    `)
    const optionsNavData = JSON.parse(optionsNav)
    record('底部导航可切到选项页且高亮选项',
      optionsNavData.hasOptions === true && optionsNavData.active === true,
      `选项页=${optionsNavData.hasOptions}, 高亮=${optionsNavData.active}`)
    await evaluate(`window.__m.clickText('今日')`)
    await sleep(900)

    // 4. 历史日期只读
    const movedBack = await evaluate(`window.__m.clickAria('前一天', '.icon-button')`)
    await sleep(1200)
    const history = await evaluate(`
      JSON.stringify({
        note: window.__m.text().includes('历史计划仅供查看'),
        hasSwitch: !!window.__m.byText('改为休息日') || !!window.__m.byText('改为工作日'),
      })
    `)
    const historyData = JSON.parse(history)
    if (movedBack !== 'OK') record('历史日期显示只读提示且无模式切换', false, movedBack)
    else record('历史日期显示只读提示且无模式切换', historyData.note && !historyData.hasSwitch,
      `note=${historyData.note}, hasSwitch=${historyData.hasSwitch}`)

    // 5. 模式切换与恢复默认
    await evaluate(`window.__m.clickAria('后一天', '.icon-button')`)
    await sleep(1200)
    const modeBefore = await evaluate(`window.__m.modeLabel()`)
    await evaluate(`window.__m.clickContains('改为')`)
    await sleep(700)
    const dialogText = await evaluate(`(document.querySelector('.confirm-modal') || {}).innerText || ''`)
    const dialogOk = dialogText.includes('恭喜幸福小Molly，今天不上班') || dialogText.includes('幸福小Molly，今天要上班哦')
    await evaluate(`window.__m.clickText('确认切换')`)
    await sleep(1300)
    const modeAfter = await evaluate(`window.__m.modeLabel()`)
    const override = await evaluate(`window.__m.text().includes('人工覆盖默认模式')`)
    record('模式切换有确认文案且生效', dialogOk && modeAfter !== modeBefore && override === true,
      `「${modeBefore}」→「${modeAfter}」，确认框=${dialogOk}`)

    await evaluate(`window.__m.clickContains('恢复默认')`)
    await sleep(1300)
    const restored = await evaluate(`window.__m.text().includes('按星期自动判断')`)
    record('恢复默认清除人工覆盖', restored === true)

    // 5b. 切换日期后保存状态不得残留上一天的结论（L0 报告 R9）
    const statusReset = JSON.parse(await evaluate(`
      (async () => {
        const read = () => (document.querySelector('.status') || {}).textContent || '';
        const before = read();
        window.__m.clickAria('后一天', '.icon-button');
        await window.__m.wait(1300);
        return JSON.stringify({ before, after: read() });
      })()
    `))
    record('切换日期后保存状态不再残留上一天的结论',
      statusReset.before.includes('已保存') && statusReset.after.includes('尚未修改'),
      `${statusReset.before.trim()} → ${statusReset.after.trim()}`)

    // 6. 准备明天：三餐面板（先确保目标日是工作日，避免周五运行时落在休息日）
    await evaluate(`window.__m.clickText('准备明天')`)
    await sleep(1100)

    // 6a. 未来空日期引导：只做说明，不落库（docs/02「引导用户准备这一天，但不强制填写」）
    const emptyHint = await evaluate(`
      JSON.stringify({
        shown: !!document.querySelector('.empty-day'),
        titled: window.__m.text().includes('这一天还没有计划'),
        guides: window.__m.text().includes('准备这一天'),
      })
    `)
    const hintData = JSON.parse(emptyHint)
    record('未来空日期显示「准备这一天」引导', hintData.shown && hintData.titled && hintData.guides,
      `引导块=${hintData.shown}, 标题=${hintData.titled}, 含引导语=${hintData.guides}`)
    await shot('01-未来空日期引导')

    const workday = await evaluate(`
      (async () => {
        if (window.__m.modeLabel() !== '休息日') return 'ALREADY_WORK';
        window.__m.clickContains('改为');
        await window.__m.wait(700);
        window.__m.clickText('确认切换');
        await window.__m.wait(1300);
        return 'SWITCHED';
      })()
    `)
    record('目标日可确认为工作日', workday === 'ALREADY_WORK' || workday === 'SWITCHED', workday)
    const meals = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('三餐已安排', '.row-main');
        await window.__m.wait(900);
        const title = (document.querySelector('.bottom-sheet h2') || {}).textContent || '';
        const bodyLockedWhileOpen = document.body.style.overflow === 'hidden';
        const candidates = window.__m.pickerOptions('.panel-group[data-meal="breakfast"]');
        const picked = [];
        for (const name of ${JSON.stringify(BREAKFAST_FOODS)}) {
          picked.push(await window.__m.pick('.panel-group[data-meal="breakfast"]', name));
        }
        picked.push(await window.__m.pick('.panel-group[data-meal="lunch"]', ${JSON.stringify(LUNCH_FOODS[0])}));
        const checkedBeforeSave = window.__m.pickerChecked('.panel-group[data-meal="breakfast"]');
        window.__m.fill('早餐备注', ${JSON.stringify(MEAL_NOTE)});
        await window.__m.wait(220);
        window.__m.clickText('保存');
        await window.__m.wait(1600);
        const body = window.__m.text();
        const bodyUnlockedAfterSave = document.body.style.overflow !== 'hidden';
        return JSON.stringify({
          title,
          bodyLockedWhileOpen,
          bodyUnlockedAfterSave,
          candidates,
          picked,
          checkedBeforeSave,
          status: body.includes('已保存'),
          breakfastInSummary: ${JSON.stringify(BREAKFAST_FOODS)}.every((name) => body.includes(name)),
          lunchInSummary: body.includes(${JSON.stringify(LUNCH_FOODS[0])}),
        });
      })()
    `))
    record('打开底部面板锁定 body 滚动，保存后恢复',
      meals.bodyLockedWhileOpen === true && meals.bodyUnlockedAfterSave === true,
      `打开时锁定=${meals.bodyLockedWhileOpen}, 保存后恢复=${meals.bodyUnlockedAfterSave}`)
    record('三餐面板按早 / 中 / 晚分组多选常用食物',
      meals.title === '编辑三餐' &&
        meals.candidates.length === 5 &&
        meals.picked.every((value) => value === 'CHECKED') &&
        JSON.stringify(meals.checkedBeforeSave) === JSON.stringify(BREAKFAST_FOODS),
      `面板标题=${meals.title}, 候选项=${meals.candidates.length}, 勾选=${meals.picked.join(',')}, 保存前已选=${meals.checkedBeforeSave.join('、')}`)
    record('三餐保存后摘要按名称快照列出所选内容',
      meals.status && meals.breakfastInSummary && meals.lunchInSummary,
      `已保存=${meals.status}, 含早餐项=${meals.breakfastInSummary}, 含午餐项=${meals.lunchInSummary}`)

    // 6b. 计划产生后引导自动消失，说明引导块只是提示、不是必须停留的状态
    const hintGone = await evaluate(`!document.querySelector('.empty-day')`)
    record('计划保存后空日期引导自动消失', hintGone === true)
    await shot('02-计划已填写')

    // 7. 勾选准备项与进度
    const progress = await evaluate(`
      (async () => {
        const row = window.__m.prepRow('三餐已安排');
        if (!row) return 'NO_ROW';
        row.querySelector('input[type=checkbox]').click();
        await window.__m.wait(1100);
        return JSON.stringify({ progress: window.__m.progress(), status: window.__m.text().includes('已保存') });
      })()
    `)
    const progressData = JSON.parse(progress)
    record('准备项勾选后进度与保存状态一致', /1\/5/.test(progressData.progress) && progressData.status,
      `${progressData.progress}, 已保存=${progressData.status}`)

    // 8. 健身面板：多选项 + 决定；选「不健身」不得清掉已选项目
    const exercise = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('健身安排已决定', '.row-main');
        await window.__m.wait(900);
        const title = (document.querySelector('.bottom-sheet h2') || {}).textContent || '';
        const candidates = window.__m.pickerOptions('.panel-group');
        const picked = [];
        for (const name of ${JSON.stringify(EXERCISE_PICKS)}) {
          picked.push(await window.__m.pick('.panel-group', name));
        }
        window.__m.fill('安排', 'exercise');
        await window.__m.wait(320);
        window.__m.fill('备注', '热身 10 分钟');
        await window.__m.wait(220);
        window.__m.clickText('保存');
        await window.__m.wait(1500);

        // 切成「不健身」再存一次：项目是内容，不该被清掉
        window.__m.clickContains('健身安排已决定', '.row-main');
        await window.__m.wait(900);
        window.__m.fill('安排', 'rest');
        await window.__m.wait(320);
        window.__m.clickText('保存');
        await window.__m.wait(1500);

        // 再打开：项目应当原样还在，切回健身并保存
        window.__m.clickContains('健身安排已决定', '.row-main');
        await window.__m.wait(900);
        const restored = window.__m.pickerChecked('.panel-group');
        window.__m.fill('安排', 'exercise');
        await window.__m.wait(320);
        window.__m.clickText('保存');
        await window.__m.wait(1500);
        return JSON.stringify({ title, candidates, picked, restored, ok: window.__m.text().includes('已决定健身') });
      })()
    `))
    record('健身面板可多选项目并保存决定',
      exercise.title === '编辑健身安排' &&
        exercise.candidates.length === 4 &&
        exercise.picked.every((value) => value === 'CHECKED') &&
        exercise.ok === true,
      `面板标题=${exercise.title}, 候选项=${exercise.candidates.length}, 勾选=${exercise.picked.join(',')}`)
    record('选「不健身」不清空已选项目',
      JSON.stringify(exercise.restored) === JSON.stringify(EXERCISE_PICKS),
      `重新打开后已选=${exercise.restored.join('、')}`)

    // 8b. 补剂面板：打开时按模板补齐当天清单，模板行不可删、自定义行可删
    const supplements = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('早中晚补剂已安排', '.row-main');
        await window.__m.wait(1600);
        const title = (document.querySelector('.bottom-sheet h2') || {}).textContent || '';
        const templateRows = {
          morning: window.__m.groupRows('.panel-group[data-period="morning"]'),
          noon: window.__m.groupRows('.panel-group[data-period="noon"]'),
          evening: window.__m.groupRows('.panel-group[data-period="evening"]'),
        };
        const removeButtonsOnTemplates = document.querySelectorAll('.panel-row button').length;

        // 取消「今天吃鱼油」：行要留在面板里，只是不勾
        const fishRow = [...document.querySelectorAll('.panel-row')].find((row) => row.textContent.includes('鱼油'));
        fishRow.querySelector('input[type=checkbox]').click();
        await window.__m.wait(320);
        const fishStillListed = [...document.querySelectorAll('.panel-row')].some((row) => row.textContent.includes('鱼油'));

        // 自己加一条
        window.__m.clickIn('.panel-group[data-period="noon"]', '添加补剂');
        await window.__m.wait(360);
        const input = window.__m.lastSupplementInput();
        if (input) window.__m.setValue(input, ${JSON.stringify(DAY_SUPPLEMENT)});
        await window.__m.wait(320);
        const removeButtonsAfterAdd = document.querySelectorAll('.panel-row button').length;

        window.__m.clickText('保存');
        await window.__m.wait(1700);
        const body = window.__m.text();
        return JSON.stringify({
          title,
          templateRows,
          removeButtonsOnTemplates,
          fishStillListed,
          removeButtonsAfterAdd,
          summaryHasMorning: body.includes('早 维生素 D'),
          summaryHasEvening: body.includes('晚 钙片'),
          summaryHasCustom: body.includes(${JSON.stringify(DAY_SUPPLEMENT)}),
          summaryExcludesFish: !body.includes('鱼油'),
        });
      })()
    `))
    record('补剂面板打开时按模板补齐当天清单',
      supplements.title === '编辑补剂' &&
        supplements.templateRows.morning.some((row) => row.includes('维生素 D')) &&
        supplements.templateRows.noon.some((row) => row.includes('鱼油')) &&
        supplements.templateRows.evening.some((row) => row.includes('钙片')),
      `面板标题=${supplements.title}, 早组=${supplements.templateRows.morning.join('|')}`)
    record('模板来源的补剂不给删除按钮，只能取消「今天吃」',
      supplements.removeButtonsOnTemplates === 0 &&
        supplements.fishStillListed === true &&
        supplements.removeButtonsAfterAdd === 1,
      `模板行删除按钮=${supplements.removeButtonsOnTemplates}, 取消勾选后仍在列表=${supplements.fishStillListed}, 加自定义行后删除按钮=${supplements.removeButtonsAfterAdd}`)
    record('补剂摘要只列「今天吃」的项，自定义项可加入',
      supplements.summaryHasMorning &&
        supplements.summaryHasEvening &&
        supplements.summaryHasCustom &&
        supplements.summaryExcludesFish,
      `早=${supplements.summaryHasMorning}, 晚=${supplements.summaryHasEvening}, 自定义=${supplements.summaryHasCustom}, 已排除未勾选项=${supplements.summaryExcludesFish}`)

    // 8c. 再次打开补剂面板：已存在的实例不会被重复补一遍；自定义行可移除
    const supplementsReopen = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('早中晚补剂已安排', '.row-main');
        await window.__m.wait(2200);
        const rows = [...document.querySelectorAll('.panel-row')];

        // 自定义行判定：有删除按钮的就是自定义行（模板行不给删除按钮）
        const fish = rows.filter((row) => row.textContent.includes('鱼油'));
        const customRows = rows.filter((row) => !!row.querySelector('button'));
        const fishChecked = fish.length ? fish[0].querySelector('input[type=checkbox]').checked : null;
        const fishRemovable = fish.length ? !!fish[0].querySelector('button') : null;
        const customRemovable = customRows.length ? !!customRows[0].querySelector('button') : null;

        if (customRows.length) customRows[0].querySelector('button').click();
        await window.__m.wait(320);
        window.__m.clickText('保存');
        await window.__m.wait(1700);
        const body = window.__m.text();
        return JSON.stringify({
          customRowCount: customRows.length,
          fishCount: fish.length,
          fishChecked,
          fishRemovable,
          customRemovable,
          customGone: !body.includes(${JSON.stringify(DAY_SUPPLEMENT)}),
          morningKept: body.includes('维生素 D'),
          eveningKept: body.includes('钙片'),
        });
      })()
    `))
    record('再次打开补剂面板不会重复补齐已存在的实例',
      supplementsReopen.fishCount === 1 && supplementsReopen.fishChecked === false,
      `鱼油行数=${supplementsReopen.fishCount}, 仍为未勾选=${supplementsReopen.fishChecked}`)
    record('自定义补剂可移除，模板来源的行不提供删除',
      supplementsReopen.customRowCount === 1 &&
        supplementsReopen.customRemovable === true &&
        supplementsReopen.fishRemovable === false &&
        supplementsReopen.customGone === true &&
        supplementsReopen.morningKept === true &&
        supplementsReopen.eveningKept === true,
      `自定义行=${supplementsReopen.customRowCount} 可删=${supplementsReopen.customRemovable}, 模板行可删=${supplementsReopen.fishRemovable}, 删除生效=${supplementsReopen.customGone}`)
    await shot('03-补剂面板')

    // 8d. 执行区：内容与完成状态严格分开——执行区勾「吃了」，准备区的勾选不受影响
    const execution = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickText('执行今天');
        await window.__m.wait(1100);
        window.__m.clickAria('后一天', '.icon-button');
        await window.__m.wait(1400);

        const rows = window.__m.executeText();
        const before = window.__m.executeStates();
        const breakfast = await window.__m.executeToggle('早餐已完成');
        const vitamin = await window.__m.executeToggle('维生素 D已完成');
        const workout = await window.__m.executeToggle('健身已完成');

        window.__m.clickText('准备明天');
        await window.__m.wait(1500);
        return JSON.stringify({
          rows,
          before,
          breakfast,
          vitamin,
          workout,
          prepBoxes: window.__m.prepChecked(),
          progressText: window.__m.progress(),
        });
      })()
    `))
    const executionLabels = execution.rows.join(' | ')
    record('执行区列出三餐内容、补剂实例与健身项目',
      executionLabels.includes('燕麦牛奶') &&
        executionLabels.includes('鸡胸沙拉') &&
        executionLabels.includes('维生素 D') &&
        executionLabels.includes('钙片') &&
        EXERCISE_PICKS.every((name) => executionLabels.includes(name)),
      firstLine(executionLabels, 170))
    record('执行区不展示「今天不吃」的补剂',
      !executionLabels.includes('鱼油'),
      firstLine(executionLabels, 170))
    record('执行区勾选完成不影响准备区勾选',
      execution.before.every((item) => item.checked === false) &&
        execution.breakfast === 'CHECKED' &&
        execution.vitamin === 'CHECKED' &&
        execution.workout === 'CHECKED' &&
        JSON.stringify(execution.prepBoxes) === JSON.stringify([false, true, false, false, false]) &&
        /1\/5/.test(execution.progressText),
      `初始=${JSON.stringify(execution.before.map((item) => item.checked))}, 三餐=${execution.breakfast}, 补剂=${execution.vitamin}, 健身=${execution.workout}, 准备区=${JSON.stringify(execution.prepBoxes)} ${execution.progressText}`)

    // 9. 自定义事项：新增
    const taskAdded = await evaluate(`
      (async () => {
        window.__m.clickContains('添加事项');
        await window.__m.wait(800);
        // 自定义事项是居中卡片，不是底部抽屉：用形态无关的 data-editor-card 定位。
        const title = (document.querySelector('[data-editor-card] h2') || {}).textContent;
        const centerCard = !!document.querySelector('.center-card[data-editor-card]');
        const bottomSheet = !!document.querySelector('.bottom-sheet[data-editor-card]');
        window.__m.fill('事项名称', ${JSON.stringify(TASK_NAME)});
        await window.__m.wait(200);
        window.__m.clickText('保存');
        await window.__m.wait(1300);
        const rows = [...document.querySelectorAll('.task-row')];
        return JSON.stringify({ title, count: rows.length, centerCard, bottomSheet, found: rows.some((row) => row.textContent.includes(${JSON.stringify(TASK_NAME)})) });
      })()
    `)
    const taskData = JSON.parse(taskAdded)
    record('自定义事项可新增', taskData.title === '添加事项' && taskData.found === true && taskData.count === 1,
      `面板标题=${taskData.title}, 事项数=${taskData.count}`)
    record('自定义事项编辑用居中卡片（不是底部抽屉）', taskData.centerCard === true && taskData.bottomSheet === false,
      `center-card=${taskData.centerCard}, bottom-sheet=${taskData.bottomSheet}`)

    // 10. 自定义事项：编辑
    const taskEdited = await evaluate(`
      (async () => {
        const row = [...document.querySelectorAll('.task-row')][0];
        if (!row) return 'NO_ROW';
        row.querySelector('button.mini').click();
        await window.__m.wait(800);
        window.__m.fill('事项名称', '测试事项已改');
        await window.__m.wait(200);
        window.__m.clickText('保存');
        await window.__m.wait(1300);
        return JSON.stringify({ found: window.__m.text().includes('测试事项已改') });
      })()
    `)
    record('自定义事项可编辑', JSON.parse(taskEdited).found === true)

    // 11. 自定义事项：删除（二次确认）
    const taskDeleted = await evaluate(`
      (async () => {
        const row = [...document.querySelectorAll('.task-row')][0];
        if (!row) return 'NO_ROW';
        const buttons = [...row.querySelectorAll('button.mini')];
        const del = buttons.find((b) => b.textContent.trim() === '删除');
        if (!del) return 'NO_DELETE';
        del.click();
        await window.__m.wait(700);
        const asked = (document.querySelector('.confirm-modal') || {}).innerText || '';
        window.__m.clickText('确认删除');
        await window.__m.wait(1300);
        return JSON.stringify({ asked: asked.includes('删除事项'), remaining: document.querySelectorAll('.task-row').length });
      })()
    `)
    const deletedData = JSON.parse(taskDeleted)
    record('自定义事项删除需二次确认且可删除', deletedData.asked === true && deletedData.remaining === 0,
      `确认框=${deletedData.asked}, 剩余=${deletedData.remaining}`)

    // 12. 复制昨天：内容复制但不带任何状态，且不改目标日模式与 mode_override
    const copied = await evaluate(`
      (async () => {
        window.__m.clickAria('后一天', '.icon-button');
        await window.__m.wait(1400);
        const modeBefore = window.__m.modeLabel();
        window.__m.clickText('复制昨天');
        await window.__m.wait(700);
        const asked = (document.querySelector('.confirm-modal') || {}).innerText || '';
        window.__m.clickText('确认覆盖');
        await window.__m.wait(1800);
        const body = window.__m.text();
        return JSON.stringify({
          asked: asked.includes('不会复制任何准备勾选'),
          hasMeals: ${JSON.stringify(BREAKFAST_FOODS)}.every((name) => body.includes(name)) && body.includes(${JSON.stringify(LUNCH_FOODS[0])}),
          hasSupplements: body.includes('维生素 D') && body.includes('钙片'),
          fishStaysUnplanned: !body.includes('鱼油'),
          hasExercise: body.includes('已决定健身'),
          prep: window.__m.prepChecked(),
          progress: window.__m.progress(),
          modeBefore,
          modeAfter: window.__m.modeLabel(),
          overrideAfter: body.includes('人工覆盖默认模式'),
        });
      })()
    `)
    const copyData = JSON.parse(copied)
    const prepAllCleared = copyData.prep.length === 0 || copyData.prep.every((value) => value === false)
    record('复制昨天带三餐 / 补剂 / 健身内容但不带准备勾选',
      copyData.asked && copyData.hasMeals && copyData.hasSupplements && copyData.hasExercise && prepAllCleared,
      `确认文案=${copyData.asked}, 三餐=${copyData.hasMeals}, 补剂=${copyData.hasSupplements}, 健身=${copyData.hasExercise}, 准备项=${JSON.stringify(copyData.prep)}`)
    record('复制昨天原样带走「今天不吃」的补剂，不回填成默认吃',
      copyData.fishStaysUnplanned === true,
      `复制后摘要里是否出现鱼油=${!copyData.fishStaysUnplanned}`)
    record('复制昨天不改目标日模式与人工覆盖',
      copyData.modeBefore === copyData.modeAfter && copyData.overrideAfter === false,
      `模式 ${copyData.modeBefore} → ${copyData.modeAfter}, 复制后存在人工覆盖=${copyData.overrideAfter}`)

    // 12b. 复制过来的内容不带任何完成状态：执行区应当整片未勾选
    const copiedExecution = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickText('执行今天');
        await window.__m.wait(1100);
        window.__m.clickAria('后一天', '.icon-button');
        await window.__m.wait(1100);
        window.__m.clickAria('后一天', '.icon-button');
        await window.__m.wait(1500);
        const labels = window.__m.executeText();
        return JSON.stringify({
          states: window.__m.executeStates(),
          hasContent: labels.join('|').includes('燕麦牛奶') && labels.join('|').includes('维生素 D'),
        });
      })()
    `))
    record('复制昨天不带走任何完成状态',
      copiedExecution.hasContent === true &&
        copiedExecution.states.length >= 5 &&
        copiedExecution.states.every((item) => item.checked === false),
      `执行区状态=${JSON.stringify(copiedExecution.states.map((item) => item.checked))}`)

    // 12c. L3：休息日家务——导航到本周六（正常休息日），验证自动出现拖地 / 洗衣
    const saturdayOffset = daysToSaturday()
    const restDay = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickText('执行今天');
        await window.__m.wait(1100);
        for (let i = 0; i < ${saturdayOffset}; i += 1) {
          window.__m.clickAria('后一天', '.icon-button');
          await window.__m.wait(900);
        }
        await window.__m.wait(1500);
        return JSON.stringify({
          mode: window.__m.modeLabel(),
          override: window.__m.text().includes('人工覆盖默认模式'),
          routines: window.__m.routineText(),
          hasPrepList: !!document.querySelector('.prep-list'),
          hasRoutineList: document.querySelectorAll('[data-routine]').length > 0,
        });
      })()
    `))
    record('周六默认是休息日且无人工覆盖',
      restDay.mode === '休息日' && restDay.override === false,
      `模式=${restDay.mode}, 人工覆盖=${restDay.override}`)
    record('正常休息日自动出现拖地 / 洗衣两个实例',
      restDay.routines.includes('拖地') && restDay.routines.includes('洗衣') && restDay.routines.length === 2,
      `家务=${restDay.routines.join('、')}`)
    record('休息日隐藏工作日准备项（衣服 / 三餐 / 晨间）',
      restDay.hasPrepList === false,
      `准备列表存在=${restDay.hasPrepList}`)

    // 12d. 家务可勾选完成，刷新后保留
    const routineToggle = await evaluate(`window.__m.routineToggle('拖地已完成')`)
    await sleep(300)
    const routineAfter = await evaluate(`window.__m.routineToggle('洗衣已完成')`)
    record('家务可逐项勾选完成',
      routineToggle === 'CHECKED' && routineAfter === 'CHECKED',
      `拖地=${routineToggle}, 洗衣=${routineAfter}`)

    // 12e. 临时不上班（工作日切休息日）不自动带家务
    const tempRest = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('改为');
        await window.__m.wait(700);
        const dialog = (document.querySelector('.confirm-modal') || {}).innerText || '';
        window.__m.clickText('确认切换');
        await window.__m.wait(1400);
        return JSON.stringify({
          dialogOk: dialog.includes('幸福小Molly，今天要上班哦'),
          mode: window.__m.modeLabel(),
          override: window.__m.text().includes('人工覆盖默认模式'),
          routines: window.__m.routineText(),
          hasRestNote: window.__m.text().includes('临时不上班'),
        });
      })()
    `))
    record('休息日切工作日有二次确认且文案正确',
      tempRest.dialogOk === true && tempRest.mode === '工作日' && tempRest.override === true,
      `确认框=${tempRest.dialogOk}, 模式=${tempRest.mode}, 覆盖=${tempRest.override}`)

    // 12f. 从工作日切回休息日（临时不上班），不自动带家务
    const tempRestBack = JSON.parse(await evaluate(`
      (async () => {
        window.__m.clickContains('改为');
        await window.__m.wait(700);
        window.__m.clickText('确认切换');
        await window.__m.wait(1400);
        return JSON.stringify({
          mode: window.__m.modeLabel(),
          override: window.__m.text().includes('人工覆盖默认模式'),
          routines: window.__m.routineText(),
          hasRestNote: window.__m.text().includes('临时不上班'),
          hasPrepList: !!document.querySelector('.prep-list'),
        });
      })()
    `))
    record('临时不上班（人工切休息日）不自动带家务且显示说明',
      tempRestBack.mode === '休息日' &&
        tempRestBack.override === true &&
        tempRestBack.routines.length === 0 &&
        tempRestBack.hasRestNote === true,
      `模式=${tempRestBack.mode}, 覆盖=${tempRestBack.override}, 家务=${tempRestBack.routines.join('、')}, 说明=${tempRestBack.hasRestNote}`)

    // 12g. 休息日仍保留补剂 / 健身 / 自定义事项入口（自定义事项列表应可见）
    const restKeeps = JSON.parse(await evaluate(`
      JSON.stringify({
        hasSupplement: window.__m.text().includes('早中晚补剂') || window.__m.text().includes('补剂'),
        hasTimeline: window.__m.text().includes('自定义事项'),
        hasPrepList: !!document.querySelector('.prep-list'),
      })
    `))
    record('休息日保留补剂 / 健身 / 自定义事项，隐藏工作日准备项',
      restKeeps.hasTimeline === true && restKeeps.hasPrepList === false,
      `自定义事项=${restKeeps.hasTimeline}, 准备列表=${restKeeps.hasPrepList}`)

    // 12h. 恢复默认回到正常休息日，家务重新出现（补齐不重复）
    await evaluate(`window.__m.clickContains('恢复默认')`)
    await sleep(1400)
    const restoredRest = JSON.parse(await evaluate(`
      JSON.stringify({
        mode: window.__m.modeLabel(),
        override: window.__m.text().includes('人工覆盖默认模式'),
        routines: window.__m.routineText(),
      })
    `))
    record('恢复默认回到正常休息日并重新补齐家务',
      restoredRest.mode === '休息日' &&
        restoredRest.override === false &&
        restoredRest.routines.includes('拖地') &&
        restoredRest.routines.includes('洗衣') &&
        restoredRest.routines.length === 2,
      `模式=${restoredRest.mode}, 覆盖=${restoredRest.override}, 家务=${restoredRest.routines.join('、')}`)

    // 回到「执行今天」且是今天，供后续刷新恢复测试使用
    await evaluate(`window.__m.clickText('执行今天')`)
    await sleep(1100)

    // 13. 刷新恢复
    await goto()
    const afterReload = await text()
    record('刷新后会话恢复且仍在日计划页', afterReload.includes('执行今天') && !afterReload.includes('邮箱'))
    await evaluate(`window.__m.clickText('准备明天')`)
    await sleep(1100)
    const persisted = await text()
    record('刷新后规划内容从本地数据库恢复',
      persisted.includes('燕麦牛奶') && persisted.includes('维生素 D'),
      firstLine(persisted, 120))

    // 14. 选项页（L1）：概览入口与状态摘要、三份清单各自的子屏、可用数量口径与本地模式说明
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const optionPage = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        // 概览：三类清单入口（带状态摘要）+ 系统项入口，以及概览自身的体量
        out.entries = ['food', 'supplement', 'exercise'].filter((kind) => !!window.__m.optionEntry(kind));
        out.entrySummaries = {
          food: window.__m.optionEntrySummary('food'),
          supplement: window.__m.optionEntrySummary('supplement'),
          exercise: window.__m.optionEntrySummary('exercise'),
        };
        out.systemEntries = ['backup', 'storage'].filter((key) => !!window.__m.optionEntry(key));
        const region = document.querySelector('.page-scroll');
        out.overviewButtons = region.querySelectorAll('button').length;

        // 三份清单各自的子屏：标题与入口标签一致，清单、摘要、分组都在自己的屏里
        out.lists = {};
        out.summaries = {};
        out.titles = {};
        for (const kind of ['food', 'supplement', 'exercise']) {
          await window.__m.openOptionList(kind);
          out.titles[kind] = (document.querySelector('.topbar h1') || {}).textContent || '';
          out.lists[kind] = window.__m.optionNames(kind);
          out.summaries[kind] = window.__m.optionSummary(kind);
          if (kind === 'supplement') out.supplementGroups = window.__m.optionGroupLabels(kind);
          if (kind === 'food') {
            const rows = [...document.querySelectorAll('.option-row')];
            out.rowHeight = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0) / rows.length) : 0;
            out.rowButtons = rows.length ? rows[0].querySelectorAll('button').length : 0;
            // 停用语义说明在清单屏（停用发生的地方），不在概览页。
            out.hint = window.__m.text().includes('停用只影响以后的新计划');
          }
        }
        await window.__m.openOptionList('account');
        out.account = window.__m.accountText();
        await window.__m.openOptionsOverview();
        return JSON.stringify(out);
      })()
    `))
    record('选项概览渲染三类清单入口与状态摘要',
      optionPage.entries.length === 3 && optionPage.entrySummaries.food === '启用 5 项',
      `入口=${optionPage.entries.join(',')}；食物摘要「${optionPage.entrySummaries.food}」`)
    record('概览把系统项与清单分开',
      optionPage.systemEntries.length === 2,
      `系统入口=${optionPage.systemEntries.join(',')}`)
    record('清单子屏说明了停用只影响以后的新计划', optionPage.hint === true)
    record('概览按钮数从 71 降到个位数',
      optionPage.overviewButtons <= 15,
      `${optionPage.overviewButtons} 个按钮`)

    // 概览是否真的一屏内：必须在手机视口下量才有意义（脚本默认窗口高度只有几百像素）。
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await sleep(600)
    const overviewFit = JSON.parse(await evaluate(`      (async () => {
        await window.__m.openOptionsOverview();
        const region = document.querySelector('.page-scroll');
        const children = [...region.children];
        const last = children[children.length - 1];
        // 余量必须单独量：内容比可视区矮时 scrollHeight 会被 clientHeight 顶住，
        // 只看它分不出「刚好塞满」和「还有富余」（见 docs/17 §4.1 的实测口径）。
        // 再减去面板自身的下内边距，才是真正能吸收字体差异的余量。
        const paddingBottom = parseFloat(getComputedStyle(region).paddingBottom) || 0;
        return JSON.stringify({
          content: region.scrollHeight,
          visible: region.clientHeight,
          viewport: window.innerHeight,
          free: last ? Math.round(region.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom - paddingBottom) : null,
          breakdown: children.map((el) => Math.round(el.getBoundingClientRect().height) + ':' + String(el.className).split(' ')[0]).join(' '),
        });
      })()
    `))
    // 概览截图在手机视口下拍：这才是目标形态（脚本默认窗口只有几百像素高，拍出来不代表真机）。
    await shot('04-选项页')
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await sleep(400)
    record('概览在 390x844 手机视口下一屏放下（改前 4.1 屏）',
      overviewFit.content <= overviewFit.visible && (overviewFit.free ?? -1) >= 24,
      `内容区可视 ${overviewFit.content}px，真实余量 ${overviewFit.free}px（≥24 才够 iOS 字体差异）；各块 ${overviewFit.breakdown}`)
    record('每个清单进自己的子屏，标题与入口标签一致',
      optionPage.titles.food === '常用食物' &&
        optionPage.titles.supplement === '固定补剂' &&
        optionPage.titles.exercise === '健身项目与动作',
      Object.values(optionPage.titles).join(' / '))
    record('选项行内只剩拖拽手柄与溢出菜单（改前每行 5 个按钮）',
      optionPage.rowButtons === 2 && optionPage.rowHeight <= 70,
      `每行 ${optionPage.rowButtons} 个按钮，行高 ${optionPage.rowHeight}px`)
    record('新账号自动带出可编辑的示例选项',
      optionPage.lists.food.length === 5 && optionPage.lists.supplement.length === 3 && optionPage.lists.exercise.length === 4,
      `食物 ${optionPage.lists.food.length} / 补剂 ${optionPage.lists.supplement.length} / 健身 ${optionPage.lists.exercise.length}`)
    record('补剂示例按早 / 中 / 晚分组', JSON.stringify(optionPage.supplementGroups) === JSON.stringify(['早', '中', '晚']),
      optionPage.supplementGroups.join(','))
    record('初始全部启用，可用数量与清单一致',
      optionPage.summaries.food === '启用 5 项 · 停用 0 项' &&
        optionPage.summaries.supplement === '启用 3 项 · 停用 0 项' &&
        optionPage.summaries.exercise === '启用 4 项 · 停用 0 项',
      `食物「${optionPage.summaries.food}」`)
    record('本地模式说明不伪装云端同步成功',
      optionPage.account.includes('本地模式') && !/已同步|同步成功|上次同步/.test(optionPage.account),
      firstLine(optionPage.account, 80))

    // 15. 选项页（L1）：新增 / 重名校验 / 排序 / 改名 / 停用 / 删除（都在清单子屏里，动作走行内溢出菜单）
    const mutations = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        // 清单现在在自己的子屏里：先进入「常用食物」。
        out.opened = await window.__m.openOptionList('food');
        window.__m.clickSectionContains('food', '添加食物');
        await window.__m.wait(700);
        out.addTitle = (document.querySelector('.bottom-sheet h2') || {}).textContent || '';
        window.__m.fill('名称', ${JSON.stringify(FOOD_NAME)});
        await window.__m.wait(150);
        window.__m.clickText('添加');
        await window.__m.wait(1300);
        out.afterAdd = window.__m.optionNames('food');
        out.addSummary = window.__m.optionSummary('food');

        // 重名必须被拒绝，且面板保留输入供改正
        window.__m.clickSectionContains('food', '添加食物');
        await window.__m.wait(700);
        window.__m.fill('名称', ${JSON.stringify(FOOD_NAME)});
        await window.__m.wait(150);
        window.__m.clickText('添加');
        await window.__m.wait(1200);
        out.duplicateNotice = (document.querySelector('.notice') || {}).textContent || '';
        out.sheetKept = !!document.querySelector('.bottom-sheet');
        window.__m.clickText('取消');
        await window.__m.wait(600);

        // 上移：与「清炒时蔬」交换位置
        await window.__m.clickOptionButton(${JSON.stringify(FOOD_NAME)}, '上移');
        await window.__m.wait(1300);
        out.afterMove = window.__m.optionNames('food');

        await window.__m.clickOptionButton(${JSON.stringify(FOOD_NAME)}, '改名');
        await window.__m.wait(700);
        window.__m.fill('名称', ${JSON.stringify(FOOD_RENAMED)});
        await window.__m.wait(150);
        window.__m.clickText('保存');
        await window.__m.wait(1300);
        out.afterRename = window.__m.optionNames('food');

        // 停用：需二次确认，且「可用数量」随之下降（该数量与 L2 选择器同源）
        await window.__m.clickOptionButton(${JSON.stringify(FOOD_RENAMED)}, '停用');
        await window.__m.wait(700);
        out.disableAsked = (document.querySelector('.confirm-modal') || {}).innerText || '';
        window.__m.clickText('确认停用');
        await window.__m.wait(1300);
        out.afterDisable = {
          names: window.__m.optionNames('food'),
          status: window.__m.optionStatus(${JSON.stringify(FOOD_RENAMED)}),
          summary: window.__m.optionSummary('food'),
        };

        // 删除：需二次确认，删完即从清单消失
        window.__m.clickSectionContains('food', '添加食物');
        await window.__m.wait(700);
        window.__m.fill('名称', ${JSON.stringify(TEMP_NAME)});
        await window.__m.wait(150);
        window.__m.clickText('添加');
        await window.__m.wait(1300);
        await window.__m.clickOptionButton(${JSON.stringify(TEMP_NAME)}, '删除');
        await window.__m.wait(700);
        out.deleteAsked = (document.querySelector('.confirm-modal') || {}).innerText || '';
        window.__m.clickText('确认删除');
        await window.__m.wait(1300);
        out.afterDelete = window.__m.optionNames('food');
        out.finalSummary = window.__m.optionSummary('food');
        return JSON.stringify(out);
      })()
    `))
    const SEED_FOODS = ['燕麦牛奶', '水煮蛋', '鸡胸沙拉', '番茄鸡蛋面', '清炒时蔬']
    record('新增食物立即出现在清单末尾',
      mutations.addTitle === '添加食物' && JSON.stringify(mutations.afterAdd) === JSON.stringify([...SEED_FOODS, FOOD_NAME]),
      `面板标题=${mutations.addTitle}, 清单=${mutations.afterAdd.join(',')}`)
    record('重名被拒绝且面板保留输入',
      mutations.duplicateNotice.includes('已有同名选项') && mutations.sheetKept === true,
      firstLine(mutations.duplicateNotice, 60))
    record('上移按同组交换顺序',
      JSON.stringify(mutations.afterMove) ===
        JSON.stringify([...SEED_FOODS.slice(0, 4), FOOD_NAME, SEED_FOODS[4]]),
      mutations.afterMove.join(','))
    record('改名只改目标项',
      JSON.stringify(mutations.afterRename) ===
        JSON.stringify([...SEED_FOODS.slice(0, 4), FOOD_RENAMED, SEED_FOODS[4]]),
      mutations.afterRename.join(','))
    record('停用需二次确认且停用项保留在清单里',
      mutations.disableAsked.includes('不会再出现在新计划的选择器中') &&
        mutations.afterDisable.status === '已停用' &&
        mutations.afterDisable.names.includes(FOOD_RENAMED),
      `确认框含停用说明=${mutations.disableAsked.includes('不会再出现在新计划的选择器中')}, 行状态=${mutations.afterDisable.status}`)
    record('停用后可用数量下降（与选择器同源）',
      mutations.afterDisable.summary === '启用 5 项 · 停用 1 项',
      mutations.afterDisable.summary)
    record('删除需二次确认且删除后从清单消失',
      mutations.deleteAsked.includes('不再出现在候选清单里') &&
        !mutations.afterDelete.includes(TEMP_NAME) &&
        mutations.afterDelete.length === 6,
      `确认框含删除说明=${mutations.deleteAsked.includes('不再出现在候选清单里')}, 剩余=${mutations.afterDelete.length}`)
    record('删除临时项后停用计数不受影响', mutations.finalSummary === '启用 5 项 · 停用 1 项', mutations.finalSummary)

    // 15b. 拖拽排序（本次新增的交互）：按住手柄往下拖一位，顺序交换；再拖回来，顺序复原。
    //      用 CDP 派发真实鼠标事件（Chrome 会据此合成 pointer 事件），因此走的是和生产一致的那条路径。
    const dragStart = JSON.parse(await evaluate(`
      (async () => {
        await window.__m.openOptionList('food');
        const rows = [...document.querySelectorAll('.option-row')];
        const handle = rows[0].querySelector('.drag-handle');
        handle.scrollIntoView({ block: 'center' });
        await window.__m.wait(300);
        const box = handle.getBoundingClientRect();
        return JSON.stringify({
          before: window.__m.optionNames('food'),
          x: Math.round(box.left + box.width / 2),
          y: Math.round(box.top + box.height / 2),
          step: Math.round(rows[0].getBoundingClientRect().height),
        });
      })()
    `))
    async function dragBy(fromY, delta) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragStart.x, y: fromY, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x, y: fromY + delta, button: 'left' })
      await sleep(250)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragStart.x, y: fromY + delta, button: 'left', clickCount: 1 })
      await sleep(1600)
    }
    await dragBy(dragStart.y, dragStart.step)
    const draggedDown = JSON.parse(await evaluate(`JSON.stringify({ names: window.__m.optionNames('food') })`))
    record('拖拽手柄可以把一项往下拖一位（顺序交换）',
      draggedDown.names[0] === dragStart.before[1] && draggedDown.names[1] === dragStart.before[0],
      `拖前=${dragStart.before.slice(0, 2).join(',')} → 拖后=${draggedDown.names.slice(0, 2).join(',')}`)

    // 反向拖回去，顺便把数据还原成后续断言期望的顺序
    const dragBack = JSON.parse(await evaluate(`
      (async () => {
        const rows = [...document.querySelectorAll('.option-row')];
        const handle = rows[1].querySelector('.drag-handle');
        handle.scrollIntoView({ block: 'center' });
        await window.__m.wait(300);
        const box = handle.getBoundingClientRect();
        return JSON.stringify({
          y: Math.round(box.top + box.height / 2),
          step: Math.round(rows[1].getBoundingClientRect().height),
        });
      })()
    `))
    await dragBy(dragBack.y, -dragBack.step)
    const draggedUp = JSON.parse(await evaluate(`JSON.stringify({ names: window.__m.optionNames('food') })`))
    record('拖拽可以往回拖（顺序复原）',
      JSON.stringify(draggedUp.names) === JSON.stringify(dragStart.before),
      `复原后=${draggedUp.names.slice(0, 2).join(',')}`)

    // 16. 选项页（L1）：补剂按时段落位，健身项目保持独立（各自在自己的子屏里）
    const supplement = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('supplement');
        window.__m.clickSectionContains('supplement', '添加补剂');
        await window.__m.wait(700);
        out.periodField = (document.querySelector('.bottom-sheet') || {}).innerText.includes('时段');
        window.__m.fill('名称', ${JSON.stringify(SUPPLEMENT_NAME)});
        await window.__m.wait(150);
        window.__m.fill('时段', 'noon');
        await window.__m.wait(150);
        window.__m.clickText('添加');
        await window.__m.wait(1300);
        out.names = window.__m.optionNames('supplement');
        out.groups = window.__m.optionGroupLabels('supplement');
        out.midGroup = window.__m.optionGroupNames('supplement', '中');
        out.summary = window.__m.optionSummary('supplement');
        // 健身是另一屏：进去取一次，再回到补剂屏留给下面的截图
        await window.__m.openOptionList('exercise');
        out.exercise = window.__m.optionNames('exercise');
        out.exerciseSummary = window.__m.optionSummary('exercise');
        await window.__m.openOptionList('supplement');
        return JSON.stringify(out);
      })()
    `))
    record('补剂面板要求选择早 / 中 / 晚时段', supplement.periodField === true)
    record('新增补剂按 sort_order 落到「中」分组',
      JSON.stringify(supplement.names) === JSON.stringify(['维生素 D', '鱼油', SUPPLEMENT_NAME, '钙片']) &&
        JSON.stringify(supplement.midGroup) === JSON.stringify(['鱼油', SUPPLEMENT_NAME]),
      `清单=${supplement.names.join(',')}；中组=${supplement.midGroup.join(',')}`)
    record('健身分区不参与时段分组且保持独立',
      JSON.stringify(supplement.exercise) === JSON.stringify(['快走', '瑜伽', '力量训练', '拉伸']) &&
        supplement.exerciseSummary === '启用 4 项 · 停用 0 项',
      supplement.exercise.join(','))
    await shot('05-选项页-补剂分组')

    // 16b. 备份（L5）：备份 → 改数据 → 导入还原，验证「导出可恢复」这条验收线
    //      选择留在卡片里；这里用导出的文本做一次真实往返，并确认改过的数据被还原。
    const backupRoundTrip = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('backup');
        window.__m.backupClick('生成备份');
        await window.__m.wait(900);
        out.text = window.__m.backupText();
        out.note = window.__m.backupNote();

        // 改一下现有数据（新增一条食物），让备份与当前状态出现可见差异。
        // 清单在自己的子屏里，所以要先离开备份屏。
        await window.__m.openOptionList('food');
        window.__m.clickSectionContains('food', '添加食物');
        await window.__m.wait(700);
        window.__m.fill('名称', ${JSON.stringify(BACKUP_EXTRA_FOOD)});
        await window.__m.wait(150);
        window.__m.clickText('添加');
        await window.__m.wait(1300);
        out.afterEdit = window.__m.optionNames('food');

        // 回备份屏：重新粘回备份文本（改数据不会清空卡片里的文本，但显式重贴更贴近用户操作）
        await window.__m.openOptionList('backup');
        window.__m.backupPaste(out.text);
        await window.__m.wait(300);
        out.inspectResult = window.__m.backupClick('检查这份备份');
        await window.__m.wait(800);
        out.modalText = window.__m.backupModalText();
        out.modalOpen = window.__m.backupModalOpen();
        window.__m.clickText('确认导入并替换');
        await window.__m.wait(2600);
        out.imported = window.__m.backupImported();
        out.status = window.__m.text().split('\\n').find((line) => line.includes('本地保存状态')) || '';

        // 回食物屏确认还原结果
        await window.__m.openOptionList('food');
        out.restored = window.__m.optionNames('food');
        out.restoredStatus = window.__m.optionStatus(${JSON.stringify(FOOD_RENAMED)});
        return JSON.stringify(out);
      })()
    `))
    record('导出后修改数据，导入备份即还原',
      backupRoundTrip.afterEdit.includes(BACKUP_EXTRA_FOOD) &&
        !backupRoundTrip.restored.includes(BACKUP_EXTRA_FOOD) &&
        JSON.stringify(backupRoundTrip.restored) === JSON.stringify([...SEED_FOODS.slice(0, 4), FOOD_RENAMED, SEED_FOODS[4]]),
      `改后=${backupRoundTrip.afterEdit.join(',')} / 还原后=${backupRoundTrip.restored.join(',')}`)
    record('导入前必须二次确认且说明是「替换」',
      backupRoundTrip.modalText.includes('导入会用备份内容替换当前账号的全部数据') &&
        backupRoundTrip.modalText.includes('确认导入并替换'),
      firstLine(backupRoundTrip.modalText, 90))
    record('导入摘要列出备份里的内容与来源账号',
      backupRoundTrip.modalText.includes('共') && backupRoundTrip.modalText.includes(EMAIL),
      firstLine(backupRoundTrip.modalText, 90))
    record('导入后停用状态一并还原',
      backupRoundTrip.restoredStatus === '已停用',
      backupRoundTrip.restoredStatus)
    record('导入结果显示条数口径且保存状态落到已保存',
      backupRoundTrip.imported.includes('已替换为备份内容') && backupRoundTrip.status.includes('已保存'),
      `${firstLine(backupRoundTrip.imported, 60)} / ${backupRoundTrip.status.trim()}`)
    BACKUP_TEXT = backupRoundTrip.text

    // 17. 选项：刷新后仍在（本地持久化）
    await goto()
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const optionReload = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('food');
        out.food = window.__m.optionNames('food');
        out.foodStatus = window.__m.optionStatus(${JSON.stringify(FOOD_RENAMED)});
        out.foodSummary = window.__m.optionSummary('food');
        await window.__m.openOptionList('supplement');
        out.supplement = window.__m.optionNames('supplement');
        out.groups = window.__m.optionGroupLabels('supplement');
        await window.__m.openOptionsOverview();
        return JSON.stringify(out);
      })()
    `))
    record('刷新后选项清单与顺序保持不变',
      JSON.stringify(optionReload.food) === JSON.stringify(mutations.afterDelete) &&
        JSON.stringify(optionReload.supplement) === JSON.stringify(supplement.names),
      optionReload.food.join(','))
    record('刷新后停用状态与可用数量保持不变',
      optionReload.foodStatus === '已停用' && optionReload.foodSummary === '启用 5 项 · 停用 1 项',
      `${optionReload.foodStatus} / ${optionReload.foodSummary}`)
    record('刷新后补剂仍按早 / 中 / 晚分组',
      JSON.stringify(optionReload.groups) === JSON.stringify(['早', '中', '晚']),
      optionReload.groups.join(','))

    // 17b. 备份（L5）：生成 → 校验非法文本不覆盖 → 运行时契约守卫
    //      「格式错误不得覆盖现有数据」是 docs/05 L5 的硬性要求，这里在真浏览器里验一遍：
    //      坏文本连确认框都不该出现，更不该有任何写入。
    const backupFirst = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('backup');
        window.__m.backupClick('生成备份');
        await window.__m.wait(900);
        out.text = window.__m.backupText();
        out.note = window.__m.backupNote();
        out.hasCard = !!window.__m.backupSection();
        // 记下导入前的选项清单（要切到食物屏读），稍后用来证明坏文本没写进任何东西
        await window.__m.openOptionList('food');
        out.before = window.__m.optionNames('food');

        // 粘贴一段「看起来像 JSON、但格式标记不对」的文本
        await window.__m.openOptionList('backup');
        window.__m.backupPaste('{"app": "happy-little-molly", "format": "csv"}');
        await window.__m.wait(300);
        out.inspectDisabled = window.__m.backupClick('检查这份备份');
        await window.__m.wait(700);
        out.modalAfterBad = window.__m.backupModalOpen();
        out.errorText = window.__m.backupError();

        // 空输入时按钮本身就该禁用
        window.__m.backupClear();
        await window.__m.wait(500);
        out.inspectWhenEmpty = window.__m.backupClick('检查这份备份');

        // 回食物屏确认这一串操作没有写入任何东西
        await window.__m.openOptionList('food');
        out.after = window.__m.optionNames('food');
        await window.__m.openOptionList('backup');

        // 运行时契约守卫：坏记录必须被 assertRecord 拦下（不只靠静态检查）
        try {
          const schemas = await import('/src/services/local/recordSchemas.ts');
          const broken = { id: '', user_id: 'x', name: '缺字段的选项' };
          try {
            schemas.assertRecord('food_options', broken);
            out.guard = 'NO_THROW';
          } catch (reason) {
            out.guard = (reason && reason.code) + '|' + String(reason && reason.message);
          }
        } catch (reason) {
          out.guard = 'IMPORT_FAILED|' + String(reason && reason.message);
        }
        return JSON.stringify(out);
      })()
    `))
    record('选项页渲染本地备份卡片并能生成备份',
      backupFirst.hasCard === true && backupFirst.text.length > 200 && backupFirst.note.includes('共'),
      `${backupFirst.text.length} 字符 / 提示「${backupFirst.note}」`)
    record('生成的备份带格式标记与来源账号',
      backupFirst.text.includes('"format": "local-backup"') &&
        backupFirst.text.includes(`"email": ${JSON.stringify(EMAIL)}`),
      firstLine(backupFirst.text.split('\n').slice(0, 8).join(' '), 100))
    record('粘贴非法备份点「检查」不弹确认框',
      backupFirst.inspectDisabled === 'OK' && backupFirst.modalAfterBad === false,
      `点击结果=${backupFirst.inspectDisabled}, 弹框=${backupFirst.modalAfterBad}`)
    record('非法备份给出可读错误且不改动现有数据',
      backupFirst.errorText.includes('这份备份不能导入') &&
        JSON.stringify(backupFirst.after) === JSON.stringify(backupFirst.before),
      firstLine(backupFirst.errorText, 70))
    record('输入为空时「检查这份备份」按钮禁用',
      backupFirst.inspectWhenEmpty === 'DISABLED:检查这份备份',
      backupFirst.inspectWhenEmpty)
    record('运行时写入契约拦下坏记录',
      String(backupFirst.guard).startsWith('local_record_invalid') &&
        String(backupFirst.guard).includes('主键 id 不能为空'),
      firstLine(backupFirst.guard, 70))
    await shot('05b-选项页-备份卡片')

    // 18. 选项页视口
    for (const [label, width, height] of [
      ['桌面 1440x900', 1440, 900],
      ['手机 390x844', 390, 844],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await sleep(700)
      const metrics = JSON.parse(await evaluate('JSON.stringify({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })'))
      record(`选项页 ${label} 无横向溢出`, metrics.scroll <= metrics.inner, `scrollWidth=${metrics.scroll}, innerWidth=${metrics.inner}`)
      await shot(`06-选项页-视口-${label}`)
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await evaluate(`window.__m.clickText('今日')`)
    await sleep(900)

    // 19. 日计划页视口
    for (const [label, width, height] of [
      ['桌面 1440x900', 1440, 900],
      ['手机 390x844', 390, 844],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await sleep(700)
      const metrics = JSON.parse(await evaluate('JSON.stringify({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })'))
      record(`${label} 无横向溢出`, metrics.scroll <= metrics.inner, `scrollWidth=${metrics.scroll}, innerWidth=${metrics.inner}`)
      await shot(`07-日计划-视口-${label}`)
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride')

    // 19b. 弹层与底部导航的层级（真机反馈：抽屉里看不到「保存 / 取消」）
    // 底部导航是 fixed 且 z-index 30，抽屉也是 fixed 且贴着视口底边——两者在屏幕上抢同一条带子。
    // 导航若排在抽屉之上，抽屉钉底的操作区会被整条盖住，真机表现就是「确认和取消按钮看不到、点不到」。
    // 所以这里不只量矩形，还要在按钮中心做一次命中测试：位置算对但被别的东西盖住，同样算失败。
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await sleep(700)
    await evaluate(`window.__m.clickText('准备明天')`)
    await sleep(1200)
    await evaluate(`window.__m.clickContains('三餐已安排', '.row-main')`)
    await sleep(1200)
    const sheetLayering = JSON.parse(await evaluate(`
      (() => {
        const sheet = document.querySelector('.bottom-sheet[data-editor-card]');
        const actions = sheet ? sheet.querySelector('.actions') : null;
        const buttons = actions ? [...actions.querySelectorAll('button')] : [];
        const nav = document.querySelector('.bottom-nav');
        const navButton = nav ? nav.querySelector('button') : null;
        // 命中测试：中心点上真正接住指针的元素是否属于自己。返回 null（点在视口外）也算失败。
        const hit = (el) => {
          if (!el) return null;
          const box = el.getBoundingClientRect();
          const found = document.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2));
          return Boolean(found) && (el === found || el.contains(found) || found.contains(el));
        };
        return JSON.stringify({
          found: Boolean(sheet) && buttons.length > 0,
          labels: buttons.map((button) => button.textContent.trim()),
          buttonsHit: buttons.map(hit),
          actionsTop: actions ? Math.round(actions.getBoundingClientRect().top) : null,
          actionsBottom: actions ? Math.round(actions.getBoundingClientRect().bottom) : null,
          innerHeight: window.innerHeight,
          navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
          navHit: hit(navButton),
        });
      })()
    `))
    record('底部抽屉的「保存 / 取消」完整可见且可点（不被底部导航压住）',
      sheetLayering.found &&
        sheetLayering.buttonsHit.length > 0 &&
        sheetLayering.buttonsHit.every((value) => value === true) &&
        sheetLayering.actionsBottom !== null &&
        sheetLayering.actionsBottom <= sheetLayering.innerHeight,
      `按钮=${sheetLayering.labels.join('/')}，命中测试=${JSON.stringify(sheetLayering.buttonsHit)}，操作区 ${sheetLayering.actionsTop}→${sheetLayering.actionsBottom}（视口 ${sheetLayering.innerHeight}），导航顶边 ${sheetLayering.navTop}`)
    record('弹层打开时底部导航被遮罩盖住（不会在编辑途中误切页）',
      sheetLayering.navHit === false,
      `导航按钮命中自身=${sheetLayering.navHit}（期望 false：应被遮罩 / 抽屉盖住）`)
    await shot('07b-抽屉操作区-手机')
    await evaluate(`window.__m.clickText('取消')`)
    await sleep(900)
    await cdp.send('Emulation.clearDeviceMetricsOverride')

    // 20. 退出登录
    await sleep(400)
    await evaluate(`window.__m.clickText('退出登录')`)
    await sleep(1500)
    const afterSignOut = await text()
    record('退出登录后回到登录页', afterSignOut.includes('邮箱') && afterSignOut.includes('注册'))

    // 21. 第二个本地账号：各自的选项互不可见（docs/05 L1「不同本地账号之间互不可见」）
    await evaluate(`
      (async () => {
        window.__m.fill('邮箱', ${JSON.stringify(EMAIL_B)});
        window.__m.fill('密码', ${JSON.stringify(PASSWORD)});
        await window.__m.wait(200);
        window.__m.clickText('注册');
      })()
    `)
    await sleep(1800)
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const secondAccount = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('food');
        out.food = window.__m.optionNames('food');
        await window.__m.openOptionList('supplement');
        out.supplement = window.__m.optionNames('supplement');
        await window.__m.openOptionList('exercise');
        out.exercise = window.__m.optionNames('exercise');
        await window.__m.openOptionList('account');
        out.account = window.__m.accountText();
        return JSON.stringify(out);
      })()
    `))
    const allSecondAccountNames = [...secondAccount.food, ...secondAccount.supplement, ...secondAccount.exercise]
    record('第二个账号只看到自己的示例选项',
      JSON.stringify(secondAccount.food) === JSON.stringify(SEED_FOODS) &&
        secondAccount.supplement.length === 3 &&
        secondAccount.exercise.length === 4,
      `食物=${secondAccount.food.join(',')}`)
    record('第二个账号看不到第一个账号的选项',
      !allSecondAccountNames.includes(FOOD_RENAMED) && !allSecondAccountNames.includes(SUPPLEMENT_NAME) && !allSecondAccountNames.includes(TEMP_NAME))
    record('账号卡显示当前登录邮箱', secondAccount.account.includes(EMAIL_B), firstLine(secondAccount.account, 60))

    // 21b. 清空站点数据（等同「清理浏览器数据」）后必须回到登录页，且库真的空了；
    //      重新注册一个新账号并导入之前导出的备份，数据应完整回来——这是备份存在的唯一理由。
    const ORIGIN = new URL(appUrl).origin
    await cdp.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' })
    await goto()
    // 清空动作发生在旧页面还活着的时候，旧页面的连接被强拆可能报出已被导航掉的噪音；
    // 那不是应用行为。从这里开始重新计数，后面的控制台检查仍然覆盖「清空之后」的完整流程。
    cdp.events.length = 0
    const afterWipe = await text()
    record('清空站点数据后回到登录页',
      afterWipe.includes('邮箱') && afterWipe.includes('注册') && !afterWipe.includes('执行今天'),
      firstLine(afterWipe, 70))

    const wipedSchema = JSON.parse(await evaluate(`(async () => { try { return await window.__m.dbSchema() } catch (reason) { return JSON.stringify({ error: String(reason) }) } })()`))
    record('清空后本地库已不存在（或为空库）',
      wipedSchema.exists === false || wipedSchema.names.length === 0,
      wipedSchema.exists === false ? '库不存在（未被动过）' : `tables=${wipedSchema.names.join(',')}`)

    await evaluate(`
      (async () => {
        window.__m.fill('邮箱', ${JSON.stringify(EMAIL_C)});
        window.__m.fill('密码', ${JSON.stringify(PASSWORD)});
        await window.__m.wait(200);
        window.__m.clickText('注册');
      })()
    `)
    await sleep(1800)
    await evaluate(`window.__m.clickText('选项')`)
    await sleep(1200)
    const freshAccount = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('food');
        out.food = window.__m.optionNames('food');
        await window.__m.openOptionList('account');
        out.account = window.__m.accountText();
        return JSON.stringify(out);
      })()
    `))
    record('新账号拿到的是全新示例选项而不是旧数据',
      JSON.stringify(freshAccount.food) === JSON.stringify(SEED_FOODS) && freshAccount.account.includes(EMAIL_C),
      firstLine(freshAccount.account, 70))

    const restoredByImport = JSON.parse(await evaluate(`
      (async () => {
        const out = {};
        await window.__m.openOptionList('backup');
        window.__m.backupPaste(${JSON.stringify(BACKUP_TEXT)});
        await window.__m.wait(400);
        window.__m.backupClick('检查这份备份');
        await window.__m.wait(900);
        out.modal = window.__m.backupModalOpen();
        window.__m.clickText('确认导入并替换');
        await window.__m.wait(2800);
        out.imported = window.__m.backupImported();
        await window.__m.openOptionList('food');
        out.food = window.__m.optionNames('food');
        out.foodStatus = window.__m.optionStatus(${JSON.stringify(FOOD_RENAMED)});
        await window.__m.openOptionList('supplement');
        out.supplement = window.__m.optionNames('supplement');
        return JSON.stringify(out);
      })()
    `))
    record('换设备场景：新账号导入备份后选项完整回来',
      restoredByImport.modal === true &&
        JSON.stringify(restoredByImport.food) === JSON.stringify([...SEED_FOODS.slice(0, 4), FOOD_RENAMED, SEED_FOODS[4]]) &&
        restoredByImport.foodStatus === '已停用' &&
        restoredByImport.supplement.includes(SUPPLEMENT_NAME),
      `食物=${restoredByImport.food.join(',')} / 状态=${restoredByImport.foodStatus}`)
    record('导入结果提示写明「已替换为备份内容」',
      restoredByImport.imported.includes('已替换为备份内容'),
      firstLine(restoredByImport.imported, 80))

    // 导入回来的不只是选项：日计划本身也要能看见内容。
    // 断言只读「准备区」文本——选项页刚导完、刚 reload 过，全页文本里本来就有这些名字，
    // 拿全页文本去断言等于恒真。准备区的三餐摘要与补剂摘要来自这一天已保存的计划，
    // 它们出现才说明备份里的计划真的回到了界面上。
    await evaluate(`window.__m.clickText('今日')`)
    await sleep(1000)
    await evaluate(`window.__m.clickText('准备明天')`)
    await sleep(1800)
    const restoredPlan = JSON.parse(await evaluate(`
      JSON.stringify({
        prep: (() => {
          const list = document.querySelector('.prep-list');
          return list ? list.innerText.replace(/\\n+/g, ' · ').trim() : 'NO_PREP_LIST';
        })(),
        mode: window.__m.modeLabel(),
      })
    `))
    record('导入后日计划内容也一并恢复',
      restoredPlan.prep.includes('燕麦牛奶') &&
        restoredPlan.prep.includes('维生素 D') &&
        restoredPlan.prep.includes('健身安排已决定'),
      firstLine(restoredPlan.prep, 220))

    // 22. 控制台
    const noisy = cdp.events.filter((event) => {
      if (event.method === 'Runtime.exceptionThrown') return true
      if (event.method === 'Log.entryAdded') return ['error', 'warning'].includes(event.params.entry.level)
      if (event.method === 'Runtime.consoleAPICalled') return ['error', 'warning'].includes(event.params.type)
      return false
    })
    record('控制台无 error / warning', noisy.length === 0,
      noisy.slice(0, 3).map((event) => event.params.entry?.text ?? event.params.exceptionDetails?.text ?? event.params.type).join(' | '))

    const failed = results.filter((item) => !item.ok)
    console.log('')
    console.log(`结果：${results.length - failed.length}/${results.length} 通过`)
    if (failed.length) {
      console.log('未通过：')
      failed.forEach((item) => console.log(`  - ${item.name}`))
      process.exitCode = 1
    }
  } finally {
    if (child) child.kill()
    stopProcess(devServer?.child ?? null)
    await sleep(500)
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('验收脚本异常：', error.message)
  process.exitCode = 2
})
>>>>>>> origin/main
