// Only the browser's HTTP boundary is mocked. Application authentication and
// workspace preparation always use the production SDK and service code.
import '../ts-resolve.mjs'

const { RECORD_SCHEMAS, USER_DATA_STORES } = await import('../../src/services/local/recordSchemas.ts')
const { buildBackup } = await import('../../src/services/local/backupFormat.ts')

export const FIXTURE_URL = 'https://molly-auth-fixture.invalid'
export const FIXTURE_UID = '11111111-2222-4333-8444-555555555555'
export const OTHER_UID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
export const FIXTURE_USERNAME = 'W'
export const FIXTURE_AUTH_IDENTIFIER = 'w@molly.local'
export const FIXTURE_PASSWORD = 'fixture-pass-2026'
export const FIXTURE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJmaXh0dXJlIiwicm9sZSI6ImFub24ifQ.fixture-signature'
export const FIXTURE_ENV = {
  VITE_SUPABASE_URL: FIXTURE_URL,
  VITE_SUPABASE_ANON_KEY: FIXTURE_ANON_KEY,
}

const ROOT_STORES = new Set(['day_plans', 'food_options', 'supplement_templates', 'exercise_options'])
const PLAN_CHILDREN = new Set(['daily_meals', 'custom_tasks', 'daily_supplements', 'daily_exercise_items', 'routine_tasks'])
const rowKey = (store, id) => `${store}\u0000${id}`
const epoch = '2020-01-01T00:00:00.000Z'

