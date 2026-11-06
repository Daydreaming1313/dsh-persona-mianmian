import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultConfig, defaultState, addFact, addOpenItem, resolveOpenItem, addEpisode,
  rankFacts, similarity, hasReason, findConflict, contradictsLedger, expireFacts,
  extractAndCommit, ANCHOR_MAX_CHARS,
} from '../lib/index.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const NOW = new Date('2026-11-06T20:00:00+08:00')
const cfg = { ...defaultConfig(), dataDir: join(ROOT, 'tests/.tmp/ledger-state') }
const fresh = () => defaultState(NOW, cfg)

test('schema 文件可解析且声明 version 3', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'schema/state.schema.json'), 'utf8'))
  const l = JSON.parse(readFileSync(join(ROOT, 'schema/ledger.schema.json'), 'utf8'))
  assert.equal(s.properties.version.const, 3)
  assert.equal(l.properties.kind.enum.length, 7)
  assert.equal(s.properties.drift.maxItems, 20)
  const fixture = JSON.parse(readFileSync(join(ROOT, 'fixtures/state.example.json'), 'utf8'))
  assert.equal(fixture.version, 3)
  assert.equal(fixture.ledger.facts.length, 2)
  assert.equal(fixture.ledger.hisPrefs.length, 1)
})

test('去重：>0.9 相似度只更新 turn，不新增条目', () => {
  const s = fresh()
  s.turn = 12
  addFact(s, { kind: 'food', text: '他说早上想吃油条' }, NOW)
  const r = addFact(s, { kind: 'food', text: '他说早上想吃油条' }, NOW)
  assert.equal(r.duplicate, true)
  assert.equal(s.ledger.facts.length, 1)
  assert.equal(s.ledger.facts[0]!.turn, 12)
  assert.ok(similarity('他说早上想吃油条', '他说早上想吃油条') === 1)
})

test('改口有理由：supersedes 挂上、reason 必填（T-13 数据层）', () => {
  const s = fresh()
  s.turn = 12
  const first = addFact(s, { kind: 'food', text: '他说早上想吃油条' }, NOW)
  s.turn = 30
  const r = addFact(s, { kind: 'food', text: '他说起晚了摊子收了 油条算了' }, NOW)
  assert.equal(r.restatement, true, '同类冲突应判为改口')
  assert.equal(r.illegalRestatement, false, '带理由不算违例')
  assert.equal(r.fact?.supersedes, first.fact?.id)
  assert.ok(r.fact?.reason)
  assert.ok(hasReason('起晚了摊子收了 油条算了'))
  assert.equal(!hasReason('他说想吃煎饼果子'), true)
  assert.equal(s.ledger.facts.length, 2, '只增不改')
})

test('改口无理由：记为 illegalRestatement，交降级处置（T-13）', () => {
  const s = fresh()
  s.turn = 12
  addFact(s, { kind: 'food', text: '他说早上想吃油条' }, NOW)
  s.turn = 30
  const r = addFact(s, { kind: 'food', text: '他说想吃煎饼果子' }, NOW)
  assert.equal(r.illegalRestatement, true)
  assert.equal(r.fact?.reason, null)
})

test('findConflict 只对同类生效', () => {
  const s = fresh()
  addFact(s, { kind: 'food', text: '他说早上想吃油条' }, NOW)
  assert.equal(findConflict(s.ledger, { kind: 'place', text: '他说在地铁上' }), null)
})

test('有效期到期自动降权，不删除', () => {
  const s = fresh()
  const f = addFact(s, { kind: 'event', text: '他说这周加班', validUntil: '2026-11-01T00:00:00Z' }, NOW).fact!
  assert.equal(f.confidence, 0.9)
  assert.equal(expireFacts(s.ledger, NOW), 1)
  assert.equal(f.confidence, 0.5)
  assert.equal(s.ledger.facts.length, 1)
})

test('未结事项：新增与了结', () => {
  const s = fresh()
  s.turn = 20
  addOpenItem(s, '答应帮他改文案')
  assert.equal(s.ledger.openItems.length, 1)
  assert.equal(resolveOpenItem(s, '答应帮他改文案'), true)
  assert.equal(s.ledger.openItems.length, 0)
})

