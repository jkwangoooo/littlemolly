// 让 Node 也能解析「不带扩展名」的相对导入。
//
// 为什么需要它：源码按前端习惯写成 `import { assertRecord } from './recordSchemas'`
// （Vite 能解析，tsc 也能解析），但 Node 的原生「剥离类型」只按真实文件路径找模块，
// 不会自动补 `.ts`。于是 `npm run check:local-data` 会报 ERR_MODULE_NOT_FOUND。
//
// 三种解法里选了最不侵入的一种：
// 1. 给源码加 `.ts` 扩展名 —— 需要在 tsconfig 打开 allowImportingTsExtensions，
//    为测试便利去改生产配置，不划算；
// 2. 让脚本 import 构建产物 —— 违背「回归脚本不依赖构建产物」的既有约定；
// 3. 注册解析钩子（本文件）—— 零依赖，只影响跑脚本的进程，源码与配置都不动。
//
// 用法：在被测模块之前静态导入本文件，并确保后续用 `await import(...)` 动态加载：
//   import './ts-resolve.mjs'
//   const { LOCAL_SCHEMA } = await import('../src/services/local/localDb.ts')
//
// 注意：只有「相对路径且没有扩展名」才走补全，裸模块名（react 等）不碰。

import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.mjs', '.js']

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
    const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier)
    if (!isRelative || hasExtension || !context.parentURL) {
      return nextResolve(specifier, context)
    }
    for (const suffix of SUFFIXES) {
      const candidate = new URL(`${specifier}${suffix}`, context.parentURL)
      if (candidate.protocol === 'file:' && existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})