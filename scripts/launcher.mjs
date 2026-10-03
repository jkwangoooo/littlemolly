#!/usr/bin/env node
/**
 * 幸福小Molly · 快捷启动器
 *
 * 只做一件事：把项目里已有的 npm 脚本收成一个菜单，按序号执行。
 * 不改动任何业务代码、配置或依赖，也不新增 npm 脚本。
 *
 * 用法：
 *   双击项目根目录的 launch.cmd        → 交互式菜单
 *   node scripts/launcher.mjs          → 同上（在终端里）
 *   node scripts/launcher.mjs dev      → 直接执行某个任务，跑完即退出
 *   node scripts/launcher.mjs --list   → 列出全部任务 ID
 *   node scripts/launcher.mjs --help   → 帮助
 *
 * 环境变量：
 *   NO_COLOR=1   关闭彩色输出
 */

import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const IS_WIN = process.platform === 'win32';
const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (text) => (USE_COLOR ? `\u001b[${code}m${text}\u001b[0m` : String(text));
const bold = paint('1');
const dim = paint('2');
const cyan = paint('36');
const green = paint('32');
const red = paint('31');
const yellow = paint('33');

/** 拼一条 npm 脚本步骤 */
const npm = (script, ...extra) => ({ cmd: 'npm', args: ['run', script, ...extra] });

// ── 任务表 ────────────────────────────────────────────────────────────────
// steps 里每条命令按顺序执行；前一条失败就中止，不继续往下跑。
const TASKS = [
  {
    no: 1,
    id: 'dev',
    aliases: ['dev'],
    group: '开发',
    label: '启动开发服务器',
    note: '自动打开浏览器 · 127.0.0.1:8800 · Ctrl+C 停止',
    steps: [npm('dev', '--', '--open')],
    needsInstall: true,
  },
  {
    no: 2,
    id: 'preview',
    aliases: ['preview'],
    group: '开发',
    label: '预览生产构建（vite preview）',
    note: '需要先跑过一次「生产构建」',
    steps: [npm('preview')],
    needsInstall: true,
  },
  {
    no: 3,
    id: 'build',
    aliases: ['build'],
    group: '构建',
    label: '生产构建（→ dist/）',
    note: 'tsc -b && vite build',
    steps: [npm('build')],
    needsInstall: true,
  },
  {
    no: 4,
    id: 'icons',
    aliases: ['icons'],
    group: '构建',
    label: '重新生成 PWA 图标',
    note: '由 public/favicon.svg 渲染出四张 PNG',
    steps: [npm('icons')],
    needsInstall: true,
  },
  {
    no: 5,
    id: 'check',
    aliases: ['check', 'quick'],
    group: '质量与验收',
    label: '快速自检（typecheck + lint）',
    note: '改完代码先跑这个',
    steps: [npm('typecheck'), npm('lint')],
    needsInstall: true,
  },
  {
    no: 6,
    id: 'checks',
    aliases: ['checks', 'regress'],
    group: '质量与验收',
    label: '静态回归五件套（无需浏览器）',
    note: 'dates 48 · local-data 62 · backup 62 · cloud-parity 78 · sync 113',
    steps: [
      npm('check:dates'),
      npm('check:local-data'),
      npm('check:backup'),
      npm('check:cloud-parity'),
      npm('check:sync'),
    ],
    needsInstall: true,
  },
  {
    no: 7,
    id: 'check:sync',
    aliases: ['checksync', 'check-sync', 'sync'],
    group: '质量与验收',
    label: '同步队列规则回归（check:sync）',
    note: '113 项 · 纯函数：入队范围 / 压缩 / 层级排序 / 绑定情形 / 映射与文案 / 账号归属 / 快照过 parseBackup',
    steps: [npm('check:sync')],
    needsInstall: true,
  },
  {
    no: 8,
    id: 'verify:local',
    aliases: ['verify', 'verifylocal', 'verify-local'],
    group: '质量与验收',
    label: '浏览器闭环验收（verify:local）',
    note: '125 项 · 自带临时开发服务器与无头浏览器',
    steps: [npm('verify:local')],
    needsInstall: true,
  },
  {
    no: 9,
    id: 'verify:pwa',
    aliases: ['verifypwa', 'verify-pwa', 'pwa'],
    group: '质量与验收',
    label: 'PWA 验收（verify:pwa）',
    note: '49 项 · 跑生产构建产物',
    steps: [npm('verify:pwa')],
    needsInstall: true,
  },
  {
    no: 10,
    id: 'verify:sync',
    aliases: ['verifysync', 'verify-sync', 'sync-e2e'],
    group: '质量与验收',
    label: '同步闭环验收（verify:sync）',
    note: '74 项 · 假云端 + CDP 拦截：自动推送 / 断网补推 / 失败如实显示 / 换账号不串推 / 双向整体替换',
    steps: [npm('verify:sync')],
    needsInstall: true,
  },
  {
    no: 11,
    id: 'verify:sql',
    aliases: ['verifysql', 'verify-sql', 'sql', 'db'],
    group: '质量与验收',
    label: '云端 SQL 真库验收（verify:sql）',
    note: '39 项 · 需要本机装 PostgreSQL 16+：起临时集群 → 真跑 6 个迁移 → 三个 RPC 往返 + RLS 双账号隔离',
    steps: [npm('verify:sql')],
  },
  {
    no: 12,
    id: 'all',
    aliases: ['all', 'full'],
    group: '质量与验收',
    label: '全量验收（构建 + 五件套 + 三个 verify）',
    note: '耗时较长（数分钟），适合交付前跑一次 · 不含第 11 项（那项需要本机 PostgreSQL）',
    steps: [
      npm('build'),
      npm('check:dates'),
      npm('check:local-data'),
      npm('check:backup'),
      npm('check:cloud-parity'),
      npm('check:sync'),
      npm('verify:local'),
      npm('verify:pwa'),
      npm('verify:sync'),
    ],
    needsInstall: true,
  },
  {
    no: 13,
    id: 'install',
    aliases: ['install', 'i'],
    group: '维护',
    label: '安装 / 更新依赖',
    note: 'npm install',
    steps: [{ cmd: 'npm', args: ['install'] }],
  },
  {
    no: 14,
    id: 'git',
    aliases: ['git', 'status'],
    group: '维护',
    label: '查看 Git 状态与最近提交',
    note: 'git status + git log -5',
    steps: [
      { cmd: 'git', args: ['status', '--short', '--branch'] },
      { cmd: 'git', args: ['log', '--oneline', '-5'] },
    ],
  },
  {
    no: 15,
    id: 'open',
    aliases: ['open', 'folder'],
    group: '维护',
    label: '在文件管理器中打开项目目录',
    note: ROOT,
    steps: [
      IS_WIN
        ? { cmd: 'explorer', args: [ROOT], ignoreExitCode: true }
        : process.platform === 'darwin'
          ? { cmd: 'open', args: [ROOT], ignoreExitCode: true }
          : { cmd: 'xdg-open', args: [ROOT], ignoreExitCode: true },
    ],
  },
];

