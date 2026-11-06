import { addFact, addOpenItem, addEpisode, hasReason, type AddFactInput } from './ledger.js'
import type { V3State } from './types.js'

/** §8 通道二：中文对话关键词，不注册成命令。 */
export type KeywordAction = 'anchor' | 'tier' | 'export' | 'reset' | null

export function detectKeyword(text: string): KeywordAction {
  const t = String(text || '').trim()
  if (/^(锚|复盘|你都记得啥|还记得什么|记得啥)$/.test(t) || /^(锚|复盘)[，。!！?？\s]*$/.test(t)) return 'anchor'
  if (/你现在什么档|我们算什么关系|什么关系|档位/.test(t)) return 'tier'
  if (/导出一下|把记忆给我|导出记忆|导出锚点/.test(t)) return 'export'
  if (/^重置$|^回锚$/.test(t)) return 'reset'
  return null
}

export interface ExtractResult {
  added: number
  duplicates: number
  illegalRestatements: string[]
  openItems: string[]
  changedTopic: boolean
  terse: boolean
  positive: boolean
  selfDisclosure: boolean
  specificPraise: boolean
  hitSore: boolean
  userPush: boolean
  offense: string | null
  keyword: KeywordAction
}

const FOOD = /油条|煎饼|包子|豆浆|咖啡|奶茶|火锅|麻辣烫|烤肉|面条|米饭|饺子|蛋糕|烧烤|螺蛳粉|小龙虾|沙拉|三明治|粥|串串|炸鸡|披萨/
const FOOD_VERB = /想吃|吃了|爱吃|不吃|点了|买(了|的)|尝了|馋|早饭|早餐|午饭|晚餐|夜宵/
const PLACE = /公司|地铁|家|店里|商场|超市|公园|医院|学校|济南|泉城|大明湖|宽厚里|楼下|工位|办公室|出差/
const TIME = /周[一二三四五六日天]|明天|后天|今天|下周|这周|周末|早上|中午|晚上|\d{1,2}点|月底|月初/
const PERSON = /我妈|我爸|我同事|我朋友|我领导|我老板|我们组|闺蜜|前任|同学/
const PREF = /不吃|不喜欢|讨厌|过敏|爱吃|喜欢|最怕|受不了|习惯/
const PROMISE = /答应|说好|约好|下次|改天|等我|带你看|给你看|帮你|陪你|一起去看|到时候/
const EVENT = /加班|出差|开会|考试|搬家|生病|感冒|面试|项目|上线|团建|放假|旅游|生日/

const PRAISE = /好看|好听|厉害|靠谱|细心|温柔|有意思|真棒|不错|谢谢你|辛苦了|说得对|懂我|记得我/
const SELF = /我今天|我最近|我以前|我小时候|我其实|我跟你说|我妈|我爸|我有点|我总是|我从来/
const PUSH = /在一起|做我女朋友|喜欢你|想你|见个面|约一下|我们算什么|要不要试试|牵手|抱一下/
const OFFENSE = /别的女生|其他女生|前女友|爽约|放我鸽子|不来了|别问了|不想说|你别管|关你什么事/
const SORE = /你怎么又|烦不烦|有意思吗|随便你|行了行了|别发了|你懂什么|啰嗦/
const TERSE = /^(哦|嗯|啊|哦哦|嗯嗯|好|行|是的|对|ok|OK|呵|额|6|1|\.|\.\.\.|。|、)+[。.！!？?~～\s]*$/

