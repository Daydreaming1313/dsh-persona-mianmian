import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs'
import type { Logger } from './config.js'
import { backupPath, resolvePaths, type DataPaths } from './paths.js'
import { STATE_VERSION, type DegradeLevel, type Fact, type Ledger, type MianmianConfigV3, type Tier, type V3State } from './types.js'

const DRIFT_LIMIT = 20

function clamp(n: unknown, fallback: number, lo: number, hi: number): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(hi, Math.max(lo, v))
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? v as T[] : []
}

/** 周期第 1 天的 ISO 日期（只用日期部分，避免时区把锚点推偏）。 */
function anchorDate(now: Date, cycleDay: number, length: number): string {
  const d = new Date(now.getTime() - ((cycleDay - 1) % length) * 86400000)
  return d.toISOString().slice(0, 10)
}

export function defaultState(now: Date, config: MianmianConfigV3): V3State {
  const dayOfMonth = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, day: 'numeric' })
    .formatToParts(now).find((p) => p.type === 'day')?.value ?? '1'
  const cycleDay = ((Number(dayOfMonth) - 1) % config.cycleLength) + 1
  return {
    version: STATE_VERSION,
    userId: 'default',
    createdAt: now.toISOString(),
    lastTickAt: now.toISOString(),
    relationship: { tier: config.tierStart, flirtCount: 0, lastFlirtTurn: -99, grudge: [] },
    body: {
      hunger: 20,
      energy: 85,
      patience: 70,
      cycle: {
        length: config.cycleLength,
        day: cycleDay,
        anchor: config.cycleAnchor ?? anchorDate(now, cycleDay, config.cycleLength),
      },
      lastMealAt: now.toISOString(),
    },
    ledger: { facts: [], hisPrefs: [], openItems: [], episodes: [] },
    drift: [],
    degradeLevel: 0,
    turn: 0,
    recentUserLen: [],
    runtime: {
      lastUserText: '',
      lastAssistantText: '',
      targetLen: 30,
      positiveStreak: 0,
      tierStart: config.tierStart,
      l2Streak: 0,
      lastL2Turn: -99,
      lastAnchorOutputTurn: -99,
      violationsThisTurn: [],
      sessionKey: '',
      userLen: 0,
      recentUserTimes: [],
      terseStreak: 0,
    },
  }
}

function normalizeFact(raw: unknown, index: number): Fact | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, unknown>
  if (typeof f.text !== 'string' || !f.text) return null
  const kinds = ['food', 'place', 'time', 'person', 'item', 'pref', 'event']
  return {
    id: typeof f.id === 'string' ? f.id : `f_${String(index).padStart(4, '0')}`,
    kind: (kinds.includes(String(f.kind)) ? f.kind : 'event') as Fact['kind'],
    text: f.text,
    speaker: f.speaker === 'her' ? 'her' : 'him',
    turn: Math.round(clamp(f.turn, 0, 0, 1e9)),
    at: typeof f.at === 'string' ? f.at : new Date().toISOString(),
    validUntil: typeof f.validUntil === 'string' ? f.validUntil : null,
    supersedes: typeof f.supersedes === 'string' ? f.supersedes : null,
    reason: typeof f.reason === 'string' ? f.reason : null,
    confidence: clamp(f.confidence, 0.9, 0, 1),
    importance: clamp(f.importance, 0.5, 0, 1),
  }
}

