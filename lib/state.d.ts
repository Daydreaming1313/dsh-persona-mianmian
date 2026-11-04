import type { MianmianConfig, MianmianState } from './types.js';
export declare const STATE_VERSION = 1;
export declare function stateDirOf(config: MianmianConfig): string;
export declare function stateFilePath(config: MianmianConfig): string;
/** 首次安装：cycleDayStart 可由配置指定，否则按当月的日期推导一个稳定起点。 */
export declare function defaultState(now: Date, config: MianmianConfig, rng?: () => number): MianmianState;
/** 读取并合并默认值；损坏的 state 文件不会让插件启动失败。 */
export declare function loadState(now: Date, config: MianmianConfig, rng?: () => number): MianmianState;
/** 跨会话按真实日期推进 cycleDay，绝不归零。 */
export declare function advanceCycleDay(state: MianmianState, now: Date, timeZone: string): void;
/** 原子写：先写临时文件再 rename，避免重启时读到半截 JSON。 */
export declare function saveState(state: MianmianState, config: MianmianConfig): void;
