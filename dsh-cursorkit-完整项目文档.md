# dsh-cursorkit 完整项目文档（汇总版）

> 为 DeepSeek Harness（`dsh`）构建一套 **Claude Desktop / Codex Desktop 风格的桌面客户端**。
> 本文档是**唯一执行纲领**，由 GOAL v2.0（目标与里程碑）+ 架构设计 v2.0（技术实现）+ 调研结论附录 合并而成。

| 项 | 值 |
|---|---|
| 文档版本 | v2.0（汇总版） |
| 日期 | 2026-09-08 |
| 上游基线 | DeepSeek Harness v0.1.x **Developer Preview**（快照 `0.1.2-alpha.4` ~ `0.1.3-alpha.2`） |
| 产品定位 | 对话为中心 + 任务并行 + 变更审查（介于 Claude Desktop 与 Codex Desktop 之间） |
| 仓库名 | `dsh-cursorkit`，npm scope `@dsh-cursorkit/*` |
| GitHub topic | 必须打 `dsh-plugin` |
| 工程量 | MVP（M0–M3）≈ 62 人日；完整（M0–M5）≈ 96 人日 |

---

## 本文档结构

| 部分 | 内容 | 何时读 |
|---|---|---|
| **第一部分 · 目标**（§0–§10） | 产品定位、非目标、架构总览、仓库结构、CKP 协议、前端信息架构、里程碑验收 | 开工前必读 |
| **第二部分 · 架构**（§0–§15） | 进程模型、目录落盘、各模块接口签名、关键时序、测试策略、**T-001~T-055 任务清单** | 实现时对照 |
| **附录 A · 调研结论** | dsh 已确认能力、`[待核验]` 来源、精简差距矩阵、三条产品判断 | 需要判断优先级时 |
| **附录 B · v1 差异** | v1（Cursor 全量对标）为何作废 | 了解决策沿革 |
| **附录 C · 执行纪律速查卡** | 十条硬约束 | 每次提交前扫一眼 |

**标记为 `[待核验]` 的条目**：必须先读 dsh 源码确认，**禁止凭猜测写代码**。查不到就写进 `BLOCKED.md`，先做不依赖它的任务。

---

# 第一部分 · 目标（GOAL）

### 0. 一句话目标

> 用**纯插件 + 一个薄薄的桌面外壳**，把 dsh 的 Agent 能力包装成一个漂亮、原生、可用的桌面应用。
> **不改 dsh 一行源码。不重建编辑器。不复制 Cursor 的闭源资产。**

判据：用户打开 App → 选工作区 → 开一个会话 → 看着消息流和工具卡片一条条滚出来 → 需要时点「允许」→ 任务结束后在 Trajectory / Changes 里审查 → 不满意就回滚到某个 checkpoint → 满意就提交。全程不需要开终端、不需要懂 dsh。

---

### 1. 非目标

| 不做 | 原因 | 允许的做法 |
|---|---|---|
| **任何编辑器功能**（Tab 补全、Cmd+K inline edit、diff gutter、LSP 跳转） | 那是 Cursor，不是本项目 | 只做**只读 diff 审查** |
| **交互式终端** | Agent 自己跑命令 | 渲染只读命令输出卡片；xterm.js 留到 P2 |
| 改 dsh 源码 / 提交 dsh patch | 违反「一切皆插件」 | 一切通过插件 / ACP / MCP / sidecar 实现 |
| Cloud SaaS、账号体系、订阅计费 | 基础设施资产 | 无 |
| Cursor Tab 延迟、Composer 模型质量 | 闭源模型资产 | 无 |
| 多用户 / 团队协作后台 | 治理控制面 | 无 |

**铁律**：`dsh` 是上游，不是你的代码。你只能通过 cordis.yml / bundle / profile / patch / 插件注册 / ACP / MCP 改变行为。

---

### 2. 架构

#### 2.1 五层

```text
┌──────────────────────────────────────────────────────────────┐
│ ① Desktop Shell  (Tauri 2 首选 / Electron 备选)               │
│    窗口 · 菜单栏 · Dock/托盘 · 全局快捷键 · Keychain · 通知     │
│    自动更新 · 多窗口 · Deep Link                              │
│    └─ Sidecar Manager：拉起 / 健康检查 / 重启 dsh              │
├──────────────────────────────────────────────────────────────┤
│ ② Frontend  (React + TS SPA)                                  │
│    Sessions │ Chat Stream │ Trajectory │ Diff │ Settings      │
│    └─ Event-Sourced Store（dsh 会话事件流的投影）              │
├──────────────────────────────────────────────────────────────┤
│ ③ Client SDK  (自有契约 CKP)                                   │
│    typed RPC · 事件流 · 断点续传(from seq) · 乐观 UI            │
├──────────────────────────────────────────────────────────────┤
│ ④ Transport  (可切换)                                          │
│    A. LocalHost：HTTP + SSE → dsh 内 dsh-cursorkit-host  ★默认 │
│    B. AcpStdio：ACP JSON-RPC over stdio          （远端/兼容）  │
├──────────────────────────────────────────────────────────────┤
│ ⑤ dsh Runtime  (sidecar 子进程)                               │
│    agent loop · tools · session log · sandbox · skills         │
│    MCP · subagents · jobs · profiles                          │
│    └─ dsh-cursorkit-host  ★我们的插件，进程内起 RPC            │
└──────────────────────────────────────────────────────────────┘
```

#### 2.2 三个关键决策

**① dsh 必须是 sidecar 子进程，绝不 in-process。**
dsh 处于 Developer Preview。它崩溃、热重载、插件装卸载都不能带走 UI。反向好处：dsh 支持配置热重载，可做到不重启 App 换插件。

**② 传输层默认用我们自己的 host 插件，ACP 只作备胎。**
dsh 的 ACP 官方定性为 **automation-only**（建会话、发消息、收更新、批权限、取消）。我们需要 Trajectory 细看、插件清单、profile 切换、文件树、checkpoint 操作，ACP 大概率不够。
`dsh-cursorkit-host` 跑在 dsh 进程内可直接访问 `ctx.*`，且**协议归我们所有** → 这是抵御 dsh API 动荡的最佳护城河。

**③ 前端事件源化（Event-Sourced）—— 拱心石。**
dsh 官方：模型看到的一切写进 append-only 会话日志，恢复/分叉/检索/回放共享同一份事件流。
因此前端就是这份流的**投影**：`state = events.reduce(projection, init)`。
白送四个能力：断线增量回放、Trajectory 按 source 分组、Fork/Restore 即 reducer 跑到某 seq、时间旅行调试。
**乐观 UI 只用于用户自己发的消息**，其余一律服从事件流。

#### 2.3 技术选型

| 项 | 选择 | 备注 |
|---|---|---|
| Shell | **Tauri 2**（首选） | ~15MB、sidecar 一等公民、原生感；Rust 仅 ~200 行做 sidecar 与 native command |
| Shell 备选 | Electron | 团队纯 JS 且 Rust 是硬门槛时用；dsh 仍是子进程，前端代码完全相同 |
| 前端 | React + TypeScript + Vite | |
| 状态 | 事件源 reducer + 轻量 store（Zustand 或自研） | 不要 Redux 全家桶 |
| 样式 | Tailwind + shadcn/ui | 快速做出 Claude Desktop 那种干净质感 |
| 流式 | SSE（LocalHost）/ stdio（ACP） | |
| 凭据 | OS Keychain（Tauri keyring / Electron safeStorage） | **绝不写明文配置文件** |

> **Shell 选型是最后一个需要锁定的决策，不是第一个。** 前端与传输层与它解耦。

---

### 3. 仓库结构

```text
dsh-cursorkit/
├─ apps/
│  ├─ desktop/              # Tauri (或 Electron) 外壳
│  │   ├─ src-tauri/        # Rust: sidecar 生命周期、native commands
│  │   └─ src/              # React 前端
│  └─ web/                  # [P2] 同一前端的浏览器版
├─ packages/
│  ├─ protocol/             # ★ CKP 契约：TS 类型 + JSON Schema（前后端共享）
│  ├─ client/               # 前端 SDK：typed RPC、事件流、重连、乐观 UI
│  ├─ host-dsh/             # ★ dsh 插件：进程内 RPC server（我们最重要的包）
│  ├─ host-acp/             # ACP stdio 适配器（远端 / 兼容）
│  ├─ ui-kit/               # 消息流、工具卡片、审批卡片、diff 视图等组件
│  ├─ features/             # 页面级特性：sessions / chat / trajectory / diff / settings
│  └─ ext-host/             # [P1] 插件 UI 贡献运行时
├─ plugins/                 # dsh 侧能力插件（可选，视 M4 需要）
│  ├─ cursorkit-worktree/
│  ├─ cursorkit-checkpoint/
│  └─ cursorkit-context/
├─ docs/
│  ├─ GOAL.md               # 本文档
│  ├─ ADR/
│  ├─ protocol/             # CKP 的 JSON Schema 与版本说明
│  └─ dsh-capability-audit.md
├─ BLOCKED.md
└─ package.json             # pnpm workspace
```

