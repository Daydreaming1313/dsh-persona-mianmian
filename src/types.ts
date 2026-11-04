/** 共享类型。本插件零运行时依赖，所有类型都在这里自己声明。 */

export type Channel = 'text' | 'image' | 'emoji' | 'voice'
export type Mode = 'persona-only' | 'persona-with-tools'
export type Phase = 'follicular' | 'ovulation' | 'luteal' | 'menstrual'
export type SlotId =
  | 'wake' | 'commute' | 'morning' | 'lunch' | 'nap'
  | 'afternoon' | 'peak' | 'main' | 'sleepy' | 'sleep'
export type LengthBand = 'short' | 'medium' | 'long' | 'emoji'
export type Tone = 'warm' | 'cold' | 'flat'
export type Completeness = 'full' | 'half' | 'jump'

/** 一个真实时间档位（时间按 Asia/Shanghai 的当日本地分钟数比较）。 */
export interface DaySlot {
  readonly id: SlotId
  readonly label: string
  readonly from: number
  readonly to: number
  readonly energyDecay: number
  readonly delayMs: readonly [number, number]
  readonly lengthRange: readonly [number, number]
  readonly leaveChance: number
  /** 暖 / 冷 / 平 的抽取权重 */
  readonly toneWeights: readonly [number, number, number]
  readonly lunchInterrupt: boolean
  readonly note: string
}

/** 一轮掷骰的结果。 */
export interface Roll {
  length: LengthBand
  completeness: Completeness
  tone: Tone
  share: boolean
  leave: boolean
}

/** 跨会话持久化的状态。所有数值都在 [0, 1] 或明确标注范围。 */
export interface MianmianState {
  version: number
  cycleDay: number
  cycleLength: number
  /** 当前周期第 1 天的本地零点时间戳，用于跨会话推进 cycleDay */
  cycleAnchor: number
  energy: number
  patience: number
  affection: number
  turn: number
  lastUserAt: number
  /** 最近的真实用户消息时间戳，用于「短时间连发」判定 */
  recentUserTimes: number[]
  /** 归一化后的问题指纹，用于追问判定 */
  lastQuestion: string
  questionCount: number
  pushed: boolean
  pushedAt: number
  busyUntil: number
  busyReason: string
  returning: boolean
  channel: Channel
  phase: Phase
  slot: SlotId
  lastLengthBand: LengthBand
  lastTone: Tone
  /** 最近两条的长度档与情绪档，用于相邻 3 条硬规则 */
  recentRolls: Array<{ length: LengthBand; tone: Tone }>
  /** 最近十轮的情绪档，用于保证一天里暖冷平都会出现 */
  toneHistory: Tone[]
  lastShareAt: number
  shareCount: number
  teaseCount: number
  lastTeaseTurn: number
  lastAnchorTurn: number
  pendingDirective: string
  lastUserText: string
  updatedAt: number
}

/** 本轮要注入给模型的运行时指令。 */
export interface Directive {
  turn: number
  slot: DaySlot
  phase: Phase
  roll: Roll
  shareLine: string
  leaveLine: string
  returnLine: string
  reset: boolean
  statusQuery: boolean
  defense: boolean
  safety: boolean
  lowMood: boolean
  tease: boolean
  typingTrace: boolean
  repeatLevel: number
  pushed: boolean
  busy: boolean
  text: string
}

/** 插件配置（cordis.patch.yml 的 config 行）。 */
export interface MianmianConfig {
  mode: Mode
  channel: Channel
  cycleLength: number
  /** 首次安装时从第几天开始；null 表示由日期推导 */
  cycleDayStart: number | null
  seed: number | null
  baseShareChance: number
  timeZone: string
  hotReload: boolean
  enableRoleAlias: boolean
  registerCommands: boolean
  stateDir: string | null
  personaFile: string | null
  debug: boolean
}

/** 可注入的随机源，便于用 seed 做回归。 */
export type Rng = () => number
