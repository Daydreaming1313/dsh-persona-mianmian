# 接口校准记录（设计文档 vs 真实 DSH）

设计文档 §7.6 要求：若发现 `ctx.systemPrompt.section` 签名、`assemble` 的 `complete` 规则或 context 快照机制与文档假设不符，**必须停下来说明**，用目标环境的 `dump-config` 与类型定义校准，不要猜写。

本文件就是那份说明。校准对象为本机实际安装：

| 项 | 值 |
|---|---|
| `dsh --version` | `0.2.1-rc.2` |
| `@deepseek-ai/cordis` | `4.0.5` |
| Node | `22.22.2` |
| 类型定义 | `C:/Users/19332/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/types/index.d.ts` |
| 配置树 | `dsh --profile web --dump-config`（1236 行，`# == @deepseek-ai/dsh-base` … `# == @dsh-pet/bridge`） |
| 现成插件样本 | `~/.dsh/profiles/desktop/node_modules/dsh-feiyu-mood`、`dsh-defend`、`dsh-context`、`dsh-freetap`、`@dsh-pet/bridge` |

---

## 1. `ctx.systemPrompt.context()` 的签名：文档写错了

- 文档 §4：`ctx.systemPrompt.context(() => ({ source: 'mianmian:runtime', content: renderRuntime(state) }))`
- 真实签名（`.d.ts` 第 269 行）：`context(context: PromptContext): () => void`
- `PromptContext`（第 72–83 行）字段是 `{ name, order, text, interpolate?, required? }`，**没有** `source` / `content`。`text` 可为静态字符串或 `(AssembleContext) => string`，返回 Cordis effect disposer。
- 本机已装插件 `dsh-feiyu-mood/lib/index.js:1289` 的实战写法：
  `agent.ctx.systemPrompt.context({ name: 'feiyu-mood', order: 900, text: () => ... })`
- 本插件采用：
  ```ts
  sp.context({ name: 'mianmian:runtime', order: 900, text: () => state.pendingDirective })
  ```
  并用 `ctx.effect` 包住返回的 disposer。

## 2. `/状态` 无法注册：命令名语法限制

- `dsh-commands/lib/index.js:103` 的 `parseCommand`：`/^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u`
- 中文命令名不匹配；`CommandRuntime.register` 同名重复注册还会抛错。
- 处理：命令面统一用 `[a-z][a-z0-9_-]*` 命名空间名 —— `/mianmian-status`、`/mianmian-role`、`/mianmian-channel`、`/mianmian-reset`；中文「状态」「回锚」改成对话关键词，在 `agent/inbox/inserted` 里识别。`/role` 作为可选别名（`enableRoleAlias`，默认关闭），注册用 try/catch 包裹，宿主已有同名命令时自动跳过。
- 另加了 `persona/mianmian.md`，使文档里的 `/role mianmian` 语义在 `/mianmian-role mianmian` 下成立。

## 3. `complete: true` 的真实语义

- `.d.ts` 第 63–69 行：「Assembly still runs the cooperative waterfall so tools, contexts, and variables can be resolved, then restores this exact section as the sole prompt section. More than one effective complete section makes assembly fail.」
- 包内 README：「A `complete: true` section becomes the exact complete prompt after assembly; more than one effective complete section makes assembly fail.」
- 所以文档说的「其他 section 整段丢弃」对 **system sections** 成立，但「工具与技能被剥掉」不准确：工具 schema、contexts、variables 照常解析，只是不出现在 system 文本里；超过一个生效的 complete 段会直接让 assemble 失败。
- `tests/integration.mjs` 用真实 `SystemPrompt` 实测：注册 complete 段后 `renderPrompt()` 只剩它，`renderContextSnapshot()` 仍含另一个 context 贡献。
- 本插件按文档要求**不使用** `complete`，只注册普通 section；集成测试确认 `harness:identity` 与 `deployment:persona-prefix` 都保留。

## 4. 安装格式：`dsh.bundle` + `cordis.patch.yml`

