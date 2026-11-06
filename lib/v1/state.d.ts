import type { MianmianConfig, MianmianState } from './types.js';
export declare const STATE_VERSION = 1;
export declare function stateDirOf(config: MianmianConfig): string;
export declare function stateFilePath(config: MianmianConfig): string;
/** 首次安装：cycleDayStart 可由配置指定，否则按当月的日期推导一个稳定起点。 */
export declare function defaultState(now: Date, config: MianmianConfig, rng?: () => number): MianmianState;
/** 读取并合并默认值；损坏的 state 文件不会让插件启动失败。 */
export declare function loadState(now: Date, config: MianmianConfig, rng?: () => number): MianmianState;
/**
 * 周期天数完全由「周期第 1 天的锚点」与今天推导，天然幂等。
 *
 * 早期实现把 cycleAnchor 当成「上次记录日」做增量累加，并把 anchor 推到今天；
 * 但 defaultState 里 anchor 的语义是周期起点（today - (cycleDay - 1) 天），
 * 于是每次 loadState / 每轮 evaluate 都会重复计入 (cycleDay - 1) 天，
 * 重启后相位凭空跳好几天。这里改为只读推导，绝不改写 anchor。
 */
export declare function advanceCycleDay(state: MianmianState, now: Date, timeZone: string): void;
/** 原子写：先写临时文件再 rename，避免重启时读到半截 JSON。 */
export declare function saveState(state: MianmianState, config: MianmianConfig): void;
