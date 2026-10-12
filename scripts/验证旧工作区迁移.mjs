import assert from 'node:assert/strict'
import {
  DB_NAME, createRecorder, launchBrowser, startDevServer, stopProcess,
} from './lib/browser-harness.mjs'
import {
  FIXTURE_PASSWORD, FIXTURE_UID, OTHER_UID, createAuthFixture,
} from './lib/auth-fixture.mjs'

const { record, finish } = createRecorder()
const epoch = '2020-01-01T00:00:00.000Z'
const sourceOwner = 'legacy-owner-a'
const otherOwner = 'legacy-owner-b'
const missingProfileOwner = 'legacy-owner-without-profile'
const targetUser = { id: FIXTURE_UID, username: 'W', created_at: epoch }
const businessStores = [
  'day_plans', 'daily_meals', 'custom_tasks', 'food_options',
  'supplement_templates', 'exercise_options', 'daily_meal_items',
  'daily_supplements', 'daily_exercise_items', 'routine_tasks',
]
const rootStores = new Set(['day_plans', 'food_options', 'supplement_templates', 'exercise_options'])
const planChildren = new Set([
  'daily_meals', 'custom_tasks', 'daily_supplements', 'daily_exercise_items', 'routine_tasks',
])

// This fixture describes the historical schema independently of LOCAL_SCHEMA.
const legacySchema = [
  { name: 'users', indexes: [{ name: 'username', key: 'username', unique: true }] },
  {
    name: 'day_plans',
    indexes: [
      { name: 'user_date', key: ['user_id', 'plan_date'], unique: true },
      { name: 'user_id', key: 'user_id' },
    ],
  },
  {
    name: 'daily_meals',
    indexes: [
      { name: 'plan_type', key: ['day_plan_id', 'meal_type'], unique: true },
      { name: 'day_plan_id', key: 'day_plan_id' },
    ],
  },
  ...['custom_tasks', 'daily_supplements', 'daily_exercise_items', 'routine_tasks']
    .map((name) => ({ name, indexes: [{ name: 'day_plan_id', key: 'day_plan_id' }] })),
  ...['food_options', 'supplement_templates', 'exercise_options']
    .map((name) => ({ name, indexes: [{ name: 'user_id', key: 'user_id' }] })),
  { name: 'daily_meal_items', indexes: [{ name: 'daily_meal_id', key: 'daily_meal_id' }] },
  {
    name: 'sync_outbox',
    indexes: [
      { name: 'seq', key: 'seq' },
      { name: 'store_record', key: ['store', 'record_id'] },
    ],
  },
  { name: 'sync_state', indexes: [] },
]

