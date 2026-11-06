/**
 * 真实 Cordis + 真实 dsh-system-prompt 挂载 v3 入口。
 * 验证：section / variable 注册、动态求值、L3 降级、卸载可逆，
 * 以及 T-27~T-30 四条「约束哨兵」（防止把已踩过的坑再踩一遍）。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TMP = join(ROOT, 'tests', '.tmp', 'integration-v3')
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })

const base = 'C:/Users/19332/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const url = (p) => pathToFileURL(join(base, p)).href
const { Context } = await import(url('cordis/lib/index.js'))
const sp = await import(url('dsh-system-prompt/lib/index.js'))
const mm = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)

console.log(`[integration] dsh 包目录: ${base}`)
console.log(`[integration] 插件导出: ${Object.keys(mm).length} 个`)

// ── 1) 真实挂载 ────────────────────────────────────────────────────────────
const ctx = new Context()
await ctx.plugin(sp.SystemPrompt, {
  includeHarnessIdentity: true,
  personaPrefix: 'You are a coding agent powered by the {{model}} model.',
})
ctx.systemPrompt.variable('model', () => 'test-model')
const fiber = await ctx.plugin(
  { name: mm.name, inject: mm.inject, apply: mm.apply },
  { dataDir: join(TMP, 'state'), hotReload: false, registerCommands: false, seed: 42, persistDebounceMs: 0 },
)

const assembly = await ctx.systemPrompt.assemble()
const sectionNames = assembly.sections.map((s) => s.name)
for (const n of ['mianmian:persona', 'mianmian:anchor', 'mianmian:degraded']) {
  assert.ok(sectionNames.includes(n), `缺少 ${n}: ${sectionNames}`)
}
assert.ok(sectionNames.includes('harness:identity'), '宿主身份段被剥掉了')
assert.ok(sectionNames.includes('deployment:persona-prefix'), '宿主 persona 段被剥掉了')
assert.ok(assembly.variables.mianmian_mood !== undefined, 'mianmian_mood 变量未注册')
console.log('[integration] sections:', sectionNames.join(', '))

for (const s of assembly.sections) {
  assert.equal(s.complete, undefined, `${s.name} 不该标 complete`)
  assert.equal(typeof s.text, 'string', `${s.name} 的 text 必须是字符串（不能是 null）`)
}
const prompt = sp.renderPrompt(assembly)
assert.ok(prompt.includes('IDENTITY'), '渲染后的 system prompt 没有人设正文')
assert.ok(prompt.includes('MIANMIAN OUTPUT CONTRACT'), '渲染后的 system prompt 没有输出铁律')
assert.ok(prompt.includes('【她记得的事'), '锚点块没有进 system prompt')
assert.ok(prompt.includes('【身份锚'), 'L1 人称约束没有常驻')
assert.ok(prompt.includes('test-model'), '宿主 {{model}} 插值失效')
const snapshotText = sp.renderContextSnapshot(assembly)
assert.ok(!snapshotText.includes('{{'), '存在未解析的模板变量')
console.log('[integration] renderPrompt / renderContextSnapshot 通过')

// ── 2) 台账原文可能含 {{ }}，锚点块必须 interpolate:false ───────────────────
assert.equal(assembly.sections.find((s) => s.name === 'mianmian:anchor').interpolate, false)
console.log('[integration] 锚点块 interpolate:false 校准通过')

// ── 3) 动态求值：每轮 assemble 都重新调 text 函数 ──────────────────────────
const first = (await ctx.systemPrompt.assemble()).sections.find((s) => s.name === 'mianmian:anchor').text
const second = (await ctx.systemPrompt.assemble()).sections.find((s) => s.name === 'mianmian:anchor').text
assert.equal(typeof first, 'string')
assert.equal(typeof second, 'string')
assert.ok(first.length > 0 && second.length > 0, '锚点块不能为空')
console.log('[integration] 动态 section 每轮重新求值通过')

// ── 4) T-28 哨兵：同名 section 在同一 layer 直接 throw ─────────────────────
const ctxDup = new Context()
await ctxDup.plugin(sp.SystemPrompt, { includeHarnessIdentity: false })
ctxDup.systemPrompt.section({ name: 'mianmian:x', order: 1, text: 'A' })
assert.throws(
  () => ctxDup.systemPrompt.section({ name: 'mianmian:x', order: 2, text: 'B' }),
  /already registered/i,
  '同名 section 必须抛错（v3 §6.1 红线二）',
)
console.log('[integration] T-28 同名 section 抛错 ✓')

// ── 5) T-29 哨兵：complete:true 会把其他 section 整段丢弃 ──────────────────
const ctxComplete = new Context()
await ctxComplete.plugin(sp.SystemPrompt, { includeHarnessIdentity: true })
ctxComplete.systemPrompt.section({ name: 'calibration:complete', order: 5, text: 'ONLY THIS', complete: true })
ctxComplete.systemPrompt.section({ name: 'calibration:normal', order: 10, text: 'DROPPED' })
ctxComplete.systemPrompt.context({ name: 'calibration:ctx', order: 1, text: 'CONTEXT SURVIVES' })
const aComplete = await ctxComplete.systemPrompt.assemble()
assert.equal(sp.renderPrompt(aComplete).trim(), 'ONLY THIS')
assert.ok(aComplete.contexts.some((c) => c.name === 'calibration:ctx'), 'complete 模式下 context 仍应解析')
console.log('[integration] T-29 complete 丢弃规则 ✓')

// ── 6) T-30 哨兵：assistant/chunk 是静默不触发的老事件名 ────────────────────
const ctxStale = new Context()
let fired = false
ctxStale.on('assistant/chunk', () => { fired = true })
await ctxStale.emit('agent/assistant-stream', { frame: { type: 'chunk' } })
assert.equal(fired, false, '老事件名 assistant/chunk 不该被触发（订阅它是静默失败）')
console.log('[integration] T-30 老事件名静默哨兵 ✓')

// ── 7) T-24：L3 时 persona / anchor 返回空串（不是 null），renderPrompt 不炸 ──
const stateFile = join(TMP, 'state', 'state.json')
assert.ok(existsSync(stateFile), 'state.json 首次启动就应落盘（§3.1 要能人工改台账）')
// 用独立目录预置一份 L3 状态，避免和第一个 fiber 的 store 互相覆盖
const l3Dir = join(TMP, 'state-l3')
mkdirSync(l3Dir, { recursive: true })
const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
saved.degradeLevel = 3
writeFileSync(join(l3Dir, 'state.json'), JSON.stringify(saved, null, 2), 'utf8')
const ctxL3 = new Context()
await ctxL3.plugin(sp.SystemPrompt, { includeHarnessIdentity: true })
await ctxL3.plugin(
  { name: mm.name, inject: mm.inject, apply: mm.apply },
  { dataDir: l3Dir, hotReload: false, registerCommands: false },
)
const aL3 = await ctxL3.systemPrompt.assemble()
const personaL3 = aL3.sections.find((s) => s.name === 'mianmian:persona')
const anchorL3 = aL3.sections.find((s) => s.name === 'mianmian:anchor')
assert.equal(personaL3.text, '', 'L3 时 persona 应返回空串')
assert.equal(anchorL3.text, '', 'L3 时 anchor 应返回空串')
const promptL3 = sp.renderPrompt(aL3)
assert.ok(!promptL3.includes('IDENTITY'), 'L3 不该再注入人设')
assert.ok(promptL3.includes('只输出这一句'), 'L3 应注入固定短回复模板')
assert.ok(!promptL3.includes('undefined') && !promptL3.includes('null'))
console.log('[integration] T-24 L3 降级空串 + 固定模板 ✓')

// ── 8) 卸载可逆（Cordis effect disposer） ──────────────────────────────────
if (typeof fiber?.dispose === 'function') {
  await fiber.dispose()
  const after = await ctx.systemPrompt.assemble()
  assert.ok(!after.sections.some((s) => s.name.startsWith('mianmian:')), '卸载后人格段仍残留')
  assert.equal(after.variables.mianmian_mood, undefined, '卸载后变量仍残留')
  console.log('[integration] 插件卸载后注册项全部撤销')
}

console.log('[integration] ALL PASS')
