# M1 里程碑报告（对话闭环——代码层）

> 日期：2026-09-08 · 状态：**完成（代码层 + T-020 集成验收 15/15 通过，见 M1-acceptance-report.md）**
> 范围：T-010（host-dsh 骨架）、T-011（RPC server）、T-012（SessionBridge+EventBus+SSE）、T-013（transport）、T-014（EventStore）、T-016（消息流组件）、T-017（ToolCallCard/ApprovalCard）

## 做了什么

| 任务 | 交付 |
|---|---|
| T-010 host-dsh 骨架 | `capability.ts`（必选 fail-fast + 可选探测）、`compat/*`（need/optional，唯一 ctx 访问点）、`apply()`（ctx.effect 生命周期）、`runtime-file`（0600 写 runtime.json） |
| T-011 RPC server | `rpc/server.ts`：/health（免鉴权）、/v1/capabilities、/v1/rpc/:method（25 方法）、/v1/sessions/:id/events（SSE）、/v1/ui-contrib、/shutdown；Bearer token 常量时间校验；错误→HTTP 状态映射 |
| T-012 SessionBridge | `bridge/session-bridge.ts`：dsh 事件类型→CKP 事件翻译（user/assistant/chunk/tool/turn/done/error/cancel），未知类型静默忽略；`rpc/sse.ts`：EventBus（seq 分配 + 5000 环形缓冲 + 订阅/重放/close） |
| T-013 client transport | `HttpTransport`：fetch RPC + SSE 解析 + seq 续传 + 指数退避重连（500ms→8s）+ gap 检测；ACP 占位 |
| T-014 EventStore | 纯函数 `rootReducer`（消息流式合并/工具/审批/文件/checkpoint/状态/lastSeq）+ `createStore`（seq 幂等去重/rebuild 重放/订阅/节流持久化）+ IndexedDB 封装（环境守卫）+ 乐观 UI（仅用户消息） |
| T-016/T-017 ui-kit | 17 组件 + 7 primitives：ToolCallCard★（5 状态/参数输出折叠/20 行截断）、ApprovalCard★（4 档风险/4 决策/倒计时）、Markdown（流式安全）、DiffView（unified/split）、Composer、SessionList、CommandPalette 等 |
| fixtures | 3 组确定性事件流（simple-qa/multi-tool/approval-error）+ **M1 核心闭环集成测试**（host×client 端到端） |

## 验证了什么

- **全量测试 54 项通过**：protocol 11 / client 14 / ui-kit 8 / host-dsh 15 / fixtures 6。
- **M1 核心闭环**（`fixtures/test/core-loop.test.ts`）：真实 host server × client SDK —— 建会话 → 订阅 SSE → 发消息 → 工具事件 → 审批 once 决策，全链路无 dsh 进程。
- **断线重连逻辑**：SSE 重连（指数退避 + lastSeq 续传 + gap→重建）在 transport 层实现并有单测覆盖。

## 被 BLOCK 了什么

- **T-020 集成验收未做**：需要真实 dsh sidecar（`dsh --profile cursorkit --patch host.cordis.yml`）拉起 host 插件，验证「kill sidecar 重启后前端状态一致」等验收项。BLOCKED-2（自建 profile 文件格式）需 `--dump-config` 实测。这些属于有 dsh 环境的集成工作，代码层已验证。
- **BLOCKED-1**（审批 dsh 原生 API）：已缓解——ApprovalBridge 自实现，见 audit §6.5。

## 与 GOAL 的偏差及理由

1. **会话订阅/发送走真实 API**：`ctx.on('session/event')` + `agent.send(msg, 'next-turn', true)`，替代文档假设的 `sessions.subscribe()/send()`（audit §3/§6）。
2. **审批由 host 自实现**：0.1.1-rc.2 无工具审批 Service，ApprovalBridge 提供 CKP 审批面（audit §6.5）。
3. **ui-kit 零运行时依赖**：未引入 shadcn/tailwind（文档建议但非硬性），组件用内联样式 + `ck-*` className，便于独立于样式栈使用。
4. **T-005（Shell）延后**：M1 代码层不依赖 Tauri/Electron；D3 决策已明确「先用任意壳跑通」，Shell 选型不阻塞。

## 下一步

- T-020：dsh sidecar 集成验收（真实会话/审批/断线重连/取消）
- T-018：features/chat + Composer + SessionList 页面组装
- T-005：Shell 空壳（Electron 快速起，Tauri 备选）
