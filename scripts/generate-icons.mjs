#!/usr/bin/env node
// 生成 PWA 图标（PNG）。可重复执行：每次都用同样的几何参数重新渲染，产物覆盖 public/ 下的同名文件。
//
// 用法：
//   npm run icons
//
// 为什么用浏览器渲染而不是装 ImageMagick / sharp：
// 本项目的运行时依赖只有 react / react-dom / @supabase/supabase-js，为了几张静态图装一个
// 图像库不划算，而验收脚本本来就依赖本机 Chrome。这里复用同一个内核：
//   chrome --headless=new --window-size=N,N --screenshot=out.png file:///临时页面.html
//
// 设计（与 public/favicon.svg 同源，保证「图标 = 浏览器标签页上的那个 M」）：
// - 底色 #a11b4a 满幅铺满：iOS 的 apple-touch-icon 会把透明像素渲染成黑色，
//   Android 的 maskable 图标四角会被系统裁掉，两者都要求背景满幅不透明。
// - 白色 M 居中；maskable 版本的 M 再缩小一档，保证落在安全区（直径 80% 的圆）内。
// - 尺寸：192 / 512（any）、180（apple-touch-icon）、512（maskable）。

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findBrowser } from './lib/find-browser.mjs'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_DIR = join(PROJECT_ROOT, 'public')
const BRAND_COLOR = '#a11b4a'
const GLYPH_COLOR = '#fff8fb'

/**
 * 图标规格。`glyphScale` 是 M 相对于 favicon 原始比例的缩放：
 * favicon 的 M 占 32 格中的 16×13.5，其半对角线约为画布宽度的 32.7%，
 * 已经落在 maskable 安全区（半径 40%）之内，所以 any 版本用 1；maskable 再留余量用 0.82。
 */
const TARGETS = [
  { file: 'icons/icon-192.png', size: 192, glyphScale: 1 },
  { file: 'icons/icon-512.png', size: 512, glyphScale: 1 },
  { file: 'icons/icon-maskable-512.png', size: 512, glyphScale: 0.82 },
  { file: 'apple-touch-icon.png', size: 180, glyphScale: 1 },
]

/** 与 favicon.svg 同源的几何：32 格坐标系里的圆角矩形 + M 折线。 */
function buildSvg(size, glyphScale) {
  const unit = 32
  const scale = (size / unit) * glyphScale
  const offset = (size - unit * scale) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BRAND_COLOR}" />
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="M8 23V9.5l8 8.5 8-8.5V23" fill="none" stroke="${GLYPH_COLOR}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  </g>
</svg>`
}

function buildHtml(svg, size) {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; width: ${size}px; height: ${size}px; background: transparent; }
  svg { display: block; }
</style>
${svg}
`
}

/** 读 PNG 的 IHDR，确认渲染出来的就是目标尺寸（Chrome 的缩放策略变了要立刻发现）。 */
function readPngSize(buffer) {
  const signature = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== signature) throw new Error('产物不是 PNG。')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function render(browserPath, htmlPath, outPath, size) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      browserPath,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        '--force-device-scale-factor=1',
        `--window-size=${size},${size}`,
        `--screenshot=${outPath}`,
        pathToFileURL(htmlPath).href,
      ],
      { stdio: 'ignore' },
    )
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`浏览器退出码 ${code}`))))
  })
}

async function main() {
  const browserPath = findBrowser()
  const workDir = join(tmpdir(), `molly-icons-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  mkdirSync(join(OUTPUT_DIR, 'icons'), { recursive: true })

  try {
    for (const target of TARGETS) {
      const svg = buildSvg(target.size, target.glyphScale)
      const htmlPath = join(workDir, `${target.size}-${target.glyphScale}.html`)
      const outPath = join(OUTPUT_DIR, target.file)
      writeFileSync(htmlPath, buildHtml(svg, target.size))
      rmSync(outPath, { force: true })
      await render(browserPath, htmlPath, outPath, target.size)

      const buffer = readFileSync(outPath)
      const actual = readPngSize(buffer)
      if (actual.width !== target.size || actual.height !== target.size) {
        throw new Error(`${target.file} 尺寸不对：期望 ${target.size}×${target.size}，实际 ${actual.width}×${actual.height}`)
      }
      console.log(`OK  public/${target.file}  ${actual.width}×${actual.height}  ${buffer.length} 字节`)
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('生成图标失败：', error.message)
  process.exitCode = 1
})