**纪律**：`protocol` 是唯一被前后端共享的包；`features` 不得直接 import `client` 之外的传输细节；`host-dsh` 是唯一访问 `ctx.*` 的地方。

---

### 4. CKP 协议（先定契约，再写实现）

#### 4.1 传输

- LocalHost：`http://127.0.0.1:<port>`，token 写在 `$DSH_HOME/.cursorkit-token`（0600），每次启动轮换。
- 事件：`GET /sessions/:id/events?from=<seq>`（SSE）。
- ACP 适配：同样语义映射到 stdio JSON-RPC。

#### 4.2 最小方法集

```
session.list / session.create / session.get / session.fork / session.close
session.send(text, attachments, mentions)
session.cancel
approval.respond(id, 'once' | 'session' | 'always' | 'deny')
events.subscribe(sessionId, fromSeq) -> SSE
workspace.list / workspace.select
model.list / model.select
config.get / config.set               # 模型、权限、profile
plugin.list / skill.list
mcp.list / mcp.add / mcp.remove
checkpoint.list / checkpoint.restore
worktree.list / worktree.create / worktree.remove
diff.get(sessionId | checkpointId)
```

#### 4.3 事件类型（前端 reducer 的输入）

```ts
type CkpEvent =
  | { seq, type: 'session.started',   sessionId, workspace, model }
  | { seq, type: 'message.user',      text, attachments }
  | { seq, type: 'message.delta',     text }              // 流式
  | { seq, type: 'message.done',      message }
  | { seq, type: 'thinking.delta',    text }
  | { seq, type: 'tool.call',         callId, name, args }
  | { seq, type: 'tool.output',       callId, output, exitCode }
  | { seq, type: 'tool.done',         callId, durationMs }
  | { seq, type: 'approval.request',  approvalId, tool, args, reason }
  | { seq, type: 'approval.resolved', approvalId, decision }
  | { seq, type: 'file.changed',      path, patch, worktreeRef }
  | { seq, type: 'checkpoint.created',checkpointId, summary, reversible }
  | { seq, type: 'subagent.spawned' | 'subagent.done', ... }
  | { seq, type: 'error' | 'cancelled' | 'done', ... }
```

**硬规则**：每个事件必须有单调递增 `seq`；前端按 `seq` 去重与断点续传。

---

### 5. 前端信息架构

```text
┌─ Sidebar ─┬──────────── Main ────────────┬── Right Rail ──┐
│ Workspace │  消息流                        │ Trajectory     │
│  ▾ repo   │  ├ 用户消息                   │ Changes (diff) │
│ Sessions  │  ├ 助手消息（markdown 流式）   │ Checkpoints    │
│  · 线程1  │  ├ 思考块（可折叠）            │ Context        │
│  · 线程2  │  ├ 工具调用卡片 ⬅ 体验核心     │                │
│  · 线程3  │  │  名称/参数/状态/耗时        │                │
│           │  │  可展开输出 + diff 预览     │                │
│ Worktree  │  ├ 审批卡片 ⬅ 体验核心         │                │
│  main  ●  │  │  允许一次/本次会话/总是/拒绝│                │
│  feat-x ○ │  └ checkpoint 标记            │                │
├───────────┴───────────────────────────────┴────────────────┤
│ Composer：/ 命令 · @ 提及 · 附件 · 图片粘贴                  │
└────────────────────────────────────────────────────────────┘
```

**设置页**：模型与 API Key（Keychain）、MCP 服务器、插件/Skills、权限策略、外观、关于（显示 dsh 版本与 commit）。
**命令面板**：`Cmd+K`，聚合会话搜索、`/` 命令、设置跳转。

**重点投入**：工具调用卡片与审批卡片的视觉与交互——Claude Desktop 的口碑主要来自这两块。

---

### 6. 里程碑与验收

#### M0 — 地基与事实核验（≈8 人日，不可跳过）

- [ ] clone dsh 源码，记录 commit hash；`pnpm install && pnpm run build && pnpm dsh web` 跑通。
- [ ] **逐项核验**并产出 `docs/dsh-capability-audit.md`：
  - dsh 插件能否在 `apply()` 里起一个 HTTP server？（读 `packages/web` 或 client 实现）
  - ACP server 的 JSON-RPC 方法全集（读 `packages/acp`）。
  - `ctx.sessions` 的事件 API 真实签名（读 `packages/session`）。
  - `ctx.jobs` / `ctx.sandbox` / `ctx.fs` / `ctx.skills` 的真实 API。
  - 是否存在官方 `index` 包、`ctx.ui`。
- [ ] 用 `--patch` scratch overlay 跑通 hello-world 插件。
- [ ] 定下 Shell（Tauri / Electron），空壳能启动。

**验收**：
> Given 启动 App，When sidecar 拉起 dsh 并加载 `host-dsh`，Then 前端能 `session.list` 拿到空列表，且状态栏显示 dsh 版本与 commit。

#### M1 — 对话闭环（≈20 人日）

`protocol` → `client` → `host-dsh` → 消息流 UI

**验收**：
1. 新建会话 → 发消息 → 流式收到回复，token 平滑无卡顿。
2. 工具调用以卡片呈现：名称、参数、状态、耗时、可展开输出。
3. 需要审批时弹出审批卡片，四种决策（一次/会话/总是/拒绝）均生效。
4. **断线重连**：kill 掉 dsh sidecar 再重启，前端从 `lastSeq` 增量回放，状态与断线前一致。
5. Agent 运行中点取消能立刻停止。

#### M2 — 审查闭环（≈18 人日）

Trajectory 视图 / diff 审查 / checkpoint 恢复

**验收**：
1. Trajectory 按 source（系统提示、思维链、工具调用、子 agent、上下文注入）分组展示。
2. Changes 面板列出所有 `file.changed`，支持按文件 keep / reject。
3. Checkpoints 时间线可点到任一节点预览，`restore` 后前端开**新的 fork**，不覆盖历史。
4. 不可撤销的操作（网络/DB 副作用）显式标注，restore 时给出警告。

#### M3 — 平台化（≈16 人日）

设置 / Keychain / MCP 与插件管理 / 命令面板

**验收**：
1. API Key 存 Keychain，配置文件中无明文。
2. 可在 UI 中添加/移除 MCP 服务器并看到其工具出现在 Agent 可用工具列表。
3. 可浏览与启停 dsh 插件、Skills。
4. `Cmd+K` 命令面板可用；`/` 命令与 `@` 提及有自动补全。

**至此 MVP 完成（≈62 人日）。**

#### M4 — 并行与隔离（≈16 人日）

worktree / 多会话并行 / best-of-n / subagent 可视化

#### M5 — 扩展与打磨（≈18 人日）

插件 UI 贡献运行时 / 多窗口 / 大会话性能 / 托盘与全局快捷键 / 自动更新

---

### 7. 插件如何贡献 UI（M5，但契约现在就定）

既然 dsh「一切皆插件」，前端也应允许插件贡献界面：

```ts
// dsh 插件侧声明
ctx.cursorkit.ui.contribute({
  panels:    [{ id, title, icon, mount: 'sidebar'|'main'|'rail', entry }],
  renderers: [{ tool: 'str_replace_editor', entry }],  // 自定义工具卡片渲染
  settings:  [{ id, title, entry }],
  commands:  [{ id, title, keybinding }],
  status:    [{ id, align: 'left'|'right', entry }],
})
```

host 插件汇总成 manifest；前端 `ext-host` 从本地 RPC 动态 import 这些 entry（ESM）。
**MVP 只实现 renderers + commands**，其余随 M5。

---

### 8. 执行纪律

> 完整十条见 **附录 C · 执行纪律速查卡**。

