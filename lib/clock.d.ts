import type { MianmianConfigV3, Phase, V3State } from './types.js';
/** 真实时间推进的 Δ 小时，上限 72h（§4.1，避免长假回来数值炸掉）。 */
export declare function deltaHours(now: Date, lastTickAt: string): number;
/** §4.1 cycle.day 由锚点幂等推导，绝不改写 anchor。 */
export declare function cycleDayOf(anchor: string, now: Date, length: number, timeZone: string): number;
/** §4.2 五档相位。按 28 天基准分段，其余长度按比例缩放。 */
export declare const PHASE_BOUNDS: ReadonlyArray<{
    phase: Phase;
    from: number;
    to: number;
    label: string;
}>;
export declare function phaseOf(day: number, length?: number): Phase;
export declare function phaseLabel(phase: Phase): string;
export interface PhaseSignals {
    patienceDelta: number;
    activeMultiplier: number;
    descriptor: string;
}
/** §4.2 相位 → 行为偏置。descriptor 只描述行为，永不出现天数。 */
export declare function phaseSignals(phase: Phase): PhaseSignals;
/** §7 时段系数。 */
export declare function timeFactor(now: Date, config: MianmianConfigV3): number;
/** 每轮 tick 的时间部分：推进 lastTickAt、由锚点重算 cycle.day。 */
export declare function tickClock(state: V3State, now: Date, config: MianmianConfigV3): number;
export declare function formatNow(now: Date, config: MianmianConfigV3): string;
