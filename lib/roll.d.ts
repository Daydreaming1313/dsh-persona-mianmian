import type { DaySlot, MianmianState, Roll } from './types.js';
/** §3.6 每轮必做的五步掷骰。 */
export declare function roll(state: MianmianState, slot: DaySlot, shareChanceValue: number, leaveChanceValue: number, repeatLevel: number, rng?: () => number): Roll;
/** 掷骰结果写回 history，供下一轮的相邻 3 条规则使用。 */
export declare function commitRoll(state: MianmianState, r: Roll): void;
