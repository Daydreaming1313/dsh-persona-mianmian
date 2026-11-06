import type { DegradeLevel, DriftEntry, V3State, Violation } from './types.js';
/**
 * §6.2 降级三档。这是「纯函数 + 明确状态迁移」，不拦截、不重试输出。
 * 处置只作用到下一轮的锚点块 / section 文本上。
 */
export interface DegradeDecision {
    level: DegradeLevel;
    /** 本轮记入 drift 的违例 */
    recorded: DriftEntry[];
    /** 下一轮 persona / anchor 两个 section 是否返回空串（L3） */
    suppressPersona: boolean;
    /** L3 时注入的固定短回复模板 */
    template: string | null;
    reason: string;
}
export declare function decideDegrade(state: V3State, violations: Violation[], now: Date): DegradeDecision;
/** 供 section 文本函数使用：L3 时 persona / anchor 返回 ''（不是 null，见校准记录）。 */
export declare function sectionTextFor(state: V3State, normal: () => string): string;
/** L3 时唯一保留的 section 文本。 */
export declare function l3SectionText(state: V3State): string;
