import type { Phase } from './types.js'

export const DEFAULT_CYCLE_LENGTH = 28

export function normalizeCycleLength(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_CYCLE_LENGTH
  return Math.min(35, Math.max(21, Math.round(n)))
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

/** 各阶段天数按周期长度等比缩放，保证 21–35 天都能得到四个非空阶段。 */
export function phaseLengths(length: number): { menstrual: number; follicular: number; ovulation: number; luteal: number } {
  const L = normalizeCycleLength(length)
  const menstrual = clampInt(L * 5 / 28, 3, 6)
  const luteal = clampInt(L * 13 / 28, 10, 15)
  const ovulation = 4
  const follicular = Math.max(3, L - menstrual - luteal - ovulation)
  return { menstrual, follicular, ovulation, luteal }
}

/** cycleDay 从 1 开始，自动折回 1..length。 */
export function phaseOf(cycleDay: number, length = DEFAULT_CYCLE_LENGTH): Phase {
  const L = normalizeCycleLength(length)
  const d = ((Math.round(cycleDay) - 1) % L + L) % L + 1
  const { menstrual, follicular, ovulation } = phaseLengths(L)
  if (d <= menstrual) return 'menstrual'
  if (d <= menstrual + follicular) return 'follicular'
  if (d <= menstrual + follicular + ovulation) return 'ovulation'
  return 'luteal'
}

export interface PhaseSignals {
  /** 双向分享概率倍率 */
  shareMultiplier: number
  /** 暖 / 冷 / 平 抽取权重 */
  toneWeights: readonly [number, number, number]
  /** 不耐烦阈值降档：加到 leaving / pushed 判定上的压力 */
  patiencePenalty: number
  /** 只走行为、不报数字的生理信号 */
  bodyLines: readonly string[]
  /** 给模型看的行为描述，绝不出现天数 */
  descriptor: string
  /** 暧昧动作密度倍率 */
  teaseMultiplier: number
}

/** §3.2 阶段映射。所有输出都是行为描述，绝不出现「经期第 X 天」这类报数。 */
export function phaseSignals(phase: Phase): PhaseSignals {
  switch (phase) {
    case 'follicular':
      return {
        shareMultiplier: 1.20, toneWeights: [0.48, 0.14, 0.38], patiencePenalty: 0,
        bodyLines: ['精神还不错 想出门走走', '刚把窗户开了 有点风', '突然想吃点凉的'],
        descriptor: '精力不错，话比平时多，容易约人出门', teaseMultiplier: 0.9,
      }
    case 'ovulation':
      return {
        shareMultiplier: 1.35, toneWeights: [0.58, 0.10, 0.32], patiencePenalty: 0,
        bodyLines: ['今天莫名心情好', '拍了张照 想发又没发', '有点想出门'],
        descriptor: '话最多，最黏，小动作最密，容易提见面', teaseMultiplier: 1.4,
      }
    case 'luteal':
      return {
        shareMultiplier: 0.85, toneWeights: [0.22, 0.42, 0.36], patiencePenalty: 0.05,
        bodyLines: ['怕冷 想把脚缩起来', '突然想吃甜的', '有点烦 说不上为什么', '不想动 就躺着'],
        descriptor: '容易烦躁、怕冷、想吃东西，偶尔缩起来不说话', teaseMultiplier: 0.5,
      }
    case 'menstrual':
      return {
        shareMultiplier: 0.65, toneWeights: [0.18, 0.48, 0.34], patiencePenalty: 0.10,
        bodyLines: ['肚子有点坠 不想动', '你别烦我 我现在火气大', '想喝点热的', '腰酸 躺着呢'],
        descriptor: '乏力、腹痛、情绪低、回得慢，不耐烦阈值降一档', teaseMultiplier: 0.25,
      }
  }
}

export const PHASE_LABEL: Record<Phase, string> = {
  follicular: '卵泡期', ovulation: '排卵期', luteal: '黄体期', menstrual: '经期',
}
