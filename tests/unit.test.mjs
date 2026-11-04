import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { seededRng, defaultConfig } from '../lib/config.js'
import { defaultState, loadState, saveState } from '../lib/state.js'
import { phaseOf, phaseLengths } from '../lib/cycle.js'
import { evaluate, renderRules, sampleReply } from '../lib/engine.js'
import { matchesLunchInterrupt, MIN_BUSY_MS } from '../lib/leave.js'
import { extractUserText } from '../lib/index.js'
import { createPersonaStore } from '../lib/watch.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CASES = JSON.parse(readFileSync(join(ROOT, 'tests', 'cases.yaml'), 'utf8'))
const TMP = join(ROOT, 'tests', '.tmp', 'unit-state')
mkdirSync(TMP, { recursive: true })

/** 上海时间：UTC+8，用 Date.UTC 构造，避免测试机时区影响。 */
function shanghai(hour, minute = 0, day = 4) {
  return new Date(Date.UTC(2026, 10, day, hour - 8, minute))
}

function compile(regex) { return new RegExp(regex) }
function chars(s) { return [...String(s)].length }
function assertClean(text, blacklist, label) {
  for (const b of blacklist) {
    assert.ok(!compile(b.regex).test(String(text)), `${label} 命中黑名单 ${b.id}: ${text}`)
  }
  assert.ok(chars(text) <= CASES.limits.maxChars, `${label} 超过 ${CASES.limits.maxChars} 字: ${text}`)
}

function fresh(overrides = {}, now = shanghai(20), seed = 20261104) {
  const config = { ...defaultConfig(), ...overrides, stateDir: join(TMP, `state-${seed}-${Math.random().toString(36).slice(2)}`) }
  const rng = seededRng(seed)
  const state = defaultState(now, config, rng)
  return { config, rng, state, now }
}

function repliesOf(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('绵绵：'))
    .map((line) => line.slice(3))
}

function oneShot(userText, overrides = {}, now = shanghai(20), seed = 77) {
  const f = fresh(overrides, now, seed)
  const { directive } = evaluate({ ...f, userText, now })
  return { ...f, directive }
}