1. **先核验，后编码**。任何不确定的 dsh API，先读源码 / README / 测试，**禁止凭猜测写调用**。查不到就写进 `BLOCKED.md`，先做不依赖它的部分。
2. **契约先行**。`protocol` 的类型与 JSON Schema 先于一切实现。
3. **永不改 dsh 源码**。
4. **凭据只进 Keychain**，禁止明文落盘。
5. **乐观 UI 只用于用户消息**。
6. 每完成一个里程碑产出 `docs/milestones/M{n}-report.md`：做了什么、验证了什么、被 BLOCK 了什么、与 GOAL 的偏差及理由。
7. 任何偏离本文档的决定必须写 ADR，**不得静默改向**。
8. 看到炫酷功能想加？先看它在里程碑表里排第几。M3 之前的 P2 一律不动。

**安全默认值**：隔离、最小网络、无持久凭据、显式审批、执行后清理。「Agent 需要完成任务」不能成为绕过安全边界的理由。

---

### 9. 参考

**dsh（一手优先，接口细节一律以源码为准）**
- https://github.com/deepseek-ai/deepseek-harness
- https://deepseek-harness.github.io/deepseek-harness/
- `packages/acp/README`、`packages/session/`、`packages/skill/`、`packages/hooks/`
- https://deepwiki.com/deepseek-ai/deepseek-harness/（辅助，非官方）

**产品参照**
- Claude Desktop（对话 + MCP + artifacts 的交互范式）
- Codex Desktop（worktree / thread 并行 + diff 审查的交互范式）

---

### 10. 附：与 v1 的差异

> 详见 **附录 B · v1 为何作废**。

---

# 第二部分 · 架构设计

### 0. 如何使用本文档

1. 先读 §2（架构总览）与 §3（进程与生命周期），建立整体心智模型。
2. §4 是目录结构，每个文件都标注了职责——**建仓时按此落盘**。
3. §5–§9 是各模块的详细设计，含真实接口签名，实现时照抄。
4. §10 是 CKP 协议完整定义（方法表 / 事件表 / 错误码），这是前后端的唯一契约。
5. §14 是**可直接分派的任务清单**（T-001 ~ T-0xx，含依赖与验收）。执行时从 T-001 顺序推进。

---

### 1. 设计原则（五条，违反即打回）

| # | 原则 | 具体含义 |
|---|---|---|
| P1 | **dsh 是上游，不是你的代码** | 永不修改 dsh 源码。一切能力通过插件 / ACP / MCP / 子进程实现 |
| P2 | **协议归我，实现可换** | 前端只认 CKP 协议，不认 dsh API。dsh 改版只改 `host-dsh` |
| P3 | **唯一 ctx 访问点** | 只有 `packages/host-dsh/src/compat/*` 允许访问 `ctx.*` |
| P4 | **事件源** | 前端状态 = dsh 会话事件流的 `reduce`。除用户自己发的消息外，禁止乐观更新 |
| P5 | **失败要响** | 能力缺失 / 版本不匹配一律 fail-fast 并给出可读错误，禁止静默降级 |

---

### 2. 架构总览

#### 2.1 五层与进程边界

```text
┌─ 进程 A：Tauri/Electron 主进程 ────────────────────────────────┐
│  SidecarManager（Rust）                                        │
│    spawn dsh · 健康检查 · 崩溃重启 · 读 runtime.json · Keychain │
└───────────────────────────┬────────────────────────────────────┘
                            │ IPC（Tauri command / Electron IPC）
┌───────────────────────────▼────────────────────────────────────┐
│ 进程 B：Renderer（React SPA）                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ features/   │  │ ui-kit/      │  │ client/               │  │
│  │ 页面与布局  │─▶│ 展示组件     │◀─│ EventStore + reducers │  │
│  └─────────────┘  └──────────────┘  │ transport: HTTP/SSE   │  │
│                                     └───────────┬───────────┘  │
└─────────────────────────────────────────────────┼──────────────┘
                                                  │ HTTP + SSE (127.0.0.1)
┌─────────────────────────────────────────────────▼──────────────┐
│ 进程 C：dsh sidecar（Node）                                     │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ dsh-cursorkit-host 插件（我们的代码）                      │ │
│  │   rpc/server · bridge/* · compat/* · capability           │ │
│  └───────────────────────────────────────────────────────────┘ │
│  dsh 内核：agent loop · tools · session log · sandbox · skills  │
│            MCP · subagents · jobs                              │
└────────────────────────────────────────────────────────────────┘
```

**为什么 dsh 必须是独立进程**：dsh 处于 Developer Preview，会崩溃、会热重载、会装卸载插件。进程隔离后这些问题不会带走 UI，且能独立重启 dsh 而不丢前端状态（靠事件流回放）。

#### 2.2 三条关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| **D1** 传输 | 自建 `host-dsh` 插件起 HTTP+SSE，**ACP 仅作远端/兼容备选** | dsh 的 ACP 官方定性为 automation-only；且 CKP 协议归我们所有，能隔离 dsh API 动荡 |
| **D2** 状态 | 前端事件源化 | dsh 会话日志本就是 append-only 事件流，照抄即白捡：断线回放、Trajectory 分组、Fork/Restore、时间旅行 |
| **D3** Shell | Tauri 2 首选，Electron 兜底 | 前端与传输层与之解耦，**选型不阻塞开发**。先用 Electron 起壳跑通 M1 也完全可以 |

#### 2.3 降级路径（D1 失效时）

优先级：`host-dsh` HTTP → `host-dsh` 挂到 dsh 内置 server 的路由 → ACP stdio → 只读模式（不可用则明确报错）。
四条路径对前端**完全透明**，由 `client/transport` 切换。

---

### 3. 进程与生命周期

#### 3.1 dsh 启动方式

**方案 A（推荐）**：自建 profile

```bash
dsh --profile cursorkit \
    --patch "$DSH_HOME/.cursorkit/host.cordis.yml"
```

`host.cordis.yml` 内容（scratch overlay 方式插入我们的插件）：

```yaml
- insert:
    - id: cursorkit-host
      name: "@dsh-cursorkit/host-dsh"
      inject: [sessions, tools]
      config:
        port: 0            # 0 = 自动选端口
        tokenFile: "$DSH_HOME/.cursorkit/runtime.json"
```

> **`[待核验-1]`**：dsh 是否支持**长驻的非 web 运行模式**（非 one-shot）。已知 `dsh --profile headless "<prompt>"` 是一次性任务。若不存在长驻 headless 模式，退回**方案 B**。

**方案 B（兜底）**：复用 `web` profile

```bash
dsh web --no-open --port <p>
```

此时 dsh 自带 Web UI 也在跑，但用户不看它；我们的 `host-dsh` 插件作为独立 HTTP server 或复用其路由提供 CKP。

> **`[待核验-2]`**：dsh 插件能否在 `apply()` 内 `http.createServer()` 监听端口；若不能，能否向内置 server 注册路由（读 `packages/web` / client 实现）。

#### 3.2 runtime.json（进程间发现协议）

路径：`$DSH_HOME/.cursorkit/runtime.json`，权限 `0600`

```jsonc
{
  "pid": 48213,
  "port": 39307,
  "token": "9f3c...（64 hex）",
  "protocolVersion": "ckp/1",
  "dshVersion": "0.1.3-alpha.2",
  "dshCommit": "47f9438",
  "startedAt": "2026-09-08T07:40:00Z",
  "pidfile": "/Users/x/.dsh/.cursorkit/host.pid"
}
```

**流程**：
1. App 启动 → 主进程读 `runtime.json`。
2. 若文件存在且 `GET /health` 返回 200 且 `pid` 存活 → **复用**该实例。
3. 否则 → spawn 新 sidecar，等待 `runtime.json` 出现（轮询，超时 30s）。
4. 拿到 `port` + `token` → 经 IPC 传给 Renderer。
5. Renderer 所有请求带 `Authorization: Bearer <token>`。

> 复用而非独占，保证「多窗口 / App 重启 / 崩溃恢复」三种场景都不会起出多个 dsh。

#### 3.3 Sidecar 状态机

```text
                 ┌──────────┐
                 │ Stopped  │
                 └────┬─────┘
                      │ start()
                 ┌────▼─────┐
                 │ Starting │
                 └────┬─────┘
          ┌───────────┼────────────┐
   ok ────┤           │            ├──── timeout / crash
   ┌──────▼─────┐     │      ┌─────▼────────┐
   │   Ready    │     │      │  Restarting  │──重试 ≤N 次──▶ Failed
   └──────┬─────┘     │      └──────────────┘
          │ health 失败│
   ┌──────▼──────┐    │
   │  Degraded   │    │
   └──────┬──────┘    │
          └───────────┴──▶ stop()
```

