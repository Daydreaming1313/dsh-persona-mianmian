import type { Phase } from './types.js';
export declare const DEFAULT_CYCLE_LENGTH = 28;
export declare function normalizeCycleLength(value: unknown): number;
/** 各阶段天数按周期长度等比缩放，保证 21–35 天都能得到四个非空阶段。 */
export declare function phaseLengths(length: number): {
    menstrual: number;
    follicular: number;
    ovulation: number;
    luteal: number;
};
/** cycleDay 从 1 开始，自动折回 1..length。 */
export declare function phaseOf(cycleDay: number, length?: number): Phase;
export interface PhaseSignals {
    /** 双向分享概率倍率 */
    shareMultiplier: number;
    /** 暖 / 冷 / 平 抽取权重 */
    toneWeights: readonly [number, number, number];
    /** 不耐烦阈值降档：加到 leaving / pushed 判定上的压力 */
    patiencePenalty: number;
    /** 只走行为、不报数字的生理信号 */
    bodyLines: readonly string[];
    /** 给模型看的行为描述，绝不出现天数 */
    descriptor: string;
    /** 暧昧动作密度倍率 */
    teaseMultiplier: number;
}
/** §3.2 阶段映射。所有输出都是行为描述，绝不出现「经期第 X 天」这类报数。 */
export declare function phaseSignals(phase: Phase): PhaseSignals;
export declare const PHASE_LABEL: Record<Phase, string>;