- 官方文档说 `dsh.bundle` 指向 bundle 的 patch 文件；本机现成插件的真实写法是
  `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，并把 `cordis.patch.yml` 列入 `files`。
- patch 文件是顶层 YAML 数组，靠 `- insert: [{ id, name }]` 插入 profile 的 Cordis 树。
- `manifest.json` **不是** DSH 读取的文件。文档 §5 要求产出，因此保留为自描述/审计元数据（`permissions`、`modes`、`verifiedAgainst`），README 里明确说明它不参与安装。
- `dsh --profile web --dump-config-schema` 确认 `patchList` 结构；`dsh plugin --profile web add` 会自动把包写进 `dsh.profile.bundles`（隔离环境实测）。

## 5. 没有 `harness eval`

- `dsh --help` / `dsh headless --help` 均无 eval 子命令；`dsh plugin` 只是把参数转发给 pnpm。
- 处理：`tests/run.sh` 改为 4 步：类型检查 → `node --test tests/unit.test.mjs`（`cases.yaml` 驱动 T-01..T-18）→ 真实 Cordis 集成 → 隔离 `DSH_HOME` 里真跑 `dsh plugin add` + `--dump-config`。
- `cases.yaml` 写成 YAML 1.2 兼容的 JSON 子集，用 `JSON.parse` 消费，零依赖。judge 类判断明确列为启发式、默认关闭。

## 6. Cordis Context 是代理：可选链挡不住「未声明 inject」

真实运行时报 `Error: cannot get property "commands" without inject`（插件第一次挂载时捕获）。属性读取本身被代理拦截，`ctx.commands?.register` 也会抛。

- 处理：改用宿主反射 API `ctx.get(name)`（`.d.ts` 中 `ReflectService.get(name, strict?): any`），缺失服务返回 `undefined` 而不抛；`service<T>()` 里对 mock/旧宿主才回退到属性读取。
- 这样 `inject` 只需硬声明 `['systemPrompt']`，`agents` / `commands` 缺失的 profile 也能装（命令与 agent 事件降级，但人格注入照常工作）。

## 7. 其余确认一致或做了防御的点

- `section(section: PromptSection): () => void`，字段 `{ name, order, text, interpolate?, complete? }`，返回 disposer —— 与文档一致，本插件用 `order: 10` / `11`（真实 `SECTION_ORDERS` 中 identity 为 −1000、persona prefix 为 0、工具指导 1000+）。
- `variable(name, provider)` —— 与文档一致。但插值**严格**：未注册或值为 `undefined` 的 `{{...}}` 会让渲染抛错；官方 README 还特别警告 loop 不注册 `{{cwd}}`。本插件只引用自己注册的 `{{channel}}` / `{{tone}}`，且只在动态 context 里引用（避免污染 system prompt 前缀缓存）。变量名匹配 `[a-z][a-z0-9_]*`。
- `persona/default.md` 已检查不含 `{{`，否则 `renderPrompt` 会炸。
- `systemPrompt` 的 provider 每个 step 求值一次（`.d.ts`：「The agent loop calls assemble(context) once per proposed step」）。因此状态推进放在 `agent/inbox/inserted`，provider 只读 `state.pendingDirective`。
- 宿主 `personaPrefix` 实际是 `You are a coding agent powered by the {{model}} model.`。文档要求「绝不替换宿主身份段」，所以保留它，靠本插件 section 内的优先级声明覆盖；差异在 README 已知限制里写明。
- `modes` 不是 DSH 字段。两种 mode 都不删宿主工具，只改变运行时指令措辞（文档同时要求「工具与技能全程保留」，这里按后者执行）。
- 事件名与形状按本机 `.d.ts` 与现成插件校准：`agent/created`（payload `{ agent }`）、`agent/inbox/inserted`（payload `{ agent, message }`），`ctx.on` 返回 disposer。

## 8. T-03 验收口径的内部矛盾

文档 §1 写「样本 95% 落在 20–120 字，无回复超 120 字，且存在 ≤10 字的短回复」，同时 §3.1 又规定 00:00 后「极慢或已读不回」。短回复必然落在 20–120 之外，两个条件不能同时严格成立。

采用口径（写进 `cases.yaml` 与测试）：**无回复超 120 字 + 清醒档 20–90 字为主导（≥60%）+ 睡眠档以极短为主 + 存在 ≤10 字短回复**。这是能执行且不撒谎的版本。

---

## 校准后的验证结果

```
== 1/4  TypeScript 类型检查 ==            PASS
== 2/4  T-01..T-18 可执行断言 ==          25 tests / 25 pass / 0 fail
== 3/4  真实 Cordis + dsh-system-prompt == ALL PASS
== 4/4  dsh plugin add / --dump-config ==  ALL PASS
```

集成测试实测的注册结果：

```
sections:  harness:identity, deployment:persona-prefix, mianmian:persona, mianmian:rules, deployment:persona-suffix
contexts:  mianmian:runtime
variables: model, channel, tone
renderPrompt / renderContextSnapshot 通过；插件卸载后注册项全部撤销
```

隔离 `DSH_HOME` 的真实装配结果（`dsh --profile web --dump-config`）：

```yaml
# == dsh-persona-mianmian
- id: mianmian
  name: dsh-persona-mianmian
  config:
    mode: persona-only
    channel: text
    cycleLength: 28
    ...
```

---

# v3 增补：落地指导书 v3 的 API 断言校准

> 来源：《「绵绵」真人化暧昧女友人格插件 · DSH 落地指导书 v3》（§12 自带差异总表）。
> v3 把 v1/v2 的 `definePlugin` / `ctx.hooks` / `ctx.state` / 中文命令 / 输出重生成等错误全部纠正了，方向正确。
> 但 v3 **新写的那批 Cordis 事件名和几处 API 细节，经实机核对仍与本机 dsh `0.2.1-rc.2` 不符**。
> 按 v3 §12 最后一句「以你本机能用的 .d.ts 和 `dsh dump-config` 为准，指南会过时，类型定义和源码不会」，
> 以下逐条按源码落地。证据路径前缀 `PKG` = `.../dsh/node_modules/@deepseek-ai/`，`PLG` = `~/.dsh/profiles/desktop/node_modules/`。

## V-1. §6.3 事件表：10 个「可用」里只有 2 个真实存在

`PKG/dsh-agent/lib/types/runtime-types.d.ts:212-409` 是 agent 事件的**唯一**声明块（12 个）；
`PKG/dsh-session/lib/types/index.d.ts:30-70` 是 session 事件的唯一声明块（4 个）。
`PKG/dsh-tool-cordis/lib/types/api-catalog.js:3929+` 有一份「Every harness event, sorted by name」权威清单可交叉验证。

| v3 §6.3 声称 | 真实 | 证据 |
|---|---|---|
| `agent/turn-start` / `agent/turn-end` | **不存在**（精确匹配 0 次） | 一轮「即将结束」是 `agent/turn-stopping`（serial，`runtime-types.d.ts:370-391`）；`turn/end` 是 SessionEvent type |
| `user/message` / `assistant/message`（作为 Cordis 事件） | **不是事件**，是 `SessionEventMap` 的 type | `PKG/dsh-session/lib/types/types.d.ts:288-295, 321-339`；只走 `session/event`（`index.d.ts:52-61`） |
| `agent/inbox/inserted` | ✅ 存在，emit | `runtime-types.d.ts:256-266`，payload `{ agent, message: UserMessage }` |
| `agent/assistant-stream` | ✅ 存在，emit，只读 | `runtime-types.d.ts:357-369`，payload `{ agent, frame }` |
| `agent/run-error` | **不存在** | 真实为 `agent/error` / `agent/request-error` |
| `command/registered` | **不存在** | 真实为 `commands/change`（`PKG/dsh-commands/lib/types/types.d.ts:78-87`） |
| `ready` / `dispose` | **都不是事件** | `PKG/cordis/lib/types/events.d.ts:208-239` 只有 `internal/*`；全树 `on('dispose')` / `on('ready')` 0 命中 |

`PLG/dsh-fish-memory/lib/index.js:3655-3658` 有一段踩坑实录，逐字印证：

```js
// ⚠⚠ 事件名踩过的坑：DSH 里**没有** `user/message` / `assistant/message` 这两个 Cordis 事件 ✗
//   `user/message` / `assistant/message` 是 **SessionEvent 的 type**（走 `session/event`），
//   而 agent 作用域上真正能收到的是 `agent/inbox/inserted` 和 `agent/turn-stopping` ✓
```

**本插件落地**：只订阅 `agent/created`、`agent/inbox/inserted`、`session/event`、`agent/turn-stopping`。
`user/message` 的文本在 `event.data.content`，`assistant/message` 的文本在 `event.data.message.content`（`bridge.ts` 已分别处理）。
事件是 Scope-filtered dispatch，必须在 `agent.ctx` 上订阅（`agent/created` 时 attach），全局 ctx 收不到。
T-30 哨兵专门钉住「老事件名 `assistant/chunk` 静默不触发」。

## V-2. §6.1 `inject: ['systemPrompt','command']` → `commands`（复数）

- `PKG/dsh-commands/lib/index.js:259` `super(ctx, "commands")`；`lib/types/index.d.ts:63-66` 声明 `Context.commands: CommandRuntime`。
- `dsh --dump-config` 里 `- id: commands / name: '@deepseek-ai/dsh-commands'`。`ctx.command` 全树 0 命中。
- `PLG/dsh-defend/lib/index.js:697` `const inject = ["commands"]`；`PKG/dsh-command-feedback/lib/index.js:66` 同。
- **本插件**：`inject` 只声明 `['systemPrompt']`，`commands` / `agents` 用 `ctx.get()` 能力探测（沿用 §1 的 Cordis 代理教训），保证任何 profile 都能装；工具注册用 `ctx.effect(() => commands.register(def))` 保证卸载撤销。

## V-3. §6.1 的 order 数值三处全错，但 0/10/20 仍可用

`PKG/dsh-system-prompt/lib/types/index.d.ts:119-152` 的 `SECTION_ORDERS` 逐字：

```
HARNESS_IDENTITY: -1000        DEPLOYMENT_PERSONA_PREFIX: 0
PLAN_POLICY: 500 ... TOOL_BASH: 1000 ... MCP_SERVERS: 3100
TOOLS_SDK: 5000 ... DEPLOYMENT_PERSONA_SUFFIX: 10200
```

- v3 说 `-100 = harness 身份基线` → 实为 **-1000**。
- v3 说 `100–199 = 工具引导` → 100–199 其实是 **`CONTEXT_ORDERS`**（`index.d.ts:155-163`）；工具 section 是 **1000–3100**。
- `0 = 部署自有 persona` 是对的（`DEPLOYMENT_PERSONA_PREFIX`）。

**本插件**：persona `order: 0`、anchor `10`、degraded `20`。都落在 persona 带，与宿主工具段（1000+）自然共存，实测 sections 顺序为
`harness:identity, deployment:persona-prefix, mianmian:persona, mianmian:anchor, mianmian:degraded, deployment:persona-suffix`。

## V-4. §6.2 的 L3「section 返回 null」会在渲染阶段抛 TypeError

- 类型 `PromptSection.text: string | ((context: AssembleContext) => string)`（`index.d.ts:46-60`），**没有 null**。
- `assemble()` 不校验直接存（`PKG/dsh-system-prompt/lib/index.js:385-393`）；`renderPrompt` 的 `interpolate()` 会执行 `text.indexOf("{{")` → `null.indexOf` 抛错；即便 `interpolate:false`，`.filter(text => text.length > 0)` 也会读 `null.length` 抛错（`lib/index.js:117-119, 158-162`）。
- 正确做法：返回**空串** `''`，`renderPrompt` 的 filter 会丢掉空 section。`PLG/dsh-fish-memory/lib/index.js:3795-3797, 3834-3836` 正是这么写。

**本插件**：L3 时 persona / anchor 返回 `''`，另起 `mianmian:degraded` section 输出固定短句模板。T-24 断言空串与 `renderPrompt` 不炸，集成测试真实挂载验证。

## V-5. §6.4 `scope.chatId` 不存在

- `AssembleContext` 只有 `scope?: ScopeKey` 与 `signal?: AbortSignal`（`index.d.ts:36-45`）；唯一合并扩展字段是 `agent?: Agent`（`PKG/dsh-agent/lib/types/runtime-types.d.ts:14-19`）。
- `ScopeKey = object`（不透明，`PKG/dsh-scope/lib/types/index.d.ts:10-11`）；运行时 `assembleContextFor(agent)` 直接把 `scope` 设为 agent 本身（`PKG/dsh-agent/lib/index.js:285-297`）。

**本插件**：用 `context.agent?.id` 取会话标识，取不到时回退到桥接槽的最近活跃 key；不依赖任何 `chatId`。

## V-6. §2「不加 type:module，用 CJS」与本机生态相反

- 本机 4 个现成插件全带 `"type": "module"`：`PLG/dsh-defend/package.json:15`、`dsh-context:15`、`dsh-feiyu-mood:7`、`dsh-fish-memory:6`；入口全是 `export const name` / `export function apply`。
- loader 用原生 ESM `import()`（`PKG/cordis-plugin-loader/lib/index.js:213-227`），靠 `unwrapExports`（`:666-672`）兼容 ESM/CJS 两种形状 —— **CJS 能跑，但不是本机既有实践**。
- 0.1.x 已用 ESM 跑通 `dsh plugin add` + 真实 Cordis 挂载，没有理由为了照文档改成 CJS。

**本插件**：保持 `"type": "module"`。

## V-7. §6.1 `ctx.on('dispose')` 与 `ctx.on('ready')` 都不存在

- Cordis 的 `ctx.on()` 注册本身就是 fiber effect，卸载时自动移除（`PKG/cordis/src/events.ts:254-259, 277-301`）。
- 卸载清理推荐 `ctx.effect(() => () => cleanup)`（`fiber.d.ts:41-51, 402-418`）；`PLG/dsh-feiyu-mood/lib/index.js:1386-1397` 是实证。

**本插件**：所有 section / variable / 工具 / 事件都用 `ctx.effect` 包住，最后一个 effect 负责 `persona.dispose()` / `bridge.dispose()` / `store.dispose()`（内含最后 flush）。

## V-8. 两条 v3 写对了的（保留）

- **§8 ASCII 工具名**：`COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u`（`PKG/dsh-commands/lib/index.js:77-78, 148-150`），下划线**合法**，`mianmian_anchor` 可用；中文名会被 `register` 直接抛 TypeError。T-27 哨兵钉住。
- **§6.1 section.text 支持函数动态求值**：每轮 assemble 重新调用（`index.js:388`），且 `PromptContext.text` 也一样。本插件 anchor 段用函数每轮重算锚点块。

## V-9. 其余落地说明

- **`interpolate: false` 是硬要求**：台账原文可能含 `{{ }}`，默认插值会抛 `unknown prompt variable`。`PLG/dsh-fish-memory/lib/index.js:3772-3777` 有同样注释。本插件三处 section 全设 false。
- **`section()` 同名同 layer 会 throw**（`PKG/dsh-scope/lib/index.js:27-30`）：统一 `mianmian:` 前缀，T-28 哨兵实测。不同 layer 同名是 shadow 而非 throw，v3 说的「直接 throw」只在同一 layer 成立。
- **`snapshotEvents()` 存在但已 `@deprecated`**（`PKG/dsh-session/lib/types/index.d.ts:214-224`）：本插件只在 `agent/turn-stopping` 里作为「`session/event` 没挂上时的兜底」调用并做判空，主路径是 `session/event`。
- **`ctx.storage` 不走**：v3 §3.1 的判断正确 —— 它不是可直接 get/set 的 KV，且领域插件挂载前读 `ctx.storage.domain` 会抛 `form-not-mounted`。本插件用自己的 JSON + 内存单例（§3.2），首次启动即落盘以便人工编辑台账。
- **没有输出拦截点**：v3 §6.2 的方向正确，`agent/assistant-stream` 是 `@mode emit` 只读，所有 waterfall（`agent/pre-step` / `agent/request` / `system-prompt/assemble`）都不针对助手文本。本插件不订阅任何 waterfall，避免忘 `await next()` 把宿主链短路。

## v3 校准后的验证结果

```
== 1/5  TypeScript 类型检查 ==                       PASS
== 2/5  v3 机制测试 T-01..T-30 (.test.ts 原生跑) ==   60 tests / 60 pass / 0 fail
== 3/5  v1 引擎回归 T-01..T-18 ==                    26 tests / 26 pass / 0 fail
== 4/5  真实 Cordis + dsh-system-prompt ==            ALL PASS（含 T-24/T-28/T-29/T-30 哨兵实测）
== 5/5  dsh plugin add / --dump-config ==             ALL PASS
```

集成实测注册结果：

```
sections:  harness:identity, deployment:persona-prefix, mianmian:persona,
           mianmian:anchor, mianmian:degraded, deployment:persona-suffix
variables: model, mianmian_mood
tools:     mianmian_anchor, mianmian_tier, mianmian_cycle,
           mianmian_export, mianmian_import, mianmian_reset
renderPrompt / renderContextSnapshot 通过；L3 空串段不炸；卸载后全部撤销
```