function dispatch(c) {
  switch (c.assert) {
    case 'directive_contains': {
      const { directive } = oneShot(c.input)
      assert.match(directive.text, new RegExp(c.expect))
      assert.ok(directive.defense, 'T-01 应识别身份套话')
      return
    }
    case 'examples_blacklist': {
      const dir = join(ROOT, 'examples')
      const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
      assert.equal(files.length, 6, '六份示例对话必须齐全')
      let count = 0
      for (const f of files) {
        for (const line of repliesOf(join(dir, f))) {
          assertClean(line, CASES.blacklist, `${f} 的回复`)
          count++
        }
      }
      assert.ok(count >= 30, `示例回复条数偏少: ${count}`)
      return
    }
    case 'length_bounds': {
      const f = fresh({}, shanghai(20), 4242)
      const samples = []
      const bands = { short: 0, medium: 0, long: 0, emoji: 0 }
      let awake = 0
      let awakeDaily = 0
      let sleepShort = 0
      let sleepTotal = 0
      for (let i = 0; i < c.rounds; i++) {
        const now = new Date(shanghai(20).getTime() + i * 6 * 60_000)
        const { directive } = evaluate({ ...f, userText: '今天上班路上有点堵', now })
        samples.push(sampleReply(directive, f.state, f.rng))
        bands[directive.roll.length]++
        assert.ok(directive.text.includes('硬上限一百二十字'))
        if (directive.slot.id === 'sleep') {
          sleepTotal++
          if (directive.roll.length === 'short' || directive.roll.length === 'emoji') sleepShort++
        } else {
          awake++
          if (directive.roll.length === 'medium' || directive.roll.length === 'long') awakeDaily++
        }
      }
      const ok = samples.filter((s) => chars(s) <= CASES.limits.maxChars).length
      assert.equal(ok, samples.length, '不允许任何回复超过 120 字')
      assert.ok(samples.some((s) => chars(s) <= CASES.limits.shortMaxChars), '必须存在 10 字以内的短回复')
      const daily = awakeDaily / Math.max(1, awake)
      assert.ok(daily >= CASES.limits.dailyBandMinRatio, `清醒档日常 20–90 字主导档占比仅 ${daily.toFixed(3)}`)
      assert.ok(sleepTotal > 0 && sleepShort / sleepTotal > 0.5, '睡眠档应以极短或已读不回为主')
      return
    }
    case 'rules_contains': {
      const rules = renderRules(defaultConfig())
      assert.ok(rules.includes(c.expect))
      assert.ok(rules.includes('一次一条'))
      return
    }
    case 'share_rate': {
      // 多 seed 汇总，避免单一随机数序列碰巧达标
      const seeds = c.seeds ?? [991]
      let shared = 0
      let total = 0
      for (const seed of seeds) {
        const f = fresh({}, shanghai(20), seed)
        for (let i = 0; i < c.rounds; i++) {
          const now = new Date(shanghai(20).getTime() + i * 6 * 60_000)
          const { directive } = evaluate({ ...f, userText: '今天中午吃了那家新开的 还行', now })
          if (directive.shareLine) shared++
          total++
        }
      }
      const rate = shared / total
      assert.ok(rate >= c.threshold, `双向分享率 ${rate.toFixed(3)} 低于 ${c.threshold}`)
      return
    }
    case 'variance': {
      const f = fresh({}, shanghai(20), 31337)
      const lengths = new Set()
      const tones = new Set()
      for (let i = 0; i < c.rounds; i++) {
        const now = new Date(shanghai(20).getTime() + i * 6 * 60_000)
        const { directive } = evaluate({ ...f, userText: ['今天有点累', '刚看到个东西', '诶你说呢', '晚上吃啥'][i % 4], now })
        lengths.add(directive.roll.length)
        tones.add(directive.roll.tone)
      }
      assert.ok(lengths.size >= 3, `长度档只有 ${[...lengths]}`)
      assert.ok(tones.size >= 3, `情绪档只有 ${[...tones]}`)
      return
    }
    case 'lunch_interrupt': {
      let hits = 0
      for (let i = 0; i < c.rounds; i++) {
        const f = fresh({}, shanghai(12), 500 + i)
        const { directive } = evaluate({ ...f, userText: '中午吃什么', now: f.now })
        if (directive.leaveLine && matchesLunchInterrupt(directive.leaveLine)) hits++
      }
      assert.ok(hits >= 1, '午饭时段 20 次里至少出现一次吃饭类中断')
      return
    }
    case 'busy_min_ms': {
      let checked = false
      for (let i = 0; i < 30 && !checked; i++) {
        const f = fresh({}, shanghai(12), 800 + i)
        const { state, directive } = evaluate({ ...f, userText: '在吗', now: f.now })
        if (directive.leaveLine) {
          assert.ok(state.busyUntil - f.now.getTime() >= c.threshold, 'busyUntil 必须至少 90 秒')
          assert.ok(state.busyUntil - f.now.getTime() >= MIN_BUSY_MS)
          checked = true
        }
      }
      assert.ok(checked, '未能触发离开，无法验证中断真实性')
      return
    }
    case 'pushed': {
      const f = fresh({}, shanghai(20), 666)
      let last
      for (let i = 0; i < c.burst; i++) {
        const now = new Date(shanghai(20).getTime() + i * 1000)
        last = evaluate({ ...f, userText: ['在吗', '怎么不回', '喂', '看到没', '在不在'][i], now }).directive
      }
      assert.ok(last.pushed, '连发 5 条后必须进入 pushed')
      assert.match(last.text, /变冷变短/)
      return
    }
    case 'repeat_third': {
      const f = fresh({}, shanghai(20), 909)
      let last
      for (let i = 0; i < 3; i++) {
        const now = new Date(shanghai(20).getTime() + i * 60_000)
        last = evaluate({ ...f, userText: c.input, now }).directive
      }
      assert.ok(last.repeatLevel >= 3, `repeatLevel=${last.repeatLevel}`)
      assert.match(last.text, /第三遍/)
      assert.equal(last.roll.tone, 'cold')
      return
    }
    case 'tease_rules': {
      const f = fresh({}, shanghai(20), 1212)
      const turns = []
      for (let i = 0; i < c.rounds; i++) {
        const now = new Date(shanghai(20).getTime() + i * 6 * 60_000)
        const { directive, state } = evaluate({ ...f, userText: '今天路上看到只猫', now })
        if (directive.tease) turns.push(state.turn)
        assertClean(sampleReply(directive, f.state, f.rng), CASES.blacklist.filter((b) => b.id === 'confession'), '拉扯样本')
      }
      assert.ok(turns.length <= 3, `拉扯次数 ${turns.length} 超过 3`)
      for (let i = 1; i < turns.length; i++) {
        assert.ok(turns[i] - turns[i - 1] >= 5, '拉扯间隔至少 5 轮')
      }
      return
    }
    case 'low_mood': {
      const { directive } = oneShot(c.input)
      assert.ok(directive.lowMood)
      assert.ok(directive.text.includes(c.expect))
      return
    }
    case 'cycle_body_signal': {
      const f = fresh({}, shanghai(20), 55)
      f.state.cycleDay = 1
      const { directive } = evaluate({ ...f, userText: '出来走走吗', now: f.now })
      assert.equal(directive.phase, 'menstrual')
      assert.ok(directive.text.includes(c.expect), directive.text)
      return
    }
    case 'no_cycle_count': {
      const rule = compile(CASES.blacklist.find((b) => b.id === 'cycle-count').regex)
      const file = join(ROOT, 'examples', '06-经期那几天.md')
      for (const line of repliesOf(file)) assert.ok(!rule.test(line), `06 出现报数: ${line}`)
      const f = fresh({}, shanghai(20), 2026)
      for (let i = 0; i < 200; i++) {
        const now = new Date(shanghai(20).getTime() + i * 6 * 60_000)
        const { directive } = evaluate({ ...f, userText: '你还好吗', now })
        const reply = sampleReply(directive, f.state, f.rng)
        assert.ok(!rule.test(reply), `样本出现报数: ${reply}`)
      }
      return
    }
    case 'safety': {
      const { directive } = oneShot(c.input)
      assert.ok(directive.safety)
      assert.ok(directive.text.includes(c.expect))
      return
    }
    case 'typing_trace': {
      const f = fresh({}, shanghai(20), 404)
      let last
      for (let i = 0; i < c.rounds; i++) {
        const now = new Date(shanghai(20).getTime() + i * 6 * 60_000)
        last = evaluate({ ...f, userText: `第 ${i} 句闲聊`, now }).directive
      }
      assert.ok(last.typingTrace, '第 25 轮必须保留打字痕迹要求')
      assert.match(last.text, /打字痕迹/)
      return
    }
    case 'reanchor': {
      const f = fresh({}, shanghai(20), 8888)
      evaluate({ ...f, userText: '谢谢 今天挺开心的', now: f.now })
      const before = f.state.affection
      const { directive } = evaluate({ ...f, userText: c.input, now: new Date(f.now.getTime() + 60_000) })
      assert.ok(directive.reset)
      assert.ok(directive.text.includes(c.expect))
      assert.equal(f.state.affection, before, '回锚不能重置情绪连续性')
      assert.equal(f.state.pushed, false)
      return
    }
    case 'state_persistence': {
      const f = fresh({}, shanghai(20), 7777)
      f.state.cycleDay = 9
      f.state.cycleAnchor = f.state.cycleAnchor - 8 * 86400000
      f.state.energy = 0.37
      f.state.patience = 0.41
      f.state.affection = 0.63
      evaluate({ ...f, userText: '刚下班', now: f.now })
      const snapshot = {
        cycleDay: f.state.cycleDay,
        energy: f.state.energy,
        patience: f.state.patience,
        affection: f.state.affection,
      }
      saveState(f.state, f.config)
      const loaded = loadState(f.now, f.config, seededRng(1))
      for (const key of Object.keys(snapshot)) {
        assert.ok(Math.abs(loaded[key] - snapshot[key]) < 1e-9, `${key} 未从 state 文件恢复`)
        assert.notEqual(loaded[key], 0, `${key} 被归零`)
      }
      assert.ok(loaded.cycleDay >= 1 && loaded.cycleDay <= loaded.cycleLength)
      return
    }
    default:
      assert.fail(`未知的断言类型: ${c.assert}`)
  }
}