function graph(prefix, owner) {
  const option = (kind, order) => ({
    id: `${prefix}-${kind}-${order}`, user_id: owner, name: `${prefix} ${kind} ${order}`,
    active: true, sort_order: order, created_at: epoch, updated_at: epoch,
  })
  const day = (number) => ({
    id: `${prefix}-plan-${number}`, user_id: owner,
    plan_date: number === 1 ? '2020-01-06' : '2020-01-09',
    mode: number === 1 ? 'work' : 'rest', mode_override: false,
    created_at: epoch, updated_at: epoch,
    outfit_ready: true, meals_ready: false, supplements_ready: true,
    morning_ready: false, exercise_ready: true, morning_focus: `${prefix} focus ${number}`,
    morning_completed: false, exercise_decision: 'exercise', exercise_note: `${prefix} note ${number}`,
    exercise_completed: number === 2,
    exercise_content: `${prefix} old exercise text ${number}`,
  })
  const meal = (number, type) => ({
    id: `${prefix}-meal-${number}`, day_plan_id: `${prefix}-plan-${number}`,
    meal_type: type, note: `${prefix} meal ${number}`, completed: number === 2,
    plan_content: `${prefix} old meal text ${number}`,
  })
  return {
    day_plans: [day(1), day(2)],
    daily_meals: [meal(1, 'breakfast'), meal(2, 'lunch')],
    custom_tasks: [1, 2].map((number) => ({
      id: `${prefix}-task-${number}`, day_plan_id: `${prefix}-plan-${number}`,
      task_time: number === 1 ? '09:10' : '17:20', title: `${prefix} task ${number}`,
      note: `${prefix} task note ${number}`, completed: number === 1,
    })),
    food_options: [option('food', 1), option('food', 2)],
    supplement_templates: [1, 2].map((number) => ({ ...option('template', number), period: number === 1 ? 'morning' : 'evening' })),
    exercise_options: [option('exercise', 1), option('exercise', 2)],
    daily_meal_items: [
      ...[1, 2].map((number) => ({
        id: `${prefix}-meal-item-${number}`, daily_meal_id: `${prefix}-meal-${number}`,
        food_option_id: `${prefix}-food-${number}`, food_name_snapshot: `${prefix} meal snapshot ${number}`,
        sort_order: number, created_at: epoch,
      })),
      {
        id: `${prefix}-meal-item-deleted`, daily_meal_id: `${prefix}-meal-1`,
        food_option_id: `${prefix}-deleted-food`, food_name_snapshot: `${prefix} deleted food snapshot`,
        sort_order: 3, created_at: epoch,
      },
    ],
    daily_supplements: [1, 2].map((number) => ({
      id: `${prefix}-supplement-${number}`, day_plan_id: `${prefix}-plan-${number}`,
      name_snapshot: `${prefix} supplement snapshot ${number}`, period: number === 1 ? 'morning' : 'evening',
      planned: true, completed: number === 2, sort_order: number, created_at: epoch, updated_at: epoch,
    })),
    daily_exercise_items: [
      ...[1, 2].map((number) => ({
        id: `${prefix}-exercise-item-${number}`, day_plan_id: `${prefix}-plan-${number}`,
        exercise_option_id: `${prefix}-exercise-${number}`, name_snapshot: `${prefix} exercise snapshot ${number}`,
        sort_order: number, created_at: epoch,
      })),
      {
        id: `${prefix}-exercise-item-deleted`, day_plan_id: `${prefix}-plan-2`,
        exercise_option_id: `${prefix}-deleted-exercise`, name_snapshot: `${prefix} deleted exercise snapshot`,
        sort_order: 3, created_at: epoch,
      },
    ],
    routine_tasks: [1, 2].map((number) => ({
      id: `${prefix}-routine-${number}`, day_plan_id: `${prefix}-plan-${number}`,
      kind: number === 1 ? 'mop' : 'laundry', title: `${prefix} routine ${number}`, completed: number === 2,
    })),
  }
}

const sourceGraph = graph('a', sourceOwner)
const otherGraph = graph('b', otherOwner)
const sourceTotal = Object.values(sourceGraph).reduce((total, rows) => total + rows.length, 0)
const orphanRows = {
  daily_meals: [{ ...sourceGraph.daily_meals[0], id: 'orphan-meal', day_plan_id: 'missing-plan' }],
  daily_meal_items: [
    { ...sourceGraph.daily_meal_items[0], id: 'orphan-item-parent', daily_meal_id: 'orphan-meal' },
    { ...sourceGraph.daily_meal_items[0], id: 'orphan-item-missing', daily_meal_id: 'missing-meal' },
  ],
  custom_tasks: [{ ...sourceGraph.custom_tasks[0], id: 'orphan-task', day_plan_id: 'missing-plan' }],
  daily_supplements: [{ ...sourceGraph.daily_supplements[0], id: 'orphan-supplement', day_plan_id: 'missing-plan' }],
  daily_exercise_items: [{ ...sourceGraph.daily_exercise_items[0], id: 'orphan-exercise', day_plan_id: 'missing-plan' }],
  routine_tasks: [{ ...sourceGraph.routine_tasks[0], id: 'orphan-routine', day_plan_id: 'missing-plan' }],
}
const orphanTotal = Object.values(orphanRows).reduce((total, rows) => total + rows.length, 0)

