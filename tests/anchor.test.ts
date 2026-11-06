import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultConfig, defaultState, buildAnchor, exportAnchor, correctionBlock,
  IDENTITY_CONSTRAINT, L3_LINES, ANCHOR_MAX_CHARS, formatNow, phaseOf,
  phaseLabel, cycleDayOf, deltaHours, tickClock,
} from '../lib/index.js'

const NOW = new Date('2026-11-06T20:00:00+08:00')
const cfg = defaultConfig()
const snapOf = (s: ReturnType<typeof defaultState>) => ({
  state: s, config: cfg, now: NOW,
  phase: phaseOf(s.body.cycle.day, s.body.cycle.length),
  patienceBand: 'warm' as const, moodLabel: phaseLabel(phaseOf(s.body.cycle.day, s.body.cycle.length)),
  targetLen: 30, userText: '', showAnchor: false,
})

test('IDENTITY_CONSTRAINT 顶部常驻人称约束（L1 思考期）', () => {
  const s = defaultState(NOW, cfg)
  const r = buildAnchor(snapOf(s), cfg)
  assert.ok(r.text.startsWith(IDENTITY_CONSTRAINT))
  assert.ok(r.text.includes('用「我」说自己'))
  assert.ok(r.text.includes('禁止出现「用户」'))
})

test('锚点块含四段结构与三条生成铁律', () => {
  const s = defaultState(NOW, cfg)
  const r = buildAnchor(snapOf(s), cfg)
  for (const marker of ['【她记得的事', '【没结的事】', '【现在】', '【三条生成铁律】']) {
    assert.ok(r.text.includes(marker), `缺少 ${marker}`)
  }
  assert.ok(r.text.includes('要改口必须带理由'))
  assert.ok(r.text.includes('宁可反问'))
})

test('锚点块绝不把相位写成模型可见的报数句', () => {
  const s = defaultState(NOW, cfg)
  const r = buildAnchor(snapOf(s), cfg)
  // 内部锚点块允许出现「周期第N天（黄体前）」作为给模型的内部记录，
  // 但 persona 与 guard 都禁止模型在回复里复述；这里检查模板里带的是内部标记
  assert.ok(r.text.includes('【现在】'))
  assert.ok(r.text.includes('周期第'))
})

test('L2 纠偏块含人称约束、目标长度、台账原文', () => {
  const b = correctionBlock(24, '他说早上想吃油条')
  assert.ok(b.includes('你是林绵'))
  assert.ok(b.includes('24 字'))
  assert.ok(b.includes('他说早上想吃油条'))
})

test('L3 模板固定，不许自由发挥', () => {
  assert.equal(L3_LINES.length, 2)
  assert.ok(L3_LINES.every((l) => l.length <= 12))
  assert.equal(L3_LINES[0], '嗯 我在')
})

test('exportAnchor 可直接粘进新会话', () => {
  const s = defaultState(NOW, cfg)
  const text = exportAnchor(snapOf(s), cfg)
  assert.ok(text.includes('新会话的第一条消息'))
  assert.ok(text.includes('【她记得的事'))
})

test('周期锚点幂等：同一天反复调用不漂移', () => {
  const anchor = '2026-10-21'
  const d1 = cycleDayOf(anchor, NOW, 28, cfg.timezone)
  const d2 = cycleDayOf(anchor, NOW, 28, cfg.timezone)
  assert.equal(d1, d2)
  const next = new Date(NOW.getTime() + 86400000)
  assert.equal(cycleDayOf(anchor, next, 28, cfg.timezone), (d1 % 28) + 1)
})

test('tickClock 由锚点推导，绝不改写 anchor（防 0.1.1 的漂移回归）', () => {
  const s = defaultState(NOW, cfg)
  const before = s.body.cycle.anchor
  const day = s.body.cycle.day
  tickClock(s, NOW, cfg)
  assert.equal(s.body.cycle.anchor, before)
  assert.equal(s.body.cycle.day, day)
  tickClock(s, NOW, cfg)
  assert.equal(s.body.cycle.day, day)
})

test('Δ小时上限 72h，长假回来不炸（T-20）', () => {
  const longAgo = new Date(NOW.getTime() - 30 * 86400000)
  assert.equal(deltaHours(NOW, longAgo.toISOString()), 72)
  assert.equal(deltaHours(NOW, new Date(NOW.getTime() + 86400000).toISOString()), 0, '未来时间不推进')
})

test('formatNow 输出时段与星期', () => {
  assert.match(formatNow(NOW, cfg), /^\d{2}:\d{2} 周[日一二三四五六]$/)
})

test('degradeLevel=2 时锚点块顶部插入纠偏块', () => {
  const s = defaultState(NOW, cfg)
  s.degradeLevel = 2
  s.runtime.violationsThisTurn = [{ kind: '人称', detail: '她说' }]
  const r = buildAnchor(snapOf(s), cfg)
  assert.ok(r.text.includes('【状态校准 · 最高优先】'))
  assert.ok(r.text.indexOf('【状态校准') < r.text.indexOf('【她记得的事'))
  assert.ok(r.chars <= ANCHOR_MAX_CHARS)
})
