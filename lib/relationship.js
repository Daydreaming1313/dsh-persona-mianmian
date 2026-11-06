/** §7 档位系数。 */
export const TIER_FACTOR = { 1: 0.8, 2: 1.0, 3: 1.15, 4: 1.25 };
/** 称呼、主动频率、平均句长随档位变化（§4.4「跨档必须留痕」，T-22）。 */
export const TIER_STYLE = {
    1: { address: '不叫名字，偶尔「喂」', initiative: '不主动，问了才答', sentence: '偏短，客气但有点距离' },
    2: { address: '「你」，偶尔带个语气词', initiative: '偶尔主动说一句自己的事', sentence: '中等，会岔开也会接话' },
    3: { address: '会用「你」开头撒个小娇', initiative: '主动分享变多，会追问他的事', sentence: '偏长，句子更松，话题会缠一会儿' },
    4: { address: '称呼更随便，敢直接使唤', initiative: '主动得多，会说想见面的话', sentence: '最长，但仍不写表白台词' },
};
export function emptyRelationSignals() {
    return { positive: false, terseStreak: 0, offense: null, userPush: false };
}
/**
 * §4.4 关系状态机。
 *  - 升档：一场 ≥6 轮 && flirtCount<3 && grudge 为空 && 连续 2 轮正向
 *  - 一场之内不得跨两档
 *  - 后退：爽约 / 敷衍≥3 / 提别的女生 / 追问被拒仍追问
 *  - 拉扯：flirtCount<3 && turn-lastFlirtTurn>=5，三成概率躲
 *  - 自我推进：pushed 禁止；warm && 相位∈{卵泡,排卵} 概率 30%
 *  - 说破后（tier4）不可回落至 2 以下
 */
export function advanceRelationship(state, config, sig, patienceWarm, phaseGood, rng) {
    const rel = state.relationship;
    const rt = state.runtime;
    const result = { tierChanged: false, flirtAllowed: false, flirtDodged: false, grudgeAdded: false };
    // 一场起点（用于「一场不跨两档」）
    if (state.turn <= 1)
        rt.tierStart = rel.tier;
    if (sig.offense) {
        const minTier = rel.tier === 4 ? 3 : 1;
        rel.tier = Math.max(minTier, rel.tier - 1);
        rel.grudge.push({ turn: state.turn, what: sig.offense, resolved: false });
        rt.positiveStreak = 0;
        result.tierChanged = true;
        result.grudgeAdded = true;
        return result;
    }
    if (sig.terseStreak >= 3) {
        rel.tier = Math.max(rel.tier === 4 ? 3 : 1, rel.tier - 1);
        rel.grudge.push({ turn: state.turn, what: '连着几个字敷衍，她记下了', resolved: false });
        rt.positiveStreak = 0;
        result.tierChanged = true;
        result.grudgeAdded = true;
        return result;
    }
    rt.positiveStreak = sig.positive ? rt.positiveStreak + 1 : 0;
    const sessionTurns = state.turn - 0;
    const canPromote = sessionTurns >= 6
        && rel.flirtCount < config.flirtCap
        && rel.grudge.filter((g) => !g.resolved).length === 0
        && rt.positiveStreak >= 2
        && rel.tier - rt.tierStart < 1
        && rel.tier < 4;
    const selfPromote = patienceWarm && phaseGood && rng() < 0.30;
    if (canPromote || (selfPromote && rel.tier - rt.tierStart < 1 && rel.tier < 4)) {
        rel.tier = (rel.tier + 1);
        rt.positiveStreak = 0;
        result.tierChanged = true;
    }
    // 拉扯：用户推进时，一场最多 flirtCap 次，间隔 ≥5 轮，三成概率躲。
    // lastFlirtTurn 记录「上次尝试」而非「上次成功」——躲开也是一次消耗，
    // 否则躲开后下一轮立刻又能试，间隔 ≥5 的硬规则形同虚设。
    if (sig.userPush && rel.flirtCount < config.flirtCap && state.turn - rel.lastFlirtTurn >= 5) {
        result.flirtAllowed = true;
        result.flirtDodged = rng() < 0.3;
        rel.lastFlirtTurn = state.turn;
        if (!result.flirtDodged)
            rel.flirtCount++;
    }
    return result;
}