function legacyRows(version) {
  const rows = Object.fromEntries(businessStores.map((store) => [
    store, [...sourceGraph[store], ...otherGraph[store], ...(orphanRows[store] ?? [])],
  ]))
  rows.food_options.push({
    ...sourceGraph.food_options[0], id: 'missing-profile-food', user_id: missingProfileOwner,
    name: 'workspace without identity evidence',
  })
  rows.users = [
    {
      id: sourceOwner, username: 'W', password_hash: 'test-only-legacy-password-a',
      created_at: epoch, access_token: 'test-only-legacy-user-token',
    },
    { id: otherOwner, username: 'old-b', password_hash: 'test-only-legacy-password-b', created_at: epoch },
  ]
  const state = (id, suffix) => ({
    id, enabled: true, cloud_user_id: `obsolete-cloud-${suffix}`, cloud_email: `old-${suffix}@example.invalid`,
    device_id: `old-device-${suffix}`, bound_at: epoch, last_push_at: epoch, last_restore_at: null,
    last_error_message: 'legacy failure', last_error_at: epoch, updated_at: epoch,
    refresh_token: 'test-only-legacy-state-token',
  })
  rows.sync_state = version === 6 ? [state('singleton', 'a')] : [state(sourceOwner, 'a'), state(otherOwner, 'b')]
  rows.sync_outbox = [sourceOwner, otherOwner, null].map((owner, index) => ({
    id: `old-outbox-${index}`, seq: index + 1, store: 'custom_tasks',
    record_id: index === 1 ? 'b-task-1' : 'a-task-1', op: index === 2 ? 'delete' : 'upsert',
    local_user_id: owner, created_at: epoch, attempts: index, last_error: index ? 'legacy upload error' : null,
    payload: { access_token: 'test-only-old-outbox-token' },
  }))
  return rows
}

function canonical(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonical)
    return items.every((row) => row && typeof row === 'object' && !Array.isArray(row) && typeof row.id === 'string')
      ? items.sort((left, right) => left.id.localeCompare(right.id)) : items
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const allRows = async (browser) => (await browser.readDb()).rows
const profileFor = (owner) => ({ ...targetUser, id: owner })
const migration = (owner = sourceOwner, target = targetUser) =>
  `window.__legacy.workspace.migrateLegacyWorkspace({sourceOwner:${JSON.stringify(owner)},targetUser:${JSON.stringify(target)},guard:()=>{}})`

async function seedLegacyDatabase(browser, version) {
  const rows = legacyRows(version)
  await browser.evaluate(`(async()=>{
    localStorage.setItem('happy-little-molly.session',JSON.stringify({user:{id:${JSON.stringify(sourceOwner)},username:'W'}}));
    const schema=${JSON.stringify(legacySchema)};
    const rows=${JSON.stringify(rows)};
    await new Promise((done,reject)=>{
      const request=indexedDB.open(${JSON.stringify(DB_NAME)},${version});
      request.onerror=()=>reject(request.error);
      request.onupgradeneeded=()=>{
        for(const definition of schema){
          const store=request.result.createObjectStore(definition.name,{keyPath:'id'});
          for(const index of definition.indexes??[])store.createIndex(index.name,index.key,{unique:index.unique??false});
          for(const row of rows[definition.name]??[])store.put(row);
        }
      };
      request.onsuccess=()=>{request.result.close();done()};
    });
    return true;
  })()`)
  return rows
}

async function loadServices(browser) {
  await browser.evaluate(`(async()=>{
    const [db,workspace,session,backup,auth]=await Promise.all([
      import('/src/services/local/localDb.ts'),
      import('/src/services/local/workspaceService.ts'),
      import('/src/services/session.ts'),
      import('/src/services/local/backupService.ts'),
      import('/src/services/api/authService.ts'),
    ]);
    window.__legacy={db,workspace,session,backup,auth};
    await db.getAll('users');
    return true;
  })()`)
}

