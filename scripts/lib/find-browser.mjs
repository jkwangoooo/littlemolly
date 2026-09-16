// 浏览器定位：验收 / 图标生成脚本共用。
//
// 为什么单独抽出来：在 Git Bash 里 `ProgramFiles` / `ProgramFiles(x86)` 这两个环境变量
// **可能根本不存在**（Windows 原生环境变量没被导出到 MSYS 环境），
// 而 Chrome 的默认安装路径就挂在它们下面。只按环境变量拼路径会得到「未找到 Chrome」，
// 于是把「本机装了浏览器」误判成「本机没有浏览器」。这里补上绝对路径兜底。

import { existsSync } from 'node:fs'

/** 相对 Program Files 根目录的浏览器路径（含 Windows 与 MSYS 两种写法）。 */
const BROWSER_RELATIVE_PATHS = [
  'Google/Chrome/Application/chrome.exe',
  'Microsoft/Edge/Application/msedge.exe',
]

/** 即使环境变量缺失也能命中的绝对路径。 */
const BROWSER_ABSOLUTE_PATHS = [
  '/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/c/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

export function findBrowser() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)
  const candidates = [
    process.env.CHROME_PATH,
    ...roots.flatMap((root) =>
      BROWSER_RELATIVE_PATHS.map((relative) => `${root.replace(/[\\/]+$/, '')}/${relative}`),
    ),
    ...BROWSER_ABSOLUTE_PATHS,
  ].filter(Boolean)

  const found = candidates.find((path) => existsSync(path))
  if (!found) throw new Error('未找到 Chrome / Edge，请用 CHROME_PATH 指定浏览器可执行文件。')
  return found
}
