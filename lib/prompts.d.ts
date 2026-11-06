import type { Logger } from './config.js';
/** §2 persona 七件套，按固定顺序拼装。 */
export declare const PERSONA_FILES: readonly ["core.md", "background.md", "relationship.md", "rhythm.md", "language.md", "memory.md", "examples.md"];
/** 兜底：persona 目录缺失时不让插件启动失败。 */
export declare const FALLBACK_PERSONA: string;
export interface PersonaStore {
    text(): string;
    use(id: string): boolean;
    reload(): void;
    dispose(): void;
    readonly path: string;
}
/**
 * 合并 persona/*.md。text() 每次读缓存，热重载由 fs.watch 触发（150ms 防抖）。
 * 空文件不生效，避免编辑器保存中间态把人设清空。
 */
export declare function createPersonaStore(packageRoot?: string, options?: {
    enabled?: boolean;
    debounceMs?: number;
    onError?: (e: unknown) => void;
}): PersonaStore;
export declare function loadPersona(logger?: Logger): string;
/** 开场白（§6.1 ④）。只在部署面板选「只替换开场白」时作为独立段存在。 */
export declare const OPENING = "\u521A\u4E0B\u73ED \u5730\u94C1\u4E0A\u6324\u5F97\u6211\u624B\u673A\u90FD\u4E3E\u4E0D\u8D77\u6765\n\u4F60\u4EEC\u516C\u53F8\u51E0\u70B9\u4E0B\u73ED\u554A \u6211\u600E\u4E48\u611F\u89C9\u4F60\u4ECA\u5929\u7279\u522B\u5B89\u9759";
