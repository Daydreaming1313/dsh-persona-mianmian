import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { normalizeCycleLength, phaseOf } from './cycle.js';
import { localMidnight, slotOf } from './schedule.js';
export const STATE_VERSION = 1;
function clamp01(n, fallback) {
    const v = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(v))
        return fallback;
    return Math.min(1, Math.max(0, v));
}
export function stateDirOf(config) {
    if (config.stateDir)
        return config.stateDir;
    const home = process.env.DSH_HOME && process.env.DSH_HOME.trim()
        ? process.env.DSH_HOME
        : join(homedir(), '.dsh');
    return join(home, 'mianmian');
}
export function stateFilePath(config) {
    return join(stateDirOf(config), 'state.json');
}
/** 首次安装：cycleDayStart 可由配置指定，否则按当月的日期推导一个稳定起点。 */
export function defaultState(now, config, rng = Math.random) {
    const length = normalizeCycleLength(config.cycleLength);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, day: 'numeric' })
        .formatToParts(now);
    const dayOfMonth = Number(parts.find((p) => p.type === 'day')?.value ?? '1');
    const cycleDay = config.cycleDayStart ?? ((dayOfMonth - 1) % length) + 1;
    const anchor = localMidnight(now, config.timeZone) - (cycleDay - 1) * 86400000;
    return {
        version: STATE_VERSION,
        cycleDay,
        cycleLength: length,
        cycleAnchor: anchor,
        energy: 0.72 + rng() * 0.18,
        patience: 0.78,
        affection: 0.42,
        turn: 0,
        lastUserAt: 0,
        recentUserTimes: [],
        lastQuestion: '',
        questionCount: 0,
        pushed: false,
        pushedAt: 0,
        busyUntil: 0,
        busyReason: '',
        returning: false,
        channel: config.channel,
        phase: phaseOf(cycleDay, length),
        slot: slotOf(now, config.timeZone).id,
        lastLengthBand: 'medium',
        lastTone: 'flat',
        recentRolls: [],
        toneHistory: [],
        lastShareAt: 0,
        shareCount: 0,
        teaseCount: 0,
        lastTeaseTurn: -99,
        lastAnchorTurn: -99,
        pendingDirective: '',
        lastUserText: '',
        updatedAt: now.getTime(),
    };
}
function asArray(value, fallback) {
    return Array.isArray(value) ? value : fallback;
}
/** 读取并合并默认值；损坏的 state 文件不会让插件启动失败。 */
export function loadState(now, config, rng = Math.random) {
    const base = defaultState(now, config, rng);
    const path = stateFilePath(config);
    if (!existsSync(path))
        return base;
    try {
        const raw = JSON.parse(readFileSync(path, 'utf8'));
        const length = normalizeCycleLength(raw.cycleLength ?? config.cycleLength);
        const cycleDay = Math.min(length, Math.max(1, Math.round(Number(raw.cycleDay) || base.cycleDay)));
        const merged = {
            ...base,
            ...raw,
            version: STATE_VERSION,
            cycleDay,
            cycleLength: length,
            cycleAnchor: Number(raw.cycleAnchor) || base.cycleAnchor,
            energy: clamp01(raw.energy, base.energy),
            patience: clamp01(raw.patience, base.patience),
            affection: clamp01(raw.affection, base.affection),
            turn: Math.max(0, Math.round(Number(raw.turn) || 0)),
            recentUserTimes: asArray(raw.recentUserTimes, []).filter((n) => Number.isFinite(n)).slice(-20),
            questionCount: Math.max(0, Math.round(Number(raw.questionCount) || 0)),
            busyUntil: Number(raw.busyUntil) || 0,
            pushedAt: Number(raw.pushedAt) || 0,
            lastUserAt: Number(raw.lastUserAt) || 0,
            lastShareAt: Number(raw.lastShareAt) || 0,
            shareCount: Math.max(0, Math.round(Number(raw.shareCount) || 0)),
            teaseCount: Math.max(0, Math.round(Number(raw.teaseCount) || 0)),
            lastTeaseTurn: Number(raw.lastTeaseTurn ?? -99),
            lastAnchorTurn: Number(raw.lastAnchorTurn ?? -99),
            updatedAt: Number(raw.updatedAt) || now.getTime(),
            phase: phaseOf(cycleDay, length),
            slot: slotOf(now, config.timeZone).id,
            recentRolls: asArray(raw.recentRolls, []).slice(-2),
            toneHistory: asArray(raw.toneHistory, [])
                .filter((t) => ['warm', 'cold', 'flat'].includes(t)).slice(-10),
            channel: (['text', 'image', 'emoji', 'voice'].includes(String(raw.channel))
                ? raw.channel : config.channel),
        };
        advanceCycleDay(merged, now, config.timeZone);
        return merged;
    }
    catch {
        return base;
    }
}
/**
 * 周期天数完全由「周期第 1 天的锚点」与今天推导，天然幂等。
 *
 * 早期实现把 cycleAnchor 当成「上次记录日」做增量累加，并把 anchor 推到今天；
 * 但 defaultState 里 anchor 的语义是周期起点（today - (cycleDay - 1) 天），
 * 于是每次 loadState / 每轮 evaluate 都会重复计入 (cycleDay - 1) 天，
 * 重启后相位凭空跳好几天。这里改为只读推导，绝不改写 anchor。
 */
export function advanceCycleDay(state, now, timeZone) {
    const today = localMidnight(now, timeZone);
    const days = Math.floor((today - state.cycleAnchor) / 86400000);
    if (!Number.isFinite(days) || !Number.isFinite(state.cycleAnchor))
        return;
    const length = normalizeCycleLength(state.cycleLength);
    state.cycleDay = ((days % length) + length) % length + 1;
    state.phase = phaseOf(state.cycleDay, length);
}
/** 原子写：先写临时文件再 rename，避免重启时读到半截 JSON。 */
export function saveState(state, config) {
    const path = stateFilePath(config);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    renameSync(tmp, path);
}
