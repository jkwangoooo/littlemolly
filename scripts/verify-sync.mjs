#!/usr/bin/env node
// Real SDK, IndexedDB, services and scheduler; only the HTTP boundary is mocked.
// The normal app covers UI and automatic uploads. An isolated service browser
// stops the production scheduler while checking controlled replacement races.
import { randomUUID } from 'node:crypto'
import {
  createAuthFixture, FIXTURE_UID, OTHER_UID, FIXTURE_PASSWORD,
} from './lib/auth-fixture.mjs'
import {
  DB_NAME, startDevServer, stopProcess, launchBrowser, createRecorder, sleep,
} from './lib/browser-harness.mjs'

const { USER_DATA_STORES, RECORD_SCHEMAS } = await import('../src/services/local/recordSchemas.ts')
const { buildBackup } = await import('../src/services/local/backupFormat.ts')
const { record, finish } = createRecorder()
const ROOT_STORES = new Set(['day_plans', 'food_options', 'supplement_templates', 'exercise_options'])
const PLAN_CHILDREN = new Set(['daily_meals', 'custom_tasks', 'daily_supplements', 'daily_exercise_items', 'routine_tasks'])
const DEVICE_STORES = [
  'sync_outbox', 'sync_state', 'legacy_users', 'legacy_sync_state', 'legacy_outbox',
  'workspace_state', 'workspace_migrations',
]
const epoch = '2020-01-01T00:00:00.000Z'
let server
let browser
let serviceBrowser

const apiHelpers = `(async()=>{
  window.__v={
    auth:await import('/src/services/api/authService.ts'),
    plan:await import('/src/services/api/dayPlanService.ts'),
    options:await import('/src/services/api/optionService.ts'),
    backup:await import('/src/services/api/backupService.ts'),
    sync:await import('/src/services/api/syncService.ts'),
    dates:await import('/src/shared/date/dateUtils.ts'),
    session:await import('/src/services/session.ts'),
    engine:await import('/src/services/sync/outbox.ts')
  };
  window.__reject=async(work)=>{try{await work();return null}catch(error){return error.message}};
  return true
})()`

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}
const stable = (value) => JSON.stringify(canonical(value))
const same = (left, right) => stable(left) === stable(right)
const queueOf = (snapshot, owner = FIXTURE_UID) => snapshot.rows.sync_outbox.filter((row) => row.local_user_id === owner)
const stateOf = (snapshot, owner = FIXTURE_UID) => snapshot.rows.sync_state.find((row) => row.id === owner)
const sortedIds = (rows) => rows.map((row) => row.id).sort()
const businessRows = (rows, owner = FIXTURE_UID) => {
  const plans = new Set((rows.day_plans ?? []).filter((row) => row.user_id === owner).map((row) => row.id))
  const meals = new Set((rows.daily_meals ?? []).filter((row) => plans.has(row.day_plan_id)).map((row) => row.id))
  return Object.fromEntries(USER_DATA_STORES.map((store) => {
    const selected = (rows[store] ?? []).filter((row) => {
      if (ROOT_STORES.has(store)) return row.user_id === owner
      if (PLAN_CHILDREN.has(store)) return plans.has(row.day_plan_id)
      return meals.has(row.daily_meal_id)
    }).map((row) => Object.fromEntries(Object.keys(RECORD_SCHEMAS[store]).map((key) => [key, row[key]])))
      .sort((left, right) => left.id.localeCompare(right.id))
    return [store, selected]
  }))
}
const foreignData = (snapshot) => ({
  business: businessRows(snapshot.rows, OTHER_UID),
  queues: queueOf(snapshot, OTHER_UID),
  state: stateOf(snapshot, OTHER_UID),
  profiles: snapshot.rows.users.filter((row) => row.id === OTHER_UID),
  workspace: snapshot.rows.workspace_state.filter((row) => row.id === OTHER_UID),
  legacy: Object.fromEntries(['legacy_users', 'legacy_sync_state', 'legacy_outbox', 'workspace_migrations']
    .map((store) => [store, snapshot.rows[store]])),
})
const fixtureBusiness = (fixture) => businessRows(Object.fromEntries(USER_DATA_STORES.map((store) => [store, fixture.rowsOf(store)])))
const status = (target) => target.evaluate(`window.__v.sync.readSyncStatus()`)
const phase = (target) => target.evaluate(`window.__v.auth.getAuthState().phase`)
const errorOf = (target, expression) => target.evaluate(`window.__reject(async()=>${expression})`)
const pendingZero = (target) => target.until(`window.__v.sync.readSyncStatus().then(value=>value.pendingCount===0)`, 30000)
const manualPush = `window.__v.engine.withSyncLock(()=>window.__v.engine.pushOnce(window.__v.session.captureAuthContext()))`

async function waitFor(predicate, message, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await sleep(100)
  }
  throw new Error(`Timed out: ${message}`)
}

async function openAccount(target) {
  await target.installHelpers()
  if (await target.evaluate(`!!document.querySelector('.sync-card')`)) return
  if (!await target.evaluate(`!!document.querySelector('[data-option-entry="account"]')`)) {
    await target.evaluate(`window.__m.click('选项')`)
    await target.until(`!!document.querySelector('[data-option-entry="account"]')`)
  }
  await target.evaluate(`window.__m.openPreference('account')`)
  await target.until(`!!document.querySelector('.sync-card')&&document.querySelector('.sync-card').innerText.includes('本地共')`)
}

async function startPromise(target, expression) {
  await target.evaluate(`(()=>{
    window.__outcome=null;
    window.__pending=(${expression}).then(value=>({ok:true,value}),error=>({ok:false,error:error.message}))
      .then(outcome=>{window.__outcome=outcome;return outcome});
    return true
  })()`)
}

async function outcome(target) {
  await target.until(`window.__outcome!==null`, 30000)
  return target.evaluate(`window.__outcome`)
}

