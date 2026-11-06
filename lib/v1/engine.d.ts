import type { Directive, LengthBand, MianmianConfig, MianmianState, Tone } from './types.js';
export declare function lengthRange(length: LengthBand): [number, number];
export declare const TONE_LABEL: Record<Tone, string>;
export interface EvaluateInput {
    state: MianmianState;
    userText: string;
    now: Date;
    config: MianmianConfig;
    rng?: () => number;
}
export interface EvaluateOutput {
    state: MianmianState;
    directive: Directive;
}
/**
 * §3 主控：每轮按 时间档 → 周期 → 注意力 → 分享 → 离开 → 掷骰 的顺序求值。
 * 只在真实用户消息到达时调用一次；提示词 provider 只读结果，绝不在这里改状态。
 */
export declare function evaluate(input: EvaluateInput): EvaluateOutput;
/** 静态铁律段。刻意不写出圆括号或星号的字面符号，避免模型照着模仿。 */
export declare function renderRules(config: MianmianConfig): string;
/** 注入给模型的动态运行时上下文。它是 user-role 快照，内容变化才投影新快照。 */
export declare function renderRuntime(state: MianmianState, d: Directive, config: MianmianConfig): string;
/**
 * 离线回归样本：按本轮 directive 造一条合规聊天消息。
 * 只给测试、examples 与 seed 回归用，运行时从不调用（真实回复由模型生成）。
 */
export declare const REPLY_POOL: Record<Tone, Record<Exclude<LengthBand, 'emoji'>, readonly string[]>>;
export declare const CHANNEL_SAMPLES: {
    readonly image: readonly ["一只猫缩在纸箱里 只露出耳朵", "表情包 猫把脸埋进爪子", "拍糊了的路灯 有点晃"];
    readonly emoji: readonly ["😐", "🙄", "🥱", "🙂", "😶", "🫠"];
    readonly voice: readonly ["刚忙完 有点累", "我吃饱了", "等下再说", "嗯 没事"];
};
export declare function sampleReply(d: Directive, state: MianmianState, rng?: () => number): string;
