import assert from 'node:assert/strict'
import { randomUUID, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import {
  createAuthFixture, FIXTURE_PASSWORD, FIXTURE_UID, FIXTURE_URL,
} from './lib/auth-fixture.mjs'
import {
  launchBrowser, startDevServer, stopProcess,
} from './lib/browser-harness.mjs'

const root = new URL('../', import.meta.url)
const user = {
  id: 'uid-w',
  email: 'w@molly.local',
  user_metadata: {},
  created_at: '2026-10-12T00:00:00Z',
}
const sdkSession = (owner = user) => ({ user: owner, access_token: 'test-token' })

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function fixture({
  cached = null, holdWorkspace = true, authUser = user,
  access = { allowed: true, uid: user.id }, prepared = null,
  userError = null, workspaceInitialized = true, profileOwner = user.id,
} = {}) {
  const storage = new Map()
  if (prepared) storage.set('happy-little-molly.offline-owner.v1', prepared)
  const timers = new Map()
  const window = new EventTarget()
  const document = new EventTarget()
  document.visibilityState = 'visible'
  let timerId = 0
  const context = vm.createContext({
    console, window, document, Event, crypto: webcrypto,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value) },
      removeItem: (key) => { storage.delete(key) },
    },
    setTimeout: (callback) => {
      const id = ++timerId
      timers.set(id, callback)
      return id
    },
    clearTimeout: (id) => { timers.delete(id) },
  })
  function load(path, imports = {}) {
    const source = readFileSync(new URL(path, root), 'utf8')
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const exports = {}
    const factory = vm.runInContext(`(function(require, exports) {${code}\n})`, context, { filename: path })
    factory((name) => {
      assert.ok(Object.hasOwn(imports, name), `Missing dependency fixture: ${name}`)
      return imports[name]
    }, exports)
    return exports
  }

  const session = load('src/services/session.ts')
  const rules = load('src/shared/authRules.ts')
  const errors = load('src/shared/errors.ts')
  const cloudErrors = load('src/services/cloud/errors.ts')
  const identity = load('src/services/cloud/identity.ts', { '../../shared/authRules': rules })
  const authErrors = load('src/services/sync/authErrors.ts', { '../cloud/errors': cloudErrors })
  const workspaceStarted = deferred()
  const workspaceRelease = deferred()
  if (!holdWorkspace) workspaceRelease.resolve()
  let currentSdkSession = cached
  let onChange
  let sessionRead
  let logout
  const history = []
  const workspaceReads = []
  session.subscribeAuth(() => { history.push(session.getAuthState()) })
  const emit = (event, value) => { onChange(event, value) }
  const client = {
    auth: {
      onAuthStateChange: (callback) => { onChange = callback },
      getSession: async () => sessionRead
        ? sessionRead()
        : { data: { session: currentSdkSession }, error: null },
      getUser: async () => ({ data: { user: currentSdkSession?.user ?? null }, error: userError }),
      signInWithPassword: async () => {
        currentSdkSession = sdkSession(authUser)
        emit('SIGNED_IN', currentSdkSession)
        return { data: { session: currentSdkSession, user: authUser }, error: null }
      },
      signOut: async () => {
        if (logout) await logout()
        currentSdkSession = null
        emit('SIGNED_OUT', null)
        return { error: null }
      },
    },
  }
  const auth = load('src/services/sync/authSession.ts', {
    '../../shared/authRules': rules,
    '../../shared/errors': errors,
    '../cloud/errors': cloudErrors,
    '../cloud/identity': identity,
    '../cloud/rpc': { callRpc: async () => access },
    '../cloud/supabase': { requireSupabase: () => client },
    '../local/backupService': {
      initializeCloudWorkspace: async () => {},
      inspectBackup: () => ({ records: { users: [user] }, summary: { total: 0 } }),
    },
    '../local/localDb': { getOne: async (_, owner) => owner === profileOwner ? { ...user, username: 'W' } : null },
    '../local/workspaceService': {
      getWorkspaceState: async (owner) => {
        workspaceReads.push(owner)
        return { initialized: workspaceInitialized }
      },
      prepareEmptyWorkspace: async () => {
        workspaceStarted.resolve()
        await workspaceRelease.promise
      },
    },
    '../session': session,
    './syncState': { deviceId: () => 'test-device' },
    './authErrors': authErrors,
  })

  function signIn() {
    if (!session.readAuthLock()) session.lockAuthRestore()
    const expectedLock = session.readAuthLock()
    const generation = session.beginAuthTransition('preparing')
    const promise = auth.signIn('W', 'test-password', generation, expectedLock)
    promise.catch(() => {})
    return promise
  }
  async function flush() {
    for (let round = 0; round < 20; round++) {
      const pending = [...timers.values()]
      timers.clear()
      for (const callback of pending) callback()
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      if (!timers.size) return
    }
    throw new Error('Authentication callbacks did not settle')
  }
  return {
    auth, session, history, signIn, flush, emit, workspaceReads,
    workspaceStarted: workspaceStarted.promise,
    releaseWorkspace: workspaceRelease.resolve,
    setSdkSession: (value) => { currentSdkSession = value },
    setSessionRead: (read) => { sessionRead = read },
    setLogout: (run) => { logout = run },
  }
}

