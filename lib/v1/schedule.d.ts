import type { DaySlot, SlotId } from './types.js';
/** §3.1 时间分档。from/to 是 Asia/Shanghai 当日分钟数，左闭右开。 */
export declare const SLOTS: readonly DaySlot[];
export interface LocalParts {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
    readonly weekday: string;
    readonly minutes: number;
}
/** 用 Intl 拿目标时区的真实本地时间，不依赖任何时区库。 */
export declare function localParts(now: Date, timeZone?: string): LocalParts;
/** 当地零点对应的真实时间戳（用于跨天推进周期）。 */
export declare function localMidnight(now: Date, timeZone?: string): number;
export declare function slotOf(now: Date, timeZone?: string): DaySlot;
export declare function slotById(id: SlotId): DaySlot;
export declare function isSleepWindow(now: Date, timeZone?: string): boolean;
