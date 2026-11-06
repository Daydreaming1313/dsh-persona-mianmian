import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultConfig, defaultState, decideDegrade, sectionTextFor, l3SectionText,
  guard, L3_LINES, phaseOf, phaseLabel,
} from '../lib/index.js'
import type { Violation } from '../lib/index.js'

const NOW = new Date('2026-11-06T20:00:00+08:00')
const cfg = defaultConfig()
const v = (kind: string, detail = kind): Violation => ({ kind, detail })
const fresh = () => defaultState(NOW, cfg)

test('L0：无违例，两个 section 正常输出', () => {
  const s = fresh()
  const d = decideDegrade(s, [], NOW)
  assert.equal(d.level, 0)
  assert.equal(d.suppressPersona, false)
  assert.equal(sectionTextFor(s, () => 'PERSONA'), 'PERSONA')
  assert.equal(l3SectionText(s), '')
})

test('L1：单处越界静默，只记 drift，不改输出（T-23 前半）', () => {
  const s = fresh()
  s.turn = 5
  const d = decideDegrade(s, [v('长度', '超目标 90/30')], NOW)
  assert.equal(d.level, 1)
  assert.equal(d.suppressPersona, false)
  assert.equal(d.template, null)
  assert.equal(s.drift.length, 1)
  assert.equal(s.drift[0]!.kind, '长度')
  assert.equal(sectionTextFor(s, () => 'PERSONA'), 'PERSONA')
})

test('L2：同轮 ≥2 处违例 → 下一轮补注入纠偏块（T-23）', () => {
  const s = fresh()
  s.turn = 5
  const d = decideDegrade(s, [v('人称'), v('客服腔')], NOW)
  assert.equal(d.level, 2)
  assert.equal(d.suppressPersona, false)
  assert.equal(sectionTextFor(s, () => 'PERSONA'), 'PERSONA')
  // 由 buildAnchor 检查纠偏块实际插入，这里验证状态位
  assert.equal(s.degradeLevel, 2)
})

test('L2：drift 近 3 轮累计 ≥3 也触发', () => {
  const s = fresh()
  s.turn = 5
  s.drift.push(
    { turn: 3, kind: '长度', at: NOW.toISOString() },
    { turn: 4, kind: '长度', at: NOW.toISOString() },
    { turn: 5, kind: '长度', at: NOW.toISOString() },
  )
  const d = decideDegrade(s, [], NOW)
  assert.equal(d.level, 2)
})

test('L3：连续两轮 L2 仍越界 → persona/anchor 返回空串（T-24）', () => {
  const s = fresh()
  s.turn = 5
  decideDegrade(s, [v('人称'), v('旁白')], NOW)
  assert.equal(s.degradeLevel, 2)
  s.turn = 6
  const d = decideDegrade(s, [v('客服腔'), v('旁白')], NOW)
  assert.equal(d.level, 3)
  assert.equal(d.suppressPersona, true)
  assert.equal(sectionTextFor(s, () => 'PERSONA'), '', 'L3 必须返回空串而不是 null')
  assert.ok(L3_LINES.includes(d.template as typeof L3_LINES[number]))
  assert.ok(l3SectionText(s).includes('只输出这一句'))
})

test('L3 直通：身份声明不经 L2（T-25）', () => {
  const s = fresh()
  const vs = guard('作为一个 AI 我没有情绪', {
    state: s, config: cfg, now: NOW, phase: phaseOf(s.body.cycle.day, s.body.cycle.length),
    patienceBand: 'warm', moodLabel: phaseLabel(phaseOf(s.body.cycle.day, s.body.cycle.length)),
    targetLen: 60, userText: '', showAnchor: false,
  })
  const d = decideDegrade(s, vs, NOW)
  assert.equal(d.level, 3)
  assert.equal(d.reason, '身份声明直通 L3')
  assert.equal(d.template, L3_LINES[0])
})

test('L3 持续一轮后回落 L2，不永久锁死（T-26）', () => {
  const s = fresh()
  s.degradeLevel = 3
  const d = decideDegrade(s, [], NOW)
  assert.equal(d.level, 2)
  assert.equal(d.suppressPersona, false)
  assert.equal(sectionTextFor(s, () => 'PERSONA'), 'PERSONA')
})

test('drift 只保留最近 20 条', () => {
  const s = fresh()
  for (let i = 0; i < 30; i++) { s.turn = i + 1; decideDegrade(s, [v('长度')], NOW) }
  assert.equal(s.drift.length, 20)
  assert.equal(s.drift[0]!.turn, 11)
})

test('section.text 返回 null 会炸 → 实现里用空串（T-24 校准点）', async () => {
  const s = fresh()
  s.degradeLevel = 3
  const text = sectionTextFor(s, () => 'PERSONA')
  assert.equal(typeof text, 'string')
  assert.notEqual(text, null)
  // 真实 renderPrompt 会 filter(text => text.length > 0)，空串被丢弃
  assert.equal(text.length, 0)
})
