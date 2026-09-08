# M0 里程碑报告（地基与事实核验）

> 日期：2026-09-08 · 状态：**完成**
> 范围：T-001（能力核验）、T-002（workspace 骨架）、T-003（protocol 契约包）、T-005（Shell 决策前置调研）

## 做了什么

| 任务 | 结果 |
|---|---|
| T-001 能力核验 | 产出 `docs/dsh-capability-audit.md`：基于本地 dsh **0.1.1-rc.2** 源码逐条核验 `[待核验-1~5]` + 补充核验 `dsh-authorization`（§6.5） |
| T-002 workspace 骨架 | pnpm workspace（`apps/*`、`packages/*`、`plugins/*`、`fixtures`）+ 根 tsconfig（strict、verbatimModuleSyntax、`allowImportingTsExtensions` + `rewriteRelativeImportExtensions` TS 5.7 方案）+ vitest 配置 |
| T-003 protocol 契约包 | `@dsh-cursorkit/protocol`：envelope / methods（25 方法，单一真源）/ events（22 事件类型）/ errors（9 错误码）/ version（ckp/1 协商）/ domain（10 模型）；`schema/methods.schema.json` 快照 + CI 一致性测试 |
| fixtures（§12 加速器） | 三组事件流：simple-qa / multi-tool / approval-error，确定性 seq/ts，与 client reducer 集成测试 5 项 |

## 验证了什么

- `pnpm --filter @dsh-cursorkit/protocol test`：11 项通过（版本协商 / 错误码 / 信封 / 方法表与 schema 一致性）。
- `fixtures` 集成测试：5 项通过（replay 状态断言 + 跨 replay 确定性）。

## 关键核验结论（差异清单，详见 audit 文档）

1. **`ctx.sessions` 是 `SessionStore` Service**（create/get/list/fork/flush），事件走 Cordis 总线 `session/event`/`session/created`——不是 GOAL 假设的 `sessions.subscribe()`。seq = log.length 连续契约，与 CKP 前端去重/续传设计无缝对接。
2. **agent 发送**：`agent.send(message, 'next-turn', true)` + `Inbox`（不是 `session.send`）。
3. **审批**：0.1.1-rc.2 **无**工具审批 Service（`dsh-authorization` 是凭据授权）。CKP 审批面由 host-dsh 自己实现（ApprovalBridge：挂起表 + 超时 deny + 风险推断），不绑定 dsh 内部机制——符合「协议归我」决策。
4. **长驻模式**：`headless` 是一次性的；自建 `$DSH_HOME/profiles/cursorkit` + `--patch` 是方案 A 的正确落地方式。
5. **插件可起 HTTP server**：`apply(ctx, config)` 内 `http.createServer()` + `ctx.effect()` 生命周期，可行。

## 被 BLOCK 了什么

- **BLOCKED-1**：工具执行审批的 dsh 原生挂起/回执 API 未找到（0.1.1-rc.2）→ 已缓解：ApprovalBridge 自行实现展示层（audit §6.5）。
- **BLOCKED-2**：自建 profile 最小文件格式未实测（需 `--dump-config` 验证）→ 待 M1 集成时验证。

## 与 GOAL 的偏差及理由

- 无实质偏差。唯一调整：T-001 的核验对象是本地 npm 安装的 `0.1.1-rc.2`（上游快照可能为 0.1.2/0.1.3 alpha），audit 文档已标注版本；API 形状以源码为准，不影响 CKP 契约。

## 下一步（M1）

- T-010/T-011：host-dsh 插件骨架 + RPC server（进行中）
- T-013/T-014：client transport + EventStore + reducers（进行中）
- T-016/T-017：ui-kit 消息流 / ToolCallCard / ApprovalCard（进行中）
- T-020：M1 集成验收（需 dsh sidecar 实跑）
