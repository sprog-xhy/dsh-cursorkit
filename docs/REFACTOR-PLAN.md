# dsh-cursorkit 重构规划：Cursor 同款 AI IDE（V2）

> 版本：0.1（讨论稿）
> 目标读者：开发者本人
> 状态：**待讨论** —— 文末「决策点」需要逐项拍板后冻结为 v1.0 执行版

---

## 1. 为什么重构（现状诊断）

M0–M5 交付的是 **Claude Desktop 风格的聊天客户端**：对话为中心、三栏布局、浏览器/Electron 壳。
实际使用后与「Cursor 同款」的差距在于：

| 维度 | 现在（V1） | Cursor 同款（V2 目标） | 差距 |
|---|---|---|---|
| 编辑器 | ❌ 无编辑器 | ✅ 完整 IDE：语法高亮/LSP/跳转/多标签 | 致命 |
| 改代码流程 | agent 写文件 → 看文本 diff | 编辑器内 diff 视图 → 逐块接受/拒绝 | 大 |
| 上下文注入 | 手动贴文件 | @文件 / 当前选中 / 打开编辑器 / @codebase | 大 |
| 行内编辑 | ❌ | Ctrl+K 选中即改、Tab 补全 | 大 |
| 代码库搜索 | ❌ | @codebase 语义/符号检索 | 大 |
| Rules | ❌ | .cursorrules / 全局 rules 注入 | 中 |
| 终端/构建 | ❌（无集成） | 读终端输出、跑测试 | 中 |
| 多会话并行 | ✅ worktree | ✅（保留） | 无 |
| Checkpoint 回滚 | ✅ 文本列表 | ✅ 时间线 UI + 逐版本还原 | 小 |
| 审批/权限 | ✅ | ✅（保留） | 无 |
| 多模型 | ✅ wps/deepseek/moonshot | ✅（保留 + 面板） | 无 |

**结论**：内核（dsh agent-loop、权限、checkpoint、worktree、多 provider）是强项且可完整复用；
壳层（自建 React 三栏 + Electron/浏览器）方向错了 —— 用户要的是「在 IDE 里工作」，不是「在聊天窗里看文件」。

---

## 2. 技术路线对比（核心决策）

| 路线 | 做法 | 优点 | 缺点 | 工作量 |
|---|---|---|---|---|
| **A. VSCode 扩展（推荐）** | 以标准 VSCode 为载体，开发扩展「dsh-cursorkit」，dsh 内核跑 sidecar | IDE 能力全免费（编辑器/LSP/SCM/终端/多窗口/主题）；开发快（F5 调试）；分发简单（vsix）；升级跟随 VSCode | UI 深度定制受 VSCode 框架限制（但 webview 自由度已足够做 Chat/Composer）；不能改 VSCode 本体 | **最小，数周出 MVP** |
| B. Fork VSCode（Cursor 真做法） | clone microsoft/vscode，改 product.json + 内置扩展 | 完全掌控，可深度改编辑器 | 构建极重（编译 30–60min）、升级跟踪难、长期维护成本高 | 最大，个人项目不现实 |
| C. Electron + Monaco 自建（现状升级） | 把 Monaco 嵌进现有壳，自建文件树/终端/SCM | 不依赖 VSCode | 等于重造半个 VSCode（文件树/SCM/终端/LSP/多窗口…），永远落后 | 巨大 |

**推荐 A**，理由：
1. Cursor 的核心竞争力是 **AI 层**（agent 执行、上下文、审查、回滚），不是 IDE 层；IDE 层 VSCode 已是全球最好且 MIT 开源。
2. 业界同款开源产品（Continue、Cline、Roo Code）全是扩展路线，已被验证可行。
3. 我们 70% 资产（protocol / host-dsh / client / sidecar 管理）直接复用，重构只发生在「壳」。
4. 未来若想做成独立产品，可走 **VSCodium fork 打包**（把扩展打进独立应用的轻量 fork），那是路线 B 的降级版，风险可控。

---

## 3. 目标架构（V2）

