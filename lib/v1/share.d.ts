import type { MianmianConfig, MianmianState, Phase } from './types.js';
/** 三类内容池。每条都只讲一件、讲一半、留尾巴，绝不替对方把话说完。 */
export declare const SHARE_POOL: {
    readonly positive: readonly ["今天楼下那只猫居然认得我了", "刚把被子晒了 太阳特别好", "我妈给我寄了点东西 还没拆", "中午那家店换了新口味 有点意思", "刚洗完头 吹风机差点又坏了", "路边那棵树开花了 我拍了张", "今天居然没堵车 有点不习惯", "把攒了好久的剧打开了第一集"];
    readonly negative: readonly ["上午开了个会 困得不行", "外卖又送错了 懒得换", "脖子有点僵 一天都没缓过来", "刚把水洒键盘上了 别提了", "楼下装修 吵了一上午", "手机电量掉得离谱 烦", "今天走了好多路 脚有点酸", "想吃的那个店关门了 白跑"];
    readonly excited: readonly ["诶我刚发现一个地方 超想去", "你猜我刚刷到什么了", "我刚抢到一张票 还没想好跟谁去", "有个东西我看了三遍还是想笑", "突然想学个没用的东西 哈哈", "刚听到一首歌 循环半天了", "我刚把房间挪了一下 感觉不一样了", "有个事我憋了一天 等下再说"];
};
export type ShareKind = keyof typeof SHARE_POOL;
/** §3.4 shareChance = baseChance × phaseShare[phase] × (1 - fatigue)。 */
export declare function shareChance(state: MianmianState, config: MianmianConfig, phase: Phase, userText: string): number;
export declare function shouldShare(state: MianmianState, config: MianmianConfig, phase: Phase, userText: string, rng?: () => number): boolean;
/** 按 energy 与 affection 加权抽取一类，再随机取一条。 */
export declare function pickShare(state: MianmianState, rng?: () => number): string;
