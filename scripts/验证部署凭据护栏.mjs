import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = fs.readFileSync(new URL('./deploy.mjs', import.meta.url), 'utf8')
const program = source.slice(0, source.lastIndexOf('\ntry {')).replace(/^import .*\r?\n/gm, '')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-deploy-guard-'))
const alias = path.join(temporary, 'repository-link')
const links = [alias]
const modeledLinks = new Map()
const fixtureFs = {
  ...fs,
  existsSync: (filename) => modeledLinks.has(path.resolve(filename)) ? false : fs.existsSync(filename),
  lstatSync: (filename, options) => modeledLinks.has(path.resolve(filename))
    ? { isSymbolicLink: () => true }
    : fs.lstatSync(filename, options),
  readlinkSync: (filename) => modeledLinks.get(path.resolve(filename)) ?? fs.readlinkSync(filename),
}
const publicJwt = (role) => `test.${Buffer.from(JSON.stringify(role ? { role } : {})).toString('base64url')}.test`

function link(target, name, type = 'file') {
  const filename = path.join(temporary, name)
  try {
    fs.symlinkSync(target, filename, type)
    links.push(filename)
  } catch (error) {
    if (process.platform !== 'win32' || type !== 'file' || error.code !== 'EPERM') throw error
    // Windows may lack file-symlink privileges; model only those API entries, retaining real junction tests.
    modeledLinks.set(filename, target)
  }
  return filename
}

function guards(configPath) {
  const observations = { reads: 0, writes: 0 }
  const context = vm.createContext({
    fs: {
      ...fixtureFs,
      readFileSync: (...args) => { observations.reads += 1; return fs.readFileSync(...args) },
      writeFileSync: () => { observations.writes += 1; throw new Error('Unexpected config write') },
    },
    os, path, Buffer, URL, console,
    process: { cwd: () => root, env: { MOLLY_DEPLOY_CONFIG: configPath }, argv: [] },
    spawnSync: () => { throw new Error('Guard verification must not launch deployment commands') },
  })
  vm.runInContext(`${program}\nglobalThis.guards={assertExternalConfigPath,validatePublicSupabaseKey,loadConfig,setup}`, context)
  return { ...context.guards, observations }
}

after(() => {
  for (const filename of links.reverse()) {
    if (fs.lstatSync(filename, { throwIfNoEntry: false })) fs.unlinkSync(filename)
  }
  const absolute = path.resolve(temporary)
  assert.ok(absolute.startsWith(`${path.resolve(os.tmpdir())}${path.sep}molly-deploy-guard-`))
  fs.rmSync(absolute, { recursive: true, force: true })
  if (modeledLinks.size) console.log(`Windows file symlink fixtures: ${modeledLinks.size} modeled entries; directory junctions used the real filesystem`)
})

for (const [label, config] of [
  ['repository file', path.join(root, 'deploy.env')],
  ['repository root', root],
  ['normalized traversal into repository', path.join(root, 'scripts', '..', 'deploy.env')],
]) {
  test(`reject ${label} before reading credentials`, () => {
    const guard = guards(config)
    assert.throws(() => guard.loadConfig(), /必须位于仓库之外/)
    assert.equal(guard.observations.reads, 0)
    assert.equal(guard.observations.writes, 0)
  })
}

test('accept an external config path with missing parent directories', () => {
  guards(path.join(temporary, 'not-created', 'deploy.env')).assertExternalConfigPath()
})

test('reject an external junction pointing into the repository', () => {
  fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const guard = guards(path.join(alias, 'not-created', 'deploy.env'))
  assert.throws(() => guard.loadConfig(), /必须位于仓库之外/)
  assert.equal(guard.observations.reads, 0)
})

