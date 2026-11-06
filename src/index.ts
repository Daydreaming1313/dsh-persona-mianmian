/**
 * dsh-persona-mianmian v3 入口。
 *
 * 按真实 dsh 0.2.1-rc.2 落地，与 v3 指导书示例代码的差异见 docs/CALIBRATION.md：
 *  - 插件是 Cordis 裸对象 { name, inject, apply }，不是 definePlugin()；
 *  - section.text 允许函数但不允许 null（L3 用 '' 代替）；
 *  - 事件只有 agent/created、agent/inbox/inserted、session/event、agent/turn-stopping；
 *  - 命令服务是 commands（复数）；清理用 ctx.effect(() => () => cleanup)，无 dispose 事件；
 *  - inject 只声明 systemPrompt，其余服务用 ctx.get 探测，保证任何 profile 都能装。
 */
import { buildAnchor, exportAnchor } from './anchor.js'
import { createBridge, type Bridge } from './bridge.js'
import { phaseOf, phaseLabel, formatNow } from './clock.js'
import { tickBody } from './body.js'
import { defaultConfig, makeLogger, normalizeConfig, seededRng, type Logger } from './config.js'
import { decideDegrade, l3SectionText, sectionTextFor } from './degrade.js'
import { extractAndCommit, shouldShowAnchor, type ExtractResult } from './extractor.js'
import { guard } from './guard.js'
import { targetLength } from './length.js'
import { createPersonaStore, type PersonaStore } from './prompts.js'
import { advanceRelationship } from './relationship.js'
import { defaultState, StateStore } from './state.js'
import { registerTools, service } from './tools.js'
import type { MianmianConfigV3, Snapshot, V3State } from './types.js'
import type { HostContext, SystemPromptHost } from './v1/host.js'

export const name = 'mianmian'
/** 只硬依赖 systemPrompt。agents / commands / sessions 缺失时自动降级。 */
export const inject = ['systemPrompt'] as const

/** 供测试与二次开发：Cordis 插件对象本身。 */
export const plugin = { name, inject, apply }

function keyOf(ctx: unknown): string {
  const c = ctx as { agent?: { id?: unknown } } | undefined
  const id = c?.agent?.id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : ''
}