- 健康检查：每 5s `GET /health`（轻量，不触发 agent 逻辑）。
- 崩溃重启：指数退避 1s / 2s / 4s / 8s，最多 5 次 → `Failed`（UI 显示明确错误 + 「查看日志」按钮）。
- dsh 热重载配置时可能短暂不可用 → 计入 `Degraded`，不触发重启。

#### 3.4 关闭顺序

App 退出 → Renderer 关闭 SSE → 主进程 `POST /shutdown`（graceful，给 dsh 5s 落盘会话）→ SIGTERM → 3s 后 SIGKILL → 清理 `runtime.json`。

---

### 4. 目录结构（按此落盘）

```text
dsh-cursorkit/
├─ apps/
│  ├─ desktop/
│  │  ├─ src-tauri/                    # Rust 外壳（Electron 方案时为 electron/）
│  │  │  ├─ src/
│  │  │  │  ├─ main.rs                 # 应用入口、窗口、tray
│  │  │  │  ├─ sidecar.rs              # ★ SidecarManager：spawn/health/restart/stop
│  │  │  │  ├─ runtime_file.rs         # 读写 runtime.json、端口扫描、token 生成
│  │  │  │  ├─ keyring.rs              # OS Keychain 读写
│  │  │  │  ├─ commands.rs             # #[tauri::command] 暴露给前端
│  │  │  │  └─ log.rs                  # 日志落盘 $DSH_HOME/.cursorkit/logs/
│  │  │  ├─ binaries/                  # sidecar 可执行文件或启动脚本
│  │  │  ├─ tauri.conf.json
│  │  │  └─ Cargo.toml
│  │  └─ src/                          # React 前端
│  │     ├─ main.tsx
│  │     ├─ App.tsx                    # 三栏布局 + 路由
│  │     ├─ bootstrap.ts               # 启动：取 runtime info → 建 CkpClient
│  │     └─ styles/
│  └─ web/                             # [P2] 同一前端的浏览器版
│
├─ packages/
│  ├─ protocol/                        # ★ CKP 契约（前后端共享，无运行时依赖）
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  ├─ envelope.ts                # 请求/响应/事件信封
│  │  │  ├─ methods.ts                 # 方法名与入参出参类型（单一真源）
│  │  │  ├─ events.ts                  # CkpEvent 联合类型
│  │  │  ├─ domain.ts                  # Session/ToolCall/Approval/FileChange/Checkpoint
│  │  │  ├─ errors.ts                  # 错误码枚举 + CkpError
│  │  │  └─ version.ts                 # 协议版本与协商
│  │  └─ schema/                       # 由 TS 生成的 JSON Schema（CI 校验）
│  │
│  ├─ client/                          # 前端 SDK
│  │  └─ src/
│  │     ├─ index.ts                   # 门面 CkpClient
│  │     ├─ transport/
│  │     │  ├─ types.ts                # Transport 接口
│  │     │  ├─ http.ts                 # RPC over fetch
│  │     │  ├─ sse.ts                  # 事件流 + 重连 + seq 续传
│  │     │  └─ acp-stdio.ts            # [P1] ACP 适配
│  │     ├─ store/
│  │     │  ├─ event-log.ts            # append / dedupe(seq) / IndexedDB 持久化
│  │     │  ├─ create-store.ts         # state = events.reduce(...)
│  │     │  ├─ reducers/
│  │     │  │  ├─ session.ts
│  │     │  │  ├─ messages.ts          # 含流式 delta 合并
│  │     │  │  ├─ thinking.ts
│  │     │  │  ├─ tools.ts
│  │     │  │  ├─ approvals.ts
│  │     │  │  ├─ files.ts
│  │     │  │  ├─ checkpoints.ts
│  │     │  │  └─ index.ts             # rootReducer
│  │     │  └─ selectors.ts            # 派生数据（未读、耗时、token 用量）
│  │     ├─ optimistic.ts              # 仅用于用户消息
│  │     └─ idb.ts                     # IndexedDB 封装
│  │
│  ├─ host-dsh/                        # ★ dsh 插件（唯一访问 ctx.* 的地方）
│  │  ├─ package.json                  # dsh.bundle: true
│  │  ├─ cordis.patch.yml
│  │  └─ src/
│  │     ├─ index.ts                   # export name / inject / apply(ctx, config)
│  │     ├─ capability.ts              # ★ 能力探测 → CapabilityReport
│  │     ├─ compat/                    # ★ 所有 ctx 访问的唯一出口
│  │     │  ├─ ctx.ts                  # 安全取服务，缺失抛 CapabilityMissingError
│  │     │  ├─ sessions.ts             # 会话事件订阅 / 发送 / fork / cancel
│  │     │  ├─ tools.ts                # 工具列表
│  │     │  ├─ approvals.ts            # 审批请求与回执
│  │     │  ├─ skills.ts               # skills 列表
│  │     │  ├─ plugins.ts              # 插件清单
│  │     │  ├─ mcp.ts                  # MCP 增删改查
│  │     │  ├─ models.ts               # 模型列表与切换
│  │     │  └─ config.ts               # profile / 权限策略
│  │     ├─ rpc/
│  │     │  ├─ server.ts               # http.createServer + 路由
│  │     │  ├─ router.ts               # 方法分发（来自 protocol/methods）
│  │     │  ├─ auth.ts                 # Bearer token 校验
│  │     │  ├─ sse.ts                  # 广播总线 + seq 分配
│  │     │  └─ errors.ts               # CKP 错误 → HTTP 状态
│  │     ├─ bridge/
│  │     │  ├─ session-bridge.ts       # ★ dsh 会话事件 → CKP 事件
│  │     │  ├─ approval-bridge.ts      # 审批请求挂起/超时/回执
│  │     │  └─ config-bridge.ts
│  │     ├─ registry/
│  │     │  └─ ui-contrib.ts           # 插件 UI 贡献收集 → manifest
│  │     ├─ runtime-file.ts            # 写 runtime.json（0600）
│  │     ├─ health.ts
│  │     └─ log.ts
│  │
│  ├─ host-acp/                        # [P1] ACP stdio 适配，实现同一 CKP 接口
│  ├─ ui-kit/                          # 纯展示组件（不含业务逻辑）
│  │  └─ src/
│  │     ├─ MessageList.tsx
│  │     ├─ MessageBubble.tsx
│  │     ├─ Markdown.tsx               # 流式安全渲染 + 代码高亮
│  │     ├─ ThinkingBlock.tsx
│  │     ├─ ToolCallCard.tsx           # ★ 体验核心
│  │     ├─ ApprovalCard.tsx           # ★ 体验核心
│  │     ├─ DiffView.tsx               # unified/split + 虚拟滚动 + 折叠未改区
│  │     ├─ FileChangeList.tsx         # keep / reject
│  │     ├─ CheckpointTimeline.tsx
│  │     ├─ TrajectoryPanel.tsx        # 按 source 分组
│  │     ├─ Composer.tsx               # / 命令 · @ 提及 · 附件 · 图片粘贴
│  │     ├─ SessionList.tsx
│  │     ├─ StatusBar.tsx
│  │     ├─ CommandPalette.tsx
│  │     ├─ ErrorBoundary.tsx
│  │     └─ primitives/                # Button / Dialog / Tabs / Tooltip ...
│  ├─ features/                        # 页面级容器（连通 store 与 ui-kit）
│  │  ├─ sessions/  chat/  trajectory/  changes/  settings/
│  └─ ext-host/                        # [P1] 插件 UI 贡献运行时
│
├─ plugins/                            # dsh 侧可选能力插件
│  ├─ cursorkit-worktree/              # [M4]
│  ├─ cursorkit-checkpoint/            # [M4]
│  └─ cursorkit-context/               # [M4]
├─ fixtures/                           # 事件流 fixture（供 reducer 单测与 UI 开发）
├─ docs/
│  ├─ GOAL.md  ARCHITECTURE.md（本文）  ADR/  protocol/  dsh-capability-audit.md
├─ BLOCKED.md
└─ package.json                        # pnpm workspace
```

---

### 5. `host-dsh` 详细设计（最重要）

#### 5.1 插件入口

