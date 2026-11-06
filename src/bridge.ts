import type { HostContext } from './v1/host.js'
import type { Logger } from './config.js'

/**
 * §6.4 闭包桥接。AssembleContext 只有 scope / signal（+ 合并的 agent?: Agent），
 * 没有 chatId，也不带用户原文，所以自己用事件缓存。
 *
 * 真实事件（已核对 dsh 0.2.1-rc.2）：
 *   agent/created          { agent }                     ← 拿到 agent.ctx 才能挂作用域事件
 *   agent/inbox/inserted   { agent, message }            ← 用户原文
 *   session/event          (session, event)              ← assistant/message 只读观测
 *   agent/turn-stopping    { agent, turn, signal }       ← 一轮「即将」结束
 * 文档 v3 写的 user/message、agent/turn-end、assistant/message（作为 Cordis 事件）
 * 都不存在；它们是 SessionEvent 的 type，只能走 session/event。
 *
 * 事件是 Scope-filtered dispatch：agent 作用域的事件必须在 agent.ctx 上订阅，
 * 全局 ctx 收不到。所以 attach() 会被 agent/created 调用多次，共享同一批槽。
 */

/** 从 UserMessage / content block 取正文，跳过 reasoning / tool_use。 */
export function extractUserText(payload: unknown): string {
  const msg = (payload && typeof payload === 'object' && 'message' in (payload as object)
    ? (payload as { message: unknown }).message
    : payload) as unknown
  if (!msg) return ''
  if (typeof msg === 'string') return msg
  if (typeof msg !== 'object') return ''
  const m = msg as Record<string, unknown>
  if (typeof m.text === 'string') return m.text
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    return m.content.map((block) => {
      if (typeof block === 'string') return block
      if (!block || typeof block !== 'object') return ''
      const b = block as Record<string, unknown>
      if (b.type === 'reasoning' || b.type === 'tool_use' || b.type === 'tool_result') return ''
      return typeof b.text === 'string' ? b.text : ''
    }).filter(Boolean).join('')
  }
  if (m.message && typeof m.message === 'object') return extractUserText(m.message)
  return ''
}

/** session/event 的 assistant/message：文本在 event.data.message.content。 */
export function extractAssistantText(event: unknown): string {
  if (!event || typeof event !== 'object') return ''
  const e = event as Record<string, unknown>
  if (e.type !== 'assistant/message') return ''
  const data = e.data as Record<string, unknown> | undefined
  return extractUserText(data?.message)
}

/** 会话标识：优先 agent.id，其次 session.id；都没有用单槽 ''。 */
export function sessionKeyOf(agent: unknown, session: unknown): string {
  const a = agent as { id?: unknown; session?: { id?: unknown } } | undefined
  const s = session as { id?: unknown } | undefined
  const id = a?.id ?? a?.session?.id ?? s?.id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : ''
}

/** 从 session 快照里倒序找最后一条 assistant/message（dsh-fish-memory 的成熟做法）。 */
export function lastAssistantFromSnapshot(session: unknown): string {
  const s = session as { snapshotEvents?: () => unknown[] } | undefined
  if (typeof s?.snapshotEvents !== 'function') return ''
  let events: unknown[] = []
  try { events = s.snapshotEvents() ?? [] } catch { return '' }
  for (let i = events.length - 1; i >= 0; i--) {
    const text = extractAssistantText(events[i])
    if (text) return text
  }
  return ''
}

export interface BridgeSlots {
  userText(key: string): string
  assistantText(key: string): string
  lastKey(): string
  /** assemble 拿不到 key 时用最近活跃槽兜底 */
  currentUserText(key: string): string
  clear(key: string): void
}

export interface BridgeOptions {
  logger: Logger
  onUser?: (text: string, key: string) => void
  onAssistant?: (text: string, key: string) => void
  onTurnStopping?: (key: string, agent: unknown) => void
}

export interface Bridge {
  slots: BridgeSlots
  /** 在给定 ctx（全局或 agent.ctx）上挂监听；可重复调用。 */
  attach(ctx: HostContext): void
  dispose(): void
}

export function createBridge(opts: BridgeOptions): Bridge {
  const users = new Map<string, string>()
  const assistants = new Map<string, string>()
  const disposers: Array<() => void> = []
  let lastKey = ''

  const on = (ctx: HostContext, event: string, handler: (...args: any[]) => void): void => {
    if (typeof ctx.on !== 'function') return
    try {
      const off = ctx.on(event, handler)
      if (typeof off === 'function') disposers.push(off)
    } catch (error) {
      opts.logger.warn(`订阅 ${event} 失败：${String(error)}`)
    }
  }

  const slots: BridgeSlots = {
    userText: (k) => users.get(k) ?? '',
    assistantText: (k) => assistants.get(k) ?? '',
    lastKey: () => lastKey,
    currentUserText: (k) => users.get(k) ?? (lastKey ? users.get(lastKey) ?? '' : ''),
    clear: (k) => { users.delete(k); assistants.delete(k) },
  }

  function attach(ctx: HostContext): void {
    on(ctx, 'agent/inbox/inserted', (payload: unknown) => {
      const p = payload as { agent?: unknown; message?: Record<string, unknown> } | null
      const raw = p?.message ?? payload
      const source = (raw as { source?: { kind?: string } } | undefined)?.source?.kind ?? ''
      if (/context|runtime|system|mianmian|injected/i.test(source)) return
      const text = extractUserText(raw)
      if (!text.trim()) return
      const key = sessionKeyOf(p?.agent, undefined)
      users.set(key, text)
      lastKey = key
      opts.onUser?.(text, key)
    })

    on(ctx, 'session/event', (session: unknown, event: unknown) => {
      const text = extractAssistantText(event)
      if (!text.trim()) return
      const key = sessionKeyOf(undefined, session) || lastKey
      assistants.set(key, text)
      opts.onAssistant?.(text, key)
    })

    on(ctx, 'agent/turn-stopping', (payload: unknown) => {
      const p = payload as { agent?: unknown } | null
      const agent = p?.agent
      const key = sessionKeyOf(agent, undefined) || lastKey
      // session/event 可能没有挂上，用快照回放兜底拿助手输出
      const a = agent as { session?: unknown } | undefined
      const fallback = lastAssistantFromSnapshot(a?.session)
      if (fallback && !assistants.get(key)) {
        assistants.set(key, fallback)
        opts.onAssistant?.(fallback, key)
      }
      opts.onTurnStopping?.(key, agent)
    })
  }

  return {
    slots,
    attach,
    dispose: () => {
      for (const off of disposers) { try { off() } catch { /* 单个失败不影响其余 */ } }
      users.clear(); assistants.clear()
    },
  }
}
