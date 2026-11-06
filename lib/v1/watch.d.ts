/** persona 文件缺失时的内置兜底正文（完整可用，不是占位符）。 */
export declare const FALLBACK_PERSONA: string;
export interface PersonaStore {
    text(): string;
    reload(): void;
    /** 切换角色文件，对应 §4 角色库设计：每个角色一个 ROLE.md */
    use(fileName: string): boolean;
    dispose(): void;
    readonly path: string;
}
export interface PersonaStoreOptions {
    fileName?: string;
    /** §4 热重载防抖 150ms */
    debounceMs?: number;
    enabled?: boolean;
    onError?: (error: unknown) => void;
    onChange?: () => void;
}
/** fs.watch 防抖热重载；改 persona/*.md 即生效，无需重启。 */
export declare function createPersonaStore(packageRoot: string, options?: PersonaStoreOptions): PersonaStore;
