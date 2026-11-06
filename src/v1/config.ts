import type { Channel, MianmianConfig, Mode } from './types.js'

const CHANNELS: Channel[] = ['text', 'image', 'emoji', 'voice']
const MODES: Mode[] = ['persona-only', 'persona-with-tools']

function num(value: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

/** mulberry32：给 seed 一个稳定可复现的随机源。 */
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

export function defaultConfig(): MianmianConfig {
  return {
    mode: 'persona-only',
    channel: 'text',
    cycleLength: 28,
    cycleDayStart: null,
    seed: null,
    baseShareChance: 0.45,
    timeZone: 'Asia/Shanghai',
    hotReload: true,
    enableRoleAlias: false,
    registerCommands: true,
    stateDir: null,
    personaFile: null,
    debug: false,
  }
}

/** 容错归一化：宿主可能传 undefined、字符串、或来自 YAML 的松散对象。 */
export function normalizeConfig(raw: unknown): MianmianConfig {
  const base = defaultConfig()
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const channel = CHANNELS.includes(c.channel as Channel) ? c.channel as Channel : base.channel
  const mode = MODES.includes(c.mode as Mode) ? c.mode as Mode : base.mode
  const seed = c.seed === null || c.seed === undefined || c.seed === ''
    ? null
    : Math.floor(num(c.seed, 0, 0, 2147483647))
  return {
    mode,
    channel,
    cycleLength: Math.round(num(c.cycleLength, base.cycleLength, 21, 35)),
    cycleDayStart: c.cycleDayStart === null || c.cycleDayStart === undefined
      ? null
      : Math.round(num(c.cycleDayStart, 1, 1, 35)),
    seed,
    baseShareChance: num(c.baseShareChance, base.baseShareChance, 0, 1),
    timeZone: typeof c.timeZone === 'string' && c.timeZone.trim() ? c.timeZone : base.timeZone,
    hotReload: c.hotReload === undefined ? true : Boolean(c.hotReload),
    enableRoleAlias: Boolean(c.enableRoleAlias),
    registerCommands: c.registerCommands === undefined ? true : Boolean(c.registerCommands),
    stateDir: typeof c.stateDir === 'string' && c.stateDir.trim() ? c.stateDir : null,
    personaFile: typeof c.personaFile === 'string' && c.personaFile.trim() ? c.personaFile : null,
    debug: Boolean(c.debug),
  }
}
