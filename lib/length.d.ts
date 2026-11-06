import type { MianmianConfigV3, V3State } from './types.js';
/**
 * §7 长度自适应。
 * base = clamp(12 + 用户输入字数 × 0.35, 12, 240)
 * × 档位系数 × 状态系数 × 时段系数 × 降级系数
 * 长度是「目标」不是「限制」：写进锚点块当软指标，不截断输出。
 */
export declare function targetLength(state: V3State, config: MianmianConfigV3, now: Date): number;
/** 写进锚点块的软指标措辞（不报内部数值给「她」，只是给模型的写作目标）。 */
export declare function lengthHint(target: number): string;