async function fixtureMutation(browser, { put = [], remove = [] }) {
  const work = { put, remove }
  await browser.evaluate(`(async()=>{
    const work=${JSON.stringify(work)};
    const names=[...new Set([...work.put.map(item=>item.store),...work.remove.map(item=>item.store)])];
    await new Promise((done,reject)=>{
      const request=indexedDB.open(${JSON.stringify(DB_NAME)});
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result;
        const tx=db.transaction(names,'readwrite');
        tx.onerror=()=>{db.close();reject(tx.error)};
        tx.onabort=()=>{db.close();reject(tx.error??new Error('fixture transaction aborted'))};
        tx.oncomplete=()=>{db.close();done()};
        for(const item of work.put)tx.objectStore(item.store).put(item.value);
        for(const item of work.remove)tx.objectStore(item.store).delete(item.id);
      };
    });
    return true;
  })()`)
}

async function observedOperation(browser, expression) {
  return browser.evaluate(`(async()=>{
    const prototype=IDBObjectStore.prototype;
    const originals={put:prototype.put,delete:prototype.delete,clear:prototype.clear};
    const writes=[];
    for(const method of Object.keys(originals)){
      prototype[method]=function(...args){
        writes.push({method,store:this.name,id:method==='put'?args[0]?.id:args[0]??null});
        return originals[method].apply(this,args);
      };
    }
    try{return {ok:true,value:await (${expression}),writes}}
    catch(reason){return {ok:false,error:reason.message,writes}}
    finally{for(const method of Object.keys(originals))prototype[method]=originals[method]}
  })()`)
}

async function rejectedWithoutWrites(browser, label, expression, expectedMessage) {
  const before = await allRows(browser)
  const result = await observedOperation(browser, expression)
  record(label, !result.ok && (!expectedMessage || result.error.includes(expectedMessage)), result.error)
  record(`${label}：没有发出写请求且全库不变`, result.writes.length === 0 && equal(before, await allRows(browser)), result.writes.length)
}

function assertOriginalRowsRemain(before, after) {
  for (const [store, rows] of Object.entries(before)) {
    const current = new Map(after[store].map((row) => [row.id, row]))
    for (const row of rows) assert.deepEqual(current.get(row.id), row, `${store}/${row.id} was modified`)
  }
}

function contentOf(row) {
  const excluded = new Set([
    'id', 'user_id', 'day_plan_id', 'daily_meal_id', 'food_option_id',
    'exercise_option_id', 'exercise_content', 'plan_content',
  ])
  return Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.has(key)))
}

function assertRemappedGraph(before, after) {
  const remapped = {}
  const ids = {}
  const reserved = new Set(businessStores.flatMap((store) => before[store].map((row) => row.id)))
  for (const store of businessStores) {
    const oldIds = new Set(before[store].map((row) => row.id))
    const added = after[store].filter((row) => !oldIds.has(row.id))
    assert.equal(added.length, sourceGraph[store].length, `${store} migration count`)
    remapped[store] = added
    ids[store] = new Map()
    for (const source of sourceGraph[store]) {
      const matching = added.filter((row) => equal(contentOf(row), contentOf(source)))
      assert.equal(matching.length, 1, `${store}/${source.id} exact content copy`)
      const row = matching[0]
      assert.ok(!reserved.has(row.id), `${store}/${source.id} did not get a globally fresh ID`)
      reserved.add(row.id)
      ids[store].set(source.id, row.id)
    }
  }
  for (const store of businessStores) {
    for (const source of sourceGraph[store]) {
      const copied = remapped[store].find((row) => row.id === ids[store].get(source.id))
      const expected = { ...source, id: copied.id }
      delete expected.exercise_content
      delete expected.plan_content
      if (rootStores.has(store)) expected.user_id = FIXTURE_UID
      if (planChildren.has(store)) expected.day_plan_id = ids.day_plans.get(source.day_plan_id)
      if (store === 'daily_meal_items') {
        expected.daily_meal_id = ids.daily_meals.get(source.daily_meal_id)
        expected.food_option_id = ids.food_options.get(source.food_option_id) ?? null
      }
      if (store === 'daily_exercise_items') {
        expected.exercise_option_id = ids.exercise_options.get(source.exercise_option_id) ?? null
      }
      assert.deepEqual(copied, expected, `${store}/${source.id} graph/fields`)
    }
  }
  return remapped
}