const BY_NO = new Map(TASKS.map((t) => [String(t.no), t]));

/** 只在真正的终端里等回车——被脚本/CI 调用时直接返回，绝不挂住 */
async function pressEnter(message) {
  if (!process.stdin.isTTY) return;
  const tmp = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await tmp.question(message);
  } finally {
    tmp.close();
  }
}

function findTask(key) {
  const k = String(key).trim().toLowerCase();
  if (BY_NO.has(k)) return BY_NO.get(k);
  return TASKS.find((t) => t.id.toLowerCase() === k || t.aliases.includes(k)) ?? null;
}

// ── 输出辅助 ──────────────────────────────────────────────────────────────

let npmVersionCache;
function npmVersion() {
  if (npmVersionCache !== undefined) return npmVersionCache;
  const r = spawnSync('npm', ['-v'], { encoding: 'utf8', shell: IS_WIN });
  npmVersionCache = r.status === 0 ? r.stdout.trim() : null;
  return npmVersionCache;
}

const hasDeps = () => existsSync(path.join(ROOT, 'node_modules', 'vite'));

function header() {
  const deps = hasDeps() ? green('依赖已安装') : red('依赖未安装');
  const ver = npmVersion();
  console.log('');
  console.log(`  ${bold(cyan('幸福小Molly'))}${dim('  ·  快捷启动器')}`);
  console.log(`  ${dim(ROOT)}`);
  console.log(`  ${dim(`node ${process.version}  ·  npm ${ver ?? '未检测到'}  ·  `)}${deps}`);
  console.log('');
}

