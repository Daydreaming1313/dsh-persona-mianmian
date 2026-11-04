import type { Completeness, DaySlot, LengthBand, MianmianState, Roll, Tone } from './types.js'
import { phaseSignals } from './cycle.js'

function weighted<T extends string>(entries: ReadonlyArray<readonly [T, number]>, rng: () => number): T {
  const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0)
  let r = rng() * total
  for (const [value, w] of entries) {
    r -= Math.max(0, w)
    if (r <= 0) return value
  }
  return entries[entries.length - 1]![0]
}

/** §3.6 每轮必做的五步掷骰。 */
export function roll(
  state: MianmianState,
  slot: DaySlot,
  shareChanceValue: number,
  leaveChanceValue: number,
  repeatLevel: number,
  rng: () => number = Math.random,
): Roll {
  const signals = phaseSignals(state.phase)
  const tired = state.energy < 0.35
  const annoyed = state.patience < 0.35 || state.pushed

  // 1. 长度档：短 / 中 / 长 / 单 emoji，按 energy 与 busyUntil 加权
  const [, maxLen] = slot.lengthRange
  const longAllowed = maxLen >= 45 && !tired && !annoyed
  // 日常以 20–60 字为主，短档只在急、困、被缠、睡眠时出现，避免字数分布塌到 10 字以内
  let length = weighted<LengthBand>([
    ['short', 0.08 + (tired ? 0.25 : 0) + (annoyed ? 0.18 : 0) + (slot.id === 'sleep' ? 0.50 : 0)],
    ['medium', 0.55 + (longAllowed ? 0 : 0.20)],
    ['long', longAllowed ? 0.30 : 0.01],
    ['emoji', (slot.id === 'sleep' || annoyed) ? 0.12 : 0.03],
  ], rng)
  if (state.busyUntil > 0) length = 'short'
  // 00:00 以后极慢或已读不回，不会半夜发一长段
  else if (slot.id === 'sleep') length = rng() < 0.85 ? 'short' : 'emoji'

  // 2. 完整度：说完 / 半句 / 想到别的直接跳走
  const completeness = weighted<Completeness>([
    ['full', annoyed ? 0.28 : 0.50],
    ['half', 0.32 + (tired ? 0.15 : 0)],
    ['jump', 0.18 + (state.phase === 'ovulation' ? 0.10 : 0)],
  ], rng)

  // 3. 情绪档：暖 / 冷 / 平，全天不可能都暖，也不该一整天缺某一档
  const [warmW, coldW, flatW] = signals.toneWeights
  const recent = state.toneHistory?.slice(-8) ?? []
  const boost = (t: Tone): number => recent.includes(t) ? 1 : 2.8
  let tone = weighted<Tone>([
    ['warm', warmW * (annoyed ? 0.25 : 1) * (tired ? 0.7 : 1) * boost('warm')],
    ['cold', (coldW + (annoyed ? 0.55 : 0) + (tired ? 0.12 : 0)) * boost('cold')],
    ['flat', flatW * boost('flat')],
  ], rng)
  const lastTwo = state.recentRolls.slice(-2)
  if (lastTwo.length === 2 && lastTwo.every((r) => r.tone === 'warm') && tone === 'warm') {
    tone = rng() < 0.5 ? 'flat' : 'cold'
  }
  // 只在「追问到第三遍」那一轮强制不耐烦；再往后不锁死情绪，否则长对话会永远冷
  if (repeatLevel === 3) tone = 'cold'

  // 硬规则：相邻 3 条在长度档与情绪档上不得完全相同
  if (lastTwo.length === 2
    && lastTwo.every((r) => r.length === length && r.tone === tone)) {
    const altLength: LengthBand[] = ['short', 'medium', 'long', 'emoji'].filter((x) => x !== length) as LengthBand[]
    const altTone: Tone[] = ['warm', 'cold', 'flat'].filter((x) => x !== tone) as Tone[]
    if (rng() < 0.5) length = altLength[Math.floor(rng() * altLength.length)] ?? length
    else tone = altTone[Math.floor(rng() * altTone.length)] ?? tone
  }

  // 4. 分享：本轮回不回一件她自己的事
  const share = rng() < shareChanceValue && !state.pushed

  // 5. 离开：说完要不要顺势消失一阵
  const leave = rng() < leaveChanceValue && !state.returning && state.busyUntil === 0

  return { length, completeness, tone, share, leave }
}

/** 掷骰结果写回 history，供下一轮的相邻 3 条规则使用。 */
export function commitRoll(state: MianmianState, r: Roll): void {
  state.recentRolls = [...state.recentRolls, { length: r.length, tone: r.tone }].slice(-2)
  state.toneHistory = [...(state.toneHistory ?? []), r.tone].slice(-10)
  state.lastLengthBand = r.length
  state.lastTone = r.tone
}