/** 合并默认值；损坏的字段逐个兜底，不让插件启动失败。 */
function normalizeState(raw: unknown, now: Date, config: MianmianConfigV3): V3State {
  const base = defaultState(now, config)
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const rel = (r.relationship ?? {}) as Record<string, unknown>
  const body = (r.body ?? {}) as Record<string, unknown>
  const cycle = (body.cycle ?? {}) as Record<string, unknown>
  const ledger = (r.ledger ?? {}) as Record<string, unknown>
  const runtime = (r.runtime ?? {}) as Record<string, unknown>
  const length = Math.round(clamp(cycle.length, config.cycleLength, 21, 35))
  const tier = Math.round(clamp(rel.tier, config.tierStart, 1, 4)) as Tier

  const facts = asArray<unknown>(ledger.facts).map(normalizeFact).filter((f): f is Fact => f !== null)
  const prefs = asArray<unknown>(ledger.hisPrefs).map(normalizeFact).filter((f): f is Fact => f !== null)
  const openItems = asArray<unknown>(ledger.openItems).flatMap((o) => {
    if (!o || typeof o !== 'object') return []
    const x = o as Record<string, unknown>
    return typeof x.what === 'string' ? [{ what: x.what, sinceTurn: Math.round(clamp(x.sinceTurn, 0, 0, 1e9)), nudged: Boolean(x.nudged) }] : []
  })
  const episodes = asArray<unknown>(ledger.episodes).flatMap((e) => {
    if (!e || typeof e !== 'object') return []
    const x = e as Record<string, unknown>
    return typeof x.summary === 'string' ? [{
      turn: Math.round(clamp(x.turn, 0, 0, 1e9)),
      at: typeof x.at === 'string' ? x.at : now.toISOString(),
      summary: x.summary,
      tag: typeof x.tag === 'string' ? x.tag : 'chat',
    }] : []
  })

  return {
    version: STATE_VERSION,
    userId: typeof r.userId === 'string' ? r.userId : 'default',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : base.createdAt,
    lastTickAt: typeof r.lastTickAt === 'string' ? r.lastTickAt : now.toISOString(),
    relationship: {
      tier,
      flirtCount: Math.round(clamp(rel.flirtCount, 0, 0, 1e6)),
      lastFlirtTurn: Math.round(clamp(rel.lastFlirtTurn, -99, -1e6, 1e9)),
      grudge: asArray<unknown>(rel.grudge).flatMap((g) => {
        if (!g || typeof g !== 'object') return []
        const x = g as Record<string, unknown>
        return typeof x.what === 'string' ? [{ turn: Math.round(clamp(x.turn, 0, 0, 1e9)), what: x.what, resolved: Boolean(x.resolved) }] : []
      }),
    },
    body: {
      hunger: clamp(body.hunger, 20, 0, 100),
      energy: clamp(body.energy, 85, 0, 100),
      patience: clamp(body.patience, 70, 0, 100),
      cycle: {
        length,
        day: Math.round(clamp(cycle.day, base.body.cycle.day, 1, length)),
        anchor: typeof cycle.anchor === 'string' ? cycle.anchor : base.body.cycle.anchor,
      },
      lastMealAt: typeof body.lastMealAt === 'string' ? body.lastMealAt : now.toISOString(),
    },
    ledger: { facts, hisPrefs: prefs, openItems, episodes } satisfies Ledger,
    drift: asArray<unknown>(r.drift).flatMap((d) => {
      if (!d || typeof d !== 'object') return []
      const x = d as Record<string, unknown>
      return typeof x.kind === 'string' ? [{ turn: Math.round(clamp(x.turn, 0, 0, 1e9)), kind: x.kind, at: typeof x.at === 'string' ? x.at : now.toISOString() }] : []
    }).slice(-DRIFT_LIMIT),
    degradeLevel: Math.round(clamp(r.degradeLevel, 0, 0, 3)) as DegradeLevel,
    turn: Math.round(clamp(r.turn, 0, 0, 1e9)),
    recentUserLen: asArray<unknown>(r.recentUserLen).map(Number).filter(Number.isFinite).slice(-3),
    runtime: {
      lastUserText: typeof runtime.lastUserText === 'string' ? runtime.lastUserText : '',
      lastAssistantText: typeof runtime.lastAssistantText === 'string' ? runtime.lastAssistantText : '',
      targetLen: clamp(runtime.targetLen, 30, 1, 600),
      positiveStreak: Math.round(clamp(runtime.positiveStreak, 0, 0, 1e6)),
      tierStart: Math.round(clamp(runtime.tierStart, tier, 1, 4)) as Tier,
      l2Streak: Math.round(clamp(runtime.l2Streak, 0, 0, 1e6)),
      lastL2Turn: Math.round(clamp(runtime.lastL2Turn, -99, -1e6, 1e9)),
      lastAnchorOutputTurn: Math.round(clamp(runtime.lastAnchorOutputTurn, -99, -1e6, 1e9)),
      violationsThisTurn: [],
      sessionKey: '',
      userLen: 0,
      recentUserTimes: asArray<unknown>(runtime.recentUserTimes).map(Number).filter(Number.isFinite).slice(-8),
      terseStreak: Math.round(clamp(runtime.terseStreak, 0, 0, 1e6)),
    },
  }
}

/**
 * v1/v2 → v3 迁移。绝不原地覆盖：先备份成 state.v{old}.bak.json。
 * v1 的 energy/patience 是 0..1，v3 是 0..100，需要换算；affection 映射到 tier。
 */
