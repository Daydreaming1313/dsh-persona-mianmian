import { formatNow } from './clock.js';
import { type Logger } from './config.js';
import type { MianmianConfigV3, V3State } from './types.js';
import type { HostContext } from './v1/host.js';
export declare const name = "mianmian";
/** 只硬依赖 systemPrompt。agents / commands / sessions 缺失时自动降级。 */
export declare const inject: readonly ["systemPrompt"];
/** 供测试与二次开发：Cordis 插件对象本身。 */
export declare const plugin: {
    name: string;
    inject: readonly ["systemPrompt"];
    apply: typeof apply;
};
export declare function apply(ctx: HostContext, rawConfig?: unknown): void;
export { defaultConfig, normalizeConfig, seededRng, makeLogger } from './config.js';
export { StateStore, defaultState } from './state.js';
export { resolvePaths, backupPath } from './paths.js';
export { tickClock, deltaHours, cycleDayOf, phaseOf, phaseLabel, phaseSignals, timeFactor, formatNow } from './clock.js';
export { tickBody, patienceBand, bodyFactor, emptySignals } from './body.js';
export { advanceRelationship, TIER_FACTOR, TIER_STYLE, emptyRelationSignals } from './relationship.js';
export { addFact, addOpenItem, resolveOpenItem, addEpisode, rankFacts, similarity, hasReason, findConflict, contradictsLedger, expireFacts, nextFactId, REASON_WORDS } from './ledger.js';
export { extractRules, extractAndCommit, detectKeyword, shouldShowAnchor } from './extractor.js';
export { buildAnchor, exportAnchor, correctionBlock, IDENTITY_CONSTRAINT, L3_LINES, ANCHOR_MAX_CHARS } from './anchor.js';
export { guard, thirdPersonViolation, isIdentityViolation } from './guard.js';
export { decideDegrade, sectionTextFor, l3SectionText } from './degrade.js';
export { targetLength, lengthHint } from './length.js';
export { createBridge, extractUserText, extractAssistantText, sessionKeyOf, lastAssistantFromSnapshot } from './bridge.js';
export { createPersonaStore, loadPersona, OPENING, PERSONA_FILES, FALLBACK_PERSONA } from './prompts.js';
export { registerTools, TOOL_NAMES, service } from './tools.js';
export type { MianmianConfigV3, V3State, Snapshot, Tier, Rng, Violation, Fact, Ledger } from './types.js';
export type { Logger };
export { formatNow as nowLabel };
/** 便于离线评测：把状态导出成锚点文本。 */
export declare function anchorText(state: V3State, config?: MianmianConfigV3, now?: Date): string;
