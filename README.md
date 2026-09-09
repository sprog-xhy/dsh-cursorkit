# dsh-cursorkit

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）构建的 **Claude Desktop / Codex Desktop 风格桌面客户端**：对话为中心 + 任务并行 + 变更审查。

> 完整执行纲领见 [`dsh-cursorkit-完整项目文档.md`](dsh-cursorkit-完整项目文档.md)（GOAL v2.0 + 架构 v2.0 汇总版）。

## 架构一句话

**纯插件 + 薄桌面外壳**，不改 dsh 一行源码：

```
Desktop Shell (Electron) ── React SPA ── client SDK (CKP)
        │                          │
        └── sidecar: dsh 进程 ── host-dsh 插件 ──┘  (HTTP + SSE, 127.0.0.1)
```

- **CKP 协议**（`packages/protocol`）：前后端唯一共享契约（方法表/事件流/错误码/版本协商）
- **host-dsh**（`packages/host-dsh`）：dsh 插件，进程内起 HTTP+SSE server，能力探测 fail-fast，唯一允许访问 `ctx.*` 的地方
- **client**（`packages/client`）：事件源 SDK（EventStore + 纯函数 reducer + SSE 断线续传 + 乐观 UI）
- **ui-kit**（`packages/ui-kit`）：Claude Desktop 质感组件（ToolCallCard / ApprovalCard 为体验核心）
- **features**（`packages/features`）：页面级容器（三栏布局 / 命令面板 / 并行视图 / settings）
- **desktop**（`apps/desktop`）：Electron 壳（sidecar 管理 / Keychain / 托盘 / 多窗口）
- **web**（`apps/web`）：同一前端的浏览器版
- **fixtures**（`fixtures/`）：确定性事件流 + host×client 集成测试

## 状态

| 里程碑 | 状态 |
|---|---|
| M0 地基（能力核验 / workspace / protocol） | ✅（audit 见 `docs/dsh-capability-audit.md`） |
| M1 对话闭环（host-dsh / client / ui-kit） | ✅ **T-020 集成验收 15/15**（真实 dsh sidecar + wps 模型流式回复 + 断线重连快照回放） |
| M2 审查闭环（diff.get / checkpoint / file.changed / trajectory） | ✅ 含**真实工具执行完整闭环**（kimi-k2.7-code 写文件 → file.changed → 自动 checkpoint） |
| M3 平台化（settings / 命令面板） | ✅ 模型/MCP/插件/Skills/关于 + Cmd+K 命令面板 |
| M4 并行（worktree / best-of-n） | ✅ 真实 git worktree 管理 + 并行会话实证脚本 |
| M5 扩展（ext-host / 托盘 / 快捷键 / 多窗口） | ✅ manifest + 动态加载运行时；Electron 托盘 + 全局快捷键 + 多窗口 |
| Desktop 壳（Electron + Keychain） | ✅ 真壳端到端验证（三栏 UI + 真实数据渲染） |

**测试**：94 项全绿（protocol 11 / client 14 / ui-kit 8 / host-dsh 40 / features 15 / fixtures 6）。

## 开发

```bash
pnpm install
pnpm -r build      # 全部包构建
pnpm -r test       # 全部测试
```

## 运行（桌面壳）

```bash
cd apps/web && pnpm build          # 构建前端
cd apps/desktop && pnpm start      # Electron 壳（自动复用/拉起 sidecar）
```

浏览器版：`cd apps/web && pnpm dev`（需 sidecar 与 `$DSH_HOME/.cursorkit/runtime.json`）。

## 集成验收 / 复现

- 测试 profile 模板与复现指南：`scripts/profile-template/README.md`
- T-020 验收脚本：`scripts/run-acceptance.mjs`（15 断言，`--only` 可按项）
- M4 并行实证脚本：`scripts/run-parallel.mjs`

## 目录

```
apps/
  desktop/     Electron 壳（sidecar 管理/Keychain/托盘/多窗口）
  web/         浏览器版前端（Vite + React）
packages/
  protocol/   ★ CKP 契约（唯一前后端共享）
  client/     前端 SDK（transport/store/optimistic）
  host-dsh/   ★ dsh 插件（capability/compat/rpc/bridge/checkpoint/worktree）
  ui-kit/     展示组件
  features/   页面容器（sessions/chat/settings/parallel/commands/ext-host）
fixtures/     事件流 fixture + 集成测试
docs/         audit / ADR / milestones / 验收报告
scripts/      验收与实证脚本
```

## 安全默认值

隔离、最小网络（loopback only）、无持久凭据（Keychain safeStorage）、显式审批、执行后清理。
