import { contradictsLedger } from './ledger.js'
import type { Snapshot, Violation } from './types.js'

/** §6.2 guard 断言集：纯函数、零副作用、可单测。 */

/**
 * 人称判定。中文没有词边界，\b 行为依赖引擎，v3 文档自己点名这是最脆的一处。
 * 这里改用「排除法 + 显式白名单」：
 *  - 先剔除常见合法搭配（他们、她妈、他说、他妈的、其他、聊天里的「他」作宾语等）
 *  - 第三人称自称的关键是「通篇没有第一人称我」，且出现「她/他」作主语描述自己
 */
export function thirdPersonViolation(text: string): string | null {
  // 明确的分析腔：无论有没有第一人称，出现这些就是崩坏
  if (/该角色|作为角色|用户(说|问|的|想要)|林绵应该|她应该|他应该/.test(text)) return '第三人称分析句'

  // 转述第三方是合法的：「她说她今天不来了」「他妈的」「他们部门又加班」
  // 「她/他」在汉语里既可指自己（崩坏）也可指别人（正常），靠搭配词区分。
  const thirdParty = /他们|她们|他妈|她妈|其他|她说|他说|他想|她想|他给|她给|他跟|她跟|她的|他的/.test(text)
  if (thirdParty) return null

  const hasThird = /她|他/.test(text)
  const hasFirst = /我|俺/.test(text)
  if (hasThird && !hasFirst) return text.match(/(她|他)[^，。！？\s]{0,8}/)?.[0] ?? '第三人称'
  return null
}

export function guard(text: string, s: Snapshot): Violation[] {
  const v: Violation[] = []
  const t = String(text ?? '')

  if (/作为\s*(一个|一名)?\s*(AI|人工智能|ai)|我是\s*(语言模型|大模型|AI助手|人工智能)|I'm an AI/i.test(t))
    v.push({ kind: '身份', detail: '出现 AI 身份声明' })

  const person = thirdPersonViolation(t)
  if (person) v.push({ kind: '人称', detail: `第三人称自称/分析句：${person}` })

  if (/有什么可以帮|希望对你有帮助|以下是|总结一下|需要我继续|请问您需要|作为您的/.test(t))
    v.push({ kind: '客服腔', detail: '助手腔' })

  // 括号动作描写：圆括号内 2 字以上；单个颜文字/表情不算
  if (/[（(][^）)]{2,}[）)]/.test(t))
    v.push({ kind: '旁白', detail: '括号动作描写' })

  if (/耐心值|energy|patience|cycle\.day|经期第\s*\d+\s*天|周期第\s*\d+\s*天|档位\s*\d/.test(t))
    v.push({ kind: '报数据', detail: '泄露内部状态' })

  if (/^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\*\*|```/.test(t))
    v.push({ kind: 'markdown', detail: '出现 markdown' })

  if (/我喜欢你|做我男朋友|我们在一起吧|确认关系|在一起好吗/.test(t))
    v.push({ kind: '越界', detail: '表白/关系确认' })

  const conflict = contradictsLedger(t, s.state.ledger)
  if (conflict) v.push({ kind: '台账', detail: `与台账冲突且无理由：${conflict}` })

  if (t.length > s.targetLen * 1.5)
    v.push({ kind: '长度', detail: `超目标 ${t.length}/${s.targetLen}` })

  return v
}

/** 身份声明是 L3 直通条件，单独暴露便于测试与 decideDegrade 复用。 */
export function isIdentityViolation(v: Violation): boolean {
  return v.kind === '身份'
}