function assertReady(f, generation = f.session.getAuthState().generation) {
  assert.equal(f.session.getAuthState().phase, 'ready')
  assert.equal(f.session.getAuthState().generation, generation)
  assert.equal(f.session.getAuthState().session?.user.id, user.id)
  assert.equal(f.session.isCloudSessionVerified(), true)
  assert.equal(f.session.readAuthLock(), null)
}

function assertClosed(f) {
  assert.equal(f.session.readSession(), null)
  assert.equal(f.session.isCloudSessionVerified(), false)
  assert.notEqual(f.session.readAuthLock(), null)
}

test('an authorized user can log in and restore a session without metadata', async () => {
  const f = fixture({ holdWorkspace: false })
  await f.signIn()
  assertReady(f)
  const restored = fixture({ cached: sdkSession(), holdWorkspace: false })
  await restored.auth.initializeAuth()
  assertReady(restored)
})

test('forged W metadata cannot authorize an unrelated UID', async () => {
  const other = { ...user, id: 'other-uid', user_metadata: { username: 'W' } }
  const f = fixture({ authUser: other, access: { allowed: false, uid: other.id }, holdWorkspace: false })
  await assert.rejects(f.signIn(), /未获准访问/)
  assertClosed(f)
  assert.deepEqual(f.workspaceReads, [])
})

for (const [label, access] of [
  ['missing', null],
  ['malformed', { allowed: 'true', uid: user.id }],
  ['missing UID', { allowed: true }],
  ['mismatched UID', { allowed: true, uid: 'other-uid' }],
]) {
  test(`${label} RPC authorization cannot open a workspace`, async () => {
    const f = fixture({ access, holdWorkspace: false })
    await assert.rejects(f.signIn())
    assert.equal(f.session.readSession(), null)
    assert.equal(f.session.isCloudSessionVerified(), false)
    assert.deepEqual(f.workspaceReads, [])
  })
}

test('a prepared offline workspace restores without metadata and never enables cloud writes', async () => {
  const f = fixture({
    cached: sdkSession(), prepared: user.id, userError: { message: 'Failed to fetch' },
  })
  await f.auth.initializeAuth()
  assert.equal(f.session.getAuthState().phase, 'offline-cached')
  assert.equal(f.session.readSession()?.user.id, user.id)
  assert.equal(f.session.isCloudSessionVerified(), false)
})

test('a cached UID without a previously prepared owner cannot open offline data', async () => {
  const f = fixture({ cached: sdkSession(), userError: { message: 'Failed to fetch' } })
  await f.auth.initializeAuth()
  assert.equal(f.session.readSession(), null)
  assert.deepEqual(f.workspaceReads, [])
})

test('an unrelated cached UID cannot select the previously prepared offline workspace', async () => {
  const f = fixture({
    cached: sdkSession({ ...user, id: 'other-uid', user_metadata: { username: 'W' } }),
    prepared: user.id, userError: { message: 'Failed to fetch' },
  })
  await f.auth.initializeAuth()
  assert.equal(f.session.readSession(), null)
  assert.deepEqual(f.workspaceReads, [])
})

test('the prepared owner still needs an initialized workspace and matching profile offline', async () => {
  for (const invalid of [{ workspaceInitialized: false }, { profileOwner: 'other-uid' }]) {
    const f = fixture({
      cached: sdkSession(), prepared: user.id, userError: { message: 'Failed to fetch' }, ...invalid,
    })
    await f.auth.initializeAuth()
    assert.equal(f.session.readSession(), null)
    assert.equal(f.session.isCloudSessionVerified(), false)
  }
})

test('SDK logout during explicit login cannot publish a verified workspace', async () => {
  const f = fixture()
  const login = f.signIn()
  await f.workspaceStarted
  f.setSdkSession(null)
  f.emit('SIGNED_OUT', null)
  f.releaseWorkspace()
  await assert.rejects(login)
  await f.flush()
  assertClosed(f)
  assert.ok(!f.history.some((state) => state.phase === 'ready'))
})

test('SDK logout during cached-session restoration cannot publish ready', async () => {
  const f = fixture({ cached: sdkSession() })
  const restoring = f.auth.initializeAuth()
  await f.workspaceStarted
  f.setSdkSession(null)
  f.emit('SIGNED_OUT', null)
  f.releaseWorkspace()
  await restoring
  await f.flush()
  assertClosed(f)
  assert.ok(!f.history.some((state) => state.phase === 'ready'))
})

