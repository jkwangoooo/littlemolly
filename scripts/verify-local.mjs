#!/usr/bin/env node
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