async function verifyUpgrade(browser, version, before) {
  const database = await browser.readDb()
  const after = database.rows
  record(`v${version} 真实历史 schema 升级到 v8`, database.version === 8 && database.names.length === 18)
  record(`v${version} 历史账号唯一索引被移除`, database.indexes.users.length === 0)
  record(`v${version} 五张隔离和工作区仓库均已建立`,
    ['legacy_users', 'legacy_sync_state', 'legacy_outbox', 'workspace_state', 'workspace_migrations']
      .every((name) => database.names.includes(name)))
  record(`v${version} 所有业务和孤儿记录保持原值原 owner`, businessStores.every((store) => equal(before[store], after[store])))
  record(`v${version} 活跃资料、旧绑定与待上传队列清空`,
    ['users', 'sync_state', 'sync_outbox', 'workspace_state', 'workspace_migrations'].every((store) => after[store].length === 0))
  const archiveProfileKeys = ['created_at', 'id', 'isolated_at', 'username'].sort()
  record(`v${version} 隔离身份只保留无密码资料`, after.legacy_users.length === before.users.length
    && after.legacy_users.every((row) => equal(Object.keys(row).sort(), archiveProfileKeys)
      && before.users.some((old) => old.id === row.id && old.username === row.username && old.created_at === row.created_at)
      && !Number.isNaN(Date.parse(row.isolated_at))))
  record(`v${version} 全库不再包含旧密码或身份 token`,
    !/password_hash|access_token|refresh_token|test-only-legacy-password|test-only-old-outbox-token/.test(JSON.stringify(after)))
  const clean = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key] ?? null]))
  const stateKeys = [
    'id', 'enabled', 'cloud_user_id', 'cloud_email', 'device_id', 'bound_at',
    'last_push_at', 'last_restore_at', 'last_error_message', 'last_error_at', 'updated_at',
  ]
  const outboxKeys = ['id', 'seq', 'store', 'record_id', 'op', 'local_user_id', 'created_at', 'attempts', 'last_error']
  record(`v${version} 旧云端绑定完整隔离且额外字段清理`,
    equal(before.sync_state.map((row) => clean(row, stateKeys)), after.legacy_sync_state.map((row) => clean(row, stateKeys)))
    && after.legacy_sync_state.every((row) => Object.keys(row).length === stateKeys.length + 1 && typeof row.isolated_at === 'string'))
  record(`v${version} 双 owner 与无归属旧队列完整隔离`,
    equal(before.sync_outbox.map((row) => clean(row, outboxKeys)), after.legacy_outbox.map((row) => clean(row, outboxKeys)))
    && after.legacy_outbox.every((row) => Object.keys(row).length === outboxKeys.length + 1 && typeof row.isolated_at === 'string'))
  record(`v${version} 旧本地 session 不建立登录身份`,
    await browser.evaluate(`window.__legacy.session.readLegacySession()?.user.id===${JSON.stringify(sourceOwner)}&&window.__legacy.session.readSession()===null`))
  const preview = await browser.evaluate('window.__legacy.workspace.listLegacyWorkspaces()')
  const selected = preview.find((row) => row.sourceOwner === sourceOwner)
  record(`v${version} 两个历史账号与无资料 owner 分开预览`,
    preview.length === 3 && [sourceOwner, otherOwner, missingProfileOwner].every((owner) => preview.some((row) => row.sourceOwner === owner)))
  record(`v${version} 预览逐表业务计数和日期范围准确`,
    selected.total === sourceTotal && businessStores.every((store) => selected.counts[store] === sourceGraph[store].length)
    && selected.firstDate === '2020-01-06' && selected.lastDate === '2020-01-09')
  record(`v${version} 预览不猜测孤儿归属`,
    preview.every((row) => row.unassignedRecordCount === orphanTotal) && selected.pendingCount === 1 && selected.migratedTo === null)
  record(`v${version} 绑定线索保持明确 owner`,
    selected.cloudUserId === (version === 6 ? null : 'obsolete-cloud-a'))
  return after
}

