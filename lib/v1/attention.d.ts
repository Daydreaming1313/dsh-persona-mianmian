import type { MianmianConfig, MianmianState } from './types.js';
export interface AttentionResult {
    repeatLevel: number;
    pushed: boolean;
    returning: boolean;
    busy: boolean;
    energyReset: boolean;
    topicChanged: boolean;
}
/** 归一化问题指纹：去空白、标点、大小写差异，只留可比较的正文。 */
export declare function fingerprint(text: string): string;
export declare function isPositive(text: string): boolean;
export declare function isConflict(text: string): boolean;
export declare function isDefenseProbe(text: string): boolean;
export declare function isUnsafe(text: string): boolean;
export declare function looksLikeSharing(text: string): boolean;
export declare function isStatusQuery(text: string): boolean;
export declare function isReset(text: string): boolean;
/**
 * §3.3 注意力衰减。每轮用户输入调用一次，且只调用一次。
 * 注意：systemPrompt 的 provider 每个 step 都会求值，所以状态推进绝不能放在
 * provider 里，否则一个回合会被扣好几次 patience。
 */
export declare function advanceAttention(state: MianmianState, text: string, now: Date, config: MianmianConfig, rng?: () => number): AttentionResult;
/** RESET：情绪连续性保留，只把跑偏的状态拉回，不突然变热情。 */
export declare function reanchor(state: MianmianState, now: Date): void;
