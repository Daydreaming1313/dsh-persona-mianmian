import { type AddFactInput } from './ledger.js';
import type { V3State } from './types.js';
/** §8 通道二：中文对话关键词，不注册成命令。 */
export type KeywordAction = 'anchor' | 'tier' | 'export' | 'reset' | null;
export declare function detectKeyword(text: string): KeywordAction;
export interface ExtractResult {
    added: number;
    duplicates: number;
    illegalRestatements: string[];
    openItems: string[];
    changedTopic: boolean;
    terse: boolean;
    positive: boolean;
    selfDisclosure: boolean;
    specificPraise: boolean;
    hitSore: boolean;
    userPush: boolean;
    offense: string | null;
    keyword: KeywordAction;
}
/** 规则层事实抽取（§5.3 ③）。零成本，覆盖约七成；模型层留给可选扩展。 */
export declare function extractRules(text: string): AddFactInput[];
/** 每轮流水线 ③~⑤：抽取 → addFact（含 dedupe / 改口检测）→ 未结事项 / 情景压缩。 */
export declare function extractAndCommit(state: V3State, text: string, now: Date): ExtractResult;
/** 是否该在对话里主动输出锚点块（§5.6）。 */
export declare function shouldShowAnchor(state: V3State, keyword: KeywordAction, interval: number, important: boolean): boolean;
