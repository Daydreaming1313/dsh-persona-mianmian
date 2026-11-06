/**
 * 两件事：
 *  A. 在隔离的 DSH_HOME 里真的跑一次 `dsh plugin add` + `--dump-config`，
 *     验证 bundle 声明、cordis.patch.yml 与 profile 装配链路（不动用户现有 profile）。
 *  B. 用 mock 宿主加载 v3 插件，验证注册项、ASCII 工具、事件链路与卸载清理。
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
for (const f of ['lib', 'persona', 'schema', 'fixtures']) {
  assert.ok(existsSync(join(ROOT, f)), `npm 包缺少 ${f}`)
}
assert.ok(existsSync(join(ROOT, 'lib', 'index.js')), 'lib/index.js 未构建，GitHub 安装会失败')
assert.ok(existsSync(join(ROOT, 'schema', 'state.schema.json')), 'state.schema.json 未打包')
console.log('[verify] package.json / bundle patch / schema / 预构建 lib 检查通过')

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
assert.match(config, /cycleLength:\s*28/, 'bundle 的 config 没有被装配进配置树')
console.log('[verify] --dump-config 输出含完整 mianmian 插件行，真实安装链路通过')

// ---- B. mock 宿主：注册项 / 工具 / 事件 / 卸载 -----------------------------
const mm = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
const sections = []
const variables = []
const commands = []
const disposed = []
const listeners = new Map()
const effects = []

const systemPrompt = {
  section(s) { sections.push(s); return () => disposed.push(`section:${s.name}`) },
  context(c) { return () => disposed.push(`context:${c.name}`) },
  variable(n, p) { variables.push([n, p]); return () => disposed.push(`var:${n}`) },
}
const commandService = {
  register(d) { commands.push(d); return () => disposed.push(`cmd:${d.name}`) },
}
const ctx = {
  get(name) {
    return { systemPrompt, commands: commandService, agents: { list: () => [] } }[name]
  },
  effect(fn, label) { const d = fn(); effects.push({ label, dispose: d }); return d },
  on(event, handler) { listeners.set(event, handler); return () => listeners.delete(event) },
  logger: { warn() {}, info() {} },
}

mm.apply(ctx, {
  dataDir: join(TMP, 'mock-state-v3'),
  hotReload: false,
  seed: 42,
  registerCommands: true,
  persistDebounceMs: 0,
})

assert.equal(sections.length, 3, `应注册 persona + anchor + degraded 三个 section，实际 ${sections.length}`)
assert.equal(variables.length, 1, '应注册 mianmian_mood 一个变量')
assert.ok(sections.every((s) => !s.complete), '绝不允许使用 complete: true')
assert.ok(sections.every((s) => Number.isFinite(s.order)), 'section order 必须是有限数')
assert.ok(sections.every((s) => s.name.startsWith('mianmian:')), 'section 必须加 mianmian: 前缀')
assert.ok(sections.every((s) => s.interpolate === false), '含台账原文的段必须 interpolate:false')
assert.equal(variables[0][0], 'mianmian_mood')
assert.equal(typeof variables[0][1](), 'string')
assert.ok(commands.length >= 6, `工具数偏少: ${commands.map((c) => c.name)}`)
assert.ok(commands.every((c) => /^[a-z][a-z0-9_-]*$/.test(c.name)), '工具名必须匹配 COMMAND_NAME')
assert.ok(commands.every((c) => !/[\u4e00-\u9fa5]/.test(c.name)), '工具名不得含中文（T-27）')
console.log('[verify] mock 宿主注册项:', sections.map((s) => s.name).join(', '), '| 工具:', commands.map((c) => c.name).join(', '))

// T-27 哨兵：中文名不可注册（验证 COMMAND_NAME 正则本身）
assert.equal(/^[a-z][a-z0-9_-]*$/u.test('锚'), false)
assert.equal(/^[a-z][a-z0-9_-]*$/u.test('mianmian_anchor'), true)
console.log('[verify] T-27 中文命令名约束 ✓')

// 工具处理器
const anchorCmd = commands.find((c) => c.name === 'mianmian_anchor')
const anchorResult = await anchorCmd.handler({ rawInput: '' })
assert.equal(anchorResult.kind, 'success')
assert.ok(anchorResult.text.includes('【她记得的事'))
const tierCmd = commands.find((c) => c.name === 'mianmian_tier')
const tierResult = await tierCmd.handler({ rawInput: '' })
assert.ok(tierResult.text.includes('关系档位'))
assert.equal((await tierCmd.handler({ rawInput: '3' })).kind, 'error', 'allowTierSet 默认 false，应拒绝写入')
const resetCmd = commands.find((c) => c.name === 'mianmian_reset')
assert.equal((await resetCmd.handler({ rawInput: '' })).kind, 'error', 'reset 需二次确认')
console.log('[verify] 工具处理器通过')

// 事件链路：agent/created → 给 agent.ctx 挂 agent/inbox/inserted
const created = listeners.get('agent/created')
assert.ok(created, '未监听 agent/created')
const agentListeners = new Map()
const agentCtx = {
  on(event, handler) { agentListeners.set(event, handler); return () => agentListeners.delete(event) },
}
created({ agent: { ctx: agentCtx, session: { id: 'session-1' }, id: 'session-1' } })
const inbox = agentListeners.get('agent/inbox/inserted')
assert.ok(inbox, '未给 agent 挂 agent/inbox/inserted')
inbox({ agent: { id: 'session-1' }, message: { content: [{ type: 'text', text: '早上想吃油条 明天给你看' }, { type: 'reasoning', text: '内部思考' }] } })
const stateFile = join(TMP, 'mock-state-v3', 'state.json')
assert.ok(existsSync(stateFile), 'state 没有落盘')
const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
assert.ok(saved.turn >= 1, 'state.turn 没有推进')
assert.equal(saved.version, 3)
assert.ok(saved.ledger.facts.some((f) => f.text.includes('油条')), '事实没有被抽进台账')
console.log('[verify] agent 事件链路 / 事实抽取 / state 落盘通过')

// 只读观测助手输出 → guard 记 drift
const sessionEvent = agentListeners.get('session/event')
assert.ok(sessionEvent, '未挂 session/event')
sessionEvent({ id: 'session-1' }, {
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text: '作为一个 AI 我没有情绪' }] } },
})
const afterGuard = JSON.parse(readFileSync(stateFile, 'utf8'))
assert.ok(afterGuard.drift.some((d) => d.kind === '身份'), '身份违例未记入 drift')
assert.equal(afterGuard.degradeLevel, 3, '身份声明应直通 L3')
console.log('[verify] 只读观测 → guard → drift / L3 通过')

for (const e of effects) {
  if (typeof e.dispose === 'function') e.dispose()
}
assert.ok(disposed.includes('section:mianmian:persona'), '卸载时没有撤销 section')
assert.ok(disposed.some((x) => x.startsWith('cmd:')), '卸载时没有撤销工具')
console.log('[verify] 卸载清理通过')

console.log('[verify] ALL PASS')
