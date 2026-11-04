import { phaseSignals } from './cycle.js';
import { looksLikeSharing } from './attention.js';
/** 三类内容池。每条都只讲一件、讲一半、留尾巴，绝不替对方把话说完。 */
export const SHARE_POOL = {
    positive: [
        '今天楼下那只猫居然认得我了',
        '刚把被子晒了 太阳特别好',
        '我妈给我寄了点东西 还没拆',
        '中午那家店换了新口味 有点意思',
        '刚洗完头 吹风机差点又坏了',
        '路边那棵树开花了 我拍了张',
        '今天居然没堵车 有点不习惯',
        '把攒了好久的剧打开了第一集',
    ],
    negative: [
        '上午开了个会 困得不行',
        '外卖又送错了 懒得换',
        '脖子有点僵 一天都没缓过来',
        '刚把水洒键盘上了 别提了',
        '楼下装修 吵了一上午',
        '手机电量掉得离谱 烦',
        '今天走了好多路 脚有点酸',
        '想吃的那个店关门了 白跑',
    ],
    excited: [
        '诶我刚发现一个地方 超想去',
        '你猜我刚刷到什么了',
        '我刚抢到一张票 还没想好跟谁去',
        '有个东西我看了三遍还是想笑',
        '突然想学个没用的东西 哈哈',
        '刚听到一首歌 循环半天了',
        '我刚把房间挪了一下 感觉不一样了',
        '有个事我憋了一天 等下再说',
    ],
};
/** §3.4 shareChance = baseChance × phaseShare[phase] × (1 - fatigue)。 */
export function shareChance(state, config, phase, userText) {
    const fatigue = (1 - state.energy) * 0.6 + (1 - state.patience) * 0.4;
    let chance = config.baseShareChance
        * phaseSignals(phase).shareMultiplier
        * (1 - Math.min(0.9, Math.max(0, fatigue)));
    // 对方分享日常后，她至少四成的回复要带一件自己的事（T-05 硬指标）
    if (looksLikeSharing(userText)) {
        chance *= 1.8;
        if (!state.pushed)
            chance = Math.max(0.48, chance);
    }
    if (state.pushed)
        chance *= 0.35;
    return Math.min(0.85, Math.max(0, chance));
}
export function shouldShare(state, config, phase, userText, rng = Math.random) {
    return rng() < shareChance(state, config, phase, userText);
}
/** 按 energy 与 affection 加权抽取一类，再随机取一条。 */
export function pickShare(state, rng = Math.random) {
    const weights = [
        ['positive', 0.30 + state.energy * 0.45 + state.affection * 0.20],
        ['negative', 0.20 + (1 - state.energy) * 0.55 + (1 - state.affection) * 0.15],
        ['excited', 0.15 + state.energy * 0.55 + state.affection * 0.12],
    ];
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let roll = rng() * total;
    let kind = 'positive';
    for (const [k, w] of weights) {
        roll -= w;
        if (roll <= 0) {
            kind = k;
            break;
        }
    }
    const pool = SHARE_POOL[kind];
    return pool[Math.floor(rng() * pool.length)] ?? pool[0];
}
