import type { DaySlot, MianmianState } from './types.js';
export declare const LUNCH_LINES: readonly ["我妈叫我吃饭了 先不说了", "我妈上班 我得自己弄 等会儿", "饭好了 我先去吃", "饿死了 我去热点东西"];
export declare const LEAVE_LINES: Record<string, readonly string[]>;
export declare const RETURN_LINES: readonly ["吃饱了", "我醒了", "我刚忙完"];
/** 最短 90 秒，保证「回来」不是 5 秒内即时恢复。 */
export declare const MIN_BUSY_MS = 90000;
export declare function leaveChance(slot: DaySlot, state: MianmianState): number;
export declare function shouldLeave(slot: DaySlot, state: MianmianState, rng?: () => number): boolean;
export declare function leaveLine(slot: DaySlot, rng?: () => number): string;
export declare function engageLeave(state: MianmianState, now: number, reason: string, rng?: () => number): void;
export declare function returnLine(rng?: () => number): string;
export declare function matchesLunchInterrupt(line: string): boolean;