function printMenu() {
  header();
  let currentGroup = null;
  for (const t of TASKS) {
    if (t.group !== currentGroup) {
      currentGroup = t.group;
      console.log(`  ${bold(t.group)}`);
    }
    console.log(`   ${bold(String(t.no).padStart(2))}) ${t.label}`);
    if (t.note) console.log(`       ${dim(t.note)}`);
  }
  console.log(`   ${bold(' 0')}) 退出`);
  console.log('');
}

function printList() {
  console.log('');
  console.log('  可用任务：');
  for (const t of TASKS) {
    console.log(`   ${String(t.no).padStart(2)}  ${t.id.padEnd(14)} ${t.label}`);
  }
  console.log('');
  console.log('  用法：node scripts/launcher.mjs <编号|任务ID>');
  console.log('');
}

function printHelp() {
  header();
  console.log('  用法：');
  console.log('    双击项目根目录的 launch.cmd    打开菜单');
  console.log('    node scripts/launcher.mjs      打开菜单');
  console.log('    node scripts/launcher.mjs 8    直接执行第 8 项（verify:local）');
  console.log('    node scripts/launcher.mjs verify:local   用任务 ID 指定');
  console.log('    node scripts/launcher.mjs --list         列出全部任务');
  console.log('');
  printList();
}

// ── 执行 ──────────────────────────────────────────────────────────────────

/** 跑一条 shell 命令，继承当前终端的输入输出 */
function runStep(step) {
  const pretty = [step.cmd, ...step.args].join(' ');
  console.log(`\n  ${cyan('▶')} ${pretty}`);
  const result = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: IS_WIN });
  if (result.error) {
    console.log(`  ${red('✖')} 无法启动命令：${result.error.message}`);
    return false;
  }
  if (result.status !== 0 && !step.ignoreExitCode) {
    console.log(`  ${red('✖')} 失败（退出码 ${result.status ?? '未知'}）：${pretty}`);
    return false;
  }
  return true;
}

/** 执行一个任务；返回是否全部成功 */
function runTask(task) {
  console.log(`\n  ${bold(task.label)}`);
  if (task.note) console.log(`  ${dim(task.note)}`);

  if (task.needsInstall && !hasDeps()) {
    console.log(`\n  ${red('✖')} 依赖没装（找不到 node_modules/vite），请先执行第 13 项「安装 / 更新依赖」。`);
    return false;
  }

  const started = Date.now();
  let done = 0;
  for (const step of task.steps) {
    if (!runStep(step)) {
      const left = task.steps.length - done - 1;
      if (left > 0) console.log(`  ${yellow('!')} 已中止后续 ${left} 步。`);
      return false;
    }
    done += 1;
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n  ${green('✔')} 完成：${task.label}${dim(`（${secs}s）`)}`);
  return true;
}

// ── 主流程 ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('-'));
const requested = argv.find((a) => !a.startsWith('-'));

if (flags.includes('--help') || flags.includes('-h')) {
  printHelp();
  process.exit(0);
}
if (flags.includes('--list') || flags.includes('-l')) {
  printList();
  process.exit(0);
}

if (requested) {
  const task = findTask(requested);
  if (!task) {
    console.error(`\n  ${red('✖')} 没有这个任务：${requested}`);
    printList();
    await pressEnter(dim('  按回车关闭…'));
    process.exit(2);
  }
  const ok = runTask(task);
  if (!ok) {
    console.log(`\n  ${red('✖')} 任务未通过：${task.label}`);
    await pressEnter(dim('  按回车关闭窗口…'));
  }
  process.exit(ok ? 0 : 1);
}

process.on('SIGINT', () => {
  console.log('\n  已退出。');
  process.exit(130);
});

const rl = createInterface({ input: process.stdin, output: process.stdout });
// 输入流结束（管道、Ctrl+D）时直接退出，避免卡在等待输入上
rl.on('close', () => process.exit(0));

while (true) {
  printMenu();
  const answer = (await rl.question(`  ${bold('请选择')} ${dim('(输入序号，回车确认)')} > `)).trim();

  if (answer === '' ) continue;
  if (answer === '0' || answer.toLowerCase() === 'q' || answer.toLowerCase() === 'exit') {
    console.log('\n  再见。\n');
    process.exit(0);
  }

  const task = findTask(answer);
  if (!task) {
    console.log(`\n  ${red('✖')} 无效输入：${answer}`);
    continue;
  }

  runTask(task);
  await rl.question(dim('\n  按回车返回菜单…'));
}

