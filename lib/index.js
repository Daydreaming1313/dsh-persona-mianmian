import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConfig, seededRng } from './config.js';
import { loadState, saveState } from './state.js';
import { slotOf } from './schedule.js';
import { PHASE_LABEL, phaseSignals } from './cycle.js';
import { reanchor } from './attention.js';
import { evaluate, renderRules, renderRuntime, TONE_LABEL } from './engine.js';
import { createPersonaStore } from './watch.js';
/** Cordis 插件身份。只硬依赖 systemPrompt；其它服务一律可选，保证任何 profile 都能装。 */
export const name = 'mianmian';
export const inject = ['systemPrompt'];
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANNELS = ['text', 'image', 'emoji', 'voice'];
/**
 * 能力探测。Cordis 的 Context 是代理：未声明 inject 的服务属性访问会直接抛
 * 「cannot get property "x" without inject」，连可选链都挡不住。真实宿主提供
 * ctx.get(name)，缺失时返回 undefined；mock/旧宿主才回退到属性读取。
 */
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
function warn(ctx, message) {
    let logger;
    try {
        logger = ctx.logger;
    }
    catch { /* logger 服务可能不可用 */ }
    if (logger?.warn)
        logger.warn(`[mianmian] ${message}`);
    else
        console.warn(`[mianmian] ${message}`);
}
/** 从 DSH 的 UserMessage 里取正文，跳过思考块，兼容字符串与 content block 两种形状。 */
export function extractUserText(payload) {
    const msg = (payload && typeof payload === 'object' && 'message' in payload
        ? payload.message
        : payload);
    if (!msg)
        return '';
    if (typeof msg === 'string')
        return msg;
    if (typeof msg !== 'object')
        return '';
    const m = msg;
    if (typeof m.text === 'string')
        return m.text;
    if (typeof m.content === 'string')
        return m.content;
    if (Array.isArray(m.content)) {
        return m.content.map((block) => {
            if (typeof block === 'string')
                return block;
            if (!block || typeof block !== 'object')
                return '';
            const b = block;
            if (b.type === 'reasoning' || b.type === 'tool_use')
                return '';
            return typeof b.text === 'string' ? b.text : '';
        }).filter(Boolean).join('');
    }
    if (m.message && typeof m.message === 'object')
        return extractUserText(m.message);
    return '';
}
function sourceKind(payload) {
    const msg = (payload && typeof payload === 'object' && 'message' in payload
        ? payload.message
        : payload);
    const source = msg?.source;
    return typeof source?.kind === 'string' ? source.kind : '';
}
/** 启动时的基线指令：保证第一次 assemble 的 context 不是空文本。 */
function baselineDirective(state, config) {
    const r = { length: 'medium', completeness: 'full', tone: state.lastTone, share: false, leave: false };
    const d = {
        turn: state.turn,
        slot: slotOf(new Date(), config.timeZone),
        phase: state.phase,
        roll: r,
        shareLine: '', leaveLine: '', returnLine: '',
        reset: false, statusQuery: false, defense: false, safety: false,
        lowMood: false, tease: false, typingTrace: false,
        repeatLevel: 1, pushed: state.pushed, busy: state.busyUntil > 0,
        text: '',
    };
    d.text = renderRuntime(state, d, config);
    return d;
}
/**
 * 插件入口。真实签名依据本机 dsh 0.2.1-rc.2：
 *   section({name, order, text}) / context({name, order, text}) / variable(name, provider)
 * 三者都返回 Cordis effect disposer，用 ctx.effect 包住以便卸载时自动撤销。
 */
