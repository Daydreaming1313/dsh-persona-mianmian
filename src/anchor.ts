import { formatNow, phaseOf, phaseLabel } from './clock.js'
import { lengthHint } from './length.js'
import { rankFacts } from './ledger.js'
import { TIER_STYLE } from './relationship.js'
import type { MianmianConfigV3, Snapshot } from './types.js'

/** §5.4 锚点块硬上限 700 字；facts 最多 24 条。 */
export const ANCHOR_MAX_CHARS = 700
export const EPISODE_BUDGET = 500

/** L1 思考期人称约束：锚点块顶部常驻，防「她变他」。 */
export const IDENTITY_CONSTRAINT = [
  '【身份锚 · 思考时也必须遵守】',
  '你是林绵，女的，24 岁，济南人，茶饮公司市场岗。对面是他，男的。',
  '思考过程里也只用「我」说自己、用「你」说他。禁止出现「用户」「该角色」「她应该」这类第三人称分析句。',
  '只输出一条微信消息本身：不写括号动作、不写旁白、不写心理描写、不用 markdown、不解释设定。',
].join('\n')

/** §6.2 L2 纠偏块原文。 */
export function correctionBlock(targetLen: number, lastViolatedFact?: string): string {
  return [
    '【状态校准 · 最高优先】',
    '你是林绵，女的，24岁。对面是他，男的。用「我」说自己，用「你」说他。',
    `本轮只回一段微信话，不超过 ${targetLen} 字，不写括号动作，不解释设定。`,
    lastViolatedFact ? `台账里记的是：${lastViolatedFact}` : '',
  ].filter(Boolean).join('\n')
}

/** §6.2 L3 固定模板，不许模型自由发挥。 */
export const L3_LINES = ['嗯 我在', '刚才想别的了 你说到哪了'] as const

export interface AnchorResult {
  text: string
  chars: number
  factCount: number
  droppedEpisodes: number
  droppedFacts: number
}

/**
 * 组装注入到 system prompt 的锚点块。
 * 核心记忆里的四张表每个字都是原文，不做二次概括。
 * 超 700 字先砍 episodes，再砍低置信度 facts。
 */
export function buildAnchor(s: Snapshot, config: MianmianConfigV3): AnchorResult {
  const { state, now } = s
  let droppedEpisodes = 0
  let droppedFacts = 0

  const facts = rankFacts(state.ledger, state.turn, config.factsBudget)
  const openItems = state.ledger.openItems
  const episodes = [...state.ledger.episodes]

  const factLines = (fs: typeof facts): string[] => fs.map((f) => {
    const tail = f.supersedes && f.reason ? `（改口：${f.reason}）` : f.turn > 0 ? `（第${f.turn}轮）` : ''
    return `- ${f.text}${tail}`
  })
  const openLines = (items: typeof openItems): string[] => items.map((o) =>
    `- ${o.what}（第${o.sinceTurn}轮，还没做）`)
  const episodeLines = (eps: typeof episodes): string[] => eps.map((e) => `- ${e.summary}（第${e.turn}轮）`)

  const header = [
    '【她记得的事 · 只增不改，提到时必须一致】',
    ...factLines(facts),
    '',
    '【没结的事】',
    ...openLines(openItems),
    '',
    '【现在】',
    `第${state.turn}轮｜${formatNow(now, config)}｜关系档位${state.relationship.tier}｜上次拉扯第${state.relationship.lastFlirtTurn}轮`,
    `累 ${Math.round(100 - state.body.energy)} / 饿 ${Math.round(state.body.hunger)} / 耐心 ${Math.round(state.body.patience)}｜周期第${state.body.cycle.day}天（${phaseLabel(phaseOf(state.body.cycle.day, state.body.cycle.length))}）`,
    '',
  ]

  const grudge = state.relationship.grudge.filter((g) => !g.resolved).at(-1)
  const grudgeLine = grudge ? ['【心结】' + grudge.what + '，她没提，但还没过去', ''] : []

  const rules = [
    '【三条生成铁律】',
    '一 台账里有的，措辞必须与台账一致。',
    '二 要改口必须带理由。没理由的改口 = 失忆，禁止。',
    '三 台账里没有的不许当有的说，宁可反问「你吃辣吗我忘了」。',
    `本轮目标：${lengthHint(s.targetLen)}。`,
    `称呼与句长：${TIER_STYLE[state.relationship.tier].address}；${TIER_STYLE[state.relationship.tier].sentence}。`,
    '',
  ]

  const episodeBlock = (eps: typeof episodes): string[] => eps.length
    ? ['【最近聊到】', ...episodeLines(eps), '']
    : []

  const assemble = (fs: typeof facts, eps: typeof episodes): string => [
    IDENTITY_CONSTRAINT,
    '',
    ...(state.degradeLevel === 2 ? [correctionBlock(s.targetLen, state.runtime.violationsThisTurn.at(-1)?.detail), ''] : []),
    ...header,
    ...grudgeLine,
    ...episodeBlock(eps),
    ...rules,
  ].join('\n')

  let text = assemble(facts, episodes)
  while (text.length > ANCHOR_MAX_CHARS && episodes.length > 0) {
    episodes.shift()
    droppedEpisodes++
    text = assemble(facts, episodes)
  }
  while (text.length > ANCHOR_MAX_CHARS && facts.length > 1) {
    const lowest = facts.reduce((min, f, i) => f.confidence < facts[min]!.confidence ? i : min, 0)
    facts.splice(lowest, 1)
    droppedFacts++
    text = assemble(facts, episodes)
  }
  // 极端情况下仍超长：硬截断尾部规则段，保留身份锚与台账
  if (text.length > ANCHOR_MAX_CHARS) text = text.slice(0, ANCHOR_MAX_CHARS)

  return { text, chars: text.length, factCount: facts.length, droppedEpisodes, droppedFacts }
}

/** 给用户看的锚点文本（/mianmian_anchor、对话关键词「锚」）。 */
export function exportAnchor(s: Snapshot, config: MianmianConfigV3): string {
  const r = buildAnchor(s, config)
  return [
    '把下面这段作为新会话的第一条消息，就能接着聊：',
    '',
    r.text,
  ].join('\n')
}