```ts
// packages/host-dsh/src/index.ts
import type { Context } from '@deepseek-ai/cordis'   // 包名 [待核验]
import { probe } from './capability'
import { startServer } from './rpc/server'
import { writeRuntimeFile, removeRuntimeFile } from './runtime-file'

export const name = 'dsh-cursorkit-host'
export const inject = ['sessions', 'tools']          // 最小依赖，其余能力运行时探测

export function apply(ctx: Context, config: HostConfig) {
  // 1. 能力探测：不通过则 fail-fast，绝不静默降级
  const report = probe(ctx)
  if (!report.required.ok) {
    ctx.logger?.error?.('[cursorkit] missing capabilities', report.required.missing)
    throw new CapabilityMissingError(report.required.missing)
  }

  // 2. 起 RPC server（ctx.effect 保证卸载时自动关闭）
  const server = ctx.effect(() => startServer({ ctx, config, report }))

  // 3. 写 runtime.json（卸载时删除）
  ctx.effect(() => {
    writeRuntimeFile({ port: server.port, token: server.token, report })
    return () => removeRuntimeFile()
  })
}
```

> 插件注册全部走 `ctx.effect()`：dsh 卸载插件时副作用自动撤销，这是 Cordis 的核心保证，也是我们不泄漏端口/文件的前提。

#### 5.2 能力探测（抵御 dsh API 动荡的核心）

```ts
// packages/host-dsh/src/capability.ts
export interface CapabilityReport {
  dshVersion: string
  dshCommit?: string
  required: { ok: boolean; missing: string[] }
  optional: Record<string, boolean>   // sessions.events / sessions.fork / approvals / mcp / ...
  probedAt: string
}

const REQUIRED = ['sessions.create', 'sessions.send', 'sessions.events']
const OPTIONAL = [
  'sessions.fork', 'sessions.cancel',
  'approvals.request', 'approvals.resolve',
  'tools.list', 'skills.list', 'plugins.list',
  'mcp.list', 'mcp.add', 'mcp.remove',
  'models.list', 'models.select',
  'jobs.schedule',
]
```

**规则**：
- REQUIRED 缺失 → 插件**拒绝启动**并打印可读错误（不是 throw 一堆 undefined）。
- OPTIONAL 缺失 → 记录进 report，对应 CKP 方法返回 `CAPABILITY_MISSING`，前端把相关 UI 置灰并 tooltip 说明。
- 每次启动把 report 写进日志；`/v1/capabilities` 暴露给前端，设置页「关于」展示。

#### 5.3 compat 层（唯一 ctx 访问点）

```ts
// packages/host-dsh/src/compat/ctx.ts
export function need<T>(ctx: any, path: string): T {
  const v = path.split('.').reduce((a, k) => a?.[k], ctx)
  if (!v) throw new CapabilityMissingError([path])
  return v as T
}
export function optional<T>(ctx: any, path: string): T | undefined {
  return path.split('.').reduce((a, k) => a?.[k], ctx)
}
```

**纪律**：`host-dsh` 下除 `compat/` 与 `capability.ts` 外，**任何文件都不得出现 `ctx.` 的点式访问**。
CI 加一条 lint 规则（自定义 ESLint 或简单 grep 脚本）自动检查。

#### 5.4 SessionBridge（把 dsh 事件翻译成 CKP 事件）

这是业务核心。设计成接口 + 三种实现：

```ts
// packages/host-dsh/src/bridge/session-bridge.ts
export interface SessionSource {
  subscribe(sessionId: string, fromSeq: number, cb: (e: RawEvent) => void): Disposer
}

// 实现 1（理想）：直接订阅 ctx.sessions 事件流          [待核验-3]
// 实现 2（兜底）：轮询 session-query / 持久化存储          [待核验-4]
// 实现 3（远端）：ACP stdio 的语义更新
```

翻译器职责：

| dsh 侧 | CKP 事件 | 说明 |
|---|---|---|
| 用户输入 | `message.user` | |
| 模型文本增量 | `message.delta` | 高频，需节流（见 §9.3） |
| 文本结束 | `message.done` | |
| 思维链 | `thinking.delta` / `thinking.done` | |
| 工具调用开始 | `tool.call` | 含 callId、name、args |
| 工具输出 | `tool.output` | 可能增量 |
| 工具结束 | `tool.done` | 含耗时、退出码 |
| 审批请求 | `approval.request` | **挂起等待前端回执** |
| 审批结果 | `approval.resolved` | |
| 文件变更 | `file.changed` | 含 patch |
| 上下文注入 | `context.injected` | Trajectory 按 source 展示 |
| 子 agent | `subagent.*` | |
| 结束 | `done` / `error` / `cancelled` | |

> **`[待核验-3]`**：`ctx.sessions` 的事件订阅 API 真实签名（读 `packages/session/`）。
> **`[待核验-4]`**：`session-query`（SQLite）能否作为兜底轮询源。

#### 5.5 ApprovalBridge（挂起式审批）

```ts
interface PendingApproval {
  id: string
  sessionId: string
  tool: string
  args: unknown
  reason?: string
  createdAt: number
  timeoutMs: number          // 默认 300_000
  resolve(d: Decision): void
  reject(e: Error): void
}
```

- 审批请求进入 `Map<id, PendingApproval>`，同时广播 `approval.request` 事件。
- 前端 `POST /v1/approval.respond` → 从 Map 取出 resolve。
- 超时 / 会话关闭 / App 断开 → 自动 `deny` 并广播 `approval.resolved`。
- **审批决策也要写进 dsh 会话日志**（可审计）。

#### 5.6 事件总线与 seq

```ts
// packages/host-dsh/src/rpc/sse.ts
class EventBus {
  private seq = 0
  private ring: CkpEvent[] = []          // 环形缓冲，默认保留最近 5000 条
  private subscribers = new Set<(e: CkpEvent) => void>()

  emit(e: Omit<CkpEvent, 'seq' | 'ts'>): CkpEvent {
    const full = { ...e, seq: ++this.seq, ts: Date.now() }
    this.ring.push(full); if (this.ring.length > 5000) this.ring.shift()
    for (const s of this.subscribers) s(full)
    return full
  }
  replayFrom(seq: number): CkpEvent[] { return this.ring.filter(e => e.seq > seq) }
}
```

> 环形缓冲让「前端重连时先补增量、补不上再全量重建」成为可能。全量重建走会话持久化存储。

#### 5.7 HTTP 路由

```text
GET  /health                          → 200 { ok, uptime, dshVersion, protocolVersion }
GET  /v1/capabilities                 → CapabilityReport
POST /v1/rpc/:method                  → 统一 RPC 入口（body: { params }）
GET  /v1/sessions/:id/events?from=N   → SSE
GET  /v1/ui-contrib                   → 插件 UI 贡献 manifest
POST /shutdown                        → graceful 退出
```

所有 `/v1/*` 需 `Authorization: Bearer <token>`；`/health` 免鉴权（供本机健康检查）。

---

### 6. `protocol` 详细设计

#### 6.1 信封

```ts
export interface Request<T = unknown>  { id: string; method: string; params: T }
export interface Response<T = unknown> { id: string; ok: true; result: T }
                                     | { id: string; ok: false; error: CkpError }
export interface CkpError { code: string; message: string; data?: unknown }
```

#### 6.2 方法清单

| 方法 | 参数 | 返回 | 缺失时 |
|---|---|---|---|
| `session.list` | `{ workspace?, limit?, cursor? }` | `Session[]` | — |
| `session.create` | `{ workspace, model?, worktree? }` | `Session` | — |
| `session.get` | `{ id }` | `SessionDetail` | — |
| `session.fork` | `{ id, fromSeq }` | `Session` | 置灰 |
| `session.close` | `{ id }` | `void` | — |
| `session.send` | `{ id, text, attachments?, mentions? }` | `{ messageId }` | — |
| `session.cancel` | `{ id }` | `void` | — |
| `events.subscribe` | `{ id, fromSeq }` | SSE | — |
| `approval.respond` | `{ approvalId, decision }` | `void` | — |
| `workspace.list` | — | `Workspace[]` | — |
| `workspace.select` | `{ path }` | `Workspace` | — |
| `model.list` / `model.select` | — / `{ id }` | `Model[]` / `void` | 置灰 |
| `config.get` / `config.set` | `{ keys? }` / `{ patch }` | `Config` / `Config` | — |
| `plugin.list` | — | `PluginInfo[]` | 置灰 |
| `skill.list` | — | `SkillInfo[]` | 置灰 |
| `mcp.list` / `mcp.add` / `mcp.remove` | | | 置灰 |
| `checkpoint.list` / `checkpoint.restore` | `{ sessionId }` / `{ id }` | | 置灰（M2） |
| `worktree.list` / `.create` / `.remove` | | | 置灰（M4） |
| `diff.get` | `{ sessionId \| checkpointId }` | `FileChange[]` | 置灰（M2） |

**决策枚举**：`'once' | 'session' | 'always' | 'deny'`

#### 6.3 错误码

