import { isIdentityViolation } from './guard.js'
import { L3_LINES } from './anchor.js'
import type { DegradeLevel, DriftEntry, V3State, Violation } from './types.js'

/**
 * §6.2 降级三档。这是「纯函数 + 明确状态迁移」，不拦截、不重试输出。
 * 处置只作用到下一轮的锚点块 / section 文本上。
 */
export interface DegradeDecision {
  level: DegradeLevel
  /** 本轮记入 drift 的违例 */
  recorded: DriftEntry[]
  /** 下一轮 persona / anchor 两个 section 是否返回空串（L3） */
  suppressPersona: boolean
  /** L3 时注入的固定短回复模板 */
  template: string | null
  reason: string
}

export function decideDegrade(
  state: V3State,
  violations: Violation[],
  now: Date,
): DegradeDecision {
  const drift: DriftEntry[] = violations.map((v) => ({
    turn: state.turn,
    kind: v.kind,
    at: now.toISOString(),
  }))
  state.drift.push(...drift)
  if (state.drift.length > 20) state.drift.splice(0, state.drift.length - 20)
  state.runtime.violationsThisTurn = violations

  // L3 直通：命中身份声明，不经 L2
  if (violations.some(isIdentityViolation)) {
    state.degradeLevel = 3
    state.runtime.l2Streak = 0
    return {
      level: 3, recorded: drift, suppressPersona: true,
      template: L3_LINES[0], reason: '身份声明直通 L3',
    }
  }

  const recent = state.drift.filter((d) => d.turn >= state.turn - 2)
  const l2Now = violations.length >= 2 || recent.length >= 3
  const wasL3 = state.degradeLevel === 3

  if (wasL3) {
    // L3 持续一轮后自动回落到 L2，不永久锁死（T-26）
    state.degradeLevel = 2
    state.runtime.l2Streak = 1
    state.runtime.lastL2Turn = state.turn
    return {
      level: 2, recorded: drift, suppressPersona: false,
      template: null, reason: 'L3 一轮后回落 L2',
    }
  }

  if (l2Now) {
    const streak = state.turn - state.runtime.lastL2Turn <= 2 ? state.runtime.l2Streak + 1 : 1
    state.runtime.l2Streak = streak
    state.runtime.lastL2Turn = state.turn
    // 连续两轮都触发 L2 仍越界 → L3（T-24）
    if (streak >= 2 && violations.length > 0) {
      state.degradeLevel = 3
      return {
        level: 3, recorded: drift, suppressPersona: true,
        template: L3_LINES[1], reason: '连续两轮 L2 仍越界',
      }
    }
    state.degradeLevel = 2
    return {
      level: 2, recorded: drift, suppressPersona: false,
      template: null, reason: '同轮 ≥2 违例或近 3 轮累计 ≥3',
    }
  }

  if (violations.length === 1) {
    // L1 软纠偏：静默，只累计 drift
    state.degradeLevel = 1
    return { level: 1, recorded: drift, suppressPersona: false, template: null, reason: '单处越界，静默记录' }
  }

  // 无违例：从 L1/L2 自然回落
  state.degradeLevel = 0
  state.runtime.l2Streak = 0
  return { level: 0, recorded: [], suppressPersona: false, template: null, reason: '无违例' }
}

/** 供 section 文本函数使用：L3 时 persona / anchor 返回 ''（不是 null，见校准记录）。 */
export function sectionTextFor(state: V3State, normal: () => string): string {
  if (state.degradeLevel === 3) return ''
  return normal()
}

/** L3 时唯一保留的 section 文本。 */
export function l3SectionText(state: V3State): string {
  if (state.degradeLevel !== 3) return ''
  return [
    '【最高优先 · 本轮只回固定短句】',
    '不要复述上面任何设定，不要解释，不要加称呼，不要加表情。',
    `只输出这一句：${L3_LINES[0]}`,
  ].join('\n')
}