function migrate(raw: Record<string, unknown>, paths: DataPaths, logger: Logger): Record<string, unknown> {
  const old = Number(raw.version) || 1
  try {
    copyFileSync(paths.stateFile, backupPath(paths, `v${old}`))
    logger.info('已备份旧状态到 state.v%s.bak.json', old)
  } catch (error) {
    logger.warn('旧状态备份失败，仍继续迁移：%s', String(error))
  }
  const affection = clamp(raw.affection, 0.42, 0, 1)
  const tier = affection >= 0.75 ? 4 : affection >= 0.55 ? 3 : affection >= 0.3 ? 2 : 1
  const cycleDay = Math.round(clamp(raw.cycleDay, 17, 1, 35))
  const length = Math.round(clamp(raw.cycleLength, 28, 21, 35))
  const nowIso = new Date().toISOString()
  return {
    version: STATE_VERSION,
    userId: 'default',
    createdAt: nowIso,
    lastTickAt: nowIso,
    relationship: {
      tier,
      flirtCount: Math.round(clamp(raw.teaseCount, 0, 0, 3)),
      lastFlirtTurn: Math.round(clamp(raw.lastTeaseTurn, -99, -1e6, 1e9)),
      grudge: [],
    },
    body: {
      hunger: 20,
      energy: clamp(raw.energy, 0.72, 0, 1) * 100,
      patience: clamp(raw.patience, 0.78, 0, 1) * 100,
      cycle: {
        length,
        day: cycleDay,
        anchor: typeof raw.cycleAnchor === 'number'
          ? new Date(raw.cycleAnchor).toISOString().slice(0, 10)
          : anchorDate(new Date(), cycleDay, length),
      },
      lastMealAt: nowIso,
    },
    ledger: { facts: [], hisPrefs: [], openItems: [], episodes: [] },
    drift: [],
    degradeLevel: 0,
    turn: Math.round(clamp(raw.turn, 0, 0, 1e9)),
    recentUserLen: [],
    runtime: {
      lastUserText: typeof raw.lastUserText === 'string' ? raw.lastUserText : '',
      lastAssistantText: '',
      targetLen: 30,
      positiveStreak: 0,
      tierStart: tier,
      l2Streak: 0,
      lastL2Turn: -99,
      lastAnchorOutputTurn: -99,
      violationsThisTurn: [],
      sessionKey: '',
      userLen: 0,
      recentUserTimes: [],
      terseStreak: 0,
    },
  }
}

/**
 * 内存单例 + 防抖原子写。每轮读写走内存（同步、零 await），落盘先写 .tmp 再 rename。
 * 写失败只记日志不中断对话。
 */
export class StateStore {
  readonly paths: DataPaths
  private state: V3State
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private readonly logger: Logger
  private readonly debounceMs: number

  constructor(config: MianmianConfigV3, logger: Logger, now: Date = new Date()) {
    this.logger = logger
    this.debounceMs = config.persistDebounceMs
    this.paths = resolvePaths(config)
    mkdirSync(this.paths.dir, { recursive: true })
    let raw: unknown = null
    if (existsSync(this.paths.stateFile)) {
      try {
        raw = JSON.parse(readFileSync(this.paths.stateFile, 'utf8'))
      } catch (error) {
        logger.warn('state.json 解析失败，从默认状态开始：%s', String(error))
      }
    }
    const firstRun = !existsSync(this.paths.stateFile)
    if (raw && typeof raw === 'object' && (Number((raw as Record<string, unknown>).version) || 1) < STATE_VERSION) {
      raw = migrate(raw as Record<string, unknown>, this.paths, logger)
    }
    this.state = normalizeState(raw, now, config)
    if (config.cycleAnchor) this.state.body.cycle.anchor = config.cycleAnchor
    // §3.1 要求 state.json 能导出、能 diff、能人工改。首次启动就落一份，
    // 否则用户「刚装好想手填台账」时文件根本不存在。
    if (firstRun) this.flush()
  }

  /** 内存引用，调用方可直接改；改完调 touch() 触发落盘。 */
  snapshot(): V3State { return this.state }

  /** 追加原话库（§5.1 原话库不进 prompt）。失败不影响对话。 */
  appendTranscript(role: 'user' | 'assistant', text: string, turn: number, now: Date): void {
    try {
      const line = JSON.stringify({ at: now.toISOString(), turn, role, text }) + '\n'
      appendFileSync(this.paths.transcriptFile, line, 'utf8')
    } catch (error) {
      this.logger.warn('transcript 追加失败：%s', String(error))
    }
  }

  /** 请求一次防抖落盘。 */
  touch(): void {
    if (this.closed) return
    if (this.debounceMs <= 0) { this.flush(); return }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; this.flush() }, this.debounceMs)
    this.timer.unref?.()
  }

  /** 立即原子写。 */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    try {
      mkdirSync(this.paths.dir, { recursive: true })
      const tmp = `${this.paths.stateFile}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8')
      renameSync(tmp, this.paths.stateFile)
    } catch (error) {
      this.logger.warn('state.json 写入失败（内存态仍然正确）：%s', String(error))
    }
  }

  /** 危险操作前备份一份，返回备份路径；失败返回 null。 */
  backup(tag: string): string | null {
    try {
      const p = backupPath(this.paths, tag)
      if (existsSync(this.paths.stateFile)) copyFileSync(this.paths.stateFile, p)
      else writeFileSync(p, JSON.stringify(this.state, null, 2), 'utf8')
      return p
    } catch (error) {
      this.logger.warn('备份失败：%s', String(error))
      return null
    }
  }

  /** 用外部导入的锚点文本覆盖台账前先备份；返回是否成功。 */
  replace(state: V3State): void {
    this.state = state
    this.flush()
  }

  dispose(): void {
    this.closed = true
    this.flush()
  }
}
