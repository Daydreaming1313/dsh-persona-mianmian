import type { HostContext } from './v1/host.js';
import type { Logger } from './config.js';
/**
 * §6.4 闭包桥接。AssembleContext 只有 scope / signal（+ 合并的 agent?: Agent），
 * 没有 chatId，也不带用户原文，所以自己用事件缓存。
 *
 * 真实事件（已核对 dsh 0.2.1-rc.2）：
 *   agent/created          { agent }                     ← 拿到 agent.ctx 才能挂作用域事件
 *   agent/inbox/inserted   { agent, message }            ← 用户原文
 *   session/event          (session, event)              ← assistant/message 只读观测
 *   agent/turn-stopping    { agent, turn, signal }       ← 一轮「即将」结束
 * 文档 v3 写的 user/message、agent/turn-end、assistant/message（作为 Cordis 事件）
 * 都不存在；它们是 SessionEvent 的 type，只能走 session/event。
 *
 * 事件是 Scope-filtered dispatch：agent 作用域的事件必须在 agent.ctx 上订阅，
 * 全局 ctx 收不到。所以 attach() 会被 agent/created 调用多次，共享同一批槽。
 */
/** 从 UserMessage / content block 取正文，跳过 reasoning / tool_use。 */
export declare function extractUserText(payload: unknown): string;
/** session/event 的 assistant/message：文本在 event.data.message.content。 */
export declare function extractAssistantText(event: unknown): string;
/** 会话标识：优先 agent.id，其次 session.id；都没有用单槽 ''。 */
export declare function sessionKeyOf(agent: unknown, session: unknown): string;
/** 从 session 快照里倒序找最后一条 assistant/message（dsh-fish-memory 的成熟做法）。 */
export declare function lastAssistantFromSnapshot(session: unknown): string;
export interface BridgeSlots {
    userText(key: string): string;
    assistantText(key: string): string;
    lastKey(): string;
    /** assemble 拿不到 key 时用最近活跃槽兜底 */
    currentUserText(key: string): string;
    clear(key: string): void;
}
export interface BridgeOptions {
    logger: Logger;
    onUser?: (text: string, key: string) => void;
    onAssistant?: (text: string, key: string) => void;
    onTurnStopping?: (key: string, agent: unknown) => void;
}
export interface Bridge {
    slots: BridgeSlots;
    /** 在给定 ctx（全局或 agent.ctx）上挂监听；可重复调用。 */
    attach(ctx: HostContext): void;
    dispose(): void;
}
export declare function createBridge(opts: BridgeOptions): Bridge;
