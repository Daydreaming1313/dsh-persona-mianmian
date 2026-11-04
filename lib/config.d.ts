import type { MianmianConfig } from './types.js';
/** mulberry32：给 seed 一个稳定可复现的随机源。 */
export declare function seededRng(seed: number): () => number;
export declare function defaultConfig(): MianmianConfig;
/** 容错归一化：宿主可能传 undefined、字符串、或来自 YAML 的松散对象。 */
export declare function normalizeConfig(raw: unknown): MianmianConfig;