/** 规则层事实抽取（§5.3 ③）。零成本，覆盖约七成；模型层留给可选扩展。 */
export function extractRules(text: string): AddFactInput[] {
  const out: AddFactInput[] = []
  const t = String(text || '').trim()
  if (!t) return out

  const push = (kind: AddFactInput['kind'], sentence: string, confidence: number, importance = 0.6): void => {
    const clean = sentence.trim().slice(0, 80)
    if (clean) out.push({ kind, text: clean, speaker: 'him', confidence, importance })
  }
  const firstSentence = t.split(/[。！？!?\n；;]/)[0] ?? t

  if (PREF.test(t) && (FOOD.test(t) || /香菜|辣|葱|姜|蒜|甜|冰/.test(t))) {
    push('pref', `他说${firstSentence}`, 0.92, 0.9)
  }
  if (FOOD.test(t) && FOOD_VERB.test(t)) {
    push('food', `他说${firstSentence}`, 0.9, 0.65)
  }
  if (PROMISE.test(t)) {
    push('event', `他说${firstSentence}`, 0.85, 0.75)
  }
  if (TIME.test(t) && (PLACE.test(t) || EVENT.test(t))) {
    push('time', `他说${firstSentence}`, 0.78, 0.6)
  }
  if (PLACE.test(t) && /在|去|到|回/.test(t) && !TIME.test(t)) {
    push('place', `他说${firstSentence}`, 0.75, 0.55)
  }
  if (PERSON.test(t)) {
    push('person', `他说${firstSentence}`, 0.8, 0.65)
  }
  if (EVENT.test(t) && !PROMISE.test(t)) {
    push('event', `他说${firstSentence}`, 0.72, 0.55)
  }
  return out
}

/** 每轮流水线 ③~⑤：抽取 → addFact（含 dedupe / 改口检测）→ 未结事项 / 情景压缩。 */
export function extractAndCommit(state: V3State, text: string, now: Date): ExtractResult {
  const t = String(text || '').trim()
  const r: ExtractResult = {
    added: 0, duplicates: 0, illegalRestatements: [], openItems: [],
    changedTopic: false, terse: TERSE.test(t), positive: PRAISE.test(t),
    selfDisclosure: SELF.test(t), specificPraise: PRAISE.test(t),
    hitSore: SORE.test(t), userPush: PUSH.test(t),
    offense: OFFENSE.test(t) ? t.slice(0, 40) : null,
    keyword: detectKeyword(t),
  }
  if (!t) return r

  const previous = state.runtime.lastUserText
  r.changedTopic = previous.length > 0 && similarityTopic(previous, t) < 0.15

  for (const input of extractRules(t)) {
    // 改口必须带理由：把本轮原文的理由词透传
    if (!hasReason(t) && input.kind === 'food' && state.ledger.facts.some((f) => f.kind === 'food')) {
      // 让 ledger 自己判断是不是同类冲突；这里不预判
    }
    const res = addFact(state, input, now)
    if (res.duplicate) r.duplicates++
    else if (res.fact) r.added++
    if (res.illegalRestatement) r.illegalRestatements.push(res.fact?.text ?? input.text)
  }

  if (PROMISE.test(t) && /下次|改天|等我|到时候|答应|说好/.test(t)) {
    const what = t.split(/[。！？!?\n；;]/)[0]!.slice(0, 50)
    if (!state.ledger.openItems.some((o) => o.what === what)) {
      addOpenItem(state, what)
      r.openItems.push(what)
    }
  }

  if (t.length >= 12 && state.turn % 2 === 0) {
    addEpisode(state, t.slice(0, 60), r.positive ? 'good' : r.offense ? 'conflict' : 'chat', now)
  }
  state.runtime.lastUserText = t
  state.runtime.userLen = t.length
  return r
}

/** 极低配话题相似度：共享 2 字组合的比例。 */
function similarityTopic(a: string, b: string): number {
  const gs = (s: string) => {
    const x = s.replace(/[\s，。！？、,.!?]/g, '')
    const set = new Set<string>()
    for (let i = 0; i < x.length - 1; i++) set.add(x.slice(i, i + 2))
    return set
  }
  const A = gs(a), B = gs(b)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  return hit / Math.max(A.size, B.size)
}

/** 是否该在对话里主动输出锚点块（§5.6）。 */
export function shouldShowAnchor(state: V3State, keyword: KeywordAction, interval: number, important: boolean): boolean {
  if (keyword === 'anchor') return true
  if (important) return true
  return state.turn - state.runtime.lastAnchorOutputTurn >= interval
}
