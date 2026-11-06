import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultConfig, defaultState, tickBody, patienceBand, bodyFactor, targetLength,
  TIER_FACTOR, TIER_STYLE, advanceRelationship, emptyRelationSignals,
  phaseOf, phaseLabel, timeFactor, seededRng, normalizeConfig,
  StateStore, resolvePaths,
} from '../lib/index.js'
import type { MianmianConfigV3, Tier } from '../lib/index.js'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NOW = new Date('2026-11-06T20:00:00+08:00')
const cfg = defaultConfig()
const fresh = () => defaultState(NOW, cfg)

test('相位五档边界（§4.2）', () => {
  const expected: Array<[number, string]> = [
    [1, '经期'], [5, '经期'], [6, '卵泡'], [13, '卵泡'], [14, '排卵'],
    [16, '排卵'], [17, '黄体前'], [23, '黄体前'], [24, '黄体后'], [28, '黄体后'],
  ]
  for (const [day, label] of expected) assert.equal(phaseLabel(phaseOf(day, 28)), label, `第${day}天`)
})

test('耐心四档阈值（§4.3）', () => {
  assert.equal(patienceBand(60), 'warm')
  assert.equal(patienceBand(59), 'normal')
  assert.equal(patienceBand(40), 'normal')
  assert.equal(patienceBand(39), 'cool')
  assert.equal(patienceBand(25), 'cool')
  assert.equal(patienceBand(24), 'pushed')
})

test('时间推进：Δ小时按真实时间，hunger 增长、energy 按段变化（T-20）', () => {
  const s = fresh()
  s.lastTickAt = new Date(NOW.getTime() - 3 * 3600000).toISOString()
  const sig = tickBody(s, NOW, cfg)
  assert.ok(s.body.hunger > 20, '三小时没吃应该更饿')
  assert.ok(['warm', 'normal', 'cool', 'pushed'].includes(sig.patienceBand))
  assert.ok(sig.activeMultiplier > 0)
})

test('跨 3 天回来按 Δ小时推进而非重置（T-20）', () => {
  const s = fresh()
  const before = s.body.cycle.day
  const back = new Date(NOW.getTime() + 3 * 86400000)
  s.lastTickAt = NOW.toISOString()
  tickBody(s, back, cfg)
  assert.equal(s.body.cycle.day, ((before - 1 + 3) % 28) + 1, '周期按真实日期推进 3 天')
  assert.equal(s.body.hunger, 100, '3 天 = 72h 上限，饿值撞到 100 并被 clamp')
  assert.equal(s.lastTickAt, back.toISOString())
})

test('pushed 只靠换话题/说自己的事回血，时间流逝 alone 不够（她记仇）', () => {
  const s = fresh()
  s.body.patience = 10
  s.lastTickAt = new Date(NOW.getTime() - 10 * 3600000).toISOString()
  tickBody(s, NOW, cfg, { burst: 0, hitSore: false, specificPraise: false, selfDisclosure: false, changedTopic: false, terse: false })
  assert.ok(s.body.patience <= 11, `光靠时间不应回血，实际 ${s.body.patience}`)

  const s2 = fresh()
  s2.body.patience = 10
  tickBody(s2, NOW, cfg, { burst: 0, hitSore: false, specificPraise: false, selfDisclosure: true, changedTopic: true, terse: false })
  assert.ok(s2.body.patience > 20, '换话题/自我暴露应明显回血')
})

test('连发 5 条进入 pushed，目标长度被压短（T-16）', () => {
  const s = fresh()
  s.body.patience = 45
  // 一轮里连发 5 条：burst 是「本轮之前的连发条数」
  tickBody(s, NOW, cfg, { burst: 5, hitSore: false, specificPraise: false, selfDisclosure: false, changedTopic: false, terse: false })
  assert.ok(s.body.patience < 25, `应进入 pushed，实际 ${s.body.patience}`)
  assert.equal(patienceBand(s.body.patience), 'pushed')
  s.runtime.userLen = 50
  assert.ok(targetLength(s, cfg, NOW) < 30, 'pushed 下目标长度应被压短')
})

test('长度自适应：短输入短回复、长输入长回复、累了压短（§7）', () => {
  const s = fresh()
  s.runtime.userLen = 2
  const short = targetLength(s, cfg, NOW)
  s.runtime.userLen = 300
  const long = targetLength(s, cfg, NOW)
  assert.ok(long > short * 2, `${long} vs ${short}`)
  assert.ok(long <= cfg.maxReplyChars)
  s.body.energy = 10
  assert.ok(targetLength(s, cfg, NOW) < long)
  s.degradeLevel = 3
  assert.equal(targetLength(s, cfg, NOW), 12)
})

test('档位系数与行为留痕（T-22）', () => {
  assert.ok(TIER_FACTOR[1] < TIER_FACTOR[2])
  assert.ok(TIER_FACTOR[2] < TIER_FACTOR[3])
  assert.ok(TIER_FACTOR[3] < TIER_FACTOR[4])
  const styles = ([1, 2, 3, 4] as Tier[]).map((t) => TIER_STYLE[t].address + TIER_STYLE[t].initiative + TIER_STYLE[t].sentence)
  assert.equal(new Set(styles).size, 4, '四档称呼/主动/句长必须逐档不同')
})

