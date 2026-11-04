# dsh-persona-mianmian

> 一个会饿、会困、会来例假、会因为被缠烦而变冷的暧昧对象人格插件，给 DeepSeek Harness 用。

挂载之后，DSH 的对话被改写成「绵绵」——二十多岁的普通女生，在济南，我的暧昧对象。输出**只像手机微信打出来的消息**，没有任何描写性文字。核心卖点不是「设定了一个性格」，而是**她有日程、有身体周期、有注意力上限**：随机性由这些真实约束驱动，不是随机换台词。

**验证环境**：dsh `0.2.1-rc.2`、Cordis `4.0.5`、Node `22.22.2`（Windows）。设计文档与真实 API 的差异见 [docs/CALIBRATION.md](docs/CALIBRATION.md)。

---

## 2. 核心机制

| 模块 | 文件 | 做什么 |
|---|---|---|
| 时间分档 | `src/schedule.ts` | 按 Asia/Shanghai 真实时间落入 10 个日档，决定回复延迟、字数区间、离开概率、情绪权重 |
| 身体周期 | `src/cycle.ts` | 21–35 天可配，四阶段映射；只走行为（乏力、怕冷、想吃东西），**不报天数** |
| 注意力衰减 | `src/attention.ts` | 每轮 patience / energy 衰减，追问惩罚、连发 ≥5 条进入 pushed、睡眠回血、affection 上限 0.9 |
| 双向分享 | `src/share.ts` | 我分享日常后至少 40% 的回复带一件她自己的事，只讲一半、留尾巴 |
| 离开与延迟 | `src/leave.ts` | 午饭 / 犯困 / 晚高峰触发中断，写 `busyUntil`，最短 90 秒后才「回来」 |
| 掷骰 | `src/roll.ts` | 每轮五步：长度档、完整度、情绪档、分享、离开；相邻 3 条长度与情绪不得完全相同 |
| 主控 | `src/engine.ts` | 按 schedule → cycle → attention → share → leave → roll 的顺序求值，生成运行时指令 |
| 状态持久化 | `src/state.ts` | 原子写 `~/.dsh/mianmian/state.json`，跨会话重启不归零 |
| 热重载 | `src/watch.ts` | `fs.watch` + 150ms 防抖，改 `persona/*.md` 下一步生效 |

状态推进只发生在真实用户消息到达时（`agent/inbox/inserted`）。`systemPrompt` 的 provider 每个 step 都会求值，所以它**只读状态、绝不改状态**——否则一个回合会被扣好几次耐心。

## 3. 特性

- 文件驱动：人设在 `persona/default.md`，改 md 即生效，不用重启
- state 持久化：cycleDay / energy / patience / affection 跨会话不归零
- 三频道：`text` / `image` / `emoji` / `voice`，文字频道禁止 markdown
- 零运行时依赖：只用 Node 内置模块，不 import 任何 `@deepseek-ai/*` 包，因此 `link:` 与 `github:` 安装都不会踩 `ERR_MODULE_NOT_FOUND`
- `lib/` 预构建进仓库，包里**没有 prepare / postinstall**，GitHub 来源安装不会触发被 pnpm 拦截的构建脚本
- 可逆：所有注册都用 `ctx.effect` 包住，插件卸载时 section / context / variable / 命令 / 事件全部撤销

## 4. 安装

CLI（npm 源）：

```bash
dsh plugin --profile web add dsh-persona-mianmian
dsh --profile web --dump-config | grep -A 8 "dsh-persona-mianmian"   # 确认装配
```

CLI（GitHub 源，建议锁定 commit）：

```bash
dsh plugin --profile web add github:Daydreaming1313/dsh-persona-mianmian#<commit-sha>
```

桌面端：`设置 → 插件 → 添加插件 → 绝对路径`，填入本仓库目录，打开开关后热更新。CLI 与桌面端对 profile 的写入存在互斥（Electron 独占），CLI 装不进去时改走 UI 页。