test('reject a dangling external file link into the repository before load or setup reads', async () => {
  const target = path.join(root, `${path.basename(temporary)}.env`)
  assert.equal(fs.existsSync(target), false)
  const config = link(target, 'dangling-config.env')
  assert.equal(fixtureFs.existsSync(config), false)
  assert.equal(fixtureFs.lstatSync(config).isSymbolicLink(), true)
  const guard = guards(config)
  assert.throws(() => guard.loadConfig(), /必须位于仓库之外/)
  await assert.rejects(guard.setup(), /必须位于仓库之外/)
  assert.deepEqual(guard.observations, { reads: 0, writes: 0 })
  assert.equal(fs.existsSync(target), false)
})

test('reject a chain of dangling links into a missing repository directory', () => {
  const target = path.join(root, path.basename(temporary), 'deploy.env')
  assert.equal(fs.existsSync(target), false)
  const first = link(target, 'chain-target.env')
  const config = link(path.basename(first), 'chain-config.env')
  assert.equal(fixtureFs.existsSync(config), false)
  const guard = guards(config)
  assert.throws(() => guard.loadConfig(), /必须位于仓库之外/)
  assert.deepEqual(guard.observations, { reads: 0, writes: 0 })
})

test('reject missing descendants of a dangling directory link into the repository', () => {
  const target = path.join(root, path.basename(temporary))
  assert.equal(fs.existsSync(target), false)
  const directory = link(target, 'dangling-directory', process.platform === 'win32' ? 'junction' : 'dir')
  const guard = guards(path.join(directory, 'not-created', 'deploy.env'))
  assert.throws(() => guard.loadConfig(), /必须位于仓库之外/)
  assert.deepEqual(guard.observations, { reads: 0, writes: 0 })
})

test('accept a dangling file link whose target stays outside the repository', () => {
  const target = path.join(temporary, 'external-missing.env')
  const config = link(path.basename(target), 'external-config.env')
  guards(config).assertExternalConfigPath()
})

test('reject symbolic link cycles without reading credentials', () => {
  const config = link('cycle-b.env', 'cycle-a.env')
  link('cycle-a.env', 'cycle-b.env')
  const guard = guards(config)
  assert.throws(() => guard.loadConfig(), /实际路径/)
  assert.deepEqual(guard.observations, { reads: 0, writes: 0 })
})

for (const key of [publicJwt('anon'), 'sb_publishable_test_fixture']) {
  test(`accept ${key.startsWith('sb_') ? 'publishable' : 'legacy anon'} public key`, () => {
    assert.equal(guards(path.join(temporary, 'config.env')).validatePublicSupabaseKey(key), key)
  })
}

for (const [label, key] of [
  ['empty', ''],
  ['service_role prefix', 'service_role_test_fixture'],
  ['secret key', 'sb_secret_test_fixture'],
  ['service_role JWT', publicJwt('service_role')],
  ['JWT without anon role', publicJwt(null)],
  ['unrecognized key', 'test_invalid_public_key'],
]) {
  test(`reject ${label} key`, () => {
    assert.throws(() => guards(path.join(temporary, 'config.env')).validatePublicSupabaseKey(key))
  })
}

test('setup rejects repository credentials before reading or writing any config', async () => {
  const guard = guards(path.join(alias, 'deploy.env'))
  await assert.rejects(guard.setup(), /必须位于仓库之外/)
  assert.deepEqual(guard.observations, { reads: 0, writes: 0 })
})

test('load validates an external config without executing a deployment', () => {
  const config = path.join(temporary, 'test.env')
  const key = publicJwt('anon')
  fs.writeFileSync(config, [
    'VERCEL_TOKEN=test-only-token',
    'SUPABASE_DB_URL=postgresql://test:test@localhost/test',
    'VITE_SUPABASE_URL=https://test.invalid',
    `VITE_SUPABASE_ANON_KEY=${key}`,
  ].join('\n'))
  const guard = guards(config)
  assert.equal(guard.loadConfig().VITE_SUPABASE_ANON_KEY, key)
  assert.equal(guard.observations.writes, 0)
})
