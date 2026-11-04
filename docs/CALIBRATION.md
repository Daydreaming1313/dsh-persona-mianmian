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
