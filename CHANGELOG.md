# Changelog

## 0.2.0 — 2026-11-06

**v3 记忆锚定架构**，按《DSH 落地指导书 v3》整份重写。核心变化：从「随机性引擎」升级为「每轮把该记的原文重新塞回她眼前」。

### 新增机制

- **三层记忆**：核心块每轮原文进 system prompt（≤900 字）／情景块滚动 8 轮（≤500 字）／原话库只落 `transcript.jsonl` 不进 prompt。
- **事实台账四张表**（`facts` / `hisPrefs` / `openItems` / `episodes`）：只增不改；相似度 >0.9 去重；同类冲突 + 理由词 → 合法 `supersedes`，无理由改口记 `drift` 违例。这是「改口必须给理由」在数据层的落点。
- **锚点块**（`anchor.ts`）：≤700 字硬上限、facts ≤24 条、按 `近因×0.6 + 重要性×0.4` 排序；超长先砍 episodes 再砍低置信事实。顶部常驻 L1 思考期人称约束。
- **关系状态机**（tier 1–4）：升档需连续 2 轮正向、后退记心结、一场不跨两档、拉扯上限 3 次且间隔 ≥5、三成概率躲；跨档在称呼／主动频率／句长上留痕。
- **长度自适应**：`base = clamp(12 + 输入字数×0.35, 12, 240)` × 档位 × 状态 × 时段 × 降级系数，硬上限 260 字，作为软目标不截断。
- **分级降级 L1/L2/L3**：DSH 无法拦截助手输出，守卫改为纯函数只观测；L2 下轮锚点补注入纠偏块，L3 只留固定短句模板，一轮后自动回落。
- **状态模型 v3**：`version: 3`，`relationship` / `body` / `ledger` / `drift` / `degradeLevel` / `recentUserLen`。内存单例 + 防抖 800ms 原子写 + 退出 flush；启动读到 v1/v2 先备份 `state.v{old}.bak.json` 再迁移（energy/patience 0..1 → 0..100，affection → tier）。
- **用户侧双通道**：6 个 ASCII 工具（`mianmian_anchor` / `_tier` / `_cycle` / `_export` / `_import` / `_reset`）+ 中文对话关键词（「锚」「复盘」「导出一下」）。
- `schema/` 两份 JSON Schema、`fixtures/state.example.json`、`persona/` 七件套、`tests/eval/cases.json`（T-01~T-30）与 `judge.ts`。

### 兼容性

- 0.1.x 的随机性引擎整体保留在 `src/v1/`（`lib/v1/`），T-01~T-12 行为验收继续跑，26 项回归断言全绿，未退化。
- 按文档要求新增 5 个 `.test.ts`（Node 22.22 原生 TS 剥离直接跑，无 ts-node / vitest 依赖），共 60 项断言。
- 评测扩为 5 步：类型检查 → v3 60 断言 → v1 26 回归 → 真实 Cordis 集成 → `dsh plugin add` / `--dump-config` 安装链路。

### 校准

v3 指导书里新写的事件名、`inject`、`order` 数值、`scope.chatId`、`text:()=>null`、`ctx.on('dispose')`、CJS 模块格式等断言，与真实 `dsh 0.2.1-rc.2` 仍有出入。全部按源码落地，逐条证据见 `docs/CALIBRATION.md` 的「v3 增补」章节。

### 验收抓到并修掉的真问题

- `onUser` 原本没接 `tickBody`，状态机的每轮 tick 根本没跑 —— 已接入真实连发时间戳。
- 工具注册的 disposer 只收集未挂 `ctx.effect`，卸载后工具残留 —— 已按 `dsh-defend` 官方写法包进 `ctx.effect`。
- 首次启动不落 `state.json`，用户「刚装好想手填台账」时文件不存在 —— 已改为首次启动即写。
- 拉扯「躲开」时未记录尝试轮次，导致间隔 ≥5 的硬规则形同虚设 —— `lastFlirtTurn` 改为记录上次尝试。
- 人称守卫对「她说她今天不来了」这类合法转述误判 —— 改用搭配词区分第三方引用与自称崩坏。

## 0.1.1 — 2026-11-04

修复版。安装到真实 DSH 环境后做运行时验收时发现并修掉一个长期一致性缺陷。

- **修复周期锚点漂移**：`advanceCycleDay` 原先把 `cycleAnchor`（语义是「周期第 1 天」）当成「上次记录日」做增量累加，并把 anchor 推到今天；这会在首次重载 / 首轮对话时重复计入 `cycleDay - 1` 天，导致重启 DSH 后经期相位凭空跳好几天。改为由 anchor 与当天日期**幂等推导**，且绝不改写 anchor。
- 新增回归测试「周期锚点重载幂等，重启不漂移」：同一时刻用 4 个不同种子反复重载、一轮对话后再重载，周期与相位逐位一致；跨一天只推进一天。
- 全套断言由 25 项增至 26 项。

> 从 0.1.0 升级时，若已存在 `~/.dsh/mianmian/state.json`，周期会按保存的锚点重新推导一次；新安装不受影响。

## 0.1.0 — 2026-11-04

首版。按《DSH 插件设计文档 · dsh-persona-mianmian》实现，并依据本机 dsh `0.2.1-rc.2` 的真实类型定义校准接口（逐条见 `docs/CALIBRATION.md`）。

- 新增 `persona/default.md` 六件套设定集、`persona/mianmian.md` 角色别名
- 新增随机性引擎：`schedule` / `cycle` / `attention` / `share` / `leave` / `roll` / `engine`
- 新增 `state.ts` 原子持久化，cycleDay / energy / patience / affection 跨会话不归零
- 新增 `watch.ts`，`fs.watch` + 150ms 防抖热重载
- 新增 DSH 接入层：两个 section、一个 context、channel/tone 两个变量、四个命名空间命令、agent 事件链路
- 新增 `cordis.patch.yml` bundle 与 `package.json` 的 `dsh.bundle.patch` 声明；`lib/` 预构建入库，无安装期脚本
- 新增六份 `examples/` 示例对话
- 新增 `tests/cases.yaml`（T-01..T-18）、`tests/run.sh`、Node 单测、真实 Cordis 集成测试、隔离 `DSH_HOME` 的 `dsh plugin add` 链路校验
- 新增 README / 校准说明 / MIT LICENSE / GitHub Actions 发布工作流

### 实现中修掉的真实问题

- Cordis 的 Context 是代理：未声明 `inject` 的服务属性访问会抛 `cannot get property "commands" without inject`，连可选链都挡不住。改用宿主 `ctx.get()` 做能力探测。
- 系统提示词 provider 每个 step 都会求值，状态推进改挂在 `agent/inbox/inserted`，避免一个回合被重复扣耐心。
- 第三遍追问曾会把情绪永久锁成「冷」；改为只在升级那一轮强制，并补上睡眠档回血，长对话不再永久「又累又烦」。
- 短档权重过高会压垮字数分布；改为日常以 20–60 字为主，短档只在急、困、被缠、睡眠时出现。
- 情绪档在部分随机种子下 20 轮只出现 2 种；加入最近 8 轮缺档加权，10 个种子复测均覆盖暖/冷/平。
