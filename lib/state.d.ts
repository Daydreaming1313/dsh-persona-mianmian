import type { Logger } from './config.js';
import { type DataPaths } from './paths.js';
import { type MianmianConfigV3, type V3State } from './types.js';
export declare function defaultState(now: Date, config: MianmianConfigV3): V3State;
/**
 * 内存单例 + 防抖原子写。每轮读写走内存（同步、零 await），落盘先写 .tmp 再 rename。
 * 写失败只记日志不中断对话。
 */
export declare class StateStore {
    readonly paths: DataPaths;
    private state;
    private timer;
    private closed;
    private readonly logger;
    private readonly debounceMs;
    constructor(config: MianmianConfigV3, logger: Logger, now?: Date);
    /** 内存引用，调用方可直接改；改完调 touch() 触发落盘。 */
    snapshot(): V3State;
    /** 追加原话库（§5.1 原话库不进 prompt）。失败不影响对话。 */
    appendTranscript(role: 'user' | 'assistant', text: string, turn: number, now: Date): void;
    /** 请求一次防抖落盘。 */
    touch(): void;
    /** 立即原子写。 */
    flush(): void;
    /** 危险操作前备份一份，返回备份路径；失败返回 null。 */
    backup(tag: string): string | null;
    /** 用外部导入的锚点文本覆盖台账前先备份；返回是否成功。 */
    replace(state: V3State): void;
    dispose(): void;
}
