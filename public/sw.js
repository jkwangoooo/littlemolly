/*
 * 幸福小Molly 的应用壳 Service Worker。
 *
 * 手写，不引第三方运行时依赖（没有 workbox / vite-plugin-pwa）：这个壳只做三件事，
 * 自己写比多背一个依赖更好读、更好查。
 *
 * 三条硬约束（改动前请先读 docs/16）：
 *
 * 1. **只处理同源 GET。** 跨域请求（尤其是 Supabase 的 REST / Auth 调用）一律直接 return，
 *    交给浏览器默认处理，绝不进缓存。缓存了跨域响应就等于在本地伪造云端状态：
 *    断网时会「读得到上一次的数据」，而用户以为那是云端的实时结果。
 *
 * 2. **缓存名带构建戳。** 戳从注册 URL 的 `?build=` 参数取（页面在注册时传入构建时间），
 *    不手写版本号——手写的版本号一定会忘记改。构建戳一变就是一次新安装，
 *    activate 里会把同前缀的旧缓存清掉。
 *
 * 3. **更新策略保守：不 skipWaiting、不 clients.claim。** 新版本装好之后停在 waiting，
 *    当前页面继续用旧版本跑完——用户可能正在编辑一份计划，静默把页面换成新版本
 *    等于让他的输入凭空消失。页面检测到 waiting 会提示「有新版本」，
 *    用户点了刷新才 postMessage(SKIP_WAITING) 让新版本接管。
 *
 * 策略：
 * - 导航请求 / HTML / manifest：network-first（3 秒超时），失败或超时回退缓存。
 *   这样每次上线都能拿到新的 index.html，而断网时应用仍然打得开。
 * - 其它同源静态资源：cache-first（构建产物文件名带内容哈希，天然不需要 revalidate）。
 */

const CACHE_PREFIX = 'molly-shell-'
const SCOPE_URL = new URL('./', self.location.href)
const INDEX_URL = new URL('index.html', SCOPE_URL).href
const INDEX_PATH = new URL(INDEX_URL).pathname
const MANIFEST_URL = new URL('manifest.webmanifest', SCOPE_URL).href

/** 构建戳来自注册 URL；没有就是有人手动注册了裸的 /sw.js，退回一个固定名。 */
const BUILD_STAMP = new URL(self.location.href).searchParams.get('build') || 'manual'
const SHELL_CACHE = `${CACHE_PREFIX}${BUILD_STAMP}`

/** 网络优先的超时上限：超过它就先拿缓存把页面渲染出来，网络请求继续在后台跑。 */
const NETWORK_FIRST_TIMEOUT_MS = 3000

/** 应用壳里与构建产物无关的那几件（图标与 manifest 文件名固定，直接写在这里）。 */
const SHELL_ASSETS = [
  INDEX_URL,
  MANIFEST_URL,
  new URL('favicon.svg', SCOPE_URL).href,
  new URL('apple-touch-icon.png', SCOPE_URL).href,
  new URL('icons/icon-192.png', SCOPE_URL).href,
  new URL('icons/icon-512.png', SCOPE_URL).href,
  new URL('icons/icon-maskable-512.png', SCOPE_URL).href,
]

/**
 * 从 index.html 里解析出构建产物地址。
 * 产物文件名带内容哈希（index-XXXX.js），没法在源码里写死，只能装的时候读一遍首页。
 * 顺带把首页本身也存下来：断网时的导航请求就是靠它渲染的。
 */
function extractAssetUrls(html) {
  const urls = new Set()
  const patterns = [
    /<script[^>]+src="([^"]+)"/g,
    /<link[^>]+rel="(?:stylesheet|icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g,
  ]
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      try {
        const url = new URL(match[1], SCOPE_URL)
        if (url.origin === SCOPE_URL.origin) urls.add(url.href)
      } catch {
        // 地址写坏了就跳过：宁可少缓存一个资源，也不能让 install 整个失败。
      }
    }
  }
  return [...urls]
}

/** 单个资源取不到时不能让 install 失败——少一个图标也要能装上。 */
async function precacheOne(cache, url) {
  try {
    const response = await fetch(url, { cache: 'no-cache' })
    if (response.ok) await cache.put(url, response)
  } catch {
    // 忽略：离线安装或某个资源缺失时，其余资源照常缓存。
  }
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE)
  const urls = new Set(SHELL_ASSETS)

  try {
    const response = await fetch(INDEX_URL, { cache: 'no-cache' })
    if (response.ok) {
      const html = await response.clone().text()
      await cache.put(INDEX_URL, response)
      for (const url of extractAssetUrls(html)) urls.add(url)
    }
  } catch {
    // 装的时候恰好断网：下面的 precacheOne 会逐个失败，缓存为空但 SW 仍然可用。
  }

  await Promise.all([...urls].map((url) => precacheOne(cache, url)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      )
      // 刻意不调 clients.claim()：让已经在跑的页面继续用旧版本，更新由用户决定。
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (reason) => {
        clearTimeout(timer)
        reject(reason)
      },
    )
  })
}

function offlineFallback() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>幸福小Molly</title><p>现在打不开：这台设备还没有缓存过应用，请联网后再试一次。',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

/**
 * 这次请求应该存到哪个缓存键下面。
 *
 * 应用壳的导航只有两种地址：`/` 与 `/index.html`，两者共用同一个键，
 * 这样断网时不管用户从哪个地址进来都拿得到同一份 HTML。
 * **其它路径的导航一律返回 null（只走网络、不写缓存）**：否则随便访问一个不存在的路径，
 * 就会把 404 页面写进应用壳，下次断网打开应用看到的就是那个 404。
 */
function shellCacheKey(request) {
  const url = new URL(request.url)
  if (url.pathname === SCOPE_URL.pathname || url.pathname === INDEX_PATH) return INDEX_URL
  return null
}

/** HTML / manifest：先网络（3 秒超时），失败再回缓存。 */
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE)
  const key = request.mode === 'navigate' ? shellCacheKey(request) : request.url

  let response = null
  try {
    response = await withTimeout(fetch(request), NETWORK_FIRST_TIMEOUT_MS)
  } catch {
    response = null
  }

  if (response && response.ok) {
    if (key) {
      const copy = response.clone()
      // 缓存写入失败不该影响这次响应，因此单独 catch。
      void cache.put(key, copy).catch(() => {})
    }
    return response
  }

  if (key) {
    const cached = await cache.match(key, { ignoreSearch: true })
    if (cached) return cached
  }
  if (response) return response
  return request.mode === 'navigate' ? offlineFallback() : Response.error()
}

/** 静态资源：先缓存，没有再去网络。 */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      const copy = response.clone()
      void cache.put(request, copy).catch(() => {})
    }
    return response
  } catch (reason) {
    const fallback = await cache.match(request, { ignoreSearch: true })
    if (fallback) return fallback
    throw reason
  }
}

function isShellDocument(request) {
  if (request.mode === 'navigate') return true
  const url = new URL(request.url)
  return url.pathname.endsWith('.html') || url.pathname.endsWith('.webmanifest')
}

self.addEventListener('fetch', (event) => {
  const request = event.request

  // 只碰同源 GET；跨域（含 Supabase）与写请求一律交给浏览器默认处理。
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== SCOPE_URL.origin) return
  // 别把 SW 自己缓存起来，否则更新逻辑会自我锁死。
  if (url.pathname === SCOPE_URL.pathname + 'sw.js') return

  event.respondWith(isShellDocument(request) ? networkFirst(request) : cacheFirst(request))
})
