# ADR-001：会话订阅/发送与审批的真实 dsh API 适配

- **日期**：2026-09-08
- **状态**：已接受
- **关联**：GOAL §2.2 决策 D1/D2；ARCHITECTURE §5.4/§5.5；`docs/dsh-capability-audit.md` §3/§6/§6.5

## 背景

GOAL/ARCHITECTURE 假设的 `ctx.sessions` API（`sessions.subscribe(sessionId, fromSeq, cb)`、`session.send(text)`）与 dsh 0.1.1-rc.2 的真实 API 不符。T-001 源码核验发现真实形状（详见 audit 文档）：

```ts
// 真实（@deepseek-ai/dsh-session, 0.1.1-rc.2）
ctx.sessions: SessionStore extends Service   // create/get/list/fork/flush
ctx.on('session/event', (session, event) => …) // ★ 事件流（Cordis 总线）
ctx.on('session/created', (session) => …)
agent.send(message, 'next-turn', true)        // 发送（dsh-agent）
```

## 决策

1. **SessionBridge 用 Cordis 事件订阅**（实现 1），替代「实现 2 轮询」；翻译表基于 dsh 事件类型（user/assistant/tool/turn/request…），未知类型静默忽略——不崩溃、可演进。
2. **发送走 `agent.send(msg, 'next-turn', true)`**（无 agent 时退回 `inbox.append`），由 compat 层封装，host 其余代码不感知差异。
3. **审批面由 host-dsh 自实现**（ApprovalBridge：挂起表 + 5 分钟超时 deny + 工具名风险推断），不与 dsh 内部授权绑定——dsh 0.1.1-rc.2 的工具审批无独立 Service（`dsh-authorization` 是凭据授权，audit §6.5）。CKP `approval.request/resolved` 事件与 `ApprovalCard` 完全由 host 与前端闭环，符合「协议归我」（P2/D1）。

## 影响

- CKP 契约与前端设计**零改动**（协议层已隔离）。
- host-dsh 的 `compat/` 成为唯一需要随 dsh API 演进而调整的模块（这正是 P3 设计意图）。
- 审批决策写入会话日志（审计）留到接入真实 dsh 授权回调时补充。

## 备选方案

- ACP stdio 作为审批回执通道：拒绝（ACP 为 automation-only，文档 §2.2 决策 D1）。
- 轮询 `session.events` 快照兜底：保留为实现 2（版本过旧时），当前实现 1 已可用。
