# dsh-persona-mianmian · 绵绵（v3 记忆锚定版）

DeepSeek Harness（DSH）人格插件。**林绵**，24 岁，济南人，茶饮公司市场岗，缺爱敏感、有脾气有缺点，跟一个男生处于会变动的关系中。

这不是「更会聊的女友机器人」，是一个具体的、会记仇、会失手、会突然不想说话的人。

v3 的核心不是「写得更好的提示词」，而是**每轮把该记的原文重新塞回她眼前**。她不需要有记忆，只需要看不见漏。

---

## 1. 这是什么 / 不是什么

**是**：纯文本 IM 人格插件；三层记忆 + 事实台账；关系状态机；长度随输入量自适应；分级降级防漂移。

**不是**：TTS / 语音 / 图片；外部数据库；多用户隔离；能拦住模型说错话的护栏。

⚠️ **最重要的一条限制**：DSH 没有任何能拦截或改写助手输出的事件。所以「防漂移」只能做到「事后检测 + 下一轮纠偏 + 主动降级」，**做不到「不合格就不发出去」**。详见 §5。

`state.json` 里留了 `userId` 字段，将来要扩多用户再改。

---

## 2. 60 秒上手

```bash
dsh plugin add dsh-persona-mianmian@0.2.0
# 或本地安装
dsh plugin add ./dsh-persona-mianmian
```

> ⚠️ **新版本刚发布时请带版本号**。DSH 的插件安装走 pnpm，受 `minimumReleaseAge`（新发布冷却期，供应链安全策略）约束，刚发布的版本会被跳过、静默装到旧版。dsh 自己的类型描述里也写了：「pnpm's `minimumReleaseAge` can make it older than the newest release」。带 `@0.2.0` 显式指定时，`dsh plugin add` 会自动把这条加进 profile 的 `minimumReleaseAgeExclude`。冷却期过后（通常数天）不带版本号也能拿到最新版。装完可用 `dsh plugin list` 或看 `node_modules/dsh-persona-mianmian/package.json` 确认版本。

部署面板选「只替换开场白」（或保持默认，人格段会与宿主工具引导共存），开聊。

首次启动会在 `~/.dsh/mianmian/` 生成 `state.json`，可以直接打开手填台账。

对话里直接说「锚」「复盘」「你现在什么档」「导出一下」就行，不用记命令。

---

## 3. 配置项

`cordis.patch.yml` 的 `config` 行（后续 profile 层可整行覆盖）：

| 项 | 默认 | 说明 |
|---|---|---|
| `dataDir` | `null` | 显式数据目录，最高优先 |
| `cycleLength` | `28` | 周期长度 21–35 |
| `cycleAnchor` | `null` | 周期第 1 天 `YYYY-MM-DD`；留空按当天推导 |
| `timezone` | `Asia/Shanghai` | 时段判定用 |
| `tierStart` | `2` | 关系起始档 1–4 |
| `flirtCap` | `3` | 一场拉扯次数上限 |
| `anchorEvery` | `5` | 每满 N 轮主动给用户看一次锚点 |
| `factsBudget` | `24` | 锚点块注入的事实条数上限 |
| `maxReplyChars` | `260` | 回复硬上限（软目标，不截断） |
| `reasoningMode` | `off` | 深度思考会让长思考中的人称漂移率上升，默认关 |
| `allowTierSet` | `false` | 是否允许工具写入档位/周期，默认只读 |
| `seed` | `null` | 固定随机源便于回归 |
| `hotReload` | `true` | 改 `persona/*.md` 即生效 |
| `registerCommands` | `true` | 是否注册 ASCII 工具 |
| `persistDebounceMs` | `800` | 防抖原子写间隔 |

**数据目录优先级**（§3.3）：`config.dataDir` > `DSH_MIANMIAN_DATA` > `DSH_DATA_DIR/mianmian` > `~/.dsh/mianmian`。`DSH_HOME` 存在时替代 `~/.dsh`。目录不存在会自动建。

---

## 4. 记忆锚定怎么工作

三层记忆，避免长上下文中间段衰减（lost in the middle）：

| 层 | 内容 | 注入 | 预算 |
|---|---|---|---|
| 核心记忆 | 身份锚、五条铁律、关系档位、四张表摘要 | 每轮原文进 system prompt | ≤900 字 |
| 情景记忆 | 最近 8 轮要点 + 关键节点 | 每轮进，滚动压缩 | ≤500 字 |
| 原话库 | 全部历史消息原文 | **不进 prompt**，落 `transcript.jsonl` | 不限 |

每轮流水线（§5.3）：

```
① bridge    事件闭包拿到本轮用户原文
② tick      按真实时间推进 hunger / energy / patience / cycle
③ extract   规则层抽事实（时间/地点/食物/人名/约定/偏好）
④ dedupe    相似度 >0.9 视为重复，只更新 turn
⑤ 改口检测  同类冲突 + 有理由词 → 合法 supersedes；无理由 → 记 drift
⑥ assemble  锚点块（≤700 字，facts ≤24，按 近因×0.6 + 重要性×0.4 排序）
⑦ guard     纯函数断言跑一遍（只观测，不阻断）
⑧ persist   防抖原子写 state.json + 追加 transcript.jsonl
```

**三条生成铁律**：台账里有的措辞必须一致；要改口必须带理由（「起晚了摊子收了，油条算了」）；台账里没有的不许当有的说，宁可反问「你吃辣吗我忘了」。

台账条目**只增不改**：改口时新增一条带 `supersedes` 指向旧 id 并填 `reason`。这是数据层的落点，不靠叮嘱模型。