export function apply(ctx: HostContext, rawConfig?: unknown): void {
  const config = normalizeConfig(rawConfig)
  const logger = makeLogger(ctx, config.debug)
  const sp = service<SystemPromptHost>(ctx, 'systemPrompt')
  if (!sp) {
    logger.warn('systemPrompt 服务不可用，人格段未挂载')
    return
  }

  const rng = config.seed === null ? Math.random : seededRng(config.seed)
  const store = new StateStore(config, logger)
  const state = store.snapshot()
  const persona: PersonaStore = createPersonaStore(undefined, {
    enabled: config.hotReload,
    debounceMs: 150,
    onError: (e) => logger.warn('persona 热重载失败：%s', String(e)),
  })

  let lastExtract: ExtractResult | null = null
  let bridge: Bridge | undefined

  /** 构造 guard / anchor / length 共同消费的快照。 */
  function makeSnapshot(assembleCtx?: unknown): Snapshot {
    const key = keyOf(assembleCtx) || bridge?.slots.lastKey() || ''
    const userText = bridge?.slots.currentUserText(key) ?? state.runtime.lastUserText
    state.runtime.sessionKey = key
    state.runtime.userLen = userText.length
    const phase = phaseOf(state.body.cycle.day, state.body.cycle.length)
    const targetLen = targetLength(state, config, new Date())
    state.runtime.targetLen = targetLen
    return {
      state, config, now: new Date(), phase,
      patienceBand: state.body.patience >= 60 ? 'warm' : state.body.patience >= 40 ? 'normal' : state.body.patience >= 25 ? 'cool' : 'pushed',
      moodLabel: phaseLabel(phase),
      targetLen,
      userText,
      showAnchor: false,
    }
  }

  /** 一轮用户输入：tick → 抽取事实 → 记关键词 → 落盘（§5.3 流水线）。 */
  function onUser(text: string, _key: string): void {
    const now = new Date()
    const trimmed = String(text || '').trim()
    if (!trimmed) return
    try {
      state.turn++
      state.recentUserLen.push(trimmed.length)
      if (state.recentUserLen.length > 3) state.recentUserLen.shift()

      // 短时间连发：30 秒内的消息条数（§4.1 patience -= 连发条数×4）
      const t = now.getTime()
      state.runtime.recentUserTimes.push(t)
      if (state.runtime.recentUserTimes.length > 8) state.runtime.recentUserTimes.shift()
      const burst = state.runtime.recentUserTimes.filter((x) => t - x < 30000).length - 1

      lastExtract = extractAndCommit(state, trimmed, now)
      tickBody(state, now, config, {
        burst,
        hitSore: lastExtract.hitSore,
        specificPraise: lastExtract.specificPraise,
        selfDisclosure: lastExtract.selfDisclosure,
        changedTopic: lastExtract.changedTopic,
        terse: lastExtract.terse,
      })
      store.appendTranscript('user', trimmed, state.turn, now)
      // 中文关键词双通道（§8）：命中时记一轮，anchor 段会额外给用户看一份
      if (lastExtract.keyword === 'anchor' || lastExtract.keyword === 'export') {
        state.runtime.lastAnchorOutputTurn = state.turn
      }
      store.touch()
    } catch (error) {
      logger.warn('本轮抽取失败：%s', String(error))
    }
  }

  /** 只读观测助手输出，跑 guard + 降级决策（不拦截、不重试）。 */
  function onAssistant(text: string, _key: string): void {
    const t = String(text || '').trim()
    if (!t) return
    state.runtime.lastAssistantText = t
    store.appendTranscript('assistant', t, state.turn, new Date())
    try {
      const snap = makeSnapshot()
      const violations = guard(t, snap)
      const decision = decideDegrade(state, violations, new Date())
      if (config.debug) logger.info('guard: %d 违例 → L%d（%s）', violations.length, decision.level, decision.reason)
      store.touch()
    } catch (error) {
      logger.warn('guard 执行失败：%s', String(error))
    }
  }

  /** 一轮结束：推进关系状态机，flush 一次。 */
  function onTurnStopping(_key: string): void {
    try {
      const e = lastExtract
      const phase = phaseOf(state.body.cycle.day, state.body.cycle.length)
      advanceRelationship(
        state, config,
        {
          positive: Boolean(e?.positive),
          terseStreak: e?.terse ? state.runtime.positiveStreak + 1 : 0,
          offense: e?.offense ?? null,
          userPush: Boolean(e?.userPush),
        },
        state.body.patience >= 60,
        phase === 'follicular' || phase === 'ovulation',
        rng,
      )
      store.flush()
    } catch (error) {
      logger.warn('轮末状态推进失败：%s', String(error))
    }
  }

  bridge = createBridge({ logger, onUser, onAssistant, onTurnStopping })

  // ── 注册 section（order 落在 persona 带，不使用 complete） ───────────────
  addEffect(ctx, () => sp.section({
    name: 'mianmian:persona',
    order: 0,
    interpolate: false,
    text: () => sectionTextFor(state, () => persona.text()),
  }), 'mianmian.persona')

  addEffect(ctx, () => sp.section({
    name: 'mianmian:anchor',
    order: 10,
    interpolate: false, // 台账原文可能含 {{ }}，绝不能被当模板解析
    text: (c) => {
      const snap = makeSnapshot(c)
      const important = Boolean(lastExtract?.keyword) || Boolean(lastExtract?.openItems.length)
      if (shouldShowAnchor(state, lastExtract?.keyword ?? null, config.anchorEvery, important)) {
        state.runtime.lastAnchorOutputTurn = state.turn
      }
      // 锚点块每轮都注入（这是心脏）；showAnchor 只决定是否额外给用户看一份
      return sectionTextFor(state, () => buildAnchor(snap, config).text)
    },
  }), 'mianmian.anchor')

  addEffect(ctx, () => sp.section({
    name: 'mianmian:degraded',
    order: 20,
    interpolate: false,
    text: () => l3SectionText(state),
  }), 'mianmian.degraded')

  // 变量：供其他 section 引用（变量名严格 [a-z][a-z0-9_]*）
  addEffect(ctx, () => sp.variable('mianmian_mood', () => phaseLabel(phaseOf(state.body.cycle.day, state.body.cycle.length))), 'mianmian.mood')

  // ── 事件桥接：全局 + 每个 agent 作用域 ─────────────────────────────────
  bridge.attach(ctx)
  const attached = new WeakSet<object>()
  const attachAgent = (agent: unknown): void => {
    const agentCtx = (agent as { ctx?: HostContext } | undefined)?.ctx
    if (!agentCtx || attached.has(agentCtx as object)) return
    attached.add(agentCtx as object)
    bridge!.attach(agentCtx)
  }
  if (typeof ctx.on === 'function') {
    try {
      const off = ctx.on('agent/created', (payload: unknown) => {
        attachAgent((payload as { agent?: unknown } | null)?.agent)
      })
      addCleanup(ctx, off)
    } catch (error) { logger.warn('agent/created 挂载失败：%s', String(error)) }
  }
  try {
    const agents = service<{ list?: () => unknown[] }>(ctx, 'agents')
    for (const a of agents?.list?.() ?? []) attachAgent(a)
  } catch { /* 服务缺失时降级 */ }
  const rescan = setTimeout(() => {
    try {
      const agents = service<{ list?: () => unknown[] }>(ctx, 'agents')
      for (const a of agents?.list?.() ?? []) attachAgent(a)
    } catch { /* ignore */ }
  }, 2000)
  rescan.unref?.()

  // ── 工具（ASCII 名） ───────────────────────────────────────────────────
  if (config.registerCommands) {
    registerTools(ctx, {
      makeSnapshot: () => makeSnapshot(),
      store, config, logger,
      onReset: () => {
        const fresh = defaultState(new Date(), config)
        Object.assign(state, fresh)
        store.touch()
      },
    })
  }

  // ── 卸载：flush、停监听、撤销订阅（Cordis 无 dispose 事件） ─────────────
  addEffect(ctx, () => () => {
    clearTimeout(rescan)
    persona.dispose()
    bridge?.dispose()
    store.dispose()
  }, 'mianmian.dispose')
}