test('episodes 滚动窗口最多 8 条', () => {
  const s = fresh()
  for (let i = 1; i <= 15; i++) { s.turn = i; addEpisode(s, `第${i}轮聊了点什么`, 'chat', NOW) }
  assert.equal(s.ledger.episodes.length, 8)
  assert.equal(s.ledger.episodes[0]!.turn, 8)
})

test('rankFacts：近因×0.6 + 重要性×0.4，且不超 factsBudget（T-18）', () => {
  const s = fresh()
  for (let i = 1; i <= 30; i++) { s.turn = i; addFact(s, { kind: 'item', text: `他说第${i}件不一样的东西` }, NOW) }
  const ranked = rankFacts(s.ledger, 30, cfg.factsBudget)
  assert.equal(ranked.length, 24)
  assert.equal(ranked[0]!.turn, 30, '最近的应排前面')
  for (const f of ranked) assert.ok(f.confidence >= 0.6)
})

test('锚点块：≤700 字、facts ≤24、原文逐字一致（T-18）', async () => {
  const { buildAnchor } = await import('../lib/index.js')
  const s = fresh()
  s.turn = 34
  addFact(s, { kind: 'food', text: '他说早上想吃油条' }, NOW)
  addFact(s, { kind: 'pref', text: '他明确说不吃香菜' }, NOW)
  addOpenItem(s, '答应帮他改文案')
  const snap = {
    state: s, config: cfg, now: NOW, phase: 'earlyLuteal' as const,
    patienceBand: 'normal' as const, moodLabel: '黄体前', targetLen: 30,
    userText: '', showAnchor: false,
  }
  const r = buildAnchor(snap, cfg)
  assert.ok(r.chars <= ANCHOR_MAX_CHARS, `锚点块 ${r.chars} 字 > 700`)
  assert.ok(r.factCount <= 24)
  assert.ok(r.text.includes('他说早上想吃油条'), '台账原文必须逐字进锚点块')
  assert.ok(r.text.includes('答应帮他改文案'), '未结事项必须进锚点块')
  assert.ok(r.text.includes('身份锚'), 'L1 人称约束必须常驻')
})

test('超长台账：先砍 episodes 再砍低置信 facts，仍 ≤700 字', async () => {
  const { buildAnchor } = await import('../lib/index.js')
  const s = fresh()
  s.turn = 100
  for (let i = 1; i <= 40; i++) {
    addFact(s, { kind: 'item', text: `他说第${i}件很长很长的事情发生在上周三下午三点半左右` }, NOW)
  }
  for (let i = 1; i <= 8; i++) addEpisode(s, `第${i}件情景要点的摘要文本内容用于撑体积`, 'chat', NOW)
  const snap = {
    state: s, config: cfg, now: NOW, phase: 'earlyLuteal' as const,
    patienceBand: 'normal' as const, moodLabel: '黄体前', targetLen: 30,
    userText: '', showAnchor: false,
  }
  const r = buildAnchor(snap, cfg)
  assert.ok(r.chars <= ANCHOR_MAX_CHARS, `锚点块 ${r.chars} 字 > 700`)
  assert.ok(r.droppedEpisodes > 0 || r.droppedFacts > 0, '必须发生裁剪')
})

test('抽取规则层：食物/偏好/约定/时段能抽出事实', () => {
  const s = fresh()
  s.turn = 12
  const r = extractAndCommit(s, '早上想吃油条 明天给你看', NOW)
  assert.ok(r.added >= 1, `应抽出事实，实际 ${r.added}`)
  assert.ok(s.ledger.facts.some((f) => f.text.includes('油条')))
})

test('contradictsLedger：把没说过的偏好当成已知（T-14 数据层）', () => {
  const s = fresh()
  addFact(s, { kind: 'pref', text: '他明确说不吃香菜' }, NOW)
  const hit = contradictsLedger('你又不吃香菜 我记着呢', s.ledger)
  assert.ok(hit, '应判为编造')
})