async function signInFixture(browser, fixture) {
  await browser.evaluate('window.__legacy.auth.initializeAuth()')
  await browser.evaluate(`window.__legacy.auth.signIn('W',${JSON.stringify(FIXTURE_PASSWORD)})`)
  const state = await browser.evaluate('window.__legacy.auth.getAuthState()')
  record('生产 SDK 与认证门面登录固定 W UID', state.phase === 'ready' && state.verified && state.session?.user.id === FIXTURE_UID)
  record('测试登录只在 HTTP 边界使用隔离 fixture', fixture.auth.some((request) => request.path === '/auth/v1/token')
    && fixture.rest.some((request) => request.name === 'account_access') && fixture.errors.length === 0)
}

async function runVersionSix(server) {
  const browser = await launchBrowser({ label: 'legacy-v6' })
  const fixture = createAuthFixture()
  try {
    await fixture.attach(browser.cdp)
    await browser.navigate(`${server.url}scripts/lib/service-fixture.html`)
    const before = await seedLegacyDatabase(browser, 6)
    await loadServices(browser)
    const isolated = await verifyUpgrade(browser, 6, before)
    await signInFixture(browser, fixture)
    const after = await allRows(browser)
    record('旧账号也叫 W 时不会自动认领历史业务',
      businessStores.every((store) => equal(isolated[store], after[store]))
      && after.workspace_state.some((row) => row.id === FIXTURE_UID && row.initialized_from === 'empty'))
    record('首次 W 登录不恢复旧密码、云端 UID 或旧队列',
      after.users.length === 1 && equal(after.users[0], targetUser)
      && after.sync_state.length === 1 && after.sync_state[0].id === FIXTURE_UID
      && !('cloud_user_id' in after.sync_state[0]) && after.sync_outbox.length === 0
      && equal(after.legacy_outbox, isolated.legacy_outbox) && fixture.writes().length === 0
      && !fixture.rest.some((request) => request.name === 'import_local_backup'))
    record('v6 升级与 W 登录没有浏览器异常', browser.noise().length === 0, JSON.stringify(browser.noise()))
  } finally {
    await browser.close()
  }
}

async function verifyRejectedMigrations(browser) {
  await rejectedWithoutWrites(browser, '缺少旧身份资料的工作区拒绝迁移',
    migration(missingProfileOwner), '缺少隔离身份资料')

  const targetPlan = { ...sourceGraph.day_plans[0], id: 'target-conflict-plan', user_id: FIXTURE_UID, plan_date: '2020-02-01' }
  await fixtureMutation(browser, { put: [{ store: 'day_plans', value: targetPlan }] })
  try {
    await rejectedWithoutWrites(browser, '目标 UID 已有业务时拒绝合并', migration(), '目标工作区已有业务数据')
  } finally {
    await fixtureMutation(browser, { remove: [{ store: 'day_plans', id: targetPlan.id }] })
  }

  for (const link of [
    { store: 'daily_meal_items', field: 'food_option_id', value: sourceGraph.daily_meal_items[0], foreignId: otherGraph.food_options[0].id },
    { store: 'daily_exercise_items', field: 'exercise_option_id', value: sourceGraph.daily_exercise_items[0], foreignId: otherGraph.exercise_options[0].id },
  ]) {
    await fixtureMutation(browser, { put: [{ store: link.store, value: { ...link.value, [link.field]: link.foreignId } }] })
    try {
      await rejectedWithoutWrites(browser, `${link.store} 跨 owner 来源选项拒绝迁移`,
        migration(), '来源选项不属于当前账号')
    } finally {
      await fixtureMutation(browser, { put: [{ store: link.store, value: link.value }] })
    }
  }
}

