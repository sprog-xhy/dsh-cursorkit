# dsh-cursorkit

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）构建的 **Claude Desktop / Codex Desktop 风格桌面客户端**：对话为中心 + 任务并行 + 变更审查。

> 完整执行纲领见 [`dsh-cursorkit-完整项目文档.md`](dsh-cursorkit-完整项目文档.md)（GOAL v2.0 + 架构 v2.0 汇总版）。

## 架构一句话

**纯插件 + 薄桌面外壳**，不改 dsh 一行源码：

```
Desktop Shell (Tauri2/Electron) ── React SPA ── client SDK (CKP)
        │                                      │
        └── sidecar: dsh 进程 ── host-dsh 插件 ─┘  (HTTP + SSE, 127.0.0.1)
```

- **CKP 协议**（`packages/protocol`）：前后端唯一共享契约（方法表/事件流/错误码/版本协商）
- **host-dsh**（`packages/host-dsh`）：dsh 插件，进程内起 HTTP+SSE server，能力探测 fail-fast，唯一允许访问 `ctx.*` 的地方
- **client**（`packages/client`）：事件源 SDK（EventStore + 纯函数 reducer + SSE 断线续传 + 乐观 UI）
- **ui-kit**（`packages/ui-kit`）：Claude Desktop 质感组件（ToolCallCard / ApprovalCard 为体验核心）
- **fixtures**（`fixtures/`）：三组确定性事件流 + host×client 集成测试

## 状态

| 里程碑 | 状态 |
|---|---|
| M0 地基（能力核验/workspace/protocol） | ✅ 完成（audit 见 `docs/dsh-capability-audit.md`） |
| M1 对话闭环（host-dsh/client/ui-kit 代码层） | ✅ 54 项测试全绿（见 `docs/milestones/M1-report.md`） |
| M1 T-020 集成验收（真实 dsh sidecar） | ⏳ 待有 dsh 环境实跑 |
| M2+ | 见任务清单 §14 |

## 开发

```bash
pnpm install
pnpm -r build      # 全部包构建
pnpm -r test       # 全部测试（54 项）
```

## 目录

```
apps/         桌面壳（[P2] Tauri/Electron）
packages/
  protocol/   ★ CKP 契约（唯一前后端共享）
  client/     前端 SDK（transport/store/optimistic）
  host-dsh/   ★ dsh 插件（capability/compat/rpc/bridge）
  ui-kit/     展示组件
fixtures/     事件流 fixture + 集成测试
docs/         audit / ADR / milestones
```

## 安全默认值

隔离、最小网络（loopback only）、无持久凭据（Keychain）、显式审批、执行后清理。