```ts
export const CKP_ERRORS = {
  CAPABILITY_MISSING: 'dsh 当前版本缺少该能力',
  UNSUPPORTED_DSH_VERSION: 'dsh 版本不受支持',
  SESSION_NOT_FOUND: '会话不存在',
  SESSION_BUSY: '会话正在运行中',
  APPROVAL_TIMEOUT: '审批超时',
  APPROVAL_NOT_FOUND: '审批请求已失效',
  PERMISSION_DENIED: '权限被拒绝',
  TRANSPORT_ERROR: '传输错误',
  INTERNAL: '内部错误',
} as const
```

#### 6.4 版本协商

`GET /health` 返回 `protocolVersion: 'ckp/1'`。
Render 启动时比对自身 `CKP_VERSION`：major 不一致 → 阻断并提示升级 App / 插件；minor 不一致 → 告警继续。

---

### 7. `client` 详细设计

#### 7.1 Transport 抽象

```ts
export interface Transport {
  call<P, R>(method: string, params: P, opts?: { signal?: AbortSignal }): Promise<R>
  subscribe(sessionId: string, fromSeq: number, onEvent: (e: CkpEvent) => void): Disposer
  readonly kind: 'http' | 'acp-stdio'
}
```

#### 7.2 SSE 重连（验收项 4 的实现）

```ts
// 指数退避 500ms → 1s → 2s → 4s → 8s（上限 8s，加抖动）
// 重连时必须带 lastSeq；服务端 ring buffer 命中则补增量
// 未命中（返回 GAP 事件）→ 全量重建：session.get + 从头回放持久化事件
```

#### 7.3 EventStore（事件源）

```ts
export function createStore(sessionId: string) {
  let events: CkpEvent[] = []
  let state: SessionState = initialState()

  return {
    append(e: CkpEvent) {
      if (events.some(x => x.seq === e.seq)) return   // 幂等去重
      events = [...events, e]
      state = rootReducer(state, e)
      persist(sessionId, events)                       // IndexedDB（节流 500ms）
      notify(state)
    },
    rebuild(es: CkpEvent[]) { /* 全量重放 */ },
    getState: () => state,
    subscribe(fn: (s: SessionState) => void): Disposer,
  }
}
```

**reducer 必须是纯函数**——这是单测友好与时间旅行调试的前提。

**SessionState 形状**：

```ts
interface SessionState {
  meta: Session
  messages: Message[]           // 流式 delta 合并进最后一条
  thinking: ThinkingBlock[]
  toolCalls: Record<string, ToolCall>
  approvals: PendingApproval[]
  fileChanges: FileChange[]
  checkpoints: Checkpoint[]
  status: 'idle' | 'running' | 'awaiting-approval' | 'done' | 'error' | 'cancelled'
  usage: { inputTokens, outputTokens, cost? }
  lastSeq: number
}
```

#### 7.4 乐观 UI（仅限用户消息）

```ts
// 用户点发送 → 立即 append 一个 seq = -1 的本地消息（status: 'sending'）
// 服务端回 confirm 或事件流中出现 message.user → 用真实 seq 替换
// 3s 未确认 → 标记 'failed' 并提供重试
```

**除用户消息外，一切状态服从事件流。**

---

### 8. `ui-kit` 详细设计

#### 8.1 组件清单与要点

| 组件 | 关键点 |
|---|---|
| `MessageList` | 虚拟滚动（`@tanstack/react-virtual`）；滚动到底/离底浮标；新消息自动跟随（用户上滑时暂停） |
| `Markdown` | 流式安全渲染（未闭合代码块要优雅处理）；代码高亮 Shiki；长输出默认截断 + 展开 |
| `ThinkingBlock` | 默认折叠，显示耗时；可展开查看思维链 |
| **`ToolCallCard`** | header：图标 + 名称 + 状态徽章 + 耗时；body：参数（JSON 树，默认折叠）、输出（虚拟滚动 + ANSI 着色）、diff 预览、错误堆栈。**状态：pending / running / success / error / denied** |
| **`ApprovalCard`** | 命令/参数预览 + 风险标记（写文件 / 执行 shell / 网络）+ 四个决策按钮 + 倒计时。**这是安全边界的可视化，不能简化成一个 Allow** |
| `DiffView` | unified / split 切换；语法高亮；大文件虚拟滚动；折叠未更改区域；支持按 hunk 选择 |
| `FileChangeList` | 按文件 keep / reject；显示增删行数；点击在右栏打开 diff |
| `CheckpointTimeline` | 纵向时间线；hover 预览；restore 二次确认（不可逆时红色警告） |
| `TrajectoryPanel` | 按 source 分组（系统提示 / 思维链 / 工具 / 子 agent / 上下文注入）；可展开原始 payload；搜索过滤 |
| `Composer` | `/` 命令菜单、`@` 提及自动补全（文件/符号/会话）、图片粘贴与拖拽、附件、多行输入（Enter 发送 / Shift+Enter 换行） |
| `SessionList` | 虚拟列表；搜索；pin / archive；显示最后消息摘要与状态点 |
| `StatusBar` | 连接状态、dsh 版本、当前模型、token 用量、运行耗时 |
| `CommandPalette` | `Cmd+K`；聚合会话搜索、`/` 命令、设置跳转 |

#### 8.2 性能预算

| 指标 | 目标 |
|---|---|
| 首屏可交互 | < 1.5s |
| 消息流滚动 | 60fps（1000+ 消息） |
| 流式 token 渲染 | 单块重渲染 < 8ms |
| 大 diff（5000 行） | 打开 < 500ms（虚拟滚动 + 折叠） |
| 冷启动恢复会话 | < 800ms（IndexedDB 事件回放） |

---

### 9. 关键时序

#### 9.1 冷启动

```text
App → SidecarManager.start()
    → 读 runtime.json
    → [命中且健康] 复用
    → [否则] spawn dsh --profile cursorkit --patch ...
         → host-dsh.apply(): probe → startServer → writeRuntimeFile
    → 等 runtime.json（≤30s）
    → IPC 传 { port, token } 给 Renderer
    → Renderer: GET /health（版本协商）→ GET /v1/capabilities → 渲染
```

#### 9.2 一次对话

```text
用户发送 → client.optimistic(本地消息)
        → POST /v1/rpc/session.send
        → host: compat.sessions.send()
        → dsh agent loop 运行
        → SessionBridge 翻译事件 → EventBus.emit（分配 seq）
        → SSE 推送
        → client.append → reducer → UI 更新
```

#### 9.3 流式节流

`message.delta` 可能极高频。host 侧按 **30ms 或 64 字符**合并后 emit；前端 reducer 只更新最后一个消息块，配合 `React.memo` 避免整列表重渲染。

#### 9.4 审批

```text
dsh 工具需审批 → ApprovalBridge 创建 PendingApproval(5min)
              → emit approval.request
              → UI 渲染 ApprovalCard
              → 用户点「允许本次会话」
              → POST /v1/rpc/approval.respond
              → resolve → emit approval.resolved
              → dsh 继续执行
超时 / 拒绝 → deny → emit approval.resolved(decision: 'deny')
```

#### 9.5 断线重连

```text
SSE 断开 → 退避重连（带 lastSeq）
        → 命中 ring buffer → 补增量 → 状态一致
        → 未命中 → 服务端发 GAP → 前端全量重建
dsh 进程崩溃 → 健康检查失败 → 自动重启 → Renderer 重连 → 回放
```

#### 9.6 关卡：restore / fork（M2）

```text
用户点某 checkpoint → 二次确认
→ POST /v1/rpc/checkpoint.restore
→ host: git reset/restore + 移动 session 指针
→ 生成新 fork trajectory（绝不覆盖历史）
→ 前端开新会话视图，从 fork 点重放
```

---

### 10. 横切关注点

#### 10.1 日志

- Rust 侧与 dsh stdout/stderr 落盘到 `$DSH_HOME/.cursorkit/logs/`，按 10MB × 5 滚动。
- 前端错误上报到本地日志文件（不做任何网络遥测）。
- 设置页提供「导出诊断包」（日志 + CapabilityReport + 协议版本 + App 版本）。

#### 10.2 安全

| 项 | 做法 |
|---|---|
| API Key | 只存 OS Keychain，**永不写明文配置文件** |
| RPC token | 每次启动轮换；`runtime.json` 权限 0600 |
| 网络 | server 只 bind `127.0.0.1`，拒绝非 loopback 来源 |
| 审批 | 默认**请求确认**；写文件 / shell / 网络三类操作按风险分级展示 |
| 前端 | CSP 禁用 inline script；Markdown 渲染禁用 raw HTML |