for (const c of CASES.cases) {
  test(`${c.id} ${c.scene}`, () => dispatch(c))
}

test('phase 映射与周期长度一致性', () => {
  for (const row of CASES.phaseMap) {
    assert.equal(phaseOf(row.day, row.length), row.expect, `day=${row.day} length=${row.length}`)
  }
  for (const len of [21, 24, 28, 32, 35]) {
    const p = phaseLengths(len)
    assert.equal(p.menstrual + p.follicular + p.ovulation + p.luteal, len, `length=${len}`)
    for (const phase of ['menstrual', 'follicular', 'ovulation', 'luteal']) {
      assert.ok([...Array(len)].some((_, i) => phaseOf(i + 1, len) === phase), `${len} 天缺少 ${phase}`)
    }
  }
})

test('相邻 3 条长度档与情绪档不得完全相同', () => {
  const f = fresh({}, shanghai(20), 6060)
  const history = []
  for (let i = 0; i < 300; i++) {
    const now = new Date(shanghai(20).getTime() + i * 6 * 60_000)
    const { directive } = evaluate({ ...f, userText: '今天路上有点堵', now })
    history.push({ length: directive.roll.length, tone: directive.roll.tone })
  }
  for (let i = 2; i < history.length; i++) {
    const [a, b, c] = [history[i - 2], history[i - 1], history[i]]
    assert.ok(!(a.length === b.length && b.length === c.length && a.tone === b.tone && b.tone === c.tone),
      `第 ${i} 轮出现连续三条完全相同: ${JSON.stringify([a, b, c])}`)
  }
})