```
┌─────────────────────────── VSCode (host) ───────────────────────────┐
│                                                                      │
│  Extension (@dsh-cursorkit/vscode)  [Node 侧]                        │
│  ├─ commands       /chat  /agent  /inline-edit  /accept  /reject …  │
│  ├─ sidecar manager 拉起/监控 dsh 进程（复用 desktop 壳逻辑）         │
│  ├─ client SDK     CKP over HTTP+SSE（复用 packages/client）          │
│  ├─ ide-bridge     VSCode API 适配层                                  │
│  │   ├─ @mentions: 当前选中/打开文件/文件树/搜索                      │
│  │   ├─ diff:      agent 改动 → vscode.diff / SCM 面板 接受·拒绝      │
│  │   ├─ file.watch: file.changed 事件 → 自动打开/标记 SCM             │
│  │   └─ terminal:  读集成终端输出（agent 可见）                       │
│  └─ webview host   ChatPanel / ComposerPanel / CheckpointPanel        │
│                     （React + 复用 reducer/selectors + ui-kit 卡片）   │
│                                                                      │
│  Webview (沙箱)                                                       │
│  ├─ ChatView       重写为 Cursor 质感（消息流 + 工具卡片 + 停止）      │
│  ├─ AgentView      Composer 多文件编辑（计划 → 逐文件 diff → 应用）    │
│  ├─ CheckpointView 时间线回滚 UI                                      │
│  └─ SettingsView   模型/Provider/Rules 管理（复用 settings 逻辑）     │
└──────────────────────────────────────────────────────────────────────┘
                        │ CKP (HTTP+SSE, 127.0.0.1, token)
                        ▼
        sidecar: dsh --profile cursorkit（host-dsh 插件，完全复用）
        ├─ agent-loop（多 agent 并行，复用）
        ├─ capability 探测 / fail-fast（复用）
        ├─ RPC: diff.get / checkpoint.* / worktree.* / file.*（复用）
        ├─ approval / 权限（复用）
        └─ providers: wps / deepseek / moonshot（复用 settings.yaml）
```

**关键原则**：
- **CKP 协议一行不改**，扩展与 sidecar 之间唯一契约不变 → sidecar 侧零重构。
- **host-dsh 插件零改动**（或仅按需加 1–2 个方法，如 `context.get` 让 agent 读 VSCode 选中内容）。
- 重构聚焦三层：**扩展骨架**（新）、**ide-bridge**（新）、**webview UI**（重写，逻辑复用）。

---

## 4. 资产复用清单

| 现有资产 | 处置 | 说明 |
|---|---|---|
| `packages/protocol` | ✅ 原样复用 | CKP 契约，唯一共享层 |
| `packages/host-dsh` | ✅ 原样复用 | sidecar 插件；可选新增 `context` 方法 |
| `packages/client/transport/http.ts` | ✅ 复用 | SSE 断线续传/重连 |
| `packages/client/store/*`（reducer/selectors/optimistic） | ✅ 复用 | webview 内继续用事件源渲染 |
| `apps/desktop` sidecar 管理 + Keychain 逻辑 | 🔄 提取为共享模块 | 迁移进扩展（启动/轮询 runtime.json/密钥读取）；Electron 壳本身废弃或转为「独立分发」入口 |
| `packages/features` 三栏页面 | ❌ 重写 | 变为 webview 面板（Chat/Composer/Checkpoint/Settings） |
| `packages/ui-kit` ToolCallCard/ApprovalCard | 🔄 移植 | 样式体系保留，进 webview |
| `apps/web` | ❓ 待定 | 保留为无 IDE 时的调试兜底，或废弃（决策点 5） |
| `scripts/*`（验收/并行实证） | 🔄 改造 | 验收脚本改为扩展集成测试（vsix + 无头 VSCode） |

---

## 5. 里程碑规划（单人，估算）

> 估时按每天 3–4h 有效开发。每里程碑有**可演示验收标准**，做完一个再进下一个。

### M0 骨架与消息打通（≈1 周）
- vsce 扩展脚手架（TS + esbuild），`dsh-cursorkit` 扩展激活
- sidecar manager 迁入扩展：启动 `dsh --profile cursorkit`、轮询 runtime.json、token 读取
- `/chat` 命令打开 ChatPanel webview，走完整 CKP 消息流（wps 模型流式回复、工具卡片、停止）
- 验收：`F5` 调试扩展 → `/chat` → 真实对话 + 工具调用 + 断线重连