test('late SIGNED_OUT during login preserves the newer SDK session', async () => {
  const f = fixture()
  const login = f.signIn()
  await f.workspaceStarted
  const generation = f.session.getAuthState().generation
  f.emit('SIGNED_OUT', null)
  await f.flush()
  assert.equal(f.session.getAuthState().generation, generation)
  assert.equal(f.session.readAuthLock(), null)
  f.releaseWorkspace()
  await login
  assertReady(f, generation)
})

test('late SIGNED_OUT after login preserves the owner and generation', async () => {
  const f = fixture({ holdWorkspace: false })
  await f.signIn()
  const generation = f.session.getAuthState().generation
  f.emit('SIGNED_OUT', null)
  await f.flush()
  assertReady(f, generation)
  assert.ok(!f.history.some((state) => state.phase === 'signed-out'))
})

test('confirmed SDK logout closes the workspace and blocks cached restoration', async () => {
  const f = fixture({ holdWorkspace: false })
  await f.signIn()
  f.setSdkSession(null)
  f.emit('SIGNED_OUT', null)
  await f.flush()
  assert.equal(f.session.getAuthState().phase, 'signed-out')
  assertClosed(f)
})

test('a stale logout check cannot override a newer SIGNED_IN event', async () => {
  const f = fixture({ holdWorkspace: false })
  await f.signIn()
  const generation = f.session.getAuthState().generation
  const oldRead = deferred()
  f.setSessionRead(() => oldRead.promise)
  f.setSdkSession(null)
  f.emit('SIGNED_OUT', null)
  await f.flush()
  f.setSessionRead(null)
  f.setSdkSession(sdkSession())
  f.emit('SIGNED_IN', sdkSession())
  oldRead.resolve({ data: { session: null }, error: null })
  await f.flush()
  assertReady(f, generation)
})

test('a SDK event during the final session read is checked again', async () => {
  const f = fixture()
  const login = f.signIn()
  await f.workspaceStarted
  let first = true
  f.setSessionRead(async () => {
    if (first) {
      first = false
      f.emit('SIGNED_OUT', null)
      return { data: { session: null }, error: null }
    }
    return { data: { session: sdkSession() }, error: null }
  })
  f.releaseWorkspace()
  await login
  await f.flush()
  assertReady(f)
})

test('a changed SDK UID during workspace preparation is rejected', async () => {
  const f = fixture()
  const login = f.signIn()
  await f.workspaceStarted
  const other = sdkSession({ ...user, id: 'other-uid' })
  f.setSdkSession(other)
  f.emit('SIGNED_IN', other)
  f.releaseWorkspace()
  await assert.rejects(login)
  assertClosed(f)
  assert.ok(!f.history.some((state) => state.phase === 'ready'))
})

test('a queued login survives the preceding explicit logout event', async () => {
  const f = fixture({ holdWorkspace: false })
  await f.signIn()
  const logoutStarted = deferred()
  const logoutRelease = deferred()
  f.setLogout(async () => {
    logoutStarted.resolve()
    await logoutRelease.promise
  })
  const generation = f.session.beginAuthTransition('signed-out')
  f.session.lockAuthRestore()
  const signingOut = f.auth.signOut(generation)
  await logoutStarted.promise
  const signingIn = f.signIn()
  logoutRelease.resolve()
  await signingOut
  await signingIn
  await f.flush()
  assertReady(f)
})

