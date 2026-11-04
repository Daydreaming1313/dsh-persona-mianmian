/**
 * 两件事：
 *  A. 在隔离的 DSH_HOME 里真的跑一次 `dsh plugin add` + `--dump-config`，
 *     验证 bundle 声明、cordis.patch.yml 与 profile 装配链路（不动用户现有 profile）。
 *  B. 用 mock 宿主加载插件，验证注册项、命令、agent 事件链路与卸载清理。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TMP = join(ROOT, 'tests', '.tmp')
const HOME = join(TMP, 'dsh-home-verify')
mkdirSync(TMP, { recursive: true })
rmSync(HOME, { recursive: true, force: true })
mkdirSync(HOME, { recursive: true })

const env = { ...process.env, DSH_HOME: HOME }
const run = (args) => spawnSync('dsh', args, {
  env, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120_000,
})

// ---- A. 真实 dsh 安装链路 -------------------------------------------------
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'package.json 缺少 dsh.bundle.patch')
const patchPath = join(ROOT, 'cordis.patch.yml')
assert.ok(existsSync(patchPath), 'bundle patch 文件不存在')
const patch = readFileSync(patchPath, 'utf8')
assert.match(patch, /-\s*insert:/, 'bundle patch 必须含 - insert 行')
assert.match(patch, /name:\s*dsh-persona-mianmian/, 'bundle patch 未指向本包')
for (const f of pkg.files.filter((x) => ['lib', 'persona'].includes(x))) {
  assert.ok(existsSync(join(ROOT, f)), `npm 包缺少 ${f}`)
}
assert.ok(existsSync(join(ROOT, 'lib', 'index.js')), 'lib/index.js 未构建，GitHub 安装会失败')
console.log('[verify] package.json / bundle patch / 预构建 lib 检查通过')

const added = run(['plugin', '--profile', 'web', 'add', `file:${ROOT}`])
if (added.status !== 0) {
  console.error(added.stdout || '')
  console.error(added.stderr || '')
  throw new Error('dsh plugin add 失败')
}
const profilePkg = JSON.parse(readFileSync(join(HOME, 'profiles', 'web', 'package.json'), 'utf8'))
assert.ok(profilePkg.dsh?.profile?.bundles?.includes('dsh-persona-mianmian'),
  'dsh plugin add 没有把包注册进 dsh.profile.bundles')
console.log('[verify] dsh plugin add 已把插件加入 profile bundles')

const dumped = run(['--profile', 'web', '--dump-config'])
if (dumped.status !== 0) {
  console.error(dumped.stdout || '')
  console.error(dumped.stderr || '')
  throw new Error('dsh --dump-config 失败')
}
const config = dumped.stdout
assert.match(config, /#\s*==\s*dsh-persona-mianmian/, '配置树里没有本插件的 bundle 段')
assert.match(config, /-\s*id:\s*mianmian/, '配置树里没有 mianmian 插件行')
assert.match(config, /name:\s*dsh-persona-mianmian/, '配置树里的插件名不对')
assert.match(config, /mode:\s*persona-only/, 'bundle 的 config 没有被装配进配置树')
assert.match(config, /cycleLength:\s*28/, 'bundle 的 config 没有被装配进配置树')
console.log('[verify] --dump-config 输出含完整 mianmian 插件行，真实安装链路通过')

// ---- B. mock 宿主：注册项 / 命令 / 事件 / 卸载 -----------------------------
const mm = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
const sections = []
const contexts = []
const variables = []
const commands = []
const disposed = []
const listeners = new Map()

const systemPrompt = {
  section(s) { sections.push(s); return () => disposed.push(`section:${s.name}`) },
  context(c) { contexts.push(c); return () => disposed.push(`context:${c.name}`) },
  variable(n, p) { variables.push([n, p]); return () => disposed.push(`var:${n}`) },
}
const commandService = {
  register(d) { commands.push(d); return () => disposed.push(`cmd:${d.name}`) },
}
const agents = { list: () => [] }
const effects = []
const ctx = {
  get(name) {
    return { systemPrompt, commands: commandService, agents }[name]
  },
  effect(fn, label) {
    const d = fn()
    effects.push({ label, dispose: d })
    return d
  },
  on(event, handler) {
    listeners.set(event, handler)
    return () => listeners.delete(event)
  },
  logger: { warn() {} },
}

mm.apply(ctx, {
  hotReload: false,
  stateDir: join(TMP, 'mock-state'),
  seed: 42,
  registerCommands: true,
})

assert.equal(sections.length, 2, '应注册 persona + rules 两个 section')
assert.equal(contexts.length, 1, '应注册一个运行时 context')
assert.equal(variables.length, 2, '应注册 channel + tone 两个变量')
assert.ok(sections.every((s) => !s.complete), '绝不允许使用 complete: true')
assert.ok(sections.every((s) => Number.isFinite(s.order)), 'section order 必须是有限数')
assert.ok(sections.every((s) => typeof s.name === 'string' && s.name.startsWith('mianmian:')))
assert.equal(typeof contexts[0].text(), 'string')
assert.ok(contexts[0].text().length > 0, 'context 首次求值不得为空')
assert.ok(contexts[0].text().includes('{{channel}}'), 'context 应引用已注册变量')
assert.equal(variables[0][0], 'channel')
assert.equal(variables[1][0], 'tone')
assert.equal(variables[0][1](), 'text')
assert.ok(['偏暖', '偏冷', '平'].includes(variables[1][1]()))
assert.ok(commands.length >= 4, `命令数偏少: ${commands.map((c) => c.name)}`)
assert.ok(commands.every((c) => /^[a-z][a-z0-9_-]*$/.test(c.name)), '命令名必须符合 DSH 语法')
console.log('[verify] mock 宿主注册项:', sections.map((s) => s.name).join(', '), '| 命令:', commands.map((c) => c.name).join(', '))

const status = commands.find((c) => c.name === 'mianmian-status')
const statusResult = await status.handler({ rawInput: '' })
assert.equal(statusResult.kind, 'success')
assert.ok(!/经期第|第\d+天/.test(statusResult.text), '状态命令输出不该有报数式表述')
const channel = commands.find((c) => c.name === 'mianmian-channel')
assert.equal((await channel.handler({ rawInput: ' voice ' })).kind, 'success')
assert.equal(variables[0][1](), 'voice')
assert.equal((await channel.handler({ rawInput: '不合法' })).kind, 'error')
await channel.handler({ rawInput: 'text' })
console.log('[verify] 命令处理器通过')

const created = listeners.get('agent/created')
assert.ok(created, '未监听 agent/created')
const agentListeners = new Map()
const agentCtx = {
  on(event, handler) {
    agentListeners.set(event, handler)
    return () => agentListeners.delete(event)
  },
}
created({ agent: { ctx: agentCtx, session: { id: 'session-1' } } })
const inbox = agentListeners.get('agent/inbox/inserted')
assert.ok(inbox, '未给 agent 挂 agent/inbox/inserted')
const before = contexts[0].text()
inbox({ message: { content: [{ type: 'text', text: '今天下班好累 刚到家' }, { type: 'reasoning', text: '内部思考' }] } })
const after = contexts[0].text()
assert.notEqual(after, before, '用户消息没有推进状态并刷新运行时上下文')
assert.ok(after.includes('内部状态记录'))
const stateFile = join(TMP, 'mock-state', 'state.json')
assert.ok(existsSync(stateFile), 'state 没有落盘')
const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
assert.ok(saved.turn >= 1, 'state.turn 没有推进')
assert.equal(saved.lastUserText, '今天下班好累 刚到家')
console.log('[verify] agent 事件链路与 state 落盘通过')

for (const e of effects) {
  if (typeof e.dispose === 'function') e.dispose()
}
assert.ok(disposed.includes('section:mianmian:persona'), '卸载时没有撤销 section')
assert.ok(disposed.includes('context:mianmian:runtime'), '卸载时没有撤销 context')
assert.ok(disposed.some((x) => x.startsWith('cmd:')), '卸载时没有撤销命令')
console.log('[verify] 卸载清理通过')

console.log('[verify] ALL PASS')
