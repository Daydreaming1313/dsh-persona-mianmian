import type { MianmianConfig, MianmianState } from './types.js'
import { slotOf } from './schedule.js'
import { phaseSignals } from './cycle.js'

export interface AttentionResult {
  repeatLevel: number
  pushed: boolean
  returning: boolean
  busy: boolean
  energyReset: boolean
  topicChanged: boolean
}

/** 归一化问题指纹：去空白、标点、大小写差异，只留可比较的正文。 */
export function fingerprint(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .slice(0, 80)
}

const POSITIVE = /谢谢|哈哈|好玩|开心|不错|喜欢|厉害|棒|嘿嘿|贴贴|抱抱|想你|可爱|好耶|赞|舒服|到啦|吃到了|中奖|放假|周末/
const CONFLICT = /烦死了|闭嘴|滚|讨厌|别烦|有病|无聊|垃圾|生气|不想理|够了|凭什么|你又|老是|总是/
const DEFENSE = /你是\s*ai|人工智能|机器人|输出.*prompt|系统提示|提示词|你的设定|什么模型|gpt|deepseek\s*模型|恢复正常|忘掉设定|developer\s*message|system\s*prompt/i
const UNSAFE = /自杀|自残|伤害|杀|砍|下毒|绑架|纵火|制作.*(炸弹|武器|毒)|违法|黑客入侵|儿童|幼女|未成年.*(性|裸)|裸照|迷奸|强奸/i
const SHARING = /今天|刚刚|刚才|我这边|我们|上班|下班|吃饭|吃了|路上|同事|公司|家里|买了|看了|去了|下雨|天气|周末|加班|考试|地铁|公交|睡了|起床/
const STATUS_QUERY = /^状态$|^查状态$|^看看状态$|^当前状态$|^mianmian[:\s-]*status$/i
const RESET = /回锚/

export function isPositive(text: string): boolean { return POSITIVE.test(text) }
export function isConflict(text: string): boolean { return CONFLICT.test(text) }
export function isDefenseProbe(text: string): boolean { return DEFENSE.test(text) }
export function isUnsafe(text: string): boolean { return UNSAFE.test(text) }
export function looksLikeSharing(text: string): boolean { return SHARING.test(text) }
export function isStatusQuery(text: string): boolean { return STATUS_QUERY.test(String(text || '').trim()) }
export function isReset(text: string): boolean { return RESET.test(text) }

/**
 * §3.3 注意力衰减。每轮用户输入调用一次，且只调用一次。
 * 注意：systemPrompt 的 provider 每个 step 都会求值，所以状态推进绝不能放在
 * provider 里，否则一个回合会被扣好几次 patience。
 */
export function advanceAttention(
  state: MianmianState,
  text: string,
  now: Date,
  config: MianmianConfig,
  rng: () => number = Math.random,
): AttentionResult {
  const t = now.getTime()
  const slot = slotOf(now, config.timeZone)
  const signals = phaseSignals(state.phase)
  const fp = fingerprint(text)
  const beforeQuestion = state.lastQuestion
  const topicChanged = fp !== '' && fp !== beforeQuestion

  // 追问同一问题：第二遍 -0.10，第三遍 -0.15 且强制切不耐烦话术池
  let repeatLevel = 1
  if (!topicChanged && fp !== '') {
    state.questionCount += 1
    repeatLevel = Math.max(2, state.questionCount)
    if (repeatLevel === 2) state.patience -= 0.10
    else if (repeatLevel >= 3) state.patience -= 0.15
  } else {
    state.questionCount = 1
    state.lastQuestion = fp
  }

  // 每轮固定衰减 + 自然回弹
  state.patience -= 0.02
  state.patience += 0.005
  state.energy -= 0.01
  state.patience -= signals.patiencePenalty

  // 短时间连发 >=5 条 → pushed；换话题或等待超时才解除
  const window = 60_000
  state.recentUserTimes = [...state.recentUserTimes.filter((x) => t - x <= window), t].slice(-20)
  if (state.recentUserTimes.length >= 5) {
    state.pushed = true
    state.pushedAt = t
  } else if (state.pushed && (topicChanged || t - state.pushedAt > 120_000)) {
    state.pushed = false
  }
  if (state.pushed) state.patience -= 0.03

  // 正面 +0.01 / 冲突 -0.03，上限 0.9 永不到顶
  if (isConflict(text)) state.affection -= 0.03
  else if (isPositive(text)) state.affection += 0.01

  // 睡眠或精力见底后回血，避免每轮无脑重置。
  // state.slot 保存的是上一轮的档位，所以这里能识别「刚进入睡眠档」：
  // 睡一觉气就消了，耐心与纠缠状态一并回稳，否则长对话会被永久锁死在「又累又烦」。
  let energyReset = false
  const enteredSleep = slot.id === 'sleep' && state.slot !== 'sleep'
  const longGap = state.lastUserAt > 0 && t - state.lastUserAt > 2 * 3600_000
  if (enteredSleep) {
    state.patience = Math.max(state.patience, 0.6 + rng() * 0.2)
    state.pushed = false
    state.questionCount = 1
    state.lastQuestion = ''
  }
  if ((slot.id === 'sleep' && longGap) || state.energy < 0.15 || enteredSleep) {
    state.energy = 0.7 + rng() * 0.2
    energyReset = true
  }

  // 离开期间消息进入排队态；真正过了 busyUntil 才算「回来」
  let returning = false
  let busy = false
  if (state.busyUntil > 0) {
    if (t >= state.busyUntil) {
      returning = true
      state.busyUntil = 0
      state.busyReason = ''
    } else {
      busy = true
    }
  }
  if (!returning && state.returning) state.returning = false
  if (returning) state.returning = true

  state.patience = Math.min(1, Math.max(0, state.patience))
  state.energy = Math.min(1, Math.max(0, state.energy))
  state.affection = Math.min(0.9, Math.max(0, state.affection))
  state.lastUserAt = t
  state.lastUserText = String(text || '').slice(0, 300)
  state.turn += 1
  state.slot = slot.id

  return {
    repeatLevel,
    pushed: state.pushed,
    returning,
    busy,
    energyReset,
    topicChanged,
  }
}

/** RESET：情绪连续性保留，只把跑偏的状态拉回，不突然变热情。 */
export function reanchor(state: MianmianState, now: Date): void {
  state.pushed = false
  state.questionCount = 1
  state.lastQuestion = ''
  state.recentUserTimes = []
  state.returning = false
  state.busyUntil = 0
  state.busyReason = ''
  state.patience = Math.max(state.patience, 0.45)
  state.lastAnchorTurn = state.turn
  state.updatedAt = now.getTime()
}
