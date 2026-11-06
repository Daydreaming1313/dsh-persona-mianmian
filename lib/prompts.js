import { existsSync, readFileSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** §2 persona 七件套，按固定顺序拼装。 */
export const PERSONA_FILES = [
    'core.md',
    'background.md',
    'relationship.md',
    'rhythm.md',
    'language.md',
    'memory.md',
    'examples.md',
];
/** 兜底：persona 目录缺失时不让插件启动失败。 */
export const FALLBACK_PERSONA = [
    '你是林绵，女的，24 岁，济南人，茶饮公司市场岗。',
    '只输出一条微信消息本身：不用 markdown、不写括号动作、不写旁白、不用助手口吻。',
    '台账里有的措辞必须一致；要改口必须带理由；台账里没有的不许当有的说。',
].join('\n');
/**
 * 合并 persona/*.md。text() 每次读缓存，热重载由 fs.watch 触发（150ms 防抖）。
 * 空文件不生效，避免编辑器保存中间态把人设清空。
 */
export function createPersonaStore(packageRoot = PACKAGE_ROOT, options = {}) {
    const dir = join(packageRoot, 'persona');
    const debounceMs = options.debounceMs ?? 150;
    let content = '';
    let roleFile = 'core.md';
    let timer = null;
    let closed = false;
    const readAll = () => {
        const parts = [];
        for (const f of PERSONA_FILES) {
            const p = join(dir, f);
            if (!existsSync(p))
                continue;
            try {
                const t = readFileSync(p, 'utf8').trim();
                if (t)
                    parts.push(t);
            }
            catch (error) {
                options.onError?.(error);
            }
        }
        return parts.length ? parts.join('\n\n') : FALLBACK_PERSONA;
    };
    const reload = () => {
        if (closed)
            return;
        try {
            const next = readAll();
            if (next)
                content = next;
        }
        catch (error) {
            options.onError?.(error);
        }
    };
    reload();
    let watcher = null;
    if (options.enabled !== false) {
        try {
            // watch 目录比 watch 单个文件更稳（编辑器换文件保存）
            watcher = watch(dir, { persistent: false }, () => {
                if (timer)
                    clearTimeout(timer);
                timer = setTimeout(reload, debounceMs);
                timer.unref?.();
            });
        }
        catch (error) {
            options.onError?.(error);
        }
    }
    return {
        text: () => content,
        use: (id) => {
            const name = id.endsWith('.md') ? id : `${id}.md`;
            const p = join(dir, name);
            if (!existsSync(p))
                return false;
            roleFile = name;
            try {
                const t = readFileSync(p, 'utf8').trim();
                if (t)
                    content = t;
                return true;
            }
            catch (error) {
                options.onError?.(error);
                return false;
            }
        },
        reload,
        dispose: () => {
            closed = true;
            if (timer)
                clearTimeout(timer);
            watcher?.close();
        },
        path: join(dir, roleFile),
    };
}
export function loadPersona(logger) {
    const store = createPersonaStore(PACKAGE_ROOT, {
        enabled: false,
        onError: (e) => logger?.warn('persona 读取失败：%s', String(e)),
    });
    const t = store.text();
    store.dispose();
    return t;
}
/** 开场白（§6.1 ④）。只在部署面板选「只替换开场白」时作为独立段存在。 */
export const OPENING = '刚下班 地铁上挤得我手机都举不起来\n你们公司几点下班啊 我怎么感觉你今天特别安静';
