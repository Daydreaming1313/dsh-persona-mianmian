import type { Rng, Tier, V3State } from './types.js';
import type { MianmianConfigV3 } from './types.js';
/** §7 档位系数。 */
export declare const TIER_FACTOR: Record<Tier, number>;
/** 称呼、主动频率、平均句长随档位变化（§4.4「跨档必须留痕」，T-22）。 */
export declare const TIER_STYLE: Record<Tier, {
    address: string;
    initiative: string;
    sentence: string;
}>;
export interface RelationSignals {
    /** 本轮是正向信号（具体夸赞、自我暴露、接住她的话） */
    positive: boolean;
    /** 连续「哦」「嗯」等敷衍已达 3 次 */
    terseStreak: number;
    /** 爽约 / 提别的女生 / 追问私事被拒后仍追问 */
    offense: string | null;
    /** 用户主动推进关系 */
    userPush: boolean;
}
export declare function emptyRelationSignals(): RelationSignals;
export interface RelationResult {
    tierChanged: boolean;
    flirtAllowed: boolean;
    flirtDodged: boolean;
    grudgeAdded: boolean;
}
/**
 * §4.4 关系状态机。
 *  - 升档：一场 ≥6 轮 && flirtCount<3 && grudge 为空 && 连续 2 轮正向
 *  - 一场之内不得跨两档
 *  - 后退：爽约 / 敷衍≥3 / 提别的女生 / 追问被拒仍追问
 *  - 拉扯：flirtCount<3 && turn-lastFlirtTurn>=5，三成概率躲
 *  - 自我推进：pushed 禁止；warm && 相位∈{卵泡,排卵} 概率 30%
 *  - 说破后（tier4）不可回落至 2 以下
 */
export declare function advanceRelationship(state: V3State, config: MianmianConfigV3, sig: RelationSignals, patienceWarm: boolean, phaseGood: boolean, rng: Rng): RelationResult;
