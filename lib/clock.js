import { localParts, slotOf } from './v1/schedule.js';
/** 真实时间推进的 Δ 小时，上限 72h（§4.1，避免长假回来数值炸掉）。 */
export function deltaHours(now, lastTickAt) {
    const last = Date.parse(lastTickAt);
    if (!Number.isFinite(last))
        return 0;
    const raw = (now.getTime() - last) / 3600000;
    if (!Number.isFinite(raw) || raw <= 0)
        return 0;
    return Math.min(72, raw);
}
/** §4.1 cycle.day 由锚点幂等推导，绝不改写 anchor。 */
export function cycleDayOf(anchor, now, length, timeZone) {
    const a = Date.parse(`${anchor}T00:00:00Z`);
    if (!Number.isFinite(a))
        return 1;
    // 用本地日期做差，避免夏令时/时区偏移导致边界抖动
    const p = localParts(now, timeZone);
    const today = Date.UTC(p.year, p.month - 1, p.day);
    const days = Math.floor((today - a) / 86400000);
    if (!Number.isFinite(days))
        return 1;
    return ((days % length) + length) % length + 1;
}
/** §4.2 五档相位。按 28 天基准分段，其余长度按比例缩放。 */
export const PHASE_BOUNDS = [
    { phase: 'menstrual', from: 1, to: 5, label: '经期' },
    { phase: 'follicular', from: 6, to: 13, label: '卵泡' },
    { phase: 'ovulation', from: 14, to: 16, label: '排卵' },
    { phase: 'earlyLuteal', from: 17, to: 23, label: '黄体前' },
    { phase: 'lateLuteal', from: 24, to: 28, label: '黄体后' },
];
export function phaseOf(day, length = 28) {
    const scaled = Math.round(((day - 1) / length) * 28) + 1;
    const hit = PHASE_BOUNDS.find((b) => scaled >= b.from && scaled <= b.to);
    return hit?.phase ?? 'earlyLuteal';
}
export function phaseLabel(phase) {
    return PHASE_BOUNDS.find((b) => b.phase === phase)?.label ?? '黄体前';
}
/** §4.2 相位 → 行为偏置。descriptor 只描述行为，永不出现天数。 */
export function phaseSignals(phase) {
    switch (phase) {
        case 'menstrual':
            return { patienceDelta: -15, activeMultiplier: 0.5, descriptor: '短、怕冷、容易炸；被关心先烦' };
        case 'follicular':
            return { patienceDelta: 10, activeMultiplier: 1.3, descriptor: '话最长、敢开玩笑' };
        case 'ovulation':
            return { patienceDelta: 5, activeMultiplier: 1.5, descriptor: '偏软、容易说漏嘴，事后自己尴尬' };
        case 'earlyLuteal':
            return { patienceDelta: 0, activeMultiplier: 1.0, descriptor: '正常' };
        case 'lateLuteal':
            return { patienceDelta: -12, activeMultiplier: 0.7, descriptor: '为小事不爽、翻旧账、觉得自己胖' };
    }
}
/** §7 时段系数。 */
export function timeFactor(now, config) {
    const p = localParts(now, config.timezone);
    const slot = slotOf(now, config.timezone);
    if (slot.id === 'sleep' || p.hour >= 0 && p.hour < 6)
        return 0.6;
    if (p.hour >= 20 && p.hour < 22)
        return 1.25;
    if (slot.id === 'lunch' || slot.id === 'nap')
        return 1.2;
    if (slot.id === 'morning' || slot.id === 'commute' || slot.id === 'afternoon')
        return 0.7;
    return 1;
}
/** 每轮 tick 的时间部分：推进 lastTickAt、由锚点重算 cycle.day。 */
export function tickClock(state, now, config) {
    const hours = deltaHours(now, state.lastTickAt);
    state.lastTickAt = now.toISOString();
    const c = state.body.cycle;
    c.day = cycleDayOf(c.anchor, now, c.length, config.timezone);
    return hours;
}
export function formatNow(now, config) {
    const p = localParts(now, config.timezone);
    const weekMap = { Sun: '日', Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' };
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} 周${weekMap[p.weekday] ?? '?'}`;
}
