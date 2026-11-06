import type { Fact, FactKind, Ledger, OpenItem, V3State } from './types.js'

let seq = 0
export function nextFactId(now: Date = new Date()): string {
  seq = (seq + 1) % 100000
  return `f_${now.getTime().toString(36)}_${String(seq).padStart(3, '0')}`
}

/** 只增不改：改口时新增一条带 supersedes + reason，旧条目标记失效。 */
export interface AddFactInput {
  kind: FactKind
  text: string
  speaker?: 'him' | 'her'
  confidence?: number
  importance?: number
  validUntil?: string | null
  supersedes?: string | null
  reason?: string | null
}

/** 中文 bigram Dice 相似度，零依赖、对短句稳定。 */
export function similarity(a: string, b: string): number {
  const norm = (s: string) => s.replace(/[\s，。！？、,.!?~～]/g, '')
  const x = norm(a), y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    if (s.length === 1) m.set(s, 1)
    return m
  }
  const ga = grams(x), gb = grams(y)
  let overlap = 0, total = 0
  for (const [g, n] of ga) { total += n; overlap += Math.min(n, gb.get(g) ?? 0) }
  let tb = 0
  for (const n of gb.values()) tb += n
  return (2 * overlap) / (total + tb || 1)
}

/** 理由词（§5.3 ⑤）。命中才算合法改口。 */
export const REASON_WORDS = /算了|改了|来不及|换成|不去了|改天|取消了|忘带|收摊|卖完|临时|改成|还是.{0,4}吧|不吃了|不想吃了/

export function hasReason(text: string): boolean {
  return REASON_WORDS.test(text)
}

/**
 * 冲突判定：同类且「说的是同一件事」但措辞变了，视为改口而非新增事实。
 * 纯相似度阈值不够：加了理由的改口句会变长，Dice 分数反而掉到 0.2 左右
 * （「他说早上想吃油条」vs「他说起晚了摊子收了 油条算了」只有 0.21）。
 * 所以补一条：同类 + 共享至少一个非停用双字词 = 同一话题。
 */
const STOP_BIGRAMS = new Set(['他说', '她说', '我们', '你们', '这个', '那个', '一下', '不太', '什么', '怎么'])

function sharedContentBigram(a: string, b: string): boolean {
  const clean = (s: string) => s.replace(/[\s，。！？、,.!?~～]/g, '')
  const x = clean(a), y = clean(b)
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2)
    if (!STOP_BIGRAMS.has(g) && y.includes(g)) return true
  }
  return false
}

export function findConflict(ledger: Ledger, input: AddFactInput): Fact | null {
  const pool = [...ledger.facts, ...ledger.hisPrefs]
  for (const f of pool) {
    if (f.kind !== input.kind) continue
    if (f.text === input.text) return null // 完全重复，交给 dedupe
    const s = similarity(f.text, input.text)
    if (s > 0.9) continue // 高度相似交给 dedupe
    if (s >= 0.18 || sharedContentBigram(f.text, input.text)) return f
  }
  return null
}

export interface AddResult {
  fact: Fact | null
  duplicate: boolean
  restatement: boolean
  /** 无理由的改口 → drift 违例 */
  illegalRestatement: boolean
}

export function addFact(state: V3State, input: AddFactInput, now: Date): AddResult {
  const { ledger } = state
  const table = input.kind === 'pref' ? ledger.hisPrefs : ledger.facts
  // ④ dedupe：>0.9 视为重复，只更新 turn
  for (const f of table) {
    if (similarity(f.text, input.text) > 0.9) {
      f.turn = state.turn
      return { fact: f, duplicate: true, restatement: false, illegalRestatement: false }
    }
  }
  // ⑤ 改口检测
  const conflict = findConflict(ledger, input)
  const reason = hasReason(input.text) ? (input.reason ?? '他本轮给了理由') : null
  const restatement = conflict !== null
  const illegalRestatement = restatement && reason === null
  const fact: Fact = {
    id: nextFactId(now),
    kind: input.kind,
    text: input.text,
    speaker: input.speaker ?? 'him',
    turn: state.turn,
    at: now.toISOString(),
    validUntil: input.validUntil ?? null,
    supersedes: conflict?.id ?? input.supersedes ?? null,
    reason: conflict ? reason : input.reason ?? null,
    confidence: input.confidence ?? 0.9,
    importance: input.importance ?? (input.kind === 'pref' ? 0.85 : input.kind === 'event' ? 0.7 : 0.6),
  }
  table.push(fact)
  return { fact, duplicate: false, restatement, illegalRestatement }
}

/** 有效期到期自动降权（不删除，只把 confidence 压到模糊提示）。 */
export function expireFacts(ledger: Ledger, now: Date): number {
  let n = 0
  for (const f of [...ledger.facts, ...ledger.hisPrefs]) {
    if (f.validUntil && Date.parse(f.validUntil) <= now.getTime() && f.confidence >= 0.6) {
      f.confidence = 0.5
      n++
    }
  }
  return n
}

/** 未结事项：漏掉最伤人，单独一表。 */
export function addOpenItem(state: V3State, what: string): OpenItem {
  const item = { what, sinceTurn: state.turn, nudged: false }
  state.ledger.openItems.push(item)
  return item
}

export function resolveOpenItem(state: V3State, what: string): boolean {
  const i = state.ledger.openItems.findIndex((o) => similarity(o.what, what) > 0.7)
  if (i < 0) return false
  state.ledger.openItems.splice(i, 1)
  return true
}

/** 情景记忆滚动窗口：最近 8 轮要点。 */
export const EPISODE_WINDOW = 8

export function addEpisode(state: V3State, summary: string, tag: string, now: Date): void {
  state.ledger.episodes.push({ turn: state.turn, at: now.toISOString(), summary, tag })
  if (state.ledger.episodes.length > EPISODE_WINDOW) {
    state.ledger.episodes.splice(0, state.ledger.episodes.length - EPISODE_WINDOW)
  }
}

/** §5.4 排序：近因 × 0.6 + 重要性 × 0.4。 */
export function rankFacts(ledger: Ledger, turn: number, budget: number): Fact[] {
  const pool = [...ledger.facts, ...ledger.hisPrefs]
    .filter((f) => f.confidence >= 0.6)
  const scored = pool.map((f) => {
    const recency = 1 / (1 + Math.max(0, turn - f.turn) / 12)
    return { f, score: recency * 0.6 + f.importance * 0.4 }
  })
  scored.sort((a, b) => b.score - a.score || a.f.turn - b.f.turn)
  return scored.slice(0, budget).map((s) => s.f)
}

/** 台账一致性：文本里出现与台账相冲突、且不带理由的断言。 */
export function contradictsLedger(text: string, ledger: Ledger): string | null {
  const prefs = ledger.hisPrefs.filter((f) => f.confidence >= 0.6)
  for (const f of prefs) {
    // 「你又不吃香菜」这类：把他没说过的偏好当成已知
    const key = f.text.replace(/^他(说|明确说|不吃|喜欢|不喜欢)*/, '').trim()
    if (!key) continue
    const negated = new RegExp(`(又不|又不|不是.*不|明明.*不)`)
    if (negated.test(text) && !hasReason(text)) {
      // 台账里是肯定偏好，文本里出现带「又」的否定暗示 → 疑似编造
      if (/不吃|不喜欢|讨厌/.test(f.text) && /你又/.test(text)) return f.text
    }
  }
  return null
}
