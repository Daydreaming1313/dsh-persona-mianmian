# Changelog

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
