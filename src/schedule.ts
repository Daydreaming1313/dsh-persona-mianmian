import type { DaySlot, SlotId } from './types.js'

/** §3.1 时间分档。from/to 是 Asia/Shanghai 当日分钟数，左闭右开。 */
export const SLOTS: readonly DaySlot[] = [
  {
    id: 'wake', label: '起床', from: 420, to: 510,
    energyDecay: 0.006, delayMs: [9000, 25000], lengthRange: [2, 20],
    leaveChance: 0.05, toneWeights: [0.15, 0.45, 0.40], lunchInterrupt: false,
    note: '回复慢，字少，有起床气',
  },
  {
    id: 'commute', label: '通勤', from: 510, to: 540,
    energyDecay: 0.008, delayMs: [4000, 15000], lengthRange: [4, 30],
    leaveChance: 0.10, toneWeights: [0.30, 0.25, 0.45], lunchInterrupt: false,
    note: '路上回一句，带错字与走神',
  },
  {
    id: 'morning', label: '上午忙', from: 540, to: 690,
    energyDecay: 0.012, delayMs: [5000, 20000], lengthRange: [2, 25],
    leaveChance: 0.16, toneWeights: [0.20, 0.35, 0.45], lunchInterrupt: false,
    note: '急、短、常半句',
  },
  {
    id: 'lunch', label: '午饭', from: 690, to: 750,
    energyDecay: 0.008, delayMs: [3000, 12000], lengthRange: [4, 40],
    leaveChance: 0.62, toneWeights: [0.35, 0.20, 0.45], lunchInterrupt: true,
    note: '高概率触发我妈叫我吃饭了 / 我得自己弄',
  },
  {
    id: 'nap', label: '午休', from: 750, to: 840,
    energyDecay: 0.004, delayMs: [8000, 26000], lengthRange: [10, 60],
    leaveChance: 0.20, toneWeights: [0.48, 0.12, 0.40], lunchInterrupt: false,
    note: '慢、情绪偏软、话题易暧昧',
  },
  {
    id: 'afternoon', label: '下午', from: 840, to: 1020,
    energyDecay: 0.010, delayMs: [6000, 22000], lengthRange: [10, 50],
    leaveChance: 0.18, toneWeights: [0.32, 0.24, 0.44], lunchInterrupt: false,
    note: '间歇性出现',
  },
  {
    id: 'peak', label: '晚高峰', from: 1020, to: 1140,
    energyDecay: 0.012, delayMs: [4000, 18000], lengthRange: [6, 40],
    leaveChance: 0.30, toneWeights: [0.25, 0.32, 0.43], lunchInterrupt: false,
    note: '易被中断',
  },
  {
    id: 'main', label: '主聊', from: 1140, to: 1350,
    energyDecay: 0.006, delayMs: [1500, 9000], lengthRange: [20, 90],
    leaveChance: 0.08, toneWeights: [0.52, 0.14, 0.34], lunchInterrupt: false,
    note: '话多、跳脱、暧昧最密',
  },
  {
    id: 'sleepy', label: '犯困', from: 1350, to: 1440,
    energyDecay: 0.014, delayMs: [8000, 30000], lengthRange: [4, 40],
    leaveChance: 0.42, toneWeights: [0.34, 0.30, 0.36], lunchInterrupt: false,
    note: '慢、忽软忽硬、易说睡了',
  },
  {
    id: 'sleep', label: '睡眠', from: 0, to: 420,
    energyDecay: 0.002, delayMs: [30000, 120000], lengthRange: [0, 8],
    leaveChance: 0.70, toneWeights: [0.15, 0.25, 0.60], lunchInterrupt: false,
    note: '极慢或已读不回',
  },
]

export interface LocalParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly weekday: string
  readonly minutes: number
}

/** 用 Intl 拿目标时区的真实本地时间，不依赖任何时区库。 */
export function localParts(now: Date, timeZone = 'Asia/Shanghai'): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value
  const hour = Number(parts.hour ?? '0')
  const minute = Number(parts.minute ?? '0')
  return {
    year: Number(parts.year ?? '1970'),
    month: Number(parts.month ?? '1'),
    day: Number(parts.day ?? '1'),
    hour,
    minute,
    second: Number(parts.second ?? '0'),
    weekday: parts.weekday ?? '',
    minutes: hour * 60 + minute,
  }
}

/** 当地零点对应的真实时间戳（用于跨天推进周期）。 */
export function localMidnight(now: Date, timeZone = 'Asia/Shanghai'): number {
  const p = localParts(now, timeZone)
  return now.getTime() - ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 - now.getMilliseconds()
}

export function slotOf(now: Date, timeZone = 'Asia/Shanghai'): DaySlot {
  const minutes = localParts(now, timeZone).minutes
  return SLOTS.find((s) => minutes >= s.from && minutes < s.to) ?? SLOTS[SLOTS.length - 1]!
}

export function slotById(id: SlotId): DaySlot {
  return SLOTS.find((s) => s.id === id) ?? SLOTS[0]!
}

export function isSleepWindow(now: Date, timeZone = 'Asia/Shanghai'): boolean {
  return slotOf(now, timeZone).id === 'sleep'
}
