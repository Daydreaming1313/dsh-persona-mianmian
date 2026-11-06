import { exportAnchor } from './anchor.js';
import { TIER_STYLE } from './relationship.js';
/**
 * §8 通道一：ASCII 工具名（COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u，下划线合法）。
 * 中文「锚」「档位」等只做对话关键词，绝不注册成命令。
 */
export const TOOL_NAMES = [
    'mianmian_anchor',
    'mianmian_tier',
    'mianmian_cycle',
    'mianmian_export',
    'mianmian_import',
    'mianmian_reset',
];
export function registerTools(ctx, tc) {
    const commands = service(ctx, 'commands');
    if (!commands || typeof commands.register !== 'function') {
        tc.logger.warn('commands 服务不可用，工具未注册（对话关键词仍可用）');
        return;
    }
    /**
     * register() 返回 Cordis effect disposer。必须用 ctx.effect 包住它，
     * 插件卸载时才会自动撤销（本机 dsh-defend 的官方写法）。
     * 早期实现只是把 disposer 收集到局部变量里，从未被调用 → 卸载后工具残留。
     */
    const safe = (def) => {
        try {
            if (typeof ctx.effect === 'function') {
                ctx.effect(() => commands.register(def), `mianmian.tool.${def.name}`);
            }
            else {
                commands.register(def);
            }
        }
        catch (error) {
            tc.logger.warn(`工具 ${def.name} 注册失败（可能与宿主重名）：${String(error)}`);
        }
    };
    safe({
        name: 'mianmian_anchor',
        description: '打印当前锚点块（只增不改的台账 + 现在的状态）',
        handler: () => ({ kind: 'success', text: exportAnchor(tc.makeSnapshot(), tc.config) }),
    });
    safe({
        name: 'mianmian_tier',
        description: '查看/设置关系档位 1|2|3|4（设置需 config.allowTierSet）',
        input: { hint: '1 | 2 | 3 | 4，留空为查看' },
        handler: ({ rawInput }) => {
            const s = tc.store.snapshot();
            const arg = String(rawInput || '').trim();
            if (!arg) {
                const style = TIER_STYLE[s.relationship.tier];
                return { kind: 'success', text: [
                        `关系档位 ${s.relationship.tier}（1 生分 / 2 暧昧 / 3 靠近 / 4 说破）`,
                        `称呼：${style.address}；主动：${style.initiative}；句长：${style.sentence}`,
                        `本场拉扯 ${s.relationship.flirtCount}/${tc.config.flirtCap} 次，未解心结 ${s.relationship.grudge.filter((g) => !g.resolved).length} 个`,
                    ].join('\n') };
            }
            if (!tc.config.allowTierSet)
                return { kind: 'error', text: '默认只读。要允许设置请把 config.allowTierSet 打开' };
            const n = Number(arg);
            if (![1, 2, 3, 4].includes(n))
                return { kind: 'error', text: '只能是 1、2、3、4' };
            s.relationship.tier = n;
            s.runtime.tierStart = n;
            tc.store.touch();
            return { kind: 'success', text: `档位已设为 ${n}（${TIER_STYLE[n].address}）` };
        },
    });
    safe({
        name: 'mianmian_cycle',
        description: '查看周期锚点与长度（设置需 config.allowTierSet）',
        input: { hint: '留空为查看；或 <length> <YYYY-MM-DD>' },
        handler: ({ rawInput }) => {
            const s = tc.store.snapshot();
            const arg = String(rawInput || '').trim();
            if (!arg) {
                return { kind: 'success', text: `周期长度 ${s.body.cycle.length} 天，锚点 ${s.body.cycle.anchor}，当前第 ${s.body.cycle.day} 天` };
            }
            if (!tc.config.allowTierSet)
                return { kind: 'error', text: '默认只读。要允许设置请把 config.allowTierSet 打开' };
            const [l, a] = arg.split(/\s+/);
            const length = Number(l);
            if (!Number.isInteger(length) || length < 21 || length > 35)
                return { kind: 'error', text: '长度要 21–35 的整数' };
            s.body.cycle.length = length;
            if (a && /^\d{4}-\d{2}-\d{2}$/.test(a))
                s.body.cycle.anchor = a;
            tc.store.touch();
            return { kind: 'success', text: `周期已设为 ${length} 天，锚点 ${s.body.cycle.anchor}` };
        },
    });
    safe({
        name: 'mianmian_export',
        description: '导出锚点文本，可直接粘进新会话第一条',
        handler: () => ({ kind: 'success', text: exportAnchor(tc.makeSnapshot(), tc.config) }),
    });
    safe({
        name: 'mianmian_import',
        description: '从文本导入锚点（覆盖前自动备份）',
        input: { hint: '<锚点文本>' },
        handler: ({ rawInput }) => {
            const text = String(rawInput || '').trim();
            if (!text)
                return { kind: 'error', text: '把导出的锚点文本贴进来' };
            const s = tc.store.snapshot();
            const facts = text.split('\n').filter((l) => /^-\s/.test(l)).map((l) => l.replace(/^-\s*/, '').replace(/（第\d+轮[^）]*）$/, ''));
            if (!facts.length)
                return { kind: 'error', text: '没识别到台账条目（每条应以 - 开头）' };
            const backup = tc.store.backup('before-import');
            const now = new Date();
            for (const f of facts) {
                s.ledger.facts.push({
                    id: `f_import_${s.ledger.facts.length}`, kind: 'event', text: f,
                    speaker: 'him', turn: s.turn, at: now.toISOString(),
                    validUntil: null, supersedes: null, reason: null, confidence: 0.9, importance: 0.6,
                });
            }
            tc.store.touch();
            return { kind: 'success', text: `导入 ${facts.length} 条${backup ? `，已备份到 ${backup}` : ''}` };
        },
    });
    safe({
        name: 'mianmian_reset',
        description: '清空状态（先备份，需二次确认）',
        input: { hint: 'confirm' },
        handler: ({ rawInput }) => {
            if (String(rawInput || '').trim() !== 'confirm') {
                return { kind: 'error', text: '这会清空全部记忆。确认请执行 /mianmian_reset confirm' };
            }
            const backup = tc.store.backup('before-reset');
            tc.onReset();
            return { kind: 'success', text: `已重置${backup ? `，原状态备份在 ${backup}` : ''}` };
        },
    });
}
/** 能力探测：Cordis 的 Context 是代理，未声明 inject 的属性访问会抛错。 */
function service(ctx, name) {
    if (typeof ctx.get === 'function') {
        try {
            return ctx.get(name);
        }
        catch { /* 落到属性回退 */ }
    }
    try {
        return ctx[name];
    }
    catch {
        return undefined;
    }
}
export { service };