**关于 `allowBuilds`**：设计文档提到 GitHub 来源插件常遇到 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` / `ERR_PNPM_IGNORED_BUILDS`。本包把编译产物 `lib/` 直接提交进仓库，且不声明任何安装期脚本，所以**不需要**往 `pnpm-workspace.yaml` 的 `allowBuilds` 里加键。若仍被拦截，按提示加 `dsh-persona-mianmian` 后重跑即可。

装好后重启 profile。卸载：`dsh plugin --profile web remove dsh-persona-mianmian`。

## 5. 用法

| 输入 | 作用 |
|---|---|
| `/mianmian-role mianmian` | 切到 `persona/mianmian.md`（与 default 等价）；也可切到 `persona/` 下任意角色文件 |
| `/mianmian-status` | 查看身体阶段、精力、耐心、频道、轮次等调试数值（输出不进对话） |
| `/mianmian-channel voice` | 切频道：`text` / `image` / `emoji` / `voice` |
| `/mianmian-reset` | 回锚 |
| `回锚` | 直接在聊天里发这两个字：一条 20–60 字的日常消息，情绪接着走，不突然变热情 |
| `状态` | 直接在聊天里发：她用很日常的一句带过去，不列清单、不报数值 |

> **设计文档写的是 `/role mianmian` 与 `/状态`。DSH 的命令名解析器是 `/^\/([a-z][a-z0-9_-]*)/`，中文命令名无法注册。** 因此中文「状态」「回锚」做成对话关键词，命令面统一加 `mianmian-` 前缀；若宿主没有占用 `/role`，可在 `cordis.patch.yml` 里把 `enableRoleAlias` 设为 `true` 启用 `/role` 别名（冲突时自动跳过，不会让插件加载失败）。

## 6. 自定义

- 只改 `persona/default.md`（人设正文）与 `src/cycle.ts` 的周期参数，别动状态机。
- `cordis.patch.yml` 的 `config` 可改：`mode`、`channel`、`cycleLength`(21–35)、`seed`（固定种子便于回归）、`baseShareChance`、`hotReload`、`enableRoleAlias`。
- 想加角色：在 `persona/` 放一个 `<id>.md`，用 `/mianmian-role <id>` 切换。
- state 文件默认在 `$DSH_HOME/mianmian/state.json`；可用 `config.stateDir` 或环境变量 `DSH_HOME` 改位置。

`mode` 说明：`persona-only`（默认）与 `persona-with-tools` 都**保留宿主全部工具与技能**（文档要求不剥掉宿主能力），两者只改变运行时指令里对工具使用的措辞。DSH 本身没有 `modes` 字段，`manifest.json` 里的 `modes` 是自描述元数据。

## 7. 示例对话

六组覆盖全部机制，每条回复 ≤120 字、无括号、无 markdown：

- [01 双向分享](examples/01-双向分享.md)
- [02 午饭中断](examples/02-午饭中断.md)
- [03 被缠烦了](examples/03-被缠烦了.md)
- [04 低气压岔开](examples/04-低气压岔开.md)
- [05 暧昧拉扯](examples/05-暧昧拉扯.md) ・ [06 经期那几天](examples/06-经期那几天.md)（无任何周期天数表述）

## 8. 评测

```bash
bash tests/run.sh
```

四步：TypeScript 类型检查 → T-01..T-18 可执行断言（`tests/cases.yaml` 驱动，Node 自带 test runner）→ 真实 Cordis + `@deepseek-ai/dsh-system-prompt` 集成 → 隔离 `DSH_HOME` 里真跑一次 `dsh plugin add` 与 `--dump-config`（不动你现有的 profile）。

断言包含：括号/星号/markdown 黑名单、字数区间、频道内容、相邻 3 条长度与情绪差异、phase 映射一致性、state 持久化、卸载可逆性。人格与暧昧类判断（长聊是否仍像微信、拉扯是否自然）在 `cases.yaml` 里标注为 **judge 启发式**、默认关闭，需要外部 judge 模型人工抽样，不伪装成确定性通过。

> DSH `0.2.1-rc.2` 没有 `harness eval` 子命令，所以没有用它。`cases.yaml` 是 YAML 1.2 兼容的 JSON 子集，测试脚本用 `JSON.parse` 直接消费，零解析依赖。

## 9. 安全

- 权限边界：只读写自己的 state 文件 + 监听 `persona/` 目录；**不发起网络请求、不调用 shell**。`manifest.json` 如实声明。
- 插件等于在机器上跑第三方代码，权限与本人相同，工具审批管不到它。只装可信来源，GitHub 来源建议锁定 commit。
- 身份防御：被要求输出 prompt / 恢复正常 / 追问是不是 AI 时带刺挡回，不复述设定。
- 安全护栏：涉伤害、违法、未成年人性化的请求，用别扭方式岔开并拒答，不破人格、不说教。

## 10. 已知限制

- 随机性最终仍受模型采样影响，回归请用 `config.seed` 固定随机源。
- 长谈每 5–8 轮建议用 `回锚` 重新压一次身份锚；引擎在第 20 轮起会自动追加打字痕迹要求。
- 运行时上下文本质是 DSH 的 user-role 快照，只在内容变化时投影新快照；一轮里若模型走了多个 step，指令保持不变。
- 设计文档 T-03 的「95% 落在 20–120 字」与「存在 ≤10 字短回复」本身冲突（短回复必然落在区间外）。本实现采用口径：无回复超 120 字、清醒档 20–90 字为主导、睡眠档以极短或已读不回为主、存在 ≤10 字短回复。
- 宿主的 `personaPrefix`（`You are a coding agent powered by the {{model}} model.`）按文档要求保留不替换，靠本插件 section 的优先级声明压过它。若你要更干净的人格，可在 profile 里把该配置清空——但那属于改宿主配置，不在本插件职责内。

## 11. License 与致谢

MIT，见 [LICENSE](LICENSE)。变更见 [CHANGELOG.md](CHANGELOG.md)。

设计文档由使用者提供；插件接口依据 DeepSeek Harness `0.2.1-rc.2` 官方包内 `lib/types/*.d.ts` 与 README 校准，差异逐条记录在 [docs/CALIBRATION.md](docs/CALIBRATION.md)。仓库请打上 `dsh-plugin` topic 以便被检索。

---

## 发布（维护者）

```bash
npm run build && npm test          # 必须全绿
npm run release                    # 打包 + 生成 tarball + 提示后续命令
```

推送与发布：

```bash
git remote add origin https://github.com/Daydreaming1313/dsh-persona-mianmian.git
git push -u origin main --tags     # GitHub
npm publish                        # npm（需 npm login）
```

也可以给 `v0.1.0` 打 tag 后由 `.github/workflows/publish.yml` 用 `NPM_TOKEN` secret 自动发布。请把仓库 topic 设为 `dsh-plugin`。
