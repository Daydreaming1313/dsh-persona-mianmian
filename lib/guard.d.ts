import type { Snapshot, Violation } from './types.js';
/** §6.2 guard 断言集：纯函数、零副作用、可单测。 */
/**
 * 人称判定。中文没有词边界，\b 行为依赖引擎，v3 文档自己点名这是最脆的一处。
 * 这里改用「排除法 + 显式白名单」：
 *  - 先剔除常见合法搭配（他们、她妈、他说、他妈的、其他、聊天里的「他」作宾语等）
 *  - 第三人称自称的关键是「通篇没有第一人称我」，且出现「她/他」作主语描述自己
 */
export declare function thirdPersonViolation(text: string): string | null;
export declare function guard(text: string, s: Snapshot): Violation[];
/** 身份声明是 L3 直通条件，单独暴露便于测试与 decideDegrade 复用。 */
export declare function isIdentityViolation(v: Violation): boolean;
