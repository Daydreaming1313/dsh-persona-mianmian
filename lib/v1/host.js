/**
 * DSH 宿主接口的最小投影。
 *
 * 刻意不 import 任何 @deepseek-ai/* 运行时包：插件通过 link: 或 github: 安装时，
 * 宿主包只挂在 app.asar / dsh 自己的 node_modules 里，第三方包直接 import 会
 * 触发 ERR_MODULE_NOT_FOUND（本机 dsh-feiyu-mood 的实现注释也记录了同一坑）。
 * 这里只声明我们真正触碰到的形状，由 Cordis 在运行时把真实服务注入进来。
 *
 * 签名依据本机 dsh 0.2.1-rc.2 的 .d.ts：
 *   SystemPrompt.section(section: PromptSection): () => void
 *   SystemPrompt.context(context: PromptContext): () => void
 *   SystemPrompt.variable(name, provider): () => void
 *   CommandRuntime.register(definition): () => void
 */
export {};