#### 10.3 可观测（本地）

- 每个 RPC 记录方法、耗时、结果码（本地环形缓冲 1000 条）。
- 设置页「开发者」面板可查看最近 RPC 与事件流，便于排查。

#### 10.4 本地持久化

| 数据 | 位置 | 说明 |
|---|---|---|
| 会话事件流 | IndexedDB（按 sessionId） | 冷启动秒开，也是全量重建的来源 |
| UI 偏好（布局、主题、折叠态） | localStorage | |
| API Key | OS Keychain | |
| dsh 配置 | dsh 自身的 profile / patch | 不另建一套配置体系 |

---

### 11. 构建与发布

#### 11.1 开发工作流

```bash
pnpm install
pnpm --filter @dsh-cursorkit/host-dsh build
pnpm --filter @dsh-cursorkit/protocol build
pnpm dev:desktop        # 起 Tauri + 前端 HMR + sidecar（link 到本地 dsh checkout）
```

**开发期强烈建议**把 `DSH_HOME` 指向一个独立目录（如 `.dsh-dev`），并 link 到本地 clone 的 dsh 源码，避免污染日常环境。

#### 11.2 打包

- Tauri：`tauri build`，sidecar 以外部命令形式调用（需 Node 已安装，或用 `pkg`/`sea` 打包 dsh）。
  > **`[待核验-5]`**：dsh 的分发形态（npm 包 `npx @deepseek-ai/dsh` vs 可打包二进制）。这直接决定 sidecar 是「要求用户装 Node」还是「自带 Node」。
- 代码签名：macOS Developer ID + notarization；Windows 可选。
- 自动更新：Tauri updater，通道 stable / nightly。

#### 11.3 CI

```
lint → typecheck → protocol schema snapshot → unit → contract(host-dsh × dsh) → build → e2e
```

`protocol` 的 JSON Schema 进 snapshot 测试，任何字段变更必须显式确认。

---

### 12. 测试策略

| 层 | 内容 | 工具 |
|---|---|---|
| `protocol` | Schema 快照；版本兼容性 | Vitest |
| `client` reducers | **纯函数单测**，用 `fixtures/*.jsonl` 事件流回放，断言最终 state | Vitest |
| `client` transport | mock HTTP server，测重连 / seq 续传 / GAP 重建 | Vitest + msw |
| `host-dsh` | **契约测试**：真实 dsh checkout 加载插件，调用每个 CKP 方法，断言不抛错且返回符合 schema | Vitest + 真实 dsh |
| `host-dsh` compat | 用 fake ctx 测「能力缺失时 fail-fast」 | Vitest |
| UI 组件 | 交互与视觉快照 | Vitest + Storybook / Playwright |
| E2E | 启动 App → 建会话 → 发消息 → 收流 → 审批 → 审查 diff | Playwright（web 版）/ tauri-driver |
| 混沌 | **kill sidecar → 自动重启 → 前端回放后状态一致** | 脚本 |

**`fixtures/` 是 UI 开发的加速器**：先造 3 组事件流（简单问答 / 多工具调用 / 含审批与错误），前端可脱离 dsh 独立开发。

---

### 13. 风险登记

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | dsh 无长驻非 web 运行模式 | 高 | 方案 B：复用 `dsh web --no-open`；或自建 profile 由 host 保活 |
| R2 | 插件内无法起 HTTP server | 高 | 挂到 dsh 内置 server 路由；再不行转 ACP stdio |
| R3 | `ctx.sessions` 事件 API 不符预期 | 高 | 轮询 `session-query` 兜底；最差退化为「任务结束后一次性拉取」 |
| R4 | dsh API 破坏性变更 | 中 | 唯一访问点 `compat/` + 能力探测 + 契约测试；锁 dsh commit |
| R5 | ACP 不足以支撑所需能力 | 中 | 已默认不用 ACP；`host-acp` 仅作远端备选 |
| R6 | dsh 分发形态导致打包复杂 | 中 | 优先「要求 Node」；M5 再评估自带 Node |
| R7 | 大会话前端性能 | 中 | 虚拟滚动 + 环形缓冲 + IndexedDB 增量持久化 |

---

### 14. 任务清单（按序执行，含依赖与验收）

> 标记 ★ 的是关键路径，阻塞后续任务。

#### M0 地基

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| **T-001** ★ | clone dsh 源码并跑通 `dsh web`，记录 commit；产出 `docs/dsh-capability-audit.md`，逐条回答 `[待核验-1~5]` | — | 文档含每个 API 的真实签名与源码行号引用 |
| **T-002** ★ | 建 pnpm workspace 与目录骨架（按 §4），每个包有 `package.json` + `tsconfig` + 空入口 | T-001 | `pnpm -r build` 通过 |
| **T-003** ★ | 实现 `protocol` 包：envelope / methods / events / errors / version + JSON Schema | T-002 | schema 快照测试通过 |
| **T-004** ★ | 用 `--patch` scratch overlay 跑通 hello-world dsh 插件，确认插件加载链路 | T-001 | `dsh --dump-config` 能看到插件行 |
| T-005 | 定 Shell（Tauri / Electron），空壳能启动并显示「未连接」 | T-002 | App 启动无报错 |

#### M1 对话闭环

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| **T-010** ★ | `host-dsh`：`capability.ts` + `compat/*` + `apply()` 骨架 + `runtime-file` | T-003, T-004 | 插件能加载并写出 `runtime.json`；缺能力时 fail-fast |
| **T-011** ★ | `host-dsh`：`rpc/server` + `auth` + `router` + `health` + `/v1/capabilities` | T-010 | `curl /health` 与 `/v1/capabilities` 正常，无 token 返回 401 |
| **T-012** ★ | `host-dsh`：`SessionBridge`（实现 1 或兜底）+ `EventBus` + SSE | T-011 | 用脚本触发一次会话，能收到带 seq 的事件流 |
| T-013 | `client`：`Transport.http` + `rpc.call` | T-003 | 单测：mock server 下各方法可用 |
| **T-014** ★ | `client`：`EventStore` + reducers + IndexedDB 持久化 | T-003, T-013 | reducer 单测：回放 fixture 得到预期 state |
| **T-015** ★ | `client`：`sse.ts` 重连 + seq 续传 + GAP 重建 | T-014 | 单测：断开 3s 后重连状态一致 |
| T-016 | `ui-kit`：`MessageList` / `MessageBubble` / `Markdown` | T-014 | 用 fixture 渲染，流式无闪烁 |
| **T-017** ★ | `ui-kit`：`ToolCallCard` + `ApprovalCard` | T-016 | 五种工具状态与四种审批决策均可交互 |
| T-018 | `features/chat` + `Composer` + `SessionList` + `StatusBar` | T-016, T-017 | 端到端跑通一次对话 |
| T-019 | Rust/Node 外壳：`SidecarManager` 状态机 + 健康检查 + 崩溃重启 | T-011 | kill sidecar 后 3s 内自动恢复，前端状态一致 |
| **T-020** ★ | M1 集成验收（GOAL §M1 五条） | T-018, T-019 | 五条全过，含断线重连与取消 |

#### M2 审查闭环

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| T-030 | `host-dsh`：`diff.get` + `file.changed` 事件 | T-012 | 真实跑一次改动能拿到 patch |
| T-031 | `ui-kit`：`DiffView`（虚拟滚动 + 折叠 + 语法高亮） | T-016 | 5000 行 diff 打开 < 500ms |
| T-032 | `ui-kit`：`FileChangeList`（keep / reject） | T-031 | 按文件操作生效 |
| T-033 | `plugins/cursorkit-checkpoint`：git 快照 + checkpoint 事件 | T-001 | 每次写入前生成 checkpoint |
| T-034 | `ui-kit`：`CheckpointTimeline` + restore 确认 | T-033 | restore 生成新 fork，不覆盖历史 |
| T-035 | `features/trajectory`：按 source 分组 + 原始 payload 展开 + 搜索 | T-014 | 四类 source 均可查看 |
| T-036 | `ui-kit`：`ThinkingBlock` | T-016 | 默认折叠，可展开 |
| T-037 | M2 集成验收 | T-030~T-036 | GOAL §M2 四条全过 |

