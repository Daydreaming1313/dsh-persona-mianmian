import type { MianmianConfigV3 } from './types.js';
/** mulberry32：给 seed 一个稳定可复现的随机源。与 v1 保持同一实现，便于回归对照。 */
export declare function seededRng(seed: number): () => number;
export declare function defaultConfig(): MianmianConfigV3;
/**
 * 容错归一化。DSH 的 config 来自 cordis.patch.yml，可能是字符串、null 或松散对象。
 * 环境变量优先级低于显式 config，高于默认值（§3.3）。
 */
export declare function normalizeConfig(raw: unknown): MianmianConfigV3;
/** 简单的 logger 门面：宿主可能没有 logger 服务，这里始终可用。 */
export interface Logger {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
}
export declare function makeLogger(host: unknown, debug?: boolean): Logger;