test('关系状态机：一场不跨两档、爽约后退并记结（T-21）', () => {
  const s = fresh()
  s.turn = 10
  s.runtime.positiveStreak = 2
  const rng = () => 0.99
  for (let i = 0; i < 10; i++) {
    advanceRelationship(s, cfg, { ...emptyRelationSignals(), positive: true }, true, false, rng)
    s.turn++
  }
  assert.ok(s.relationship.tier - s.runtime.tierStart <= 1, '一场不得跨两档')

  const s2 = fresh()
  s2.turn = 10
  s2.relationship.tier = 3
  const r = advanceRelationship(s2, cfg, { ...emptyRelationSignals(), offense: '爽约' }, true, false, rng)
  assert.equal(r.grudgeAdded, true)
  assert.equal(s2.relationship.tier, 2)
  assert.equal(s2.relationship.grudge.length, 1)
})

test('拉扯：一场最多 flirtCap 次、间隔 ≥5、三成概率躲（T-21）', () => {
  // 三成概率是统计口径，单一种子断言「必躲一次」不成立（seed 42 恰好全不躲）。
  // 跑 200 次独立采样验证躲的比例落在 0.2~0.45，同时逐个检查上限与间隔硬规则。
  let dodges = 0
  let opportunities = 0
  for (let seed = 1; seed <= 200; seed++) {
    const s = fresh()
    const rng = seededRng(seed)
    let lastAllowedTurn = -Infinity
    for (let i = 0; i < 40; i++) {
      s.turn = i
      const r = advanceRelationship(s, cfg, { ...emptyRelationSignals(), userPush: true, positive: false }, false, false, rng)
      assert.ok(s.relationship.flirtCount <= cfg.flirtCap, `seed ${seed} 拉扯超上限`)
      if (r.flirtAllowed) {
        assert.ok(i - lastAllowedTurn >= 5, `seed ${seed} 拉扯间隔 <5`)
        lastAllowedTurn = i
        opportunities++
        if (r.flirtDodged) dodges++
      }
    }
  }
  const rate = dodges / opportunities
  assert.ok(opportunities > 100, `采样数不足：${opportunities}`)
  assert.ok(rate >= 0.2 && rate <= 0.45, `躲的比例 ${rate.toFixed(3)} 偏离 0.3 太多`)
})

test('时段系数：深夜 0.6 / 20-22 点 1.25', () => {
  const night = new Date('2026-11-06T02:00:00+08:00')
  const evening = new Date('2026-11-06T21:00:00+08:00')
  assert.ok(timeFactor(evening, cfg) > timeFactor(night, cfg))
})

test('配置归一化与 env 优先级（§3.3）', () => {
  const c = normalizeConfig({ cycleLength: 999, maxReplyChars: -5, reasoningMode: 'on' })
  assert.equal(c.cycleLength, 35)
  assert.equal(c.maxReplyChars, 40)
  assert.equal(c.reasoningMode, 'on')
  assert.equal(c.allowTierSet, false)
  const dir = mkdtempSync(join(tmpdir(), 'mm-paths-'))
  try {
    process.env.DSH_DATA_DIR = dir
    const p = resolvePaths({ ...cfg, dataDir: null })
    assert.equal(p.dir, join(dir, 'mianmian'))
    assert.ok(p.stateFile.endsWith('state.json'))
  } finally {
    delete process.env.DSH_DATA_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})

test('StateStore：原子写、v1→v3 迁移先备份、flush 不丢最后一轮', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-state-'))
  try {
    const c: MianmianConfigV3 = { ...cfg, dataDir: dir, persistDebounceMs: 0 }
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      version: 1, cycleDay: 7, cycleLength: 28, energy: 0.5, patience: 0.4,
      affection: 0.6, turn: 33, lastUserText: '早上想吃油条',
    }), 'utf8')
    const store = new StateStore(c, { info: () => {}, warn: () => {} }, NOW)
    const s = store.snapshot()
    assert.equal(s.version, 3)
    assert.equal(s.turn, 33, '迁移保留轮次')
    assert.equal(s.body.energy, 50, 'v1 的 0..1 换算成 0..100')
    assert.equal(s.body.patience, 40)
    assert.equal(s.relationship.tier, 3, 'affection 0.6 映射到档位 3')
    assert.ok(existsSync(join(dir, 'state.v1.bak.json')), '旧状态必须先备份')
    s.turn = 34
    store.touch()
    const reread = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
    assert.equal(reread.turn, 34, 'debounce=0 立即落盘')
    store.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('StateStore：state.json 损坏时从默认状态启动，不崩', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-broken-'))
  try {
    writeFileSync(join(dir, 'state.json'), '{ 不是 json', 'utf8')
    const c = { ...cfg, dataDir: dir }
    const store = new StateStore(c, { info: () => {}, warn: () => {} }, NOW)
    assert.equal(store.snapshot().version, 3)
    store.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
