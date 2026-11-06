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

export interface PromptSectionInput {
  readonly name: string
  readonly order: number
  readonly text: string | ((context?: unknown) => string)
  readonly interpolate?: boolean
  readonly complete?: boolean
}

export interface PromptContextInput {
  readonly name: string
  readonly order: number
  readonly text: string | ((context?: unknown) => string)
  readonly interpolate?: boolean
  readonly required?: boolean
}

export interface SystemPromptHost {
  section(section: PromptSectionInput): () => void
  context(context: PromptContextInput): () => void
  variable(name: string, provider: (context?: unknown) => string | undefined): () => void
}

export interface CommandDefinitionInput {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string }
  readonly handler: (invocation: { readonly rawInput: string }) =>
    | { readonly kind: 'success'; readonly text?: string }
    | { readonly kind: 'error'; readonly text: string }
    | Promise<{ readonly kind: 'success'; readonly text?: string }
      | { readonly kind: 'error'; readonly text: string }>
}

export interface CommandHost {
  register(definition: CommandDefinitionInput): () => void
}

export interface AgentLike {
  readonly ctx?: HostContext
  readonly session?: { readonly id?: string }
}

export interface AgentsHost {
  list?(): AgentLike[]
}

export type Disposer = () => void

export interface HostContext {
  /** Cordis 反射查询：对未声明 inject 的服务返回 undefined 而不抛错 */
  get?(name: string, strict?: boolean): unknown
  systemPrompt?: SystemPromptHost
  commands?: CommandHost
  agents?: AgentsHost
  /** 事件总线；返回 disposer（本机 Cordis 4.0.5 的 ctx.on 返回函数）。 */
  on?(event: string, handler: (...args: any[]) => unknown): Disposer
  /** 注册一个可逆副作用；execute 的返回值会在插件卸载时被调用。 */
  effect?(execute: () => Disposer | void, label?: string): unknown
  logger?: { warn?(message: string): void; info?(message: string): void; error?(message: string): void }
}