### M1 IDE 上下文与审查闭环（≈1 周）
- ide-bridge：@文件 / 当前选中 / 打开编辑器 → 注入 agent 上下文（`context.get`）
- diff 集成：agent 写文件 → `file.changed` → VSCode SCM / `vscode.diff` 打开 → 逐块接受/拒绝
- checkpoint 时间线：CheckpointPanel 列出版本、一键还原、对比两版本
- 验收：让 agent 改一个函数，编辑器内看到 diff，逐块接受/拒绝，还原 checkpoint

### M2 Agent 模式（Composer）（1–2 周）
- `/agent` 多文件任务：dsh agent-loop 多 agent 并行（复用 worktree best-of-n）
- 计划视图 → 每个文件独立 diff → 全部/逐文件应用、撤销
- 长任务进度：阶段状态、当前文件、工具调用流
- 验收：一个跨 3 文件的重构任务，计划 → 执行 → 逐文件审查应用全流程

### M3 代码库智能与 Rules（≈1 周）
- @codebase：ripgrep 符号/文本检索（零依赖；决策点 3 可升级 embedding）
- Rules：项目 `.cursorrules` / 全局 rules → 注入 system prompt（复用 settings 管理）
- 多模型切换面板（wps/deepseek/moonshot，复用 settings.yaml）
- 验收：@codebase 找到符号定义；rules 影响 agent 行为；面板切模型

### M4 体验补齐（1–2 周，可按需裁剪）
- Ctrl+K 行内编辑（选中 → agent 改 → 内联 diff 接受/拒绝）
- Tab 补全（InlineCompletionProvider；需决策点 2）
- 终端集成（读集成终端输出给 agent，需决策点 4）
- 多窗口/多会话并行面板（复用 worktree）
- 验收：以上各一条真实演示

### M5 分发与文档（≈1 周）
- vsix 打包 + `--install-extension` 一键安装脚本（node+dsh+凭据前置检查）
- Windows / macOS 上 VSCode 可用性验证（三平台文档）
- 旧资产清理与 repo 整理、验收脚本迁移
- （可选）GitHub Actions 三平台 vsix 构建矩阵

**总计约 6–9 周**；M0–M2 是核心（可用的 AI IDE 雏形），M3–M5 是增强与分发。

---

## 6. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| VSCode webview 沙箱限制（消息过大/二进制） | 中 | 大 payload 走 sidecar 文件 + 引用传递 |
| dsh agent-loop 读不到 VSCode 上下文 | 中 | ide-bridge 显式注入；`context.get` 新方法 |
| Tab 补全质量依赖模型，成本高 | 中 | MVP 跳过，用 Ctrl+K 替代（决策点 2） |
| 扩展与 dsh 版本耦合（dsh 0.1.1-rc） | 低 | sidecar 版本探测 + 兼容层已有（capability 探测） |
| 单人开发周期拉长 | 中 | 严格里程碑切割，先 M0–M2 出可用版 |

---

## 7. 决策点（请拍板）

1. **载体路线**：A. VSCode 扩展（推荐） / B. Fork VSCode 独立应用 / C. 扩展先行 + 后续 VSCodium fork 打包成独立产品？
2. **Tab 补全**：M4 做（InlineCompletionProvider，成本高）还是跳过（用 Ctrl+K 行内编辑替代）？
3. **@codebase 索引**：轻量 ripgrep+符号（零依赖，够用）还是上 embedding 向量检索（要本地模型/API）？
4. **终端集成**：M4 读 VSCode 集成终端输出给 agent？还是暂不做（agent 通过命令执行已够）？
5. **旧 apps/web + Electron 壳**：废弃？保留为「无 IDE 的轻量兜底」？还是未来做「独立分发」入口？
6. **命名**：产品还叫 dsh-cursorkit，还是换品牌名（如 DSH IDE / dsh-cursor）？
7. **首个里程碑节奏**：先做 M0+M1（1 周出「能在 IDE 里审查 agent 改动」的最小闭环）给你体验，再决定 M2 细节？

---

## 8. 下一步

1. 对第 7 节逐项回复（可只回编号+选择）
2. 我冻结规划为 v1.0 执行版，提交 git，从 M0 开工