async function rejectWithoutWrites(target, name, expression, expected = '') {
  const before = await target.readDb()
  const problem = await errorOf(target, expression)
  record(name, Boolean(problem) && (!expected || problem.includes(expected)), problem ?? 'unexpected success')
  record(`${name}：业务、队列与成功时间不变`, same((await target.readDb()).rows, before.rows))
}

function snapshotWith(records, owner = FIXTURE_UID) {
  return buildBackup({
    dbVersion: 8, exportedAt: new Date().toISOString(), sourceUsername: 'W',
    records: { ...structuredClone(records), users: [{ id: owner, username: 'W', created_at: epoch }] },
  })
}

async function injectForeign(target) {
  const before = await target.readDb()
  const copies = businessRows(before.rows)
  const remap = new Map(Object.values(copies).flat().map((row) => [row.id, randomUUID()]))
  const puts = []
  for (const [store, rows] of Object.entries(copies)) {
    for (const row of rows) {
      const copy = { ...row, id: remap.get(row.id) }
      if (ROOT_STORES.has(store)) copy.user_id = OTHER_UID
      for (const key of ['day_plan_id', 'daily_meal_id', 'food_option_id', 'exercise_option_id']) {
        if (copy[key] !== null && key in copy) copy[key] = remap.get(copy[key])
      }
      puts.push({ store, value: copy })
    }
  }
  const foreignFood = puts.find((item) => item.store === 'food_options').value
  const queue = {
    id: randomUUID(), seq: 1, store: 'food_options', record_id: foreignFood.id, op: 'upsert',
    local_user_id: OTHER_UID, created_at: epoch, attempts: 7, last_error: 'foreign queue must stay untouched',
  }
  const state = { ...stateOf(before), id: OTHER_UID, device_id: 'foreign-device', last_push_at: epoch, last_error_message: 'foreign error' }
  puts.push(
    { store: 'users', value: { id: OTHER_UID, username: 'unapproved-fixture', created_at: epoch } },
    { store: 'sync_outbox', value: queue },
    { store: 'sync_state', value: state },
    { store: 'workspace_state', value: { id: OTHER_UID, initialized: true, initialized_at: epoch, initialized_from: 'cloud', updated_at: epoch } },
    { store: 'legacy_users', value: { id: 'isolated-fixture', username: 'old-fixture', created_at: epoch, isolated_at: epoch } },
    { store: 'legacy_outbox', value: { ...queue, id: randomUUID(), local_user_id: 'isolated-fixture', isolated_at: epoch } },
    { store: 'legacy_sync_state', value: { ...state, id: 'isolated-fixture', cloud_user_id: OTHER_UID, isolated_at: epoch } },
    { store: 'workspace_migrations', value: {
      id: randomUUID(), source_owner: 'journal-fixture', target_owner: OTHER_UID,
      status: 'completed', record_count: 1, started_at: epoch, completed_at: epoch,
    } },
  )
  await target.evaluate(`new Promise((done,reject)=>{
    const request=indexedDB.open(${JSON.stringify(DB_NAME)});
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result;const puts=${JSON.stringify(puts)};
      const tx=db.transaction([...new Set(puts.map(item=>item.store))],'readwrite');
      for(const item of puts)tx.objectStore(item.store).put(item.value);
      tx.oncomplete=()=>{db.close();done(true)};tx.onerror=()=>reject(tx.error)
    }
  })`)
  return foreignData(await target.readDb())
}

async function createTenTables(target) {
  return target.evaluate(`(async()=>{
    const date=window.__v.dates.addDays(window.__v.dates.getBusinessDateKey(),7);
    const food=await window.__v.options.createOption('food',{name:'十表验收食物'});
    const supplement=await window.__v.options.createOption('supplement',{name:'十表验收补剂',period:'morning'});
    const exercise=await window.__v.options.createOption('exercise',{name:'十表验收动作'});
    const plan=await window.__v.plan.upsertDayPlan(date,{
      mode:'rest',mode_override:false,morning_focus:'晨间内容快照',morning_completed:true,
      outfit_ready:true,meals_ready:false,supplements_ready:true,morning_ready:false,exercise_ready:true
    });
    await window.__v.plan.saveMeals(date,[
      {meal_type:'breakfast',note:'早餐备注',items:[{optionId:food.id,name:food.name},{optionId:null,name:'独立食物快照'}]},
      {meal_type:'lunch',note:'午餐备注',items:[{optionId:food.id,name:food.name}]},
      {meal_type:'dinner',note:'晚餐备注',items:[{optionId:null,name:'晚餐名称快照'}]}
    ]);
    await window.__v.plan.setMealCompleted(date,'breakfast',true);
    await window.__v.plan.saveDaySupplements(date,[
      {name:'补剂名称快照',period:'noon',planned:true,completed:true},
      {name:'停用计划补剂',period:'evening',planned:false,completed:false}
    ]);
    await window.__v.plan.saveExercise(date,{decision:'exercise',note:'健身备注',
      items:[{optionId:exercise.id,name:exercise.name},{optionId:null,name:'独立动作快照'}]});
    await window.__v.plan.upsertDayPlan(date,{exercise_completed:true});
    await window.__v.plan.saveCustomTask(date,{task_time:'09:15',title:'账号归属事项',note:'事项备注',completed:true});
    const routines=await window.__v.plan.ensureRestDayRoutines(date);
    await window.__v.plan.setRoutineCompleted(date,routines[0].id,true);
    return {date,food:food.id,supplement:supplement.id,exercise:exercise.id,plan:plan.id}
  })()`)
}