for (const [operation, moduleName, method] of [
  ['restore', 'replaceLocal', 'restoreCloudToLocal'],
  ['upload', 'replaceCloud', 'uploadLocalToCloud'],
  ['summary', 'replaceCloud', 'readCloudSummary'],
]) {
  test(`a delayed ${operation} module cannot capture the newer login generation`, { timeout: 120000 }, async () => {
    let server
    let browser
    let heldRequest
    let released = false
    let moduleTimer
    try {
      server = await startDevServer()
      browser = await launchBrowser({ label: `auth-import-${operation}` })
      const cloud = createAuthFixture()
      const existingId = randomUUID()
      const timestamp = '2020-01-01T00:00:00.000Z'
      cloud.put('food_options', {
        id: existingId, user_id: FIXTURE_UID, name: 'cloud original',
        active: true, sort_order: 0, created_at: timestamp, updated_at: timestamp,
      })
      await cloud.attach(browser.cdp)
      await browser.cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      const fixtureHandler = browser.cdp.handlers.get('Fetch.requestPaused')
      assert.equal(typeof fixtureHandler, 'function')
      const modulePaused = deferred()
      const modulePath = `/src/services/sync/${moduleName}.ts`
      // Delay the real ES module response without replacing its implementation.
      browser.cdp.on('Fetch.requestPaused', (params) => {
        if (new URL(params.request.url).pathname === modulePath && !heldRequest) {
          heldRequest = params.requestId
          modulePaused.resolve(true)
          return
        }
        fixtureHandler(params)
      })
      await browser.cdp.send('Fetch.enable', {
        patterns: [
          { urlPattern: `${FIXTURE_URL}/*` },
          { urlPattern: `${server.url}src/services/sync/${moduleName}.ts*` },
        ],
      })

      // A static same-origin page imports real services without the UI scheduler.
      await browser.navigate(`${server.url}scripts/lib/service-fixture.html`)
      const firstLogin = await browser.evaluate(`(async()=>{
        window.__race={
          auth:await import('/src/services/api/authService.ts'),
          options:await import('/src/services/api/optionService.ts'),
          sync:await import('/src/services/api/syncService.ts')
        };
        await window.__race.auth.initializeAuth();
        await window.__race.auth.signIn('W',${JSON.stringify(FIXTURE_PASSWORD)});
        return window.__race.auth.getAuthState()
      })()`)
      assert.equal(firstLogin.phase, 'ready')
      assert.equal(firstLogin.session.user.id, FIXTURE_UID)
      assert.equal(heldRequest, undefined, 'replacement module was loaded before the operation')
      const beforeCall = { auth: cloud.auth.length, rest: cloud.rest.length }
      await browser.evaluate(`(()=>{
        window.__moduleOutcome=null;
        window.__modulePromise=window.__race.sync[${JSON.stringify(method)}]()
          .then(value=>({ok:true,value}),error=>({ok:false,error:error.message}))
          .then(outcome=>{window.__moduleOutcome=outcome;return outcome});
        return true
      })()`)
      moduleTimer = setTimeout(() => { modulePaused.resolve(false) }, 15000)
      assert.equal(await modulePaused.promise, true, `did not intercept ${modulePath}`)
      clearTimeout(moduleTimer)
      assert.equal(await browser.evaluate('window.__moduleOutcome'), null)
      assert.deepEqual(
        { auth: cloud.auth.length, rest: cloud.rest.length },
        beforeCall,
        'the delayed operation must not make cloud requests before loading',
      )

      await browser.evaluate('window.__race.auth.signOut()')
      assert.equal(await browser.evaluate('window.__race.auth.getAuthState().phase'), 'signed-out')
      await browser.evaluate(`window.__race.auth.signIn('W',${JSON.stringify(FIXTURE_PASSWORD)})`)
      const secondLogin = await browser.evaluate('window.__race.auth.getAuthState()')
      assert.equal(secondLogin.phase, 'ready')
      assert.equal(secondLogin.session.user.id, FIXTURE_UID)
      assert.ok(secondLogin.generation > firstLogin.generation)
      const added = await browser.evaluate(`(async()=>{
        await window.__race.options.renameOption('food',${JSON.stringify(existingId)},'new generation edit');
        return window.__race.options.createOption('food',{name:'new generation addition'})
      })()`)
      const protectedSnapshot = await browser.readDb()
      const protectedQueue = protectedSnapshot.rows.sync_outbox
        .filter((entry) => entry.local_user_id === FIXTURE_UID)
      assert.deepEqual(
        protectedQueue.map((entry) => entry.record_id).sort(),
        [existingId, added.id].sort(),
        'both new-generation edits must have actual pending queue entries',
      )
      assert.equal(
        protectedSnapshot.rows.food_options.find((row) => row.id === existingId)?.name,
        'new generation edit',
      )
      const beforeRelease = { auth: cloud.auth.length, rest: cloud.rest.length }
      const protectedCloud = structuredClone(cloud.rows)
      await browser.cdp.send('Fetch.continueRequest', { requestId: heldRequest })
      released = true
      await browser.until('window.__moduleOutcome!==null')
      const outcome = await browser.evaluate('window.__moduleOutcome')
      assert.equal(outcome.ok, false, 'the operation confirmed in an old generation must reject')
      assert.match(outcome.error, /登录状态已变化/)
      assert.deepEqual(
        { auth: cloud.auth.length, rest: cloud.rest.length },
        beforeRelease,
        'releasing an obsolete module load must make zero cloud requests',
      )
      assert.deepEqual((await browser.readDb()).rows, protectedSnapshot.rows,
        'obsolete operations must preserve business records, queues and success timestamps')
      assert.deepEqual(cloud.rows, protectedCloud, 'obsolete operations must not replace cloud records')
      assert.deepEqual(cloud.errors, [])
      assert.deepEqual(browser.noise(), [])
    } finally {
      clearTimeout(moduleTimer)
      if (heldRequest && !released) {
        await browser?.cdp.send('Fetch.continueRequest', { requestId: heldRequest }).catch(() => {})
      }
      try {
        if (browser) await browser.close()
      } finally {
        await stopProcess(server?.child)
      }
    }
  })
}
