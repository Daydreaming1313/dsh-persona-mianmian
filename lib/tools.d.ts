import type { Logger } from './config.js';
import type { StateStore } from './state.js';
import type { MianmianConfigV3, Snapshot } from './types.js';
import type { HostContext } from './v1/host.js';
/**
 * §8 通道一：ASCII 工具名（COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u，下划线合法）。
 * 中文「锚」「档位」等只做对话关键词，绝不注册成命令。
 */
export declare const TOOL_NAMES: readonly ["mianmian_anchor", "mianmian_tier", "mianmian_cycle", "mianmian_export", "mianmian_import", "mianmian_reset"];
export interface ToolContext {
    makeSnapshot: () => Snapshot;
    store: StateStore;
    config: MianmianConfigV3;
    logger: Logger;
    onReset: () => void;
}
export declare function registerTools(ctx: HostContext, tc: ToolContext): void;
/** 能力探测：Cordis 的 Context 是代理，未声明 inject 的属性访问会抛错。 */
declare function service<T>(ctx: HostContext, name: string): T | undefined;
export { service };