async function mainApp(fixture) {
  browser = await launchBrowser({ label: 'sync-app' })
  await fixture.attach(browser.cdp)
  await browser.navigate(server.url)
  await browser.until(`!!document.querySelector('input[type="password"]')`)
  await browser.evaluate(apiHelpers)
  await sleep(1800)
  record('未登录时没有业务读写或上传', fixture.rest.length === 0 && fixture.writes().length === 0)
  record('登录界面只有账号和密码，没有公开注册', await browser.evaluate(`document.querySelectorAll('input').length===2&&!([...document.querySelectorAll('button')].some(button=>/注册/.test(button.textContent)))`))
  record('未登录业务写入明确被拒', Boolean(await errorOf(browser, `window.__v.options.createOption('food',{name:'未登录写入'})`)))

  fixture.hold = 'export_cloud_snapshot'
  await browser.login()
  await waitFor(() => fixture.held.some((item) => item.name === 'export_cloud_snapshot'), 'first snapshot is held')
  record('首次恢复完成前封闭业务界面', await phase(browser) === 'preparing' && !await browser.evaluate(`!!document.querySelector('.bottom-nav')`))
  record('首次准备期间不上传业务行', fixture.writes().length === 0)
  record('工作区准备前不能导出业务备份', Boolean(await errorOf(browser, `window.__v.backup.exportBackup()`)))
  await fixture.release('export_cloud_snapshot')
  await browser.ready()
  await pendingZero(browser)
  await sleep(1800)
  const initialized = await browser.readDb()
  const identity = await browser.evaluate(`window.__v.auth.currentUser()`)
  record('认证 UID、资料 UID 与同步状态 UID 统一', identity?.id === FIXTURE_UID && initialized.rows.users.length === 1 && initialized.rows.users[0].id === FIXTURE_UID && stateOf(initialized)?.id === FIXTURE_UID)
  record('本地资料不保存密码，也没有第二个 cloud_user_id', same(Object.keys(initialized.rows.users[0]).sort(), ['created_at', 'id', 'username']) && !('cloud_user_id' in stateOf(initialized)))
  record('新工作区没有播种示例账号或候选项', ['food_options', 'supplement_templates', 'exercise_options'].every((store) => initialized.rows[store].length === 0))
  record('工作区已准备且云端授权已验证', initialized.rows.workspace_state[0]?.initialized === true && await browser.evaluate(`window.__v.auth.getAuthState().verified`))
  const firstDevice = stateOf(initialized).device_id

  await openAccount(browser)
  const beforeStatus = fixture.rest.length
  await status(browser)
  record('同步状态读取只取本地事实', fixture.rest.length === beforeStatus)
  record('账号界面没有补建、注册或双身份绑定入口', await browser.evaluate(`![...document.querySelectorAll('button')].some(button=>/注册|创建云端|连接云端|断开连接|补建/.test(button.textContent))`))
  record('队列排空仍不声称已同步', await browser.evaluate(`document.querySelector('.sync-card').innerText.includes('不代表云端内容与本地完全一致')&&!document.querySelector('.sync-card').innerText.includes('已同步')`))

  const beforeDebounce = fixture.writes().length
  const food = await browser.evaluate(`window.__v.options.createOption('food',{name:'防抖初值'})`)
  let snapshot = await browser.readDb()
  record('本地写入同事务产生统一 UID 的队列', snapshot.rows.food_options.some((row) => row.id === food.id && row.user_id === FIXTURE_UID) && queueOf(snapshot).length === 1 && queueOf(snapshot)[0].record_id === food.id)
  await sleep(650)
  record('1500ms 防抖窗口内不抢先发送', fixture.writes().length === beforeDebounce)
  await browser.evaluate(`window.__v.options.renameOption('food',${JSON.stringify(food.id)},'防抖中间值')`)
  await sleep(650)
  record('连续编辑重置防抖等待', fixture.writes().length === beforeDebounce)
  await browser.evaluate(`window.__v.options.renameOption('food',${JSON.stringify(food.id)},'防抖最终值')`)
  await sleep(650)
  record('最后编辑后的防抖窗口仍未上传', fixture.writes().length === beforeDebounce)
  record('连续编辑压缩成一条待上传记录', queueOf(await browser.readDb()).length === 1)
  await pendingZero(browser)
  const debounceWrites = fixture.writes().slice(beforeDebounce).filter((request) => request.table === 'food_options' && request.method === 'POST')
  record('自然调度只上传最终值一次', debounceWrites.length === 1 && debounceWrites[0].body.length === 1 && debounceWrites[0].body[0].name === '防抖最终值')
  record('上传保留原业务 UUID 与归属', fixture.rowsOf('food_options').some((row) => row.id === food.id && row.user_id === FIXTURE_UID))
  record('成功才退役队列并写入上传时间', queueOf(await browser.readDb()).length === 0 && Boolean((await status(browser)).lastPushAt))

  const beforeDelete = fixture.writes().length
  const kept = await browser.evaluate(`window.__v.options.createOption('food',{name:'保留的食物'})`)
  await browser.evaluate(`window.__v.options.deleteOption('food',${JSON.stringify(food.id)})`)
  record('删除与新建都在同一 UID 的队列内', queueOf(await browser.readDb()).some((row) => row.op === 'delete' && row.record_id === food.id))
  await pendingZero(browser)
  const ordered = fixture.writes().slice(beforeDelete)
  record('删除先于同批次写入发送', ordered[0]?.method === 'DELETE' && ordered.some((request) => request.method === 'POST'))
  record('云端真实删除旧行并保留新行', !fixture.rowsOf('food_options').some((row) => row.id === food.id) && fixture.rowsOf('food_options').some((row) => row.id === kept.id))
  const countBeforeRepeat = fixture.rowsOf('food_options').length
  await browser.evaluate(`window.__v.options.renameOption('food',${JSON.stringify(kept.id)},'幂等末值')`)
  await pendingZero(browser)
  record('重复 upsert 幂等，UUID 不变且没有多出行', fixture.rowsOf('food_options').length === countBeforeRepeat && fixture.rowsOf('food_options').find((row) => row.id === kept.id)?.name === '幂等末值')

  const beforeOffline = await browser.readDb()
  const beforeOfflineWrites = fixture.writes().length
  fixture.offline = true
  await browser.cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  await browser.evaluate(`window.__v.auth.retryAuth()`)
  record('断网进入缓存工作区且不能上传', await phase(browser) === 'offline-cached' && !await browser.evaluate(`window.__v.auth.getAuthState().verified`))
  const offlineFood = await browser.evaluate(`window.__v.options.createOption('food',{name:'离线持久化食物'})`)
  const offlineDb = await browser.readDb()
  await sleep(1800)
  record('离线编辑保留队列且不伪造上传时间', queueOf(offlineDb).length === 1 && stateOf(await browser.readDb()).last_push_at === stateOf(beforeOffline).last_push_at && fixture.writes().length === beforeOfflineWrites)
  // Keep fixture HTTP offline while allowing the dev shell to reload.
  await browser.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await rejectWithoutWrites(browser, '离线不能整体上传', `window.__v.sync.uploadLocalToCloud()`, '联网验证')
  await browser.reload()
  await browser.ready()
  await browser.evaluate(apiHelpers)
  const reloadedOffline = await browser.readDb()
  record('离线刷新保留业务 ID 与队列 ID', same(businessRows(reloadedOffline.rows), businessRows(offlineDb.rows)) && same(sortedIds(queueOf(reloadedOffline)), sortedIds(queueOf(offlineDb))))
  record('离线刷新保留设备 ID 与最后成功时间', stateOf(reloadedOffline).device_id === firstDevice && stateOf(reloadedOffline).last_push_at === stateOf(offlineDb).last_push_at)
  record('离线刷新仍未通过云端认证门禁', await phase(browser) === 'offline-cached' && fixture.writes().length === beforeOfflineWrites)

  fixture.offline = false
  fixture.hold = 'account_access'
  const beforeOnlineGate = fixture.rest.length
  const beforeOnlineUser = fixture.auth.filter((request) => request.path.endsWith('/user')).length
  await browser.evaluate(`window.dispatchEvent(new Event('online'))`)
  await waitFor(() => fixture.held.some((item) => item.name === 'account_access'), 'reconnection gate is held')
  record('联网后先重新验证 SDK 用户与服务端门禁', fixture.auth.filter((request) => request.path.endsWith('/user')).length > beforeOnlineUser && fixture.rest.slice(beforeOnlineGate).some((request) => request.name === 'account_access'))
  record('门禁验证完成前保留离线队列且不上传', fixture.writes().length === beforeOfflineWrites && same(sortedIds(queueOf(await browser.readDb())), sortedIds(queueOf(offlineDb))))
  await fixture.release('account_access')
  await browser.until(`window.__v.auth.getAuthState().phase==='ready'&&window.__v.auth.getAuthState().verified`)
  await pendingZero(browser)
  record('联网认证通过后自然补推离线编辑', fixture.rowsOf('food_options').some((row) => row.id === offlineFood.id && row.name === offlineFood.name))

  fixture.offline = true
  await browser.evaluate(`window.__v.auth.retryAuth()`)
  const reloginFood = await browser.evaluate(`window.__v.options.createOption('food',{name:'退出重登待上传食物'})`)
  const beforeLogout = await browser.readDb()
  const logoutError = await errorOf(browser, `window.__v.auth.signOut()`)
  await browser.until(`window.__v.auth.getAuthState().phase==='signed-out'`)
  record('退出请求失败仍立即封闭业务并如实报错', Boolean(logoutError) && !await browser.evaluate(`!!document.querySelector('.bottom-nav')`))
  record('退出不删除账号业务或待上传队列', same((await browser.readDb()).rows, beforeLogout.rows))
  fixture.offline = false
  fixture.hold = 'account_access'
  const beforeReloginWrites = fixture.writes().length
  await browser.login()
  await waitFor(() => fixture.held.some((item) => item.name === 'account_access'), 'same account login gate')
  record('原账号可以重新登录，认证期间仍不上传', await phase(browser) === 'preparing' && fixture.writes().length === beforeReloginWrites)
  record('同 UID 重登不重建业务和队列 ID', same(businessRows((await browser.readDb()).rows), businessRows(beforeLogout.rows)) && same(sortedIds(queueOf(await browser.readDb())), sortedIds(queueOf(beforeLogout))))
  await fixture.release('account_access')
  await browser.ready()
  await pendingZero(browser)
  const afterRelogin = await browser.readDb()
  record('原账号重登后恢复同一 UID 和设备 ID', await browser.evaluate(`window.__v.auth.currentUser().id===${JSON.stringify(FIXTURE_UID)}`) && stateOf(afterRelogin).device_id === firstDevice)
  record('重登后继续发送原队列而非要求重新注册', fixture.rowsOf('food_options').some((row) => row.id === reloginFood.id) && queueOf(afterRelogin).length === 0)
  record('同账号重登保持原业务 UUID', afterRelogin.rows.food_options.some((row) => row.id === kept.id) && afterRelogin.rows.food_options.some((row) => row.id === offlineFood.id))

  const lastPushBeforeFailure = (await status(browser)).lastPushAt
  fixture.rejectTable = 'food_options'
  const rejected = await browser.evaluate(`window.__v.options.createOption('food',{name:'500 后可重试食物'})`)
  await browser.until(`window.__v.sync.readSyncStatus().then(value=>Boolean(value.lastError?.message.includes('fixture rejected food_options')))`)
  const failedDb = await browser.readDb()
  record('HTTP 500 保留队列并增加真实 attempts', queueOf(failedDb).length === 1 && queueOf(failedDb)[0].attempts >= 1 && queueOf(failedDb)[0].last_error.includes('fixture rejected food_options'))
  record('上传失败不更新最后成功时间', stateOf(failedDb).last_push_at === lastPushBeforeFailure)
  record('失败没有伪造云端记录', !fixture.rowsOf('food_options').some((row) => row.id === rejected.id))
  await openAccount(browser)
  record('界面显示上传失败的具体原因', await browser.evaluate(`document.querySelector('.sync-card').innerText.includes('上传失败')&&document.querySelector('.sync-card').innerText.includes('fixture rejected food_options')`))
  await browser.until(`window.__v.sync.readSyncStatus().then(async()=>{const db=await import('/src/services/local/localDb.ts');return (await db.getAll('sync_outbox')).some(row=>row.local_user_id===${JSON.stringify(FIXTURE_UID)}&&row.attempts>=2)})`)
  record('500 后退避调度确实自动重试', queueOf(await browser.readDb())[0].attempts >= 2)
  fixture.rejectTable = null
  await pendingZero(browser)
  record('服务恢复后自动成功并清除过期错误', (await status(browser)).lastError === null && fixture.rowsOf('food_options').some((row) => row.id === rejected.id))

  await createTenTables(browser)
  await pendingZero(browser)
  snapshot = await browser.readDb()
  record('验收数据覆盖十张业务表', USER_DATA_STORES.every((store) => businessRows(snapshot.rows)[store].length > 0))
  record('增量上传十表全部逐行一致', same(fixtureBusiness(fixture), businessRows(snapshot.rows)))
  record('十表根记录全部使用同一 Supabase UID', [...ROOT_STORES].every((store) => snapshot.rows[store].every((row) => row.user_id === FIXTURE_UID)))
  const foreignBefore = await injectForeign(browser)
  const beforeForeignWake = fixture.writes().length
  await browser.evaluate(`window.dispatchEvent(new Event('molly-outbox-change'))`)
  await sleep(1800)
  record('OTHER_UID 仅注入隔离数据，没有登录 B', fixture.auth.filter((request) => request.path.endsWith('/token')).every((request) => request.body.email === 'w@molly.local'))
  record('OTHER_UID 队列不上传、不退役也不计入 W 待上传数', fixture.writes().length === beforeForeignWake && (await status(browser)).pendingCount === 0 && queueOf(await browser.readDb(), OTHER_UID).length === 1)
  record('OTHER_UID 业务、队列和状态原样保留', same(foreignData(await browser.readDb()), foreignBefore))

  fixture.rejectTable = 'food_options'
  await browser.evaluate(`window.__v.options.createOption('food',{name:'整体上传前积压食物'})`)
  await browser.until(`window.__v.sync.readSyncStatus().then(value=>Boolean(value.lastError))`)
  const beforeUpload = await browser.readDb()
  const expectedUpload = businessRows(beforeUpload.rows)
  fixture.rows.clear()
  fixture.put('food_options', {
    id: randomUUID(), user_id: FIXTURE_UID, name: '即将被替换的云端旧数据',
    active: true, sort_order: 99, created_at: epoch, updated_at: epoch,
  })
  await openAccount(browser)
  const localTotal = (await status(browser)).localCount
  const beforeUploadRpc = fixture.rest.filter((request) => request.name === 'import_local_backup').length
  await browser.evaluate(`window.__m.click('上传本地数据到云端')`)
  await browser.until(`!!document.querySelector('.confirm-modal')`)
  const uploadDialog = await browser.evaluate(`document.querySelector('.confirm-modal').innerText`)
  record('整体上传先确认，不提前执行 RPC', fixture.rest.filter((request) => request.name === 'import_local_backup').length === beforeUploadRpc)
  record('上传确认框写出具体条数与正确方向', uploadDialog.replace(/\s/g, '').includes(`将用本地${localTotal}条替换云端1条。`), uploadDialog)
  record('上传确认框明确不可撤销及云端旧内容删除', uploadDialog.includes('不可撤销') && uploadDialog.includes('云端账号现有的全部业务数据会被删除') && uploadDialog.includes('云端原有的内容无法找回'))
  await browser.evaluate(`window.__m.click('替换云端数据',document.querySelector('.confirm-modal'))`)
  await browser.until(`!document.querySelector('.confirm-modal')&&document.querySelector('.sync-card').innerText.includes('云端已替换为本地内容')`)
  record('整体上传用真实 import_local_backup RPC 并如实报数', fixture.rest.filter((request) => request.name === 'import_local_backup').length === beforeUploadRpc + 1 && fixture.summary().total === localTotal)
  for (const store of USER_DATA_STORES) {
    record(`整体上传逐行核对 ${store}`, same(fixtureBusiness(fixture)[store], expectedUpload[store]))
  }
  const afterUpload = await browser.readDb()
  record('整体上传只清自己的捕获队列并记录成功时间', queueOf(afterUpload).length === 0 && stateOf(afterUpload).last_push_at !== stateOf(beforeUpload).last_push_at)
  record('整体上传保留 OTHER_UID 与设备 ID', same(foreignData(afterUpload), foreignBefore) && stateOf(afterUpload).device_id === firstDevice)
  const uploadPayload = fixture.rest.filter((request) => request.name === 'import_local_backup').at(-1).body.payload
  record('整体上传没有夹带设备或旧身份仓库', DEVICE_STORES.every((store) => !(store in uploadPayload.records)))
  record('整体备份只携带无密码的 W 资料', uploadPayload.records.users.length === 1 && uploadPayload.records.users[0].id === FIXTURE_UID && same(Object.keys(uploadPayload.records.users[0]).sort(), ['created_at', 'id', 'username']))

  for (const name of ['云端独有食物甲', '云端独有食物乙']) {
    fixture.put('food_options', { id: randomUUID(), user_id: FIXTURE_UID, name, active: true, sort_order: 99, created_at: epoch, updated_at: epoch })
  }
  const localOnly = await browser.evaluate(`window.__v.options.createOption('food',{name:'恢复时必须删除的本地编辑'})`)
  await browser.until(`window.__v.sync.readSyncStatus().then(value=>Boolean(value.lastError))`)
  const restoreSource = fixtureBusiness(fixture)
  const cloudTotal = fixture.summary().total
  const localBeforeRestore = (await status(browser)).localCount
  const beforeSnapshotRpc = fixture.rest.filter((request) => request.name === 'export_cloud_snapshot').length
  await browser.evaluate(`window.__m.click('从云端恢复到本地')`)
  await browser.until(`!!document.querySelector('.confirm-modal')`)
  const restoreDialog = await browser.evaluate(`document.querySelector('.confirm-modal').innerText`)
  record('整体恢复先确认，不提前取快照写本地', fixture.rest.filter((request) => request.name === 'export_cloud_snapshot').length === beforeSnapshotRpc)
  record('恢复确认框写出具体条数与正确方向', restoreDialog.replace(/\s/g, '').includes(`将用云端${cloudTotal}条替换本地${localBeforeRestore}条。`), restoreDialog)
  record('恢复确认框明确本地待上传编辑不可撤销', restoreDialog.includes('不可撤销') && restoreDialog.includes('本地业务数据和待上传编辑会被删除') && restoreDialog.includes('本地编辑将无法找回'))
  const beforeRestoreWrites = fixture.writes().length
  await browser.evaluate(`window.__m.click('替换本地数据',document.querySelector('.confirm-modal'))`)
  await browser.until(`!document.querySelector('.confirm-modal')&&document.querySelector('.sync-card').innerText.includes('本地已替换为云端内容')`)
  const afterRestore = await browser.readDb()
  for (const store of USER_DATA_STORES) {
    record(`整体恢复逐行核对 ${store}`, same(businessRows(afterRestore.rows)[store], restoreSource[store]))
  }
  record('恢复删除本地独有编辑并清自己队列', !afterRestore.rows.food_options.some((row) => row.id === localOnly.id) && queueOf(afterRestore).length === 0)
  record('恢复在同一事务写准备状态与恢复时间', afterRestore.rows.workspace_state.find((row) => row.id === FIXTURE_UID)?.initialized_from === 'cloud' && Boolean(stateOf(afterRestore).last_restore_at))
  record('恢复保留 OTHER_UID 业务、队列与状态', same(foreignData(afterRestore), foreignBefore))
  await sleep(1800)
  record('云端恢复不产生回推队列或业务写请求', queueOf(await browser.readDb()).length === 0 && fixture.writes().length === beforeRestoreWrites)

  fixture.rejectTable = null
  fixture.rejectReplace = 'fixture denied whole replacement'
  await browser.evaluate(`window.__m.click('上传本地数据到云端')`)
  await browser.until(`!!document.querySelector('.confirm-modal')`)
  const beforeUiFailure = await browser.readDb()
  const cloudBeforeUiFailure = fixtureBusiness(fixture)
  await browser.evaluate(`window.__m.click('替换云端数据',document.querySelector('.confirm-modal'))`)
  await browser.until(`document.querySelector('.sync-card').innerText.includes('fixture denied whole replacement')`)
  record('整体上传失败界面显示真实原因且不伪装成功', await browser.evaluate(`document.querySelector('.sync-card').innerText.includes('上传到云端失败')&&!document.querySelector('.sync-card').innerText.includes('云端已替换为本地内容')`))
  record('整体上传 RPC 失败不清本地账本或改云端', same((await browser.readDb()).rows, beforeUiFailure.rows) && same(fixtureBusiness(fixture), cloudBeforeUiFailure))
  await browser.evaluate(`window.__m.click('取消',document.querySelector('.confirm-modal'))`)
  fixture.rejectReplace = null
  fixture.rejectSnapshot = 'fixture denied cloud snapshot'
  await browser.evaluate(`window.__m.click('从云端恢复到本地')`)
  await browser.until(`!!document.querySelector('.confirm-modal')`)
  const beforeUiRestoreFailure = await browser.readDb()
  await browser.evaluate(`window.__m.click('替换本地数据',document.querySelector('.confirm-modal'))`)
  await browser.until(`document.querySelector('.sync-card').innerText.includes('fixture denied cloud snapshot')`)
  record('整体恢复失败界面显示真实原因且不伪装成功', await browser.evaluate(`document.querySelector('.sync-card').innerText.includes('从云端恢复失败')&&!document.querySelector('.sync-card').innerText.includes('本地已替换为云端内容')`))
  record('整体恢复 RPC 失败不改业务、队列和时间', same((await browser.readDb()).rows, beforeUiRestoreFailure.rows))
  await browser.evaluate(`window.__m.click('取消',document.querySelector('.confirm-modal'))`)
  fixture.rejectSnapshot = null
  fixture.summaryOverride = { counts: { day_plans: 1 }, total: 2 }
  await browser.evaluate(`window.__m.click('上传本地数据到云端')`)
  await browser.until(`document.querySelector('.sync-card').innerText.includes('合计不一致')`)
  record('无效云端摘要阻止确认和上传，不把失败当空云端', !await browser.evaluate(`!!document.querySelector('.confirm-modal')`) && !await browser.evaluate(`document.querySelector('.sync-card').innerText.includes('云端已替换为本地内容')`))
  fixture.summaryOverride = null
  record('账号资料和设备仓库没有任何表上传请求', fixture.writes().every((request) => USER_DATA_STORES.includes(request.table)))
  record('普通首页全程零公开 signup 请求', fixture.auth.every((request) => !request.path.endsWith('/signup')))
  record('普通首页无未处理 JavaScript 错误', browser.noise().length === 0, stable(browser.noise().map((event) => event.params)))
  record('普通首页 HTTP 夹具没有处理异常', fixture.errors.length === 0, fixture.errors.join(' | '))
  const transfer = fixtureBusiness(fixture)
  await browser.close()
  browser = null
  return transfer
}

