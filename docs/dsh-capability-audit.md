# dsh 能力核验报告（dsh-capability-audit）

> 依据：本地 dsh 源码 `@deepseek-ai/dsh` **0.1.1-rc.2**（npm 安装，`node_modules/@deepseek-ai/*`），核验日期 2026-09-08。
> 本文档逐条回答 GOAL §M0 T-001 的 `[待核验-1~5]`，并记录真实 API 签名与源码出处。
> **结论先行的纪律**：任何与 GOAL 文档假设不一致之处，以本报告为准。

## 0. 核验基线

| 项 | 值 |
|---|---|
| dsh 版本 | `0.1.1-rc.2`（上游快照可能为 0.1.2/0.1.3 alpha，API 以源码为准） |
| 包形态 | npm 包 `@deepseek-ai/dsh`，`bin: dsh`，ESM，`type: module` |
| 插件核心 | `@deepseek-ai/cordis`（4.x），插件 = 导出 `apply(ctx, config)` 的模块 |
| 配置栈 | Bundle（`package.json#dsh.bundle` + `cordis.patch.yml`）→ Profile → Patch overlay |
| 会话 | `@deepseek-ai/dsh-session`：append-only 事件日志 + `SessionStore` Service |
| Agent | `@deepseek-ai/dsh-agent`：`Agent.send(message, target, wakeup)` + `Inbox` |
| 长驻 profile | `web` / `tui`（`dsh --profile <name>`），`headless` 为一次性 |

---

## 1. `[待核验-1]`：dsh 是否支持长驻的非 web 运行模式？

**结论：支持自定义 profile 长驻运行（方案 A 可行，但默认只有 web/tui 两种长驻 profile）。**

- `dsh --profile <name>` 启动 `$DSH_HOME/profiles/<name>` 下任意 profile；`--patch <path>` 追加 overlay（`lib/bin.js` 可重复收集）。
- 内置 profile：`web`（Web UI）、`tui`（终端 UI）、`headless`（**一次性**：跑一个 prompt 打印结果退出，`lib/bin.js` HELP_EXAMPLES 明确 `answer one task, print the result, and exit`）。
- `--dump-config` 打印组合后的 profile 树（可用于验证插件行是否加载）。

> **实现含义**：`dsh-cursorkit-host` 的宿主 profile 应**自建** `$DSH_HOME/profiles/cursorkit/`（一个 cordis.patch.yml 插入 host 插件行），或复用 `web`/`tui` + `--patch` overlay。profile 文件格式与内置 profile 完全一致（patch list）。**不需要 headless 的一次性模式。**

## 2. `[待核验-2]`：dsh 插件能否在 apply() 内起 HTTP server？

**结论：可以。插件代码就是运行在 dsh（Node 进程）内的 ESM 模块，`apply(ctx, config)` 内可直接 `http.createServer()`，并应通过 `ctx.effect()` 注册生命周期（卸载时自动 close）。**

- Cordis `Context.effect(fn)`：注册可逆副作用，返回 disposer；卸载插件时按逆序执行（`@deepseek-ai/cordis` lib/types/context.d.ts、service.d.ts）。
- dsh 自带 server 能力（`web` profile 里有 HTTP server），但**协议归我们所有**——起独立 loopback server 更干净，只 bind `127.0.0.1`。
- 端口冲突风险：用 `port: 0`（自动分配），把实际端口 + token 写 `runtime.json`。

> 与 GOAL 假设一致（方案 A 首选自建 HTTP+SSE server 成立）。`[待核验-2]` 关闭。

## 3. `[待核验-3]`：ctx.sessions 事件 API 真实签名

**结论：`ctx.sessions` 是 `SessionStore extends Service`，事件走 Cordis 总线，不是文档假设的 `sessions.subscribe()`。API 比假设更简单、更稳。**

真实签名（`@deepseek-ai/dsh-session/lib/types/index.d.ts`）：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context { sessions: SessionStore }
  interface Events {
    'session/created'(session: Session): void          // 会话进入 store
    'session/disposed'(session: Session): void         // 会话离开 store
    'session/event'(session: Session, event: SessionEvent): void  // ★ 追加事件流
    'session/flush'(session: Session): Promise<void> | void      // 持久化检查点
  }
}

