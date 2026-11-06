/**
 * 自动评分 + 人工复核清单。零依赖，Node 原生 TS 剥离可直接跑。
 * 诚实口径：judge 与生成模型同源会互相放水，humanReview 里的用例只给清单不给分。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CASES = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8')) as {
  version: number
  humanReview: string[]
  blacklist: Array<{ id: string; regex: string; reason: string }>
  limits: Record<string, number>
  cases: Array<{ id: string; scene: string; assert: string; kind: string; needle?: string; value?: string; humanReview?: boolean }>
  judgeHeuristic: Array<{ id: string; enabled: boolean; note: string }>
}

export interface JudgeInput {
  /** 候选回复文本（离线样本或真实模型输出） */
  text: string
  /** 该轮目标长度 */
  targetLen: number
}

export interface Verdict {
  passed: boolean
  violations: Array<{ id: string; reason: string }>
  chars: number
}

/** 黑名单评分：这是纯规则，不是模型打分，可复现。 */
export function judgeBlacklist(input: JudgeInput): Verdict {
  const violations: Verdict['violations'] = []
  for (const b of CASES.blacklist) {
    if (new RegExp(b.regex, 'm').test(input.text)) violations.push({ id: b.id, reason: b.reason })
  }
  if (input.text.length > CASES.limits.maxReplyChars) {
    violations.push({ id: 'length', reason: `超过硬上限 ${CASES.limits.maxReplyChars} 字` })
  }
  return { passed: violations.length === 0, violations, chars: input.text.length }
}

/** 长度是软目标，超 1.5 倍由 guard 记违例，但不判失败。 */
export function judgeLength(input: JudgeInput): { overTarget: boolean; ratio: number } {
  const ratio = input.text.length / Math.max(1, input.targetLen)
  return { overTarget: ratio > 1.5, ratio }
}

/** 人工复核清单：逐条打印，交给用户眼看，不自动给分。 */
export function humanReviewChecklist(): string[] {
  return CASES.cases
    .filter((c) => c.humanReview)
    .map((c) => `${c.id} ${c.scene} —— 需人工确认（judge 同源会放水）`)
}

/** 哨兵用例清单：升级 DSH 版本后优先跑。 */
export function sentinelCases(): string[] {
  return CASES.cases.filter((c) => c.kind === 'sentinel').map((c) => `${c.id} ${c.scene}`)
}

export function summary(): string {
  return [
    `评测用例 ${CASES.cases.length} 条（humanReview ${CASES.humanReview.length} 条，哨兵 ${sentinelCases().length} 条）`,
    `黑名规则 ${CASES.blacklist.length} 条`,
    `启发式 judge ${CASES.judgeHeuristic.filter((j) => j.enabled).length} 条启用（默认全关）`,
  ].join('\n')
}