export function createAuthFixture() {
  const fixture = {
    auth: [],
    rest: [],
    rows: new Map(),
    errors: [],
    offline: false,
    rejectAuth: false,
    rejectGate: null,
    rejectBusiness: null,
    rejectSnapshot: null,
    rejectReplace: null,
    rejectTable: null,
    rejectLogout: false,
    snapshotOverride: null,
    replaceResultOverride: null,
    summaryOverride: null,
    hold: null,
    held: [],
    userId: FIXTURE_UID,
    userEmail: FIXTURE_AUTH_IDENTIFIER,
    userMetadata: {},
    gateAllowed: true,
    revokedTokens: new Set(),
    validTokens: new Set(),
    tokenUsers: new Map(),
    validRefreshTokens: new Set(),
    authSequence: 0,
  }

  fixture.user = () => ({
    id: fixture.userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: fixture.userEmail,
    email_confirmed_at: epoch,
    created_at: epoch,
    updated_at: epoch,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: structuredClone(fixture.userMetadata),
    identities: [],
  })
  fixture.session = () => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const sequence = ++fixture.authSequence
    const token = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({
        sub: fixture.userId,
        aud: 'authenticated',
        role: 'authenticated',
        user_metadata: structuredClone(fixture.userMetadata),
        exp: expires,
        iat: expires - 3600,
        session_id: `fixture-${sequence}`,
      })).toString('base64url'),
      `fixture-signature-${sequence}`,
    ].join('.')
    const refreshToken = `fixture-refresh-${sequence}`
    fixture.validTokens.add(token)
    fixture.tokenUsers.set(token, structuredClone(fixture.user()))
    fixture.validRefreshTokens.add(refreshToken)
    return {
      access_token: token,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expires,
      user: fixture.user(),
    }
  }
  fixture.rowsOf = (store) => [...fixture.rows.entries()]
    .filter(([key]) => key.startsWith(`${store}\u0000`))
    .map(([, row]) => structuredClone(row))
  fixture.put = (store, row) => fixture.rows.set(rowKey(store, row.id), structuredClone(row))
  fixture.writes = () => fixture.rest.filter((request) => !request.rpc && ['POST', 'DELETE'].includes(request.method))
  fixture.ownedRows = (store) => {
    const plans = new Set(fixture.rowsOf('day_plans').filter((row) => row.user_id === fixture.userId).map((row) => row.id))
    const meals = new Set(fixture.rowsOf('daily_meals').filter((row) => plans.has(row.day_plan_id)).map((row) => row.id))
    if (store === 'daily_meal_items') return fixture.rowsOf(store).filter((row) => meals.has(row.daily_meal_id))
    if (PLAN_CHILDREN.has(store)) return fixture.rowsOf(store).filter((row) => plans.has(row.day_plan_id))
    return fixture.rowsOf(store).filter((row) => row.user_id === fixture.userId)
  }
  fixture.summary = () => {
    const counts = {}
    for (const store of USER_DATA_STORES) {
      const count = fixture.ownedRows(store).length
      if (count) counts[store] = count
    }
    return { counts, total: Object.values(counts).reduce((total, count) => total + count, 0) }
  }
  fixture.snapshot = () => {
    const records = {}
    for (const store of USER_DATA_STORES) {
      records[store] = fixture.ownedRows(store).map((row) =>
        Object.fromEntries(Object.keys(RECORD_SCHEMAS[store]).filter((key) => key in row).map((key) => [key, row[key]])),
      )
    }
    records.users = [{ id: fixture.userId, username: 'W', created_at: epoch }]
    return buildBackup({
      dbVersion: 8,
      exportedAt: new Date().toISOString(),
      sourceUsername: 'W',
      records,
    })
  }
  fixture.replace = (payload) => {
    for (const store of USER_DATA_STORES) {
      for (const row of fixture.ownedRows(store)) fixture.rows.delete(rowKey(store, row.id))
    }
    const imported = {}
    for (const store of USER_DATA_STORES) {
      const rows = payload?.records?.[store] ?? []
      for (const row of rows) fixture.put(store, ROOT_STORES.has(store) ? { ...row, user_id: fixture.userId } : row)
      if (rows.length) imported[store] = rows.length
    }
    return { imported, total: Object.values(imported).reduce((total, count) => total + count, 0) }
  }
  fixture.release = async (name = fixture.hold) => {
    fixture.hold = null
    const held = fixture.held.splice(0)
    for (const item of held) {
      if (!name || item.name === name) await item.respond()
      else fixture.held.push(item)
    }
  }
  fixture.revoke = () => {
    for (const token of fixture.validTokens) fixture.revokedTokens.add(token)
    fixture.validRefreshTokens.clear()
  }

  fixture.attach = async (cdp) => {
    const respond = (requestId, status, value, extra = {}) => {
      const headers = {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,prefer,x-supabase-api-version,content-profile,accept-profile,content-range',
        'access-control-allow-methods': 'GET,POST,HEAD,DELETE,OPTIONS',
        'access-control-expose-headers': 'content-range',
        ...extra,
      }
      const params = {
        requestId,
        responseCode: status,
        responseHeaders: Object.entries(headers).map(([name, val]) => ({ name, value: String(val) })),
      }
      if (status !== 204 && value !== undefined) params.body = Buffer.from(JSON.stringify(value)).toString('base64')
      return cdp.send('Fetch.fulfillRequest', params)
    }
    const handler = async (params) => {
      const url = new URL(params.request.url)
      if (!url.href.startsWith(FIXTURE_URL)) return cdp.send('Fetch.continueRequest', { requestId: params.requestId })
      if (fixture.offline) return cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'InternetDisconnected' })
      const method = params.request.method
      if (method === 'OPTIONS') return respond(params.requestId, 204)
      const body = params.request.postData ? JSON.parse(params.request.postData) : {}
      const bearer = (params.request.headers.Authorization ?? params.request.headers.authorization ?? '').replace(/^Bearer /, '')
      const valid = () => fixture.validTokens.has(bearer) && !fixture.revokedTokens.has(bearer)
      const tokenUser = fixture.tokenUsers.get(bearer)
      if (url.pathname.startsWith('/auth/v1/')) {
        fixture.auth.push({ method, path: url.pathname, query: url.search, body })
        const name = url.pathname.split('/').at(-1)
        const run = () => {
          if (name === 'token') {
            const refresh = url.searchParams.get('grant_type') === 'refresh_token'
            const credentialsValid = refresh
              ? fixture.validRefreshTokens.has(body.refresh_token)
              : body.email === FIXTURE_AUTH_IDENTIFIER && body.password === FIXTURE_PASSWORD
            if (fixture.rejectAuth || !credentialsValid) return respond(params.requestId, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
            return respond(params.requestId, 200, fixture.session())
          }
          if (name === 'user') {
            if (!valid() || fixture.rejectAuth) return respond(params.requestId, 401, { code: 401, error_code: 'bad_jwt', msg: 'JWT is invalid' })
            return respond(params.requestId, 200, tokenUser)
          }
          if (name === 'logout') {
            if (fixture.rejectLogout) return respond(params.requestId, 500, { msg: 'fixture logout unavailable' })
            fixture.revokedTokens.add(bearer)
            return respond(params.requestId, 204)
          }
          return respond(params.requestId, 403, { message: 'Public registration is disabled' })
        }
        if (fixture.hold === name) fixture.held.push({ name, respond: run })
        else await run()
        return
      }
      const rpc = url.pathname.startsWith('/rest/v1/rpc/')
      const table = url.pathname.replace('/rest/v1/', '')
      const name = rpc ? table.slice(4) : table
      fixture.rest.push({ method, table, rpc, name, query: url.search, body, bearer })
      const run = async () => {
        if (!valid()) return respond(params.requestId, 401, { code: 'PGRST301', message: 'JWT is invalid' })
        if (rpc && name === 'account_access') {
          if (fixture.rejectGate) return respond(params.requestId, 500, { message: fixture.rejectGate })
          return respond(params.requestId, 200, { allowed: fixture.gateAllowed && tokenUser?.id === FIXTURE_UID, uid: tokenUser?.id ?? null })
        }
        if (!fixture.gateAllowed || tokenUser?.id !== FIXTURE_UID) return respond(params.requestId, 403, { code: '42501', message: '当前账号未获应用访问授权' })
        if (fixture.rejectBusiness) return respond(params.requestId, 500, { message: fixture.rejectBusiness })
        if (rpc) {
          if (name === 'cloud_sync_summary') return respond(params.requestId, 200, fixture.summaryOverride ?? fixture.summary())
          if (name === 'export_cloud_snapshot') {
            if (fixture.rejectSnapshot) return respond(params.requestId, 500, { message: fixture.rejectSnapshot })
            return respond(params.requestId, 200, fixture.snapshotOverride ?? fixture.snapshot())
          }
          if (name === 'import_local_backup') {
            if (fixture.rejectReplace) return respond(params.requestId, 500, { message: fixture.rejectReplace })
            const result = fixture.replace(body.payload)
            return respond(params.requestId, 200, fixture.replaceResultOverride ?? result)
          }
          return respond(params.requestId, 404, { message: `Fixture RPC not implemented: ${name}` })
        }
        if (method === 'GET' || method === 'HEAD') {
          const rows = fixture.ownedRows(table)
          return respond(params.requestId, 200, method === 'HEAD' ? undefined : rows, { 'content-range': `*/${rows.length}` })
        }
        if (method === 'POST') {
          if (fixture.rejectTable === table) return respond(params.requestId, 500, { message: `fixture rejected ${table}` })
          const rows = Array.isArray(body) ? body : [body]
          for (const row of rows) {
            if (ROOT_STORES.has(table) && row.user_id !== fixture.userId) return respond(params.requestId, 403, { code: '42501', message: 'Wrong owner' })
            fixture.put(table, row)
          }
          return respond(params.requestId, 201)
        }
        if (method === 'DELETE') {
          const matched = /^in\.\((.*)\)$/.exec(url.searchParams.get('id') ?? '')
          const ids = matched ? matched[1].split(',') : [(url.searchParams.get('id') ?? '').replace(/^eq\./, '')]
          for (const id of ids) fixture.rows.delete(rowKey(table, id))
          return respond(params.requestId, 204)
        }
        return respond(params.requestId, 405, { message: `Unsupported fixture method ${method}` })
      }
      if (fixture.hold === name) fixture.held.push({ name, respond: run })
      else await run()
    }
    cdp.on('Fetch.requestPaused', (params) => {
      handler(params).catch((error) => {
        fixture.errors.push(error.message)
        cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' }).catch(() => {})
      })
    })
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${FIXTURE_URL}/*` }] })
  }
  return fixture
}
