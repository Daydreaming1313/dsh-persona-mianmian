import type { MianmianConfigV3, Snapshot } from './types.js';
/** §5.4 锚点块硬上限 700 字；facts 最多 24 条。 */
export declare const ANCHOR_MAX_CHARS = 700;
export declare const EPISODE_BUDGET = 500;
/** L1 思考期人称约束：锚点块顶部常驻，防「她变他」。 */
export declare const IDENTITY_CONSTRAINT: string;
/** §6.2 L2 纠偏块原文。 */
export declare function correctionBlock(targetLen: number, lastViolatedFact?: string): string;
/** §6.2 L3 固定模板，不许模型自由发挥。 */
export declare const L3_LINES: readonly ["嗯 我在", "刚才想别的了 你说到哪了"];
export interface AnchorResult {
    text: string;
    chars: number;
    factCount: number;
    droppedEpisodes: number;
    droppedFacts: number;
}
/**
 * 组装注入到 system prompt 的锚点块。
 * 核心记忆里的四张表每个字都是原文，不做二次概括。
 * 超 700 字先砍 episodes，再砍低置信度 facts。
 */
export declare function buildAnchor(s: Snapshot, config: MianmianConfigV3): AnchorResult;
/** 给用户看的锚点文本（/mianmian_anchor、对话关键词「锚」）。 */
export declare function exportAnchor(s: Snapshot, config: MianmianConfigV3): string;
