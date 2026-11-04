import type { HostContext } from './host.js';
/** Cordis 插件身份。只硬依赖 systemPrompt；其它服务一律可选，保证任何 profile 都能装。 */
export declare const name = "mianmian";
export declare const inject: string[];
/** 从 DSH 的 UserMessage 里取正文，跳过思考块，兼容字符串与 content block 两种形状。 */
export declare function extractUserText(payload: unknown): string;
/**
 * 插件入口。真实签名依据本机 dsh 0.2.1-rc.2：
 *   section({name, order, text}) / context({name, order, text}) / variable(name, provider)
 * 三者都返回 Cordis effect disposer，用 ctx.effect 包住以便卸载时自动撤销。
 */
export declare function apply(ctx: HostContext, rawConfig?: unknown): void;
export { defaultConfig, normalizeConfig } from './config.js';
export { evaluate, renderRules, renderRuntime, sampleReply } from './engine.js';
export type { MianmianConfig, MianmianState, Directive, Channel, Mode } from './types.js';
