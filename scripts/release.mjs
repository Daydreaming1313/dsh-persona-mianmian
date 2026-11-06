/**
 * 本地一键打包。默认只产出 tarball 并打印上传命令，绝不偷偷执行外部发布。
 *   node scripts/release.mjs              # 构建 + 全量测试 + 打包到 dist/
 *   node scripts/release.mjs --skip-test  # 跳过测试（CI 已跑过时）
 *   node scripts/release.mjs --publish    # 额外执行 npm publish（需已 npm login）
 *
 * GitHub 上传始终交给 git push：
 *   git remote add origin https://github.com/<owner>/dsh-persona-mianmian.git
 *   git push -u origin main --tags
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(ROOT, 'dist')
const args = new Set(process.argv.slice(2))
const shell = process.platform === 'win32'

function run(cmd, cmdArgs, options = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: ROOT, encoding: 'utf8', shell, stdio: 'inherit', ...options,
  })
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} 失败`)
  return r
}

function capture(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, {
    cwd: ROOT, encoding: 'utf8', shell,
  }).trim()
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
console.log(`[release] ${pkg.name}@${pkg.version}`)

console.log('[release] 1/4 构建')
run('npm', ['run', 'build'])

if (!existsSync(join(ROOT, 'lib', 'index.js'))) throw new Error('lib/index.js 缺失，禁止发布')
for (const f of ['core.md', 'background.md', 'relationship.md', 'rhythm.md', 'language.md', 'memory.md', 'examples.md']) {
  if (!existsSync(join(ROOT, 'persona', f))) throw new Error(`persona/${f} 缺失`)
}
for (const f of ['state.schema.json', 'ledger.schema.json']) {
  if (!existsSync(join(ROOT, 'schema', f))) throw new Error(`schema/${f} 缺失`)
}

if (!args.has('--skip-test')) {
  console.log('[release] 2/4 全量评测')
  run('bash', ['tests/run.sh'])
} else {
  console.log('[release] 2/4 跳过评测（--skip-test）')
}

console.log('[release] 3/4 校验 npm 包内容')
const packInfo = JSON.parse(capture('npm', ['pack', '--dry-run', '--json']))
const files = new Set((packInfo[0]?.files ?? []).map((f) => f.path))
const required = [
  'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'manifest.json',
  'cordis.patch.yml', 'lib/index.js', 'lib/state.js', 'lib/anchor.js',
  'lib/v1/engine.js', 'lib/v1/legacy.js',
  'persona/core.md', 'persona/memory.md', 'persona/examples.md',
  'schema/state.schema.json', 'schema/ledger.schema.json',
  'fixtures/state.example.json',
  'tests/eval/cases.json', 'tests/eval/judge.ts',
  'tests/ledger.test.ts', 'tests/anchor.test.ts', 'tests/guard.test.ts',
  'tests/degrade.test.ts', 'tests/body.test.ts', 'tests/run.sh',
]
for (const f of required) {
  if (!files.has(f)) throw new Error(`npm 包缺少必需文件: ${f}`)
}
const leaked = [...files].filter((f) => /node_modules|\/\.tmp\/|^dist\//.test(f))
if (leaked.length) {
  throw new Error(`npm 包混入了临时/依赖目录，共 ${leaked.length} 项，例如 ${leaked.slice(0, 3).join(', ')}`)
}
// v3 有 16 个机制模块 + 13 个 v1 规则库模块，各自 .js/.d.ts，加上 persona 七件套、
// schema、tests，正常体量约 146。阈值防止误把 node_modules / .tmp 递归打进来。
if (files.size > 200) throw new Error(`包内文件数异常: ${files.size}，请检查 files 白名单`)
console.log(`[release] 包内文件 ${files.size} 个，必需文件齐全，无临时目录泄漏`)

mkdirSync(DIST, { recursive: true })
console.log('[release] 4/4 生成 tarball')
run('npm', ['pack', '--pack-destination', DIST])
const tarball = join(DIST, `${pkg.name}-${pkg.version}.tgz`)
if (!existsSync(tarball)) throw new Error(`tarball 未生成: ${tarball}`)

console.log('')
console.log(`[release] 产物: ${tarball}`)
console.log('[release] 接下来的上传命令（需要你自己的凭据）：')
console.log(`  git tag v${pkg.version}`)
console.log('  git remote add origin https://github.com/Daydreaming1313/dsh-persona-mianmian.git')
console.log('  git push -u origin main --tags')
console.log(`  npm publish ${tarball} --access public      # 或打 tag 后由 GitHub Actions 自动发布`)

if (args.has('--publish')) {
  console.log('')
  console.log('[release] --publish：检查 npm 凭据')
  const who = spawnSync('npm', ['whoami'], { cwd: ROOT, encoding: 'utf8', shell })
  if (who.status !== 0) {
    console.error('[release] npm 未登录（npm whoami 失败）。请先 npm login，或改用 NPM_TOKEN + GitHub Actions。')
    process.exit(1)
  }
  run('npm', ['publish', tarball, '--access', 'public'])
  console.log('[release] npm 发布完成')
} else {
  console.log('[release] 未加 --publish，未执行任何外部发布动作。')
}
