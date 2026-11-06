import type { Fact, FactKind, Ledger, OpenItem, V3State } from './types.js';
export declare function nextFactId(now?: Date): string;
/** 只增不改：改口时新增一条带 supersedes + reason，旧条目标记失效。 */
export interface AddFactInput {
    kind: FactKind;
    text: string;
    speaker?: 'him' | 'her';
    confidence?: number;
    importance?: number;
    validUntil?: string | null;
    supersedes?: string | null;
    reason?: string | null;
}
/** 中文 bigram Dice 相似度，零依赖、对短句稳定。 */
export declare function similarity(a: string, b: string): number;
/** 理由词（§5.3 ⑤）。命中才算合法改口。 */
export declare const REASON_WORDS: RegExp;
export declare function hasReason(text: string): boolean;
export declare function findConflict(ledger: Ledger, input: AddFactInput): Fact | null;
export interface AddResult {
    fact: Fact | null;
    duplicate: boolean;
    restatement: boolean;
    /** 无理由的改口 → drift 违例 */
    illegalRestatement: boolean;
}
export declare function addFact(state: V3State, input: AddFactInput, now: Date): AddResult;
/** 有效期到期自动降权（不删除，只把 confidence 压到模糊提示）。 */
export declare function expireFacts(ledger: Ledger, now: Date): number;
/** 未结事项：漏掉最伤人，单独一表。 */
export declare function addOpenItem(state: V3State, what: string): OpenItem;
export declare function resolveOpenItem(state: V3State, what: string): boolean;
/** 情景记忆滚动窗口：最近 8 轮要点。 */
export declare const EPISODE_WINDOW = 8;
export declare function addEpisode(state: V3State, summary: string, tag: string, now: Date): void;
/** §5.4 排序：近因 × 0.6 + 重要性 × 0.4。 */
export declare function rankFacts(ledger: Ledger, turn: number, budget: number): Fact[];
/** 台账一致性：文本里出现与台账相冲突、且不带理由的断言。 */
export declare function contradictsLedger(text: string, ledger: Ledger): string | null;
