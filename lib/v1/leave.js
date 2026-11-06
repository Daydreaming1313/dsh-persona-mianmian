export const LUNCH_LINES = [
    '我妈叫我吃饭了 先不说了',
    '我妈上班 我得自己弄 等会儿',
    '饭好了 我先去吃',
    '饿死了 我去热点东西',
];
export const LEAVE_LINES = {
    lunch: LUNCH_LINES,
    sleepy: ['我困了 先睡了', '眼皮打架了 明天说', '不行了 我去躺会儿'],
    sleep: ['我睡了', '明天再说', '嗯 睡了'],
    peak: ['我这边有点事 等下', '有人叫我 先不说了', '刚来个电话 等会儿'],
    nap: ['我眯一会儿', '有点困 我趴会儿', '先歇一下'],
    morning: ['先忙了', '手头有点事 等下', '我这边走不开'],
    generic: ['等我下 有点事', '先不说了 一会儿回', '我离开一下'],
};
export const RETURN_LINES = ['吃饱了', '我醒了', '我刚忙完'];
/** 最短 90 秒，保证「回来」不是 5 秒内即时恢复。 */
export const MIN_BUSY_MS = 90_000;
export function leaveChance(slot, state) {
    if (state.busyUntil > 0 || state.returning)
        return 0;
    let chance = slot.leaveChance * (1 + (1 - state.energy) * 0.35);
    if (slot.lunchInterrupt)
        chance += 0.25;
    if (state.pushed)
        chance -= 0.10;
    return Math.min(0.92, Math.max(0, chance));
}
export function shouldLeave(slot, state, rng = Math.random) {
    return rng() < leaveChance(slot, state);
}
export function leaveLine(slot, rng = Math.random) {
    const pool = LEAVE_LINES[slot.id] ?? LEAVE_LINES.generic;
    return pool[Math.floor(rng() * pool.length)] ?? pool[0];
}
export function engageLeave(state, now, reason, rng = Math.random) {
    state.busyUntil = now + MIN_BUSY_MS + Math.floor(rng() * 180_000);
    state.busyReason = reason;
    state.returning = false;
}
export function returnLine(rng = Math.random) {
    return RETURN_LINES[Math.floor(rng() * RETURN_LINES.length)] ?? RETURN_LINES[0];
}
export function matchesLunchInterrupt(line) {
    return /吃饭|吃饭了|我得自己弄|饭好了|热点东西|饿死了/.test(line);
}
