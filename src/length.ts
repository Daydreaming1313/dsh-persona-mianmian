import { timeFactor } from './clock.js'
import { bodyFactor } from './body.js'
import { TIER_FACTOR } from './relationship.js'
import type { MianmianConfigV3, V3State } from './types.js'

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/**
 * §7 长度自适应。
 * base = clamp(12 + 用户输入字数 × 0.35, 12, 240)
 * × 档位系数 × 状态系数 × 时段系数 × 降级系数
 * 长度是「目标」不是「限制」：写进锚点块当软指标，不截断输出。
 */
export function targetLength(state: V3State, config: MianmianConfigV3, now: Date): number {
  const userLen = state.runtime.userLen || 12
  const base = clamp(12 + userLen * 0.35, 12, 240)
  let n = base * TIER_FACTOR[state.relationship.tier]
  n *= bodyFactor(state)
  n *= timeFactor(now, config)
  if (state.degradeLevel === 2) n *= 0.6
  if (state.degradeLevel === 3) return 12
  return clamp(Math.round(n), 3, config.maxReplyChars)
}

/** 写进锚点块的软指标措辞（不报内部数值给「她」，只是给模型的写作目标）。 */
export function lengthHint(target: number): string {
  if (target <= 10) return '这轮只回几个字，别展开'
  if (target <= 25) return `这回一句话，${target} 字左右，别追问`
  if (target <= 60) return `这回 ${target} 字左右，一两条微信，像随手打的`
  return `他写得多，你可以回 ${target} 字左右，但别写成小作文，说完留个尾巴`
}