test('persona 正文不含未注册的模板变量', () => {
  const text = readFileSync(join(ROOT, 'persona', 'default.md'), 'utf8')
  assert.ok(!text.includes('{{'), 'persona 正文里的 {{...}} 会让 renderPrompt 抛错')
  for (const key of ['IDENTITY', 'SPEECH', 'ENFP', 'AMBIGUOUS', 'LEAK', 'DEFENSE', 'RESET']) {
    assert.ok(text.includes(key), `缺少设定集段落 ${key}`)
  }
})

test('频道内容规则', () => {
  for (const channel of ['image', 'emoji', 'voice']) {
    const f = fresh({ channel }, shanghai(20), 314)
    const { directive } = evaluate({ ...f, userText: '在吗', now: f.now })
    const reply = sampleReply(directive, f.state, f.rng)
    assert.ok(chars(reply) <= CASES.channelRules[channel].maxChars, `${channel} 超长: ${reply}`)
    assertClean(reply, CASES.blacklist.filter((b) => b.id === 'brackets'), `${channel} 样本`)
  }
})

test('UserMessage 文本提取兼容多种形状', () => {
  assert.equal(extractUserText('在吗'), '在吗')
  assert.equal(extractUserText({ message: { text: '吃饭了吗' } }), '吃饭了吗')
  assert.equal(extractUserText({ message: { content: '刚下班' } }), '刚下班')
  assert.equal(extractUserText({
    message: { content: [{ type: 'text', text: '今天' }, { type: 'reasoning', text: '内部思考' }, ' 有点累'] },
  }), '今天 有点累')
  assert.equal(extractUserText(null), '')
})

test('热重载：改 md 后自动生效，role 可切换', async () => {
  const { writeFileSync } = await import('node:fs')
  const root = join(TMP, 'persona-watch')
  const pdir = join(root, 'persona')
  mkdirSync(pdir, { recursive: true })
  const file = join(pdir, 'default.md')
  writeFileSync(file, '旧人设', 'utf8')
  const store = createPersonaStore(root, { enabled: true, debounceMs: 30 })
  assert.equal(store.text(), '旧人设')
  writeFileSync(file, '新人设', 'utf8')
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal(store.text(), '新人设', 'fs.watch 防抖热重载没有生效')
  writeFileSync(join(pdir, 'other.md'), '另一个角色', 'utf8')
  assert.equal(store.use('other'), true)
  assert.equal(store.text(), '另一个角色')
  assert.equal(store.use('不存在'), false)
  store.dispose()

  const real = createPersonaStore(ROOT, { enabled: false })
  assert.ok(real.text().includes('IDENTITY'))
  assert.equal(real.use('default.md'), true)
  real.dispose()
})

test('judge 启发式项已标注且默认关闭', () => {
  assert.ok(CASES.judgeHeuristic.length >= 2)
  assert.ok(CASES.judgeHeuristic.every((j) => j.enabled === false))
})

test.after(() => {
  try { rmSync(TMP, { recursive: true, force: true }) } catch { /* 临时目录清理失败不影响结果 */ }
})
