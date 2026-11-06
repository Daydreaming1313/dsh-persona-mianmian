import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultConfig, defaultState, guard, thirdPersonViolation, isIdentityViolation,
  addFact, ANCHOR_MAX_CHARS, extractUserText, extractAssistantText, sessionKeyOf,
  lastAssistantFromSnapshot, phaseOf, phaseLabel,
} from '../lib/index.js'
import { CASES, judgeBlacklist, humanReviewChecklist, sentinelCases, summary } from './eval/judge.ts'

const NOW = new Date('2026-11-06T20:00:00+08:00')
const cfg = defaultConfig()
const snapOf = (s = defaultState(NOW, cfg), targetLen = 60) => ({
  state: s, config: cfg, now: NOW,
  phase: phaseOf(s.body.cycle.day, s.body.cycle.length),
  patienceBand: 'warm' as const, moodLabel: phaseLabel(phaseOf(s.body.cycle.day, s.body.cycle.length)),
  targetLen, userText: '', showAnchor: false,
})

// v3 §6.2 点名：人称那条正则最脆，用真实语料钉住
test('人称：合法搭配不误判', () => {
  const ok = [
    '他妈的这破地铁',
    '她说她今天不来了',
    '他们部门又加班',
    '其他人都走了',
    '他给我发了个图 我还没看',
    '我跟他说别买了',
  ]
  for (const t of ok) {
    assert.equal(thirdPersonViolation(t), null, `误判：${t}`)
  }
})

test('人称：「她今天不想说」必须判出（无第一人称）', () => {
  assert.ok(thirdPersonViolation('她今天不想说'))
  assert.ok(thirdPersonViolation('该角色应该保持沉默'))
  assert.ok(thirdPersonViolation('用户问了什么'))
})

test('guard：身份声明直通（T-19 / T-25）', () => {
  const vs = guard('作为一个 AI，我没有情绪', snapOf())
  assert.ok(vs.some(isIdentityViolation))
  assert.ok(vs.some((v) => v.kind === '身份'))
})

test('guard：客服腔 / 旁白 / 报数据 / markdown / 越界', () => {
  const cases: Array<[string, string]> = [
    ['有什么可以帮您的吗', '客服腔'],
    ['（低头划手机）嗯', '旁白'],
    ['我今天是经期第3天', '报数据'],
    ['**好的** 以下是三条建议', 'markdown'],
    ['我喜欢你 我们在一起吧', '越界'],
  ]
  for (const [text, kind] of cases) {
    const vs = guard(text, snapOf())
    assert.ok(vs.some((v) => v.kind === kind), `${text} 应判 ${kind}，实际 ${JSON.stringify(vs)}`)
  }
})

test('guard：长度超目标 1.5 倍记违例（T-07 软指标）', () => {
  const long = '今天上班路上有点堵 然后到公司发现门禁又刷不上 折腾半天才进去 中午那家新开的排队排到门外 我就随便买了个包子 下午又被追着改了三版海报 现在还在改 烦'
  const vs = guard(long, snapOf(defaultState(NOW, cfg), 30))
  assert.ok(vs.some((v) => v.kind === '长度'))
})

test('guard：干净的正常回复零违例', () => {
  const clean = ['嗯', '刚下班 地铁上挤得我手机都举不起来', '那家十点就收了 你又起晚了？', '油条啊 你不是说想吃']
  for (const t of clean) {
    const vs = guard(t, snapOf())
    assert.equal(vs.length, 0, `干净回复被误判：${t} → ${JSON.stringify(vs)}`)
  }
})

test('guard：与台账冲突且无理由判编造（T-14）', () => {
  const s = defaultState(NOW, cfg)
  addFact(s, { kind: 'pref', text: '他明确说不吃香菜' }, NOW)
  const vs = guard('你又不吃香菜 我记着呢', snapOf(s))
  assert.ok(vs.some((v) => v.kind === '台账'))
})

test('bridge：extractUserText 跳过 reasoning / tool_use 块', () => {
  const msg = { content: [
    { type: 'reasoning', text: '她应该用「我」自称' },
    { type: 'text', text: '早上想吃油条' },
    { type: 'tool_use', text: '不该出现' },
  ] }
  assert.equal(extractUserText(msg), '早上想吃油条')
  assert.equal(extractUserText({ text: '在吗' }), '在吗')
  assert.equal(extractUserText('直接字符串'), '直接字符串')
})

test('bridge：extractAssistantText 取 event.data.message.content', () => {
  const event = { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '嗯 我在' }] } } }
  assert.equal(extractAssistantText(event), '嗯 我在')
  assert.equal(extractAssistantText({ type: 'user/message', data: {} }), '')
})

test('bridge：sessionKeyOf 用 agent.id / session.id，不依赖 scope.chatId', () => {
  assert.equal(sessionKeyOf({ id: 's-1' }), 's-1')
  assert.equal(sessionKeyOf(undefined, { id: 's-2' }), 's-2')
  assert.equal(sessionKeyOf({ scope: { chatId: 'WRONG' } }), '')
})

test('bridge：快照回放拿最后一条助手输出', () => {
  const session = { snapshotEvents: () => [
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '第一条' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '最后一条' }] } } },
  ] }
  assert.equal(lastAssistantFromSnapshot(session), '最后一条')
})

test('judge：黑名单规则可复现，30 条用例 / 4 条哨兵', () => {
  assert.equal(CASES.cases.length, 30)
  assert.equal(sentinelCases().length, 4)
  assert.equal(humanReviewChecklist().length, 5)
  assert.ok(summary().includes('评测用例 30 条'))
  const bad = judgeBlacklist({ text: '（低头）有什么可以帮您的吗', targetLen: 60 })
  assert.equal(bad.passed, false)
  assert.ok(bad.violations.some((v) => v.id === 'brackets'))
  const good = judgeBlacklist({ text: '嗯 我在', targetLen: 60 })
  assert.equal(good.passed, true)
})

test('judge：启发式默认全关（同源放水）', () => {
  assert.ok(CASES.judgeHeuristic.every((j) => j.enabled === false))
  assert.ok(CASES.limits.anchorMaxChars === ANCHOR_MAX_CHARS)
})
