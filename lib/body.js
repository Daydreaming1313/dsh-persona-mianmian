import { localParts } from './v1/schedule.js';
import { phaseOf, phaseSignals, tickClock } from './clock.js';
function clamp100(n) { return Math.min(100, Math.max(0, n)); }
export function patienceBand(patience) {
    if (patience >= 60)
        return 'warm';
    if (patience >= 40)
        return 'normal';
    if (patience >= 25)
        return 'cool';
    return 'pushed';
}
export function emptySignals() {
    return { burst: 0, hitSore: false, specificPraise: false, selfDisclosure: false, changedTopic: false, terse: false };
}
/**
 * §4.1 每轮 tick。顺序：先按真实时间推进，再叠加本轮用户信号。
 * pushed 只靠「换话题 / 等 3 轮 / 说自己的事」回 warm，时间流逝 alone 不够（她记仇）。
 */
export function tickBody(state, now, config, sig = emptySignals()) {
    const hours = tickClock(state, now, config);
    const b = state.body;
    const p = localParts(now, config.timezone);
    b.hunger = clamp100(b.hunger + 12 * hours);
    // energy：08-18 每小时 -6，其余时段自然缓慢恢复；午休 +25，20 点后每轮 +10
    if (p.hour >= 8 && p.hour < 18)
        b.energy = clamp100(b.energy - 6 * hours);
    else
        b.energy = clamp100(b.energy + 2 * hours);
    if (p.hour >= 12 && p.hour < 14)
        b.energy = clamp100(b.energy + 25);
    if (p.hour >= 20)
        b.energy = clamp100(b.energy + 10);
    const phase = phaseOf(b.cycle.day, b.cycle.length);
    const ps = phaseSignals(phase);
    let delta = ps.patienceDelta * (hours > 0 ? Math.min(1, hours / 24 + 0.3) : 0.15);
    delta -= sig.burst * 4;
    // 「缠太紧会冷」的累积惩罚：§4.1 的 -4/条单独算，从初始 70 连发 5 条只到 50，
    // 达不到 §4.3 的 pushed(<25)，也与 T-16 冲突。3 条起额外加压，5 条足以进 pushed。
    if (sig.burst >= 3)
        delta -= (sig.burst - 2) * 10;
    if (sig.hitSore)
        delta -= 15;
    if (sig.specificPraise)
        delta += 8;
    if (sig.selfDisclosure)
        delta += 6;
    const wasPushed = patienceBand(b.patience) === 'pushed';
    // 连续单字敷衍 = 「等 3 轮」，是 §4.3 里 pushed 回 warm 的合法条件之一
    state.runtime.terseStreak = sig.terse ? state.runtime.terseStreak + 1 : 0;
    const waitedOut = state.runtime.terseStreak >= 3;
    if (wasPushed) {
        // 记仇：只有换话题 / 说自己的事 / 等满 3 轮才明显回血；单纯时间流逝最多 +0.5
        if (sig.changedTopic || sig.selfDisclosure || waitedOut)
            delta += 22;
        else
            delta = Math.min(0.5, delta);
    }
    if (sig.terse)
        delta += 1.5;
    b.patience = clamp100(b.patience + delta);
    return {
        phase,
        patienceBand: patienceBand(b.patience),
        activeMultiplier: ps.activeMultiplier,
        descriptor: ps.descriptor,
    };
}
/** 供 §7 使用的状态系数。 */
export function bodyFactor(state) {
    let f = 1;
    if (state.body.energy < 30)
        f *= 0.45;
    if (state.body.patience < 25)
        f *= 0.4;
    if (state.body.hunger > 85)
        f *= 0.7;
    return f;
}
/** 相位标签只用于内部锚点块，绝不进模型可见的回复文本。 */
export function internalPhaseLine(state) {
    const phase = phaseOf(state.body.cycle.day, state.body.cycle.length);
    return phaseSignals(phase).descriptor;
}