#### M3 平台化

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| T-040 | Keychain 集成 + `config.get/set` | T-011 | 配置文件中无明文密钥 |
| T-041 | `features/settings`：模型 / MCP / 插件 / Skills / 权限 / 外观 / 关于 | T-040 | 各项可读写并生效 |
| T-042 | `mcp.list/add/remove` | T-011 | 添加后工具出现在 Agent 可用列表 |
| T-043 | `CommandPalette`（`Cmd+K`）+ `/` 命令 + `@` 提及补全 | T-018 | 三个入口可用 |
| T-044 | 诊断包导出 + 开发者面板 | T-011 | 一键导出日志与 CapabilityReport |
| T-045 | M3 集成验收 | T-040~T-044 | GOAL §M3 四条全过 → **MVP 完成** |

#### M4 / M5

| ID | 任务 |
|---|---|
| T-050 | `plugins/cursorkit-worktree` + UI 展示分支/状态 |
| T-051 | 多会话并行 + `best-of-n` + subagent 可视化 |
| T-052 | `ext-host`：插件 UI 贡献（renderers + commands） |
| T-053 | 多窗口 / 托盘 / 全局快捷键 / 自动更新 |
| T-054 | 大会话性能专项（虚拟滚动、增量持久化、内存） |
| T-055 | `host-acp`（远端/兼容传输） |

---

### 15. 执行纪律

> 完整十条见 **附录 C · 执行纪律速查卡**（含第 10 条安全默认值）。

1. **先核验，后编码**。`[待核验]` 项必须先读 dsh 源码；查不到写 `BLOCKED.md`，先做不依赖它的任务。
2. **契约先行**。`protocol` 的类型先于 `host-dsh` 与前端实现。
3. **永不改 dsh 源码**。
4. **凭据只进 Keychain**。
5. **乐观 UI 只用于用户消息**。
6. **reducer 必须是纯函数**。
7. 每完成一个里程碑产出 `docs/milestones/M{n}-report.md`：做了什么、验证了什么、BLOCK 了什么、偏差与理由。
8. 任何偏离本文档的决定必须写 ADR，**不得静默改向**。
9. 看到炫酷功能想加？先看它在 §14 里的编号；M3 之后的一律不动。

---

# 附录 A · 调研结论（事实依据）

> 来源：`dsh-cursorkit-调研报告.md`（基于 dsh 官方仓库/文档、Cursor 官方 changelog 与文档，调研截点 2026-09-08）。
> 本附录只保留对执行有直接影响的结论。完整版见独立报告。

## A.1 dsh 已确认具备的能力（可直接复用）

| 能力族 | 说明 |
|---|---|
| `core/` | Agent、Agent Loop、Tools 注册表 |
| `session/` | 会话持久化、checkpoint 策略、format、SQLite query |
| `fs/` `shell/` `terminal/` `subprocess/` | 文件、Shell、PTY、子进程能力缝 |
| `sandbox/` | bwrap、Landlock、Seatbelt 等进程隔离后端 |
| `skill/` | 注册、文件系统发现、模型面 loader（`tool-skill`） |
| `mcp/` | stdio / streamable-http MCP 客户端（**仅桥接 Tools**） |
| `subagent/` `workflow/` `jobs/` `acp/` | 子 Agent、工作流、后台任务、ACP server |
| `web/` `lsp/` | Web 搜索/抓取、LSP 能力缝 |
| `hooks/` | `hook-protocol` + Claude Code / Codex hooks.json 桥 |

**架构事实**：
- 插件 = 导出 `apply(ctx, config)` 的 JS/TS 模块；`inject` 声明服务依赖；注册皆为**可逆 effect**，卸载自动撤销。
- 三层配置：**Bundle**（`package.json` 含 `dsh.bundle` + `cordis.patch.yml`）→ **Profile**（`$DSH_HOME/profiles/<name>`）→ **Patch**（用户/命令行覆盖）。
- 会话日志 **append-only**，Trajectory 支持恢复 / 分叉 / 检索 / 回放。
- ACP = **automation-only** JSON-RPC stdio server（建会话、发消息、收更新、批权限、取消）。
- 插件发现靠 GitHub topic `dsh-plugin`，**无官方市场**。
- Web UI 默认 `http://127.0.0.1:3080`；`npx @deepseek-ai/dsh web`。

## A.2 未能证实的关键项（即 `[待核验]` 来源）

| 项 | 状态 |
|---|---|
| 稳定的 `ctx.ui.*` 面板注册 API | **未证实** |
| 官方 `index` 语义索引包 | **未证实存在** |
| 官方 worktree / checkpoint / rollback / best-of-n 包 | **未证实存在** |
| `turtle-ui` 具体形态 | **未证实** |
| 完整 hook 事件名与 payload（已知 `agent/pre-step`、`tools/pre-execute`） | 部分 |
| Cursor Hooks 完整 schema | **未证实** |

## A.3 差距矩阵（精简版：本项目范围内的能力）

| Cursor 能力 | dsh 现状 | 本项目对应 | 扩展点 | 优先级 |
|---|---|---|---|---|
| Chat / Agent 会话流 | 部分（Web UI + sessions） | `features/chat` + `client` | host 插件 + CKP | **P0** |
| 工具调用与审批可视化 | 部分 | `ToolCallCard` / `ApprovalCard` | `host-dsh` + CKP 事件 | **P0** |
| Trajectory 视图 | 有（dsh 原生） | `features/trajectory` | CKP 事件按 source 分组 | **P0** |
| Diff / keep-reject | 部分 | `DiffView` / `FileChangeList` | tool + git + UI | **P0** |
| Checkpoint / restore | 部分（session-checkpoint-policy） | `plugins/cursorkit-checkpoint` | session hook + git 快照 | **P0** |
| Codebase 检索 / @-mentions | 部分（grep / session-query） | `plugins/cursorkit-context` | tool + 可插拔 index | P1 |
| Git worktree 隔离 | 部分（可走 shell/git） | `plugins/cursorkit-worktree` | tool + lifecycle hook | P1 |
| Tab 补全 / inline edit | 无 | **不做**（非编辑器） | — | 不做 |
| Cloud Agents / Origin / 计费 | 无 | **不做**（基础设施资产） | — | 不做 |

## A.4 三条产品判断（影响设计取舍）

1. **产品形态偏 Codex Desktop 而非纯 Claude Desktop**。dsh 有 `subagent` / `jobs` / `workflow` / Trajectory 分叉，纯聊天壳会浪费这些差异化能力。做成「对话 + 多任务并行 + 事后审查」才对得起 dsh。
2. **UI 路线上，(a) dsh Web UI 插件、(c) 独立 Electron/Tauri 应用中，本项目选 (c)**。因为要做桌面级体验（原生窗口、Keychain、托盘、多窗口），Web UI 插件给不了；而 dsh 仍以 sidecar 子进程复用，不重复建设其能力。
3. **Tab 补全不可复制**。Cursor Tab 依赖本地模型 + 编辑器 buffer + 50–200ms 推断，经 RPC 往返无法复刻。本项目**完全不做编辑器**，只做只读 diff 审查。

---

# 附录 B · v1 为何作废

| | v1（作废） | v2（现行） |
|---|---|---|
| 定位 | 复刻 Cursor 编码体验 | dsh 的桌面客户端 |
| 编辑器 | 做 Tab / inline edit / LSP | **完全不做**，只做只读 diff |
| UI 路线 | Web UI 插件 + VS Code 扩展 | 独立桌面 App（Tauri/Electron）+ sidecar |
| 工程量 | 213 人日，含多项不可完成项 | MVP 62 人日，全部可做 |
| 最大风险 | dsh API 动荡 + Cursor 闭源资产 | 仅 dsh API 动荡（已由自有协议隔离） |

v1 的差距分析仍保留在独立调研报告中，作为「若未来要扩展编辑器能力」的参考。

---

# 附录 C · 执行纪律（速查卡）

1. **先核验，后编码**。`[待核验]` 项必须先读 dsh 源码；查不到写 `BLOCKED.md`，先做不依赖它的任务。
2. **契约先行**。`protocol` 的类型先于 `host-dsh` 与前端实现。
3. **永不改 dsh 源码**。一切通过插件 / ACP / MCP / 子进程实现。
4. **凭据只进 Keychain**，禁止明文落盘。
5. **乐观 UI 只用于用户消息**，其余一律服从事件流。
6. **reducer 必须是纯函数**。
7. 每完成一个里程碑产出 `docs/milestones/M{n}-report.md`：做了什么、验证了什么、BLOCK 了什么、偏差与理由。
8. 任何偏离本文档的决定必须写 ADR，**不得静默改向**。
9. 看到炫酷功能想加？先看它在任务清单里的编号；M3 之后的一律不动。
10. **安全默认值**：隔离、最小网络、无持久凭据、显式审批、执行后清理。「Agent 需要完成任务」不能成为绕过安全边界的理由。
