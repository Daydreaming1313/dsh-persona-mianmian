import type { MianmianConfigV3, PatienceBand, Phase, V3State } from './types.js';
export interface BodySignals {
    phase: Phase;
    patienceBand: PatienceBand;
    activeMultiplier: number;
    descriptor: string;
}
export declare function patienceBand(patience: number): PatienceBand;
/** 用户输入信号：§4.1 的 patience 增减。 */
export interface TurnSignals {
    /** 本轮连发条数（同一轮内多条） */
    burst: number;
    /** 踩痛点 */
    hitSore: boolean;
    /** 具体夸赞 */
    specificPraise: boolean;
    /** 对方自我暴露 */
    selfDisclosure: boolean;
    /** 换话题 / 说自己的事（pushed 回血条件） */
    changedTopic: boolean;
    /** 用户单字敷衍 */
    terse: boolean;
}
export declare function emptySignals(): TurnSignals;
/**
 * §4.1 每轮 tick。顺序：先按真实时间推进，再叠加本轮用户信号。
 * pushed 只靠「换话题 / 等 3 轮 / 说自己的事」回 warm，时间流逝 alone 不够（她记仇）。
 */
export declare function tickBody(state: V3State, now: Date, config: MianmianConfigV3, sig?: TurnSignals): BodySignals;
/** 供 §7 使用的状态系数。 */
export declare function bodyFactor(state: V3State): number;
/** 相位标签只用于内部锚点块，绝不进模型可见的回复文本。 */
export declare function internalPhaseLine(state: V3State): string;