/** ctx.effect 存在时用它（卸载自动撤销）；否则直接执行。 */
function addEffect(ctx: HostContext, execute: () => (() => void) | void, label: string): void {
  if (typeof ctx.effect === 'function') ctx.effect(() => execute() ?? (() => {}), label)
  else execute()
}

function addCleanup(ctx: HostContext, off: unknown): void {
  if (typeof off === 'function' && typeof ctx.effect === 'function') {
    ctx.effect(() => off as () => void, 'mianmian.event')
  }
}

// ── 公开给测试 / 二次开发的纯函数与类 ────────────────────────────────────
export { defaultConfig, normalizeConfig, seededRng, makeLogger } from './config.js'
export { StateStore, defaultState } from './state.js'
export { resolvePaths, backupPath } from './paths.js'
export { tickClock, deltaHours, cycleDayOf, phaseOf, phaseLabel, phaseSignals, timeFactor, formatNow } from './clock.js'
export { tickBody, patienceBand, bodyFactor, emptySignals } from './body.js'
export { advanceRelationship, TIER_FACTOR, TIER_STYLE, emptyRelationSignals } from './relationship.js'
export { addFact, addOpenItem, resolveOpenItem, addEpisode, rankFacts, similarity, hasReason, findConflict, contradictsLedger, expireFacts, nextFactId, REASON_WORDS } from './ledger.js'
export { extractRules, extractAndCommit, detectKeyword, shouldShowAnchor } from './extractor.js'
export { buildAnchor, exportAnchor, correctionBlock, IDENTITY_CONSTRAINT, L3_LINES, ANCHOR_MAX_CHARS } from './anchor.js'
export { guard, thirdPersonViolation, isIdentityViolation } from './guard.js'
export { decideDegrade, sectionTextFor, l3SectionText } from './degrade.js'
export { targetLength, lengthHint } from './length.js'
export { createBridge, extractUserText, extractAssistantText, sessionKeyOf, lastAssistantFromSnapshot } from './bridge.js'
export { createPersonaStore, loadPersona, OPENING, PERSONA_FILES, FALLBACK_PERSONA } from './prompts.js'
export { registerTools, TOOL_NAMES, service } from './tools.js'
export type { MianmianConfigV3, V3State, Snapshot, Tier, Rng, Violation, Fact, Ledger } from './types.js'
export type { Logger }
export { formatNow as nowLabel }

/** 便于离线评测：把状态导出成锚点文本。 */
export function anchorText(state: V3State, config?: MianmianConfigV3, now = new Date()): string {
  const cfg = config ?? defaultConfig()
  const phase = phaseOf(state.body.cycle.day, state.body.cycle.length)
  const snap: Snapshot = {
    state, config: cfg, now, phase,
    patienceBand: state.body.patience >= 60 ? 'warm' : state.body.patience >= 40 ? 'normal' : state.body.patience >= 25 ? 'cool' : 'pushed',
    moodLabel: phaseLabel(phase),
    targetLen: targetLength(state, cfg, now),
    userText: '', showAnchor: false,
  }
  return exportAnchor(snap, cfg)
}