export function apply(ctx, rawConfig) {
    const config = normalizeConfig(rawConfig);
    const sp = service(ctx, 'systemPrompt');
    if (!sp) {
        warn(ctx, 'systemPrompt 服务不可用，人格段未挂载');
        return;
    }
    const rng = config.seed === null ? Math.random : seededRng(config.seed);
    const state = loadState(new Date(), config, rng);
    const store = createPersonaStore(PACKAGE_ROOT, {
        enabled: config.hotReload,
        debounceMs: 150,
        onError: (error) => warn(ctx, `persona 热重载失败：${String(error)}`),
    });
    const disposers = [];
    let lastDirective = baselineDirective(state, config);
    state.pendingDirective = lastDirective.text;
    const addEffect = (execute, label) => {
        if (typeof ctx.effect === 'function') {
            ctx.effect(() => execute() ?? (() => { }), label);
        }
        else {
            const d = execute();
            if (typeof d === 'function')
                disposers.push(d);
        }
    };
    // 1) 人格段：order 落在 persona 带（0 附近），不替换宿主身份段，不使用 complete
    addEffect(() => sp.section({
        name: 'mianmian:persona',
        order: 10,
        text: () => store.text(),
    }), 'mianmian.persona');
    // 2) 输出铁律段：静态文本，前缀稳定，不引用会变化的变量
    addEffect(() => sp.section({
        name: 'mianmian:rules',
        order: 11,
        text: () => renderRules(config),
    }), 'mianmian.rules');
    // 3) 动态运行时上下文：只在上一步用户消息到达时更新，assemble 每个 step 只读不写状态
    addEffect(() => sp.context({
        name: 'mianmian:runtime',
        order: 900,
        text: () => state.pendingDirective || lastDirective.text,
    }), 'mianmian.runtime');
    // 4) 频道与语气变量：只在动态 context 里引用，避免污染 system prompt 前缀缓存
    addEffect(() => sp.variable('channel', () => state.channel), 'mianmian.channel');
    addEffect(() => sp.variable('tone', () => TONE_LABEL[state.lastTone]), 'mianmian.tone');
    /** 一轮真实用户输入 → 推进状态机 → 落盘 → 更新下一条 context 快照。 */
    const onUserMessage = (text, now) => {
        const trimmed = String(text || '').trim();
        if (!trimmed)
            return;
        try {
            const result = evaluate({ state, userText: trimmed, now, config, rng });
            lastDirective = result.directive;
            saveState(state, config);
        }
        catch (error) {
            warn(ctx, `本轮状态推进失败：${String(error)}`);
        }
    };
    const mounted = new WeakSet();
    const attach = (agent) => {
        const agentCtx = agent?.ctx;
        if (!agentCtx || typeof agentCtx.on !== 'function' || mounted.has(agentCtx))
            return;
        mounted.add(agentCtx);
        try {
            const off = agentCtx.on('agent/inbox/inserted', (payload) => {
                const kind = sourceKind(payload);
                if (/context|runtime|system|mianmian|injected/i.test(kind))
                    return;
                onUserMessage(extractUserText(payload), new Date());
            });
            if (typeof off === 'function')
                disposers.push(off);
        }
        catch (error) {
            warn(ctx, `挂载 agent/inbox/inserted 失败：${String(error)}`);
        }
    };
    const scanAgents = () => {
        try {
            const agents = service(ctx, 'agents');
            for (const agent of agents?.list?.() ?? [])
                attach(agent);
        }
        catch (error) {
            if (config.debug)
                warn(ctx, `扫描 agents 失败：${String(error)}`);
        }
    };
    if (typeof ctx.on === 'function') {
        try {
            const offCreated = ctx.on('agent/created', (payload) => {
                const agent = payload?.agent;
                if (agent)
                    attach(agent);
            });
            if (typeof offCreated === 'function')
                disposers.push(offCreated);
        }
        catch (error) {
            warn(ctx, `挂载 agent/created 失败：${String(error)}`);
        }
    }
    scanAgents();
    // profile 启动时服务装载顺序不定，2 秒后补扫一次；unref 不阻塞进程退出
    const rescan = setTimeout(scanAgents, 2000);
    rescan.unref?.();
    // 5) 命令。DSH 的命令名只能是 [a-z][a-z0-9_-]*，所以中文「状态」是普通消息关键词，
    //    命令面用 mianmian-status 等命名空间名（见 docs/CALIBRATION.md）。
    const commands = service(ctx, 'commands');
    if (config.registerCommands && commands && typeof commands.register === 'function') {
        const safeRegister = (definition) => {
            try {
                const off = commands.register(definition);
                if (typeof off === 'function')
                    disposers.push(off);
            }
            catch (error) {
                warn(ctx, `命令 ${definition.name} 已存在或注册失败，已跳过：${String(error)}`);
            }
        };
        const statusText = () => {
            const s = state;
            return [
                `绵绵 · ${PHASE_LABEL[s.phase]}｜${phaseSignals(s.phase).descriptor}`,
                `精力 ${Math.round(s.energy * 100)}／耐心 ${Math.round(s.patience * 100)}／亲近 ${Math.round(s.affection * 100)}`,
                `时段 ${slotOf(new Date(), config.timeZone).label}｜频道 ${s.channel}｜轮次 ${s.turn}`,
                `被缠 ${s.pushed ? '是' : '否'}｜离开中 ${s.busyUntil > Date.now() ? '是' : '否'}｜拉扯 ${s.teaseCount} 次`,
                '这里显示的是调试数值，不会进入绵绵的回复。',
            ].join('\n');
        };
        safeRegister({
            name: 'mianmian-status',
            description: '查看绵绵当前的身体与情绪状态（调试用，不进入对话）',
            handler: () => ({ kind: 'success', text: statusText() }),
        });
        safeRegister({
            name: 'mianmian-channel',
            description: '切换回复频道：text / image / emoji / voice',
            input: { hint: 'text | image | emoji | voice' },
            handler: ({ rawInput }) => {
                const next = String(rawInput || '').trim().toLowerCase();
                if (!CHANNELS.includes(next)) {
                    return { kind: 'error', text: '只能是 text、image、emoji、voice 之一' };
                }
                state.channel = next;
                saveState(state, config);
                return { kind: 'success', text: `频道切到 ${next}` };
            },
        });
        safeRegister({
            name: 'mianmian-role',
            description: '切换 persona 目录下的角色文件，例如 mianmian',
            input: { hint: '<role-id>' },
            handler: ({ rawInput }) => {
                const id = String(rawInput || '').trim();
                if (!id)
                    return { kind: 'error', text: '给一个角色文件名，例如 mianmian' };
                if (!store.use(id))
                    return { kind: 'error', text: `persona/${id}.md 不存在` };
                return { kind: 'success', text: `已切到 persona/${id}.md，下一步生效` };
            },
        });
        safeRegister({
            name: 'mianmian-reset',
            description: '回锚：把跑偏的状态拉回，情绪连续性保留',
            handler: () => {
                reanchor(state, new Date());
                lastDirective = baselineDirective(state, config);
                state.pendingDirective = lastDirective.text;
                saveState(state, config);
                return { kind: 'success', text: '已回锚，情绪接着走' };
            },
        });
        if (config.enableRoleAlias) {
            safeRegister({
                name: 'role',
                description: '绵绵角色切换（与 mianmian-role 相同；宿主已有 /role 时会被跳过）',
                input: { hint: 'mianmian' },
                handler: ({ rawInput }) => {
                    const id = String(rawInput || '').trim() || 'default';
                    if (!store.use(id))
                        return { kind: 'error', text: `persona/${id}.md 不存在` };
                    return { kind: 'success', text: `已切到 persona/${id}.md` };
                },
            });
        }
    }
    // 卸载时撤销一切：热重载监听、事件、命令、补扫定时器
    addEffect(() => () => {
        clearTimeout(rescan);
        store.dispose();
        for (const off of disposers) {
            try {
                off();
            }
            catch { /* 单个 disposer 失败不影响其余清理 */ }
        }
    }, 'mianmian.dispose');
}
export { defaultConfig, normalizeConfig } from './config.js';
export { evaluate, renderRules, renderRuntime, sampleReply } from './engine.js';