class SessionStore extends Service {
  create(id?, options?): Session            // options.seed 可回放/fork
  get(id): Session | undefined
  list(): Session[]
  fork(source, boundary?, childSessionId?): Session
  flush(session): Promise<boolean>
  prepare/enter/announce                     // 组合式生命周期（agent 用）
}

class Session {
  readonly id: SessionId
  readonly header: SessionHeader             // 含 cwd、lineage
  get seq(): number                          // 下一个 seq（= log.length）
  get events(): readonly SessionEvent[]      // 深冻结快照
  append<T>(type, data, ...opts): SessionEvent<T>  // 事件进 log（surface 元数据必填）
  deriveMessages(): Message[]                // 模型可见消息投影
}
```

**关键事实**：
- 会话日志事件自带 **`seq = log.length` 连续契约**（`session.seq` getter 注释明确 "the `seq = log.length` contiguity contract"）——CKP 前端按 seq 去重/续传的设计与 dsh 一致，**无缝对接**。
- 事件类型（`SessionEventMap`）以 `user/…`、`assistant/…`、`tool/…`、`turn/start`、`request/header` 等命名（KNOWN_SESSION_EVENT_TYPES 生成自源码，持久化读取会拒绝未知类型——**这是我们的 SessionBridge 翻译表的事实来源**）。
- 订阅方式：`ctx.on('session/event', (session, event) => …)`（或插件 `inject: ['sessions']` 后 ctx.sessions 可用）。**没有** `session.subscribe()` 方法。

> `[待核验-3]` 关闭：SessionBridge 实现 1（直接订阅 `session/event`）成立，且能拿到原始 `SessionEvent`（含 seq）。

## 4. `[待核验-4]`：session-query 能否作为兜底轮询源？

**结论：可以，但 M1 用不上。`@deepseek-ai/dsh-session-query` 是语义查询（corpus/documents/filters），不是事件日志轮询。**

- `dsh-session-query` 提供 `corpus`/`documents`/`filters`/`cursor` 等模块，面向**检索**（@-mentions、代码检索场景），不是逐事件轮询。
- 若 `session/event` 订阅不可用（版本过旧），兜底应改为：`ctx.sessions.list()` + `session.events` 快照轮询 + `session.seq` 差量——**不需要 session-query**。
- 持久化兜底源是 `dsh-session-persistence-jsonl`（订阅 `session/event` 落 JSONL）——可读其文件做离线重建。

> `[待核验-4]` 部分关闭：语义查询存在但**不适用**；真正的兜底是 `sessions.list()` + `session.events`。

## 5. `[待核验-5]`：dsh 分发形态

**结论：npm 包 + Node 运行时（ESM）。sidecar 方案取「要求用户装 Node」。**

- `@deepseek-ai/dsh` 是纯 npm 包（`bin: lib/bin.js`），依赖树完整在 node_modules；**无独立二进制**。
- `npx @deepseek-ai/dsh web` 是官方入口。
- 因此 `apps/desktop` 的 sidecar 策略：**要求系统 Node ≥ 20**，spawn `dsh --profile cursorkit`（Tauri sidecar 或直接 `node` 子进程）。自带 Node（pkg/sea 打包）留到 M5。

> `[待核验-5]` 关闭：Tauri `sidecar` 配置用外部命令形式。

---

## 6. 补充核验：Agent 消息发送与审批真实 API

GOAL 假设 `session.send(text, attachments)`；真实 API 在 `dsh-agent`：

```ts
// @deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts / inbox.d.ts
interface Agent {
  readonly inbox: Inbox
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void  // ★ 发消息
  cancel(options?: { keepInbox?: boolean }): Promise<void>
  runMaintenance<T>(task): Promise<T>
  whenIdle(): Promise<void>
}
class Inbox {
  get nextTurn(): readonly UserMessage[]
  get nextStep(): readonly UserMessage[]
  append(target: InboxTarget, message: UserMessage): void
  claim(target: InboxTarget, turn: number): UserMessage[]
}
```

- `InboxTarget` = `'next-turn' | 'next-step'`（普通对话用 `next-turn` + `wakeup: true`）。
- **审批（approval）**：GOAL 假设的 `approvals.request/resolve` **在 0.1.1-rc.2 中未找到对应 Service**（`dsh-authorization` / `dsh-client-ui-permission-presets` 存在，机制走 Cordis `ctx.permission` / 授权层，需进一步核验 `dsh-authorization` 的 `request/resolve` 签名）。
  - 标为 **`[待核验-6]`**：dsh 权限审批的挂起/回执 API 签名（读 `@deepseek-ai/dsh-authorization` lib/types）。
  - M1 若未核验完成，ApprovalBridge 先接「权限策略预置（permission presets）」的已授权/需人工路径，审批 UI 用 CKP 事件层先行实现。

## 6.5 补充核验：`dsh-authorization` 是凭据授权，不是工具审批

**结论（2026-09-08 核验）**：`ctx.authorization`（`AuthorizationService`）是 **API 凭据授权流程**（API key 登录），不是工具调用审批：

```ts
// @deepseek-ai/dsh-authorization/lib/types/index.d.ts
class AuthorizationService extends Service {
  registerFlow(flow: AuthorizationFlow): () => void
  list(): readonly AuthorizationEntry[]
  describe(key: CredentialKey): AuthorizationEntry | undefined
  cancel(key: CredentialKey): void
  begin(request: AuthorizationRequest): Promise<AuthorizationOutcome>
  // AuthorizationRequest = { key, method?, interaction: AuthorizationInteraction, signal? }
  // AuthorizationInteraction = { notify(notice), prompt(prompt): Promise<string> }
}
```

- 面向「credential record」（API key / 登录态），interaction 回调（`notify`/`prompt`）由调用方提供——headless 调用方可以 `prompt` 返回拒绝。
- **工具执行审批**（写文件 / shell / 网络）在 0.1.1-rc.2 源码中**未发现独立 Service**：`dsh-client-ui-permission-presets` 只是 UI 预置（`apply()` 注册），未暴露 `request/resolve` RPC。
- **结论**：CKP 的 `approval.request/resolved` 事件流与 `ApprovalCard` 由 **host-dsh 自己实现**（挂起表 + 超时 deny + 决策写回会话日志），不与 dsh 内部审批绑定；工具是否执行由 dsh 自身授权策略决定（如权限预置），host 只做**展示层**。这符合「协议归我」的架构决策，且不违反「不改 dsh 源码」红线。

## 7. 对实现的影响（差异清单）

| # | GOAL 假设 | 实际 | 影响 |
|---|---|---|---|
| 1 | `sessions.subscribe(sessionId, fromSeq, cb)` | `ctx.on('session/event', (s, e) => …)` | SessionBridge 用 Cordis 事件订阅；seq 取 `event` 自带 seq |
| 2 | `session.send(text)` | `agent.send(msg, 'next-turn', true)` | `compat/sessions.send` 需要从 `ctx.agentLoop` 或注入的 agent 拿实例 |
| 3 | 审批 `approvals.request/resolve` | `dsh-authorization`（待核验-6） | ApprovalBridge 挂起表先实现，回执映射到授权层 |
| 4 | `session.fork(id, fromSeq)` | `ctx.sessions.fork(source, boundary?, childId?)` | 直接映射，boundary 即 fromSeq |
| 5 | `session.list` | `ctx.sessions.list()` | 直接映射 |
| 6 | events.subscribe = SSE 持久流 | `session/event` 总线 + 我们的 EventBus（ring buffer） | 一致：CKP 事件由 host 分配 seq 广播，SSE 出口不变 |

**总体判断**：GOAL 的架构（host-dsh 插件 + 自有 CKP 协议 + 事件源前端）**完全成立**；仅「订阅/发送/审批」三个点的底层调用需按真实 API 调整，均不影响 CKP 契约与前端设计。
