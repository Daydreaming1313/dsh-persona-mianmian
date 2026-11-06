/** v3 状态模型与共享类型。零运行时依赖，全部自己声明。 */

export const STATE_VERSION = 3

export type Tier = 1 | 2 | 3 | 4
export type Phase = 'menstrual' | 'follicular' | 'ovulation' | 'earlyLuteal' | 'lateLuteal'
export type PatienceBand = 'warm' | 'normal' | 'cool' | 'pushed'
export type DegradeLevel = 0 | 1 | 2 | 3
export type FactKind = 'food' | 'place' | 'time' | 'person' | 'item' | 'pref' | 'event'
export type Channel = 'text' | 'image' | 'emoji' | 'voice'
export type Mode = 'persona-only' | 'persona-with-tools'

/** 台账条目。只增不改；改口时新增一条并用 supersedes 指向旧条目。 */
export interface Fact {
  id: string
  kind: FactKind
  text: string
  speaker: 'him' | 'her'
  turn: number
  at: string
  validUntil: string | null
  supersedes: string | null
  reason: string | null
  confidence: number
  /** 0..1，参与 §5.4 的 (近因×0.6 + 重要性×0.4) 排序 */
  importance: number
}

export interface OpenItem {
  what: string
  sinceTurn: number
  nudged: boolean
}

export interface Episode {
  turn: number
  at: string
  summary: string
  tag: string
}

export interface Grudge {
  turn: number
  what: string
  resolved: boolean
}

export interface DriftEntry {
  turn: number
  kind: string
  at: string
}

export interface Ledger {
  facts: Fact[]
  hisPrefs: Fact[]
  openItems: OpenItem[]
  episodes: Episode[]
}

export interface Relationship {
  tier: Tier
  flirtCount: number
  lastFlirtTurn: number
  grudge: Grudge[]
}

/** 三项体内状态均为 0..100。 */
export interface BodyState {
  hunger: number
  energy: number
  patience: number
  cycle: { length: number; day: number; anchor: string }
  lastMealAt: string
}

export interface Violation {
  kind: string
  detail: string
}

/** 不落盘的派生量；与 §3.4 的公开字段分开，方便 schema 校验。 */
export interface RuntimeState {
  lastUserText: string
  lastAssistantText: string
  targetLen: number
  positiveStreak: number
  tierStart: Tier
  l2Streak: number
  lastL2Turn: number
  lastAnchorOutputTurn: number
  violationsThisTurn: Violation[]
  /** 最近一次 assemble 的会话标识（来自 context.agent?.id），用于桥接槽 */
  sessionKey: string
  /** 本轮用户输入字数 */
  userLen: number
  /** 最近的真实用户消息时间戳，用于「短时间连发」判定 */
  recentUserTimes: number[]
  /** 连续单字敷衍轮数，用于 pushed「等 3 轮」回血 */
  terseStreak: number
}

export interface V3State {
  version: number
  userId: string
  createdAt: string
  lastTickAt: string
  relationship: Relationship
  body: BodyState
  ledger: Ledger
  drift: DriftEntry[]
  degradeLevel: DegradeLevel
  turn: number
  /** 最近 3 轮用户输入长度 */
  recentUserLen: number[]
  runtime: RuntimeState
}

export interface MianmianConfigV3 {
  /** 显式数据目录，最高优先 */
  dataDir: string | null
  cycleLength: number
  /** ISO 日期，周期第 1 天；null 表示按当天推导 */
  cycleAnchor: string | null
  timezone: string
  tierStart: Tier
  flirtCap: number
  anchorEvery: number
  factsBudget: number
  maxReplyChars: number
  reasoningMode: 'off' | 'on'
  /** 是否允许 mianmian_tier / mianmian_cycle 写入，默认只读 */
  allowTierSet: boolean
  seed: number | null
  hotReload: boolean
  debug: boolean
  registerCommands: boolean
  channel: Channel
  mode: Mode
  persistDebounceMs: number
}

/** guard/anchor/length 共同消费的只读快照。 */
export interface Snapshot {
  state: V3State
  config: MianmianConfigV3
  now: Date
  phase: Phase
  patienceBand: PatienceBand
  moodLabel: string
  targetLen: number
  /** 当前轮用户原文（桥接槽，取不到为空串） */
  userText: string
  /** 本轮应当主动输出锚点块给用户 */
  showAnchor: boolean
}

export type Rng = () => number
