import type { Channel, MianmianConfigV3, Mode, Tier } from './types.js'

const CHANNELS: Channel[] = ['text', 'image', 'emoji', 'voice']
const MODES: Mode[] = ['persona-only', 'persona-with-tools']
const TIERS: Tier[] = [1, 2, 3, 4]

function num(value: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

/** mulberry32：给 seed 一个稳定可复现的随机源。与 v1 保持同一实现，便于回归对照。 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function env(...names: string[]): string | null {
  for (const n of names) {
    const v = process.env[n]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

export function defaultConfig(): MianmianConfigV3 {
  return {
    dataDir: null,
    cycleLength: 28,
    cycleAnchor: null,
    timezone: 'Asia/Shanghai',
    tierStart: 2,
    flirtCap: 3,
    anchorEvery: 5,
    factsBudget: 24,
    maxReplyChars: 260,
    reasoningMode: 'off',
    allowTierSet: false,
    seed: null,
    hotReload: true,
    debug: false,
    registerCommands: true,
    channel: 'text',
    mode: 'persona-only',
    persistDebounceMs: 800,
  }
}

/**
 * 容错归一化。DSH 的 config 来自 cordis.patch.yml，可能是字符串、null 或松散对象。
 * 环境变量优先级低于显式 config，高于默认值（§3.3）。
 */
export function normalizeConfig(raw: unknown): MianmianConfigV3 {
  const base = defaultConfig()
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const channel = CHANNELS.includes(c.channel as Channel) ? c.channel as Channel : base.channel
  const mode = MODES.includes(c.mode as Mode) ? c.mode as Mode : base.mode
  const seed = c.seed === null || c.seed === undefined || c.seed === ''
    ? null
    : Math.floor(num(c.seed, 0, 0, 2147483647))
  const tier = TIERS.includes(Number(c.tierStart) as Tier)
    ? Number(c.tierStart) as Tier : base.tierStart

  return {
    dataDir: (typeof c.dataDir === 'string' && c.dataDir.trim() ? c.dataDir.trim() : null)
      ?? env('DSH_MIANMIAN_DATA'),
    cycleLength: Math.round(num(c.cycleLength, base.cycleLength, 21, 35)),
    cycleAnchor: typeof c.cycleAnchor === 'string' && c.cycleAnchor.trim() ? c.cycleAnchor.trim() : null,
    timezone: typeof c.timezone === 'string' && c.timezone.trim() ? c.timezone : base.timezone,
    tierStart: tier,
    flirtCap: Math.round(num(c.flirtCap, base.flirtCap, 1, 10)),
    anchorEvery: Math.round(num(c.anchorEvery, base.anchorEvery, 1, 50)),
    factsBudget: Math.round(num(c.factsBudget, base.factsBudget, 1, 100)),
    maxReplyChars: Math.round(num(c.maxReplyChars, base.maxReplyChars, 40, 600)),
    reasoningMode: c.reasoningMode === 'on' ? 'on' : 'off',
    allowTierSet: Boolean(c.allowTierSet),
    seed,
    hotReload: c.hotReload === undefined ? true : Boolean(c.hotReload),
    debug: Boolean(c.debug),
    registerCommands: c.registerCommands === undefined ? true : Boolean(c.registerCommands),
    channel,
    mode,
    persistDebounceMs: Math.round(num(c.persistDebounceMs, base.persistDebounceMs, 0, 10000)),
  }
}

/** 简单的 logger 门面：宿主可能没有 logger 服务，这里始终可用。 */
export interface Logger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

export function makeLogger(host: unknown, debug = false): Logger {
  const candidate = host as { logger?: { info?: unknown; warn?: unknown } } | undefined
  const info = typeof candidate?.logger?.info === 'function'
    ? (candidate.logger.info as (...a: unknown[]) => void).bind(candidate.logger)
    : () => {}
  const warn = typeof candidate?.logger?.warn === 'function'
    ? (candidate.logger.warn as (...a: unknown[]) => void).bind(candidate.logger)
    : (...a: unknown[]) => console.warn('[mianmian]', ...a)
  return {
    info: (...a: unknown[]) => { if (debug) info('[mianmian]', ...a) },
    warn: (...a: unknown[]) => warn('[mianmian]', ...a),
  }
}
