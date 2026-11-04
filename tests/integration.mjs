/**
 * 真实运行时集成校验：用本机 dsh 0.2.1-rc.2 自带的 Cordis 与
 * @deepseek-ai/dsh-system-prompt 挂载本插件，验证 section / context / variable
 * 的真实签名、渲染插值、卸载可逆性，以及 complete 规则的实际行为。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TMP = join(ROOT, 'tests', '.tmp', 'integration')
mkdirSync(TMP, { recursive: true })

function findDshScope() {
  if (process.env.DSH_PACKAGES_DIR) return process.env.DSH_PACKAGES_DIR
  const candidates = []
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8', shell: process.platform === 'win32',
    }).trim()
    candidates.push(join(globalRoot, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
  } catch { /* 继续试下面的候选 */ }
  candidates.push(
    join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
  )
  for (const dir of candidates) {
    if (existsSync(join(dir, 'cordis', 'lib', 'index.js'))
      && existsSync(join(dir, 'dsh-system-prompt', 'lib', 'index.js'))) return dir
  }
  throw new Error('找不到本机 dsh 的 @deepseek-ai 包目录，请设置 DSH_PACKAGES_DIR 环境变量')
}

const scope = findDshScope()
const url = (p) => pathToFileURL(join(scope, p)).href
const { Context } = await import(url('cordis/lib/index.js'))
const sp = await import(url('dsh-system-prompt/lib/index.js'))
const mm = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)

console.log(`[integration] dsh 包目录: ${scope}`)

// 1) 真实挂载
const ctx = new Context()
await ctx.plugin(sp.SystemPrompt, {
  includeHarnessIdentity: true,
  personaPrefix: 'You are a coding agent powered by the {{model}} model.',
})
ctx.systemPrompt.variable('model', () => 'test-model')
const fiber = await ctx.plugin(
  { name: mm.name, inject: mm.inject, apply: mm.apply },
  { channel: 'text', hotReload: false, registerCommands: false, stateDir: join(TMP, 'state') },
)

const assembly = await ctx.systemPrompt.assemble()
const sectionNames = assembly.sections.map((s) => s.name)
assert.ok(sectionNames.includes('mianmian:persona'), `缺少人格段: ${sectionNames}`)
assert.ok(sectionNames.includes('mianmian:rules'), `缺少铁律段: ${sectionNames}`)
assert.ok(sectionNames.includes('harness:identity'), '宿主身份段被剥掉了')
assert.ok(sectionNames.includes('deployment:persona-prefix'), '宿主 persona 段被剥掉了')
assert.ok(assembly.contexts.some((c) => c.name === 'mianmian:runtime'), '运行时 context 未注册')
assert.ok(assembly.variables.channel !== undefined, 'channel 变量未注册')
assert.ok(assembly.variables.tone !== undefined, 'tone 变量未注册')
console.log('[integration] sections:', sectionNames.join(', '))
console.log('[integration] contexts:', assembly.contexts.map((c) => c.name).join(', '))

const prompt = sp.renderPrompt(assembly)
assert.ok(prompt.includes('IDENTITY'), '渲染后的 system prompt 里没有人设正文')
assert.ok(prompt.includes('MIANMIAN OUTPUT CONTRACT'), '渲染后的 system prompt 里没有输出铁律')
assert.ok(prompt.includes('test-model'), '宿主 {{model}} 插值失效')

const snapshot = sp.renderContextSnapshot(assembly)
assert.ok(!snapshot.includes('{{'), 'context 快照里存在未解析的模板变量')
assert.ok(snapshot.includes('频道 text'), 'channel 变量没有插值进运行时上下文')
assert.ok(/语气 (偏暖|偏冷|平)/.test(snapshot), 'tone 变量没有插值进运行时上下文')
assert.ok(snapshot.includes('内部状态记录'), '运行时指令内容缺失')
console.log('[integration] renderPrompt / renderContextSnapshot 通过')

// 2) 卸载可逆性（Cordis 的 effect disposer）
if (typeof fiber?.dispose === 'function') {
  await fiber.dispose()
  const after = await ctx.systemPrompt.assemble()
  assert.ok(!after.sections.some((s) => s.name.startsWith('mianmian:')), '卸载后人格段仍残留')
  assert.ok(!after.contexts.some((c) => c.name.startsWith('mianmian:')), '卸载后运行时上下文仍残留')
  console.log('[integration] 插件卸载后注册项全部撤销')
} else {
  console.log('[integration] 当前 Cordis fiber 未暴露 dispose，跳过卸载检查')
}

// 3) 校准文档里的 complete 假设：complete 段确实成为唯一 section，
//    但 contexts / tools / variables 仍照常解析，不是「工具与技能被剥掉」。
const ctx2 = new Context()
await ctx2.plugin(sp.SystemPrompt, { includeHarnessIdentity: true })
ctx2.systemPrompt.section({ name: 'calibration:complete', order: 5, text: 'ONLY THIS', complete: true })
ctx2.systemPrompt.section({ name: 'calibration:normal', order: 10, text: 'DROPPED' })
ctx2.systemPrompt.context({ name: 'calibration:ctx', order: 1, text: 'CONTEXT SURVIVES' })
const a2 = await ctx2.systemPrompt.assemble()
assert.equal(sp.renderPrompt(a2).trim(), 'ONLY THIS')
assert.ok(a2.contexts.some((c) => c.name === 'calibration:ctx'), 'complete 模式下 context 应仍然解析')
assert.ok(sp.renderContextSnapshot(a2).includes('CONTEXT SURVIVES'))
console.log('[integration] complete 规则校准通过：唯一 section + 上下文仍解析')

console.log('[integration] ALL PASS')