`schema/state.schema.json` 与 `schema/ledger.schema.json` 是结构说明；`fixtures/state.example.json` 是一份可直接开聊的初始状态。

---

## 5. 防漂移的诚实说明

DSH 全仓库没有任何 `beforeOutput` / `transformOutput` / `onAssistantMessage` 拦截点，`agent/assistant-stream` 与 `assistant/message` 都是只读。所以守卫只在事后观测，处置全部延后到下一轮。

| 档 | 触发 | 处置 | 用户看到 |
|---|---|---|---|
| L1 软纠偏 | 单处越界 | 静默，违例累计进 `state.drift[]` | 无感 |
| L2 锚点补注入 | 同轮 ≥2 处，或近 3 轮累计 ≥3 | 下轮锚点块顶部插纠偏指令，`targetLen` 压到 60% | 她下一轮回神、话变短 |
| L3 降级短回复 | 连续两轮 L2 仍越界，或命中 AI 身份声明 | 下轮不再注入 persona / anchor，只留固定短句模板 | 突然很简短，像走神 |

L3 模板固定（「嗯 我在」/「刚才想别的了 你说到哪了」），持续一轮后自动回落 L2，不永久锁死。宁可她突然冷淡，也不让「作为一个 AI」这种话把人推出剧。

**L1 思考期约束**常驻锚点块顶部：思考过程里也只用「我」说自己、用「你」说他，禁止「用户」「该角色」「她应该」这类第三人称分析句。

---

## 6. 用户侧用法

**中文关键词**（推荐，自然说话即可）：

| 说 | 等价 |
|---|---|
| 「锚」「复盘」「你都记得啥」 | 打印锚点块 |
| 「你现在什么档」「我们算什么关系」 | 查看关系档位（只读） |
| 「导出一下」「把记忆给我」 | 导出锚点文本 |
| 「回锚」 | 状态回锚 |

**ASCII 工具**（`COMMAND_NAME = /^[a-z][a-z0-9_-]*$/`，中文名注册会直接抛错）：

| 工具 | 作用 |
|---|---|
| `/mianmian_anchor` | 打印当前锚点块 |
| `/mianmian_tier` | 查看/设置档位 1–4（写入需 `allowTierSet`） |
| `/mianmian_cycle` | 查看/设置周期（写入需 `allowTierSet`） |
| `/mianmian_export` | 导出锚点，粘进新会话第一条 |
| `/mianmian_import` | 从文本导入台账（覆盖前自动备份） |
| `/mianmian_reset` | 清空状态（需 `confirm`，先备份） |

工具返回的是给**你**看的调试文本，不会进入绵绵的回复。

---

## 7. 换设备 / 新会话接力

```
/mianmian_export  →  复制输出  →  新会话第一条原样粘贴
```

或把 `~/.dsh/mianmian/state.json` 整个拷过去。锚点块格式与「直接投喂版」§9.4 一致，两边可互倒。

---

## 8. 数据与隐私

全部状态在 `~/.dsh/mianmian/`：

- `state.json` — 关系、身体、台账、drift，**明文**，可人工改
- `transcript.jsonl` — 历史原话，只追加
- `state.v{old}.bak.json` — 从旧版本迁移时的自动备份
- `state.before-import.bak.json` / `state.before-reset.bak.json` — 危险操作前备份

不联网、不上传、不调用任何宿主存储服务。**删掉整个目录即彻底清除**。

`transcript.jsonl` 默认无界增长（一年几十上百 MB，磁盘不值钱）。真跑出体积问题再改 `ledger.ts` 一个文件。

---

## 9. 已知限制

- 单机单用户；`userId` 字段预留未用。
- 长上下文仍会漂，靠每 5 轮回贴锚点兜，不保证 30 轮后零瑕疵。
- 深度思考开启后人称漂移率上升，默认关。
- **无法拦截或重试助手输出**（DSH 架构事实，见 §5）。
- 规则层事实抽取覆盖约七成，模型层抽取属可选扩展，本版未接。
- 宿主 `personaPrefix` 是 `You are a coding agent powered by the {{model}} model.`，本插件不替换它（严禁 `complete: true`），靠 section 内的优先级声明覆盖。
- 验收口径：连续 40 轮，人称漂移 0 次、无据编造 0 次、改口未给理由 0 次、AI 身份声明 0 次。

---

## 10. 贡献

- 改 **人格** → 只改 `persona/*.md` 七件套：core / background / relationship / rhythm / language / memory / examples。
- 改 **机制** → 只改 `src/*.ts`。
- `persona/default.md` 与 `persona/mianmian.md` 是 0.1.x 的旧人设文件，仅为 `src/v1/` 规则库回归测试保留，**v3 运行时不读**，别改错文件。
- 别混着改。提交前跑 `npm test`，特别是 T-27~T-30 四条约束哨兵（升级 DSH 后优先跑）。

```bash
npm test          # 5 步：类型检查 → v3 60 断言 → v1 26 回归 → 真实 Cordis → dsh plugin add
```

Node 22.22 原生 TS 剥离，`.test.ts` 直接跑，无需 ts-node / vitest。

---

## 版本与校准

当前 **0.2.0**（v3 记忆锚定架构）。0.1.x 是随机性引擎版，其规则库保留在 `src/v1/`（`lib/v1/`），T-01~T-12 行为验收继续跑，未退化。

需求文档 §12 附了 v2→v3 差异总表；但其中新写的事件名与几处 API 断言经实机核对仍与真实 DSH 不符，**全部差异与本插件的实际落地方式记在 [docs/CALIBRATION.md](docs/CALIBRATION.md)**。以本机 `.d.ts` 和 `dsh --dump-config` 为准，指南会过时，类型定义和源码不会。

许可 MIT。