async function verifyInterruptedMigration(browser) {
  const before = await allRows(browser)
  const interrupted = await browser.evaluate(`(async()=>{
    const session=window.__legacy.session;
    const generation=session.beginAuthTransition('preparing');
    const guard=()=>{if(session.getAuthState().generation!==generation)throw new Error('fixture auth generation changed')};
    const original=IDBObjectStore.prototype.put;
    let issued=0;
    let successful=0;
    let invalidated=false;
    IDBObjectStore.prototype.put=function(...args){
      const request=original.apply(this,args);
      if(${JSON.stringify(businessStores)}.includes(this.name)){
        issued++;
        request.addEventListener('success',()=>{
          successful++;
          if(!invalidated){invalidated=true;session.beginAuthTransition('signed-out')}
        },{once:true});
      }
      return request;
    };
    try{
      await window.__legacy.workspace.migrateLegacyWorkspace({
        sourceOwner:${JSON.stringify(sourceOwner)},targetUser:${JSON.stringify(targetUser)},guard,
      });
      return {ok:true,issued,successful,invalidated};
    }catch(reason){return {ok:false,error:reason.message,issued,successful,invalidated}}
    finally{IDBObjectStore.prototype.put=original}
  })()`)
  record('首条业务写请求成功后身份代次变化中断真实迁移',
    !interrupted.ok && interrupted.invalidated && interrupted.issued > 0 && interrupted.successful > 0
      && interrupted.error.includes('auth generation changed'), JSON.stringify(interrupted))
  record('中途迁移回滚全部业务、资料、准备状态和 journal', equal(before, await allRows(browser)))
  return before
}

async function verifySuccessfulMigration(browser, before) {
  const migrated = await observedOperation(browser, migration())
  record('中断后重试完整提交旧工作区', migrated.ok && migrated.value.total === sourceTotal, migrated.error)
  const after = await allRows(browser)
  assertOriginalRowsRemain(before, after)
  record('迁移保留其他 owner、源 owner、孤儿及所有隔离数据', true)
  const copied = assertRemappedGraph(before, after)
  record('十张业务表所有 ID 全部更新且全局无冲突', true)
  record('全部父链和 food/exercise 来源外键映射到对应新记录', true)
  record('业务内容、顺序与执行状态逐字段保持，历史字段清理', true)
  record('已删除来源选项改为 null 并保留名称快照',
    copied.daily_meal_items.some((row) => row.food_name_snapshot === 'a deleted food snapshot' && row.food_option_id === null)
    && copied.daily_exercise_items.some((row) => row.name_snapshot === 'a deleted exercise snapshot' && row.exercise_option_id === null))
  record('迁移账号资料只缓存 Auth UID 且不含旧密码', after.users.length === 1 && equal(after.users[0], targetUser))
  record('迁移一次提交 initialized_from 与完成 journal',
    after.workspace_state.length === 1 && after.workspace_state[0].id === FIXTURE_UID
    && after.workspace_state[0].initialized && after.workspace_state[0].initialized_from === 'legacy'
    && after.workspace_migrations.length === 1 && after.workspace_migrations[0].id === `legacy:${sourceOwner}`
    && after.workspace_migrations[0].source_owner === sourceOwner && after.workspace_migrations[0].target_owner === FIXTURE_UID
    && after.workspace_migrations[0].record_count === sourceTotal && after.workspace_migrations[0].status === 'completed')
  record('旧工作区迁移不产生或激活任何上传意图',
    after.sync_outbox.length === 0 && after.sync_state.length === 0
    && !migrated.writes.some((write) => ['sync_outbox', 'sync_state', 'legacy_outbox'].includes(write.store)))

  const repeated = await observedOperation(browser, migration())
  record('完成 journal 使同目标重试幂等且没有写请求',
    repeated.ok && repeated.value.total === sourceTotal && repeated.writes.length === 0 && equal(after, await allRows(browser)))
  const preview = await browser.evaluate('window.__legacy.workspace.listLegacyWorkspaces()')
  record('完成后预览记录明确 migratedTo 并保留源条数',
    preview.find((row) => row.sourceOwner === sourceOwner)?.migratedTo === FIXTURE_UID
    && preview.find((row) => row.sourceOwner === sourceOwner)?.total === sourceTotal)
  await rejectedWithoutWrites(browser, '完成的旧工作区拒绝改迁另一个 UID',
    migration(sourceOwner, profileFor(OTHER_UID)), '迁往另一个 UID')
  const state = after.workspace_state[0]
  await fixtureMutation(browser, { remove: [{ store: 'workspace_state', id: FIXTURE_UID }] })
  try {
    await rejectedWithoutWrites(browser, 'journal 与准备状态不一致时拒绝伪装完成', migration(), '状态不一致')
  } finally {
    await fixtureMutation(browser, { put: [{ store: 'workspace_state', value: state }] })
  }
}