async function controlledServices(transfer) {
  const fixture = createAuthFixture()
  for (const [store, rows] of Object.entries(transfer)) for (const row of rows) fixture.put(store, row)
  serviceBrowser = await launchBrowser({ label: 'sync-services' })
  await fixture.attach(serviceBrowser.cdp)
  await serviceBrowser.navigate(`${server.url}motion-lab`)
  await serviceBrowser.evaluate(apiHelpers)
  await serviceBrowser.evaluate(`window.__v.auth.initializeAuth()`)
  await serviceBrowser.evaluate(`window.__v.auth.signIn('W',${JSON.stringify(FIXTURE_PASSWORD)})`)
  record('新设备登录同账号恢复十表且保持原 UUID', same(businessRows((await serviceBrowser.readDb()).rows), transfer))
  record('新设备恢复不播种示例或产生回推', queueOf(await serviceBrowser.readDb()).length === 0)
  await serviceBrowser.evaluate(`(async()=>{window.__stopScheduler=await window.__v.sync.startPushScheduler();return true})()`)
  await pendingZero(serviceBrowser)
  await serviceBrowser.evaluate(`window.__stopScheduler()`)
  const foreignBefore = await injectForeign(serviceBrowser)
  const pending = await serviceBrowser.evaluate(`window.__v.options.createOption('food',{name:'RPC 失败必须保留的编辑'})`)
  record('服务边界场景使用真实队列且保留未发送编辑', queueOf(await serviceBrowser.readDb()).length === 1)

  fixture.rejectReplace = 'fixture replacement unavailable'
  await rejectWithoutWrites(serviceBrowser, '整体上传 RPC 500 必须拒绝', `window.__v.sync.uploadLocalToCloud()`, 'fixture replacement unavailable')
  fixture.rejectReplace = null
  const exported = await serviceBrowser.evaluate(`window.__v.backup.exportBackup()`)
  const invalidImports = [
    ['总数与分表合计不一致', { imported: exported.summary.counts, total: exported.summary.total + 1 }],
    ['漏掉非空业务表', { imported: { food_options: exported.summary.counts.food_options }, total: exported.summary.counts.food_options }],
    ['包含设备表计数', { imported: { ...exported.summary.counts, sync_state: 1 }, total: exported.summary.total + 1 }],
    ['负数写入计数', { imported: { ...exported.summary.counts, food_options: -1 }, total: exported.summary.total }],
    ['没有分表摘要', { imported: 'invalid', total: exported.summary.total }],
  ]
  for (const [label, value] of invalidImports) {
    fixture.replaceResultOverride = value
    await rejectWithoutWrites(serviceBrowser, `上传摘要${label}必须拒绝`, `window.__v.sync.uploadLocalToCloud()`)
  }
  fixture.replaceResultOverride = null
  const invalidSummaries = [
    ['未知仓库', { counts: { users: 1 }, total: 1 }],
    ['负数', { counts: { food_options: -1 }, total: -1 }],
    ['小数', { counts: { food_options: 1.5 }, total: 1.5 }],
    ['合计不一致', { counts: { food_options: 1 }, total: 2 }],
    ['非对象计数', { counts: [], total: 0 }],
  ]
  for (const [label, value] of invalidSummaries) {
    fixture.summaryOverride = value
    await rejectWithoutWrites(serviceBrowser, `云端摘要${label}必须拒绝`, `window.__v.sync.readCloudSummary()`)
  }
  fixture.summaryOverride = null
  fixture.rejectSnapshot = 'fixture snapshot unavailable'
  await rejectWithoutWrites(serviceBrowser, '恢复 RPC 500 必须拒绝', `window.__v.sync.restoreCloudToLocal()`, 'fixture snapshot unavailable')
  fixture.rejectSnapshot = null
  const foreignRecords = fixtureBusiness(fixture)
  for (const store of ROOT_STORES) for (const row of foreignRecords[store]) row.user_id = OTHER_UID
  fixture.snapshotOverride = snapshotWith(foreignRecords, OTHER_UID)
  await rejectWithoutWrites(serviceBrowser, '外 UID 云端快照必须拒绝', `window.__v.sync.restoreCloudToLocal()`, '不属于当前')
  fixture.snapshotOverride = snapshotWith({})
  await rejectWithoutWrites(serviceBrowser, '空云端快照不能清空本地', `window.__v.sync.restoreCloudToLocal()`)
  const brokenGraph = fixtureBusiness(fixture)
  brokenGraph.daily_meal_items[0].daily_meal_id = randomUUID()
  fixture.snapshotOverride = snapshotWith(brokenGraph)
  await rejectWithoutWrites(serviceBrowser, '悬空父键快照必须拒绝', `window.__v.sync.restoreCloudToLocal()`)
  fixture.snapshotOverride = {}
  await rejectWithoutWrites(serviceBrowser, '损坏快照必须拒绝', `window.__v.sync.restoreCloudToLocal()`)
  fixture.snapshotOverride = null
  record('坏 RPC 与快照都没有改写 OTHER_UID', same(foreignData(await serviceBrowser.readDb()), foreignBefore))

  const beforeHeldUpload = await serviceBrowser.readDb()
  fixture.hold = 'import_local_backup'
  await startPromise(serviceBrowser, `window.__v.sync.uploadLocalToCloud()`)
  await waitFor(() => fixture.held.some((item) => item.name === 'import_local_backup'), 'whole upload held')
  const capturedUpload = fixture.rest.filter((request) => request.name === 'import_local_backup').at(-1).body.payload
  await serviceBrowser.evaluate(`window.__v.options.renameOption('food',${JSON.stringify(pending.id)},'整体上传期间的更新末值')`)
  const addedDuringUpload = await serviceBrowser.evaluate(`window.__v.options.createOption('food',{name:'整体上传期间的新食物'})`)
  const duringUpload = await serviceBrowser.readDb()
  const freshIds = sortedIds(queueOf(duringUpload).filter((row) => !queueOf(beforeHeldUpload).some((old) => old.id === row.id)))
  record('整体上传途中产生独立的新队列 ID', freshIds.length === 2)
  await fixture.release('import_local_backup')
  const uploaded = await outcome(serviceBrowser)
  record('整体上传按捕获快照确认成功', uploaded.ok && uploaded.value.sourceTotal === USER_DATA_STORES.reduce((total, store) => total + (capturedUpload.counts[store] ?? 0), 0))
  record('整体上传只退役捕获队列，新编辑保持待上传', same(sortedIds(queueOf(await serviceBrowser.readDb())), freshIds))
  record('整体上传 HTTP 负载确实没有偷带后来编辑', !capturedUpload.records.food_options.some((row) => row.id === addedDuringUpload.id) && capturedUpload.records.food_options.find((row) => row.id === pending.id)?.name === pending.name)
  record('云端暂时只收到捕获快照中的旧值', fixture.rowsOf('food_options').find((row) => row.id === pending.id)?.name === pending.name && !fixture.rowsOf('food_options').some((row) => row.id === addedDuringUpload.id))
  await serviceBrowser.evaluate(`(async()=>{window.__stopScheduler=await window.__v.sync.startPushScheduler();return true})()`)
  await pendingZero(serviceBrowser)
  record('恢复真实调度后新编辑继续自动上传', fixture.rowsOf('food_options').find((row) => row.id === pending.id)?.name === '整体上传期间的更新末值' && fixture.rowsOf('food_options').some((row) => row.id === addedDuringUpload.id))
  await serviceBrowser.evaluate(`window.__stopScheduler()`)
  record('上传并发编辑不影响 OTHER_UID', same(foreignData(await serviceBrowser.readDb()), foreignBefore))

  for (const kind of ['increment', 'upload', 'restore']) {
    for (const response of ['success', 'failure']) {
      const label = `${kind} 退出后迟到${response === 'success' ? '成功' : '失败'}`
      const queued = await serviceBrowser.evaluate(`window.__v.options.createOption('food',{name:${JSON.stringify(label)}})`)
      const before = await serviceBrowser.readDb()
      const oldGeneration = await serviceBrowser.evaluate(`window.__v.auth.getAuthState().generation`)
      const name = kind === 'increment' ? 'food_options' : kind === 'upload' ? 'import_local_backup' : 'export_cloud_snapshot'
      fixture.hold = name
      await startPromise(serviceBrowser, kind === 'increment' ? manualPush : kind === 'upload' ? `window.__v.sync.uploadLocalToCloud()` : `window.__v.sync.restoreCloudToLocal()`)
      await waitFor(() => fixture.held.some((item) => item.name === name), `${label} HTTP held`)
      const inFlight = fixture.rest.filter((request) => request.name === name).at(-1)
      // A successful delayed response must still have a valid old token.
      fixture.rejectLogout = true
      record(`${label}：退出立即关闭工作区`, Boolean(await errorOf(serviceBrowser, `window.__v.auth.signOut()`)) && await phase(serviceBrowser) === 'signed-out')
      await serviceBrowser.evaluate(`window.__v.auth.signIn('W',${JSON.stringify(FIXTURE_PASSWORD)})`)
      const current = await serviceBrowser.readDb()
      record(`${label}：原账号重登保留待上传 ID`, same(sortedIds(queueOf(current)), sortedIds(queueOf(before))) && current.rows.food_options.some((row) => row.id === queued.id))
      record(`${label}：重登使用新认证代次`, await serviceBrowser.evaluate(`window.__v.auth.getAuthState().generation>${oldGeneration}&&window.__v.auth.getAuthState().phase==='ready'`))
      if (response === 'failure') {
        if (kind === 'increment') fixture.rejectTable = 'food_options'
        if (kind === 'upload') fixture.rejectReplace = 'fixture delayed upload failure'
        if (kind === 'restore') fixture.rejectSnapshot = 'fixture delayed restore failure'
      }
      record(`${label}：旧请求 token 未被退出撤销`, fixture.validTokens.has(inFlight.bearer) && !fixture.revokedTokens.has(inFlight.bearer))
      await fixture.release(name)
      const result = await outcome(serviceBrowser)
      record(`${label}：旧操作不能返回本地成功`, !result.ok, result.error)
      record(`${label}：迟到响应不结算当前业务、队列或时间`, same((await serviceBrowser.readDb()).rows, current.rows))
      record(`${label}：OTHER_UID 原样保留`, same(foreignData(await serviceBrowser.readDb()), foreignBefore))
      if (response === 'success' && kind !== 'restore') {
        record(`${label}：HTTP 边界确实已收到旧请求成功写入`, fixture.rowsOf('food_options').some((row) => row.id === queued.id))
      }
      fixture.rejectLogout = false
      fixture.rejectTable = null
      fixture.rejectReplace = null
      fixture.rejectSnapshot = null
      const retry = await serviceBrowser.evaluate(manualPush)
      record(`${label}：原队列仍可在当前认证下重试`, retry.kind === 'pushed' && queueOf(await serviceBrowser.readDb()).length === 0)
    }
  }
  record('全部同步 HTTP 表写入仅含十张业务表', fixture.writes().every((request) => USER_DATA_STORES.includes(request.table)))
  record('服务场景全程零公开 signup 请求', fixture.auth.every((request) => !request.path.endsWith('/signup')))
  record('服务场景没有未处理 JavaScript 异常', serviceBrowser.noise().length === 0, stable(serviceBrowser.noise().map((event) => event.params)))
  record('服务场景 HTTP 夹具没有处理异常', fixture.errors.length === 0, fixture.errors.join(' | '))
}

try {
  server = await startDevServer()
  const fixture = createAuthFixture()
  const transfer = await mainApp(fixture)
  await controlledServices(transfer)
} catch (error) {
  console.error('验收脚本异常：', error.stack ?? error.message)
  process.exitCode = error.name === 'AssertionError' ? 1 : 2
} finally {
  if (browser) await browser.close()
  if (serviceBrowser) await serviceBrowser.close()
  await stopProcess(server?.child)
  finish()
}