async function verifyBackupCollisions(browser) {
  await browser.evaluate(`(async()=>{
    window.__legacyExport=await window.__legacy.backup.exportBackup();
    return true;
  })()`)
  const exported = await browser.evaluate('window.__legacyExport')
  record('当前 UID 导出只含迁入业务和一条无密码 Auth 资料',
    exported.summary.total === sourceTotal && exported.file.records.users.length === 1
    && exported.file.records.users[0].id === FIXTURE_UID
    && !/legacy_|password_hash|access_token|refresh_token|sync_outbox|workspace_migrations/.test(exported.text))
  for (const collision of [
    { label: '普通备份不能覆盖孤儿 ID', id: 'orphan-task' },
    { label: '普通备份不能覆盖其他 owner 的 ID', id: otherGraph.custom_tasks[0].id },
  ]) {
    await browser.evaluate(`(()=>{
      window.__collisionBackup=structuredClone(window.__legacyExport.file);
      window.__collisionBackup.records.custom_tasks[0].id=${JSON.stringify(collision.id)};
      return true;
    })()`)
    await rejectedWithoutWrites(browser, collision.label,
      'window.__legacy.backup.importBackup(JSON.stringify(window.__collisionBackup))', '其他工作区冲突')
  }
}

async function runVersionSeven(server) {
  const browser = await launchBrowser({ label: 'legacy-v7' })
  const fixture = createAuthFixture()
  try {
    await fixture.attach(browser.cdp)
    await browser.navigate(`${server.url}scripts/lib/service-fixture.html`)
    const before = await seedLegacyDatabase(browser, 7)
    await loadServices(browser)
    await verifyUpgrade(browser, 7, before)
    await verifyRejectedMigrations(browser)
    const beforeMigration = await verifyInterruptedMigration(browser)
    await verifySuccessfulMigration(browser, beforeMigration)
    await signInFixture(browser, fixture)
    await verifyBackupCollisions(browser)
    const after = await allRows(browser)
    record('旧 W 资料与新 W 资料不会发生唯一账号名冲突',
      after.legacy_users.some((row) => row.id === sourceOwner && row.username === 'W')
      && after.users.some((row) => row.id === FIXTURE_UID && row.username === 'W'))
    record('迁入业务在正式 Auth 工作区可见，孤儿和其他 owner 仍隔离',
      await browser.evaluate(`window.__legacy.backup.collectUserRecords().then(result=>
        Object.values(result.records).reduce((count,rows)=>count+rows.length,0)===${sourceTotal}
        &&result.records.day_plans.every(row=>row.user_id===${JSON.stringify(FIXTURE_UID)}))`))
    record('迁移与备份冲突验证没有浏览器异常', browser.noise().length === 0, JSON.stringify(browser.noise()))
    record('整个迁移验收没有推送旧数据到 fixture 云端', fixture.writes().length === 0 && fixture.errors.length === 0
      && !fixture.rest.some((request) => request.name === 'import_local_backup'))
  } finally {
    await browser.close()
  }
}

let server
try {
  server = await startDevServer()
  await runVersionSix(server)
  await runVersionSeven(server)
} catch (reason) {
  console.error(`旧工作区迁移验收异常：${reason.stack ?? reason}`)
  process.exitCode = reason.name === 'AssertionError' ? 1 : 2
} finally {
  await stopProcess(server?.child)
  finish()
}
