# dsh-cursorkit V2 决策记录（定稿版 v1.0）

> 状态：**全部定稿**（2026-09-09）。用户授权开发者全权决定。本文件是 V2 实现的唯一依据；后续修改走 ADR。
> 配套：`REFACTOR-PLAN.md`（路线规划）、本文档（决策明细）。

---

## 0. 全局前提 ✅

| 项 | 决定 |
|---|---|
| 路线 | **VSCode 扩展**（非 fork、非自建 Monaco） |
| 旧代码 | 已清空（git 历史在 tag `v1-legacy`）；**内核包 protocol/host-dsh/client 从 v1-legacy 恢复复用**（它们不是壳，是 dsh 集成层） |
| 参考基准 | Cursor 桌面版 `876.335.039`（2026-09）；只复刻 **IDE 窗口界面**，不参考 agent windows（Cloud Agents） |
| 目标用户 | 习惯 Cursor 的用户 → 布局/交互/快捷键一致，无痛迁移 |
| dsh 版本 | **固定 0.1.1-rc.2**（本机已验证） |
| 讨论方式 | 一次性定稿；后续改动须 ADR |

---

## 1. 技术栈与架构 ✅

### D1 技术栈
**TypeScript + esbuild（主扩展）+ React 18 + Vite（webview）**。tsc 仅类型检查。monorepo：`packages/`（内核）+ `extensions/vscode/`（扩展）。

### D2 dsh 版本
**固定 0.1.1-rc.2**。扩展内置 version 探测（capability），升级单独验证。

### D3 通信
**sidecar 进程（`dsh --profile cursorkit`）+ CKP over HTTP+SSE（127.0.0.1，token 认证）**。复用 V1 client SDK。

### D4 内核保留
**保留 host-dsh 插件 + CKP 协议**（从 v1-legacy 恢复）。host-dsh 是 sidecar 侧唯一 dsh 集成层；新增 `context.get` 方法供 IDE 上下文注入。

### D5 职责划分
- 扩展进程（Node）：sidecar 管理、CKP client、VSCode API 适配（diff/SCM/终端/快捷键/文件监听）
- webview（React）：Chat / Composer / Checkpoint / Settings 渲染
- 通信：`vscode.postMessage`（webview↔扩展）→ CKP（扩展↔sidecar）

---

## 2. 界面复刻（Cursor IDE 窗口）✅

### D6 界面元素清单 —— 全部做
1. 活动栏 AI 图标（Chat/Composer 入口）
2. Chat 面板：Ask/Edit/Agent 模式切换、多会话列表、消息流、输入框 @提及、模型选择器、发送/停止
3. Composer 面板：多文件编辑、计划→逐文件 diff→应用/撤销
4. Tab 补全：编辑器内 ghost text，Tab 接受（InlineCompletionProvider）
5. Ctrl+K 行内编辑：选中→输入→内联 diff 接受/拒绝
6. Checkpoint 时间线：消息旁图标→回滚
7. Rules：`.cursorrules` + `.cursor/rules/*.mdc`
8. Settings：模型 / Rules / Features 标签页
9. 底部状态栏：模型名、连接状态、Tab 开关
10. 命令面板 Cmd+Shift+P 的 AI 命令（New Chat / Edit Code / Toggle Tab 等）

### D7 Chat 面板交互
- 多线程会话（新建/切换/删除/重命名/自动保存恢复）
- @提及：**@file / @folder / @codebase**（MVP）；@web/@docs 后置（需联网搜索）
- Ask/Edit/Agent 三模式（见 D15）

### D8 Tab 补全 —— 做
- `InlineCompletionProvider` + 模型 streaming（走 sidecar agent）
- 节流：停止输入 200ms 后触发；上下文 = 当前文件 + 打开的编辑器（≤8k tokens）；行内/多行 ghost text
- 成本控制：每会话可关闭；默认开启

### D9 Ctrl+K 行内编辑 —— 做
- 选中文本 → Ctrl+K → 输入指令 → agent 生成替换 → 内联 diff 接受/拒绝/重新生成

### D10 @codebase 索引
- **MVP：ripgrep 文本/符号检索**（零依赖，后台进程）；embedding 后置
- 触发：@codebase 或 Cmd+Shift+F 风格检索；结果注入 prompt

### D11 Checkpoint 时间线 —— 做
- 复用 git-checkpoint：每次 agent 改动后自动 checkpoint；消息旁时间线图标；回滚/对比

### D12 Rules —— 兼容 Cursor
- `.cursorrules`（项目根 + `~/.cursorrules` 全局）+ `.cursor/rules/*.mdc`（frontmatter: description/globs）
- 注入 system prompt；settings 面板可视化编辑

### D13 终端集成 —— MVP 不做
- 后置（P2）：agent 读 VSCode 集成终端输出需终端 API 适配，MVP 由 agent 命令执行代替

### D14 主题
- **跟随 VSCode 主题**（深浅自动）：webview 用 CSS 变量映射 VSCode 主题色

---

## 3. Agent 执行与 dsh 集成 ✅

### D15 三模式 → dsh 能力映射
- **Ask**：纯问答 —— dsh 会话，无工具/只读（`session.send` + context）
- **Edit**：单文件行内修改 —— 选中块 + diff 应用（`diff.get` + 编辑器 workspace.edit）
- **Agent**：多文件自动执行 —— dsh agent-loop（多 agent 并行可选）+ worktree 隔离 + 审批 + checkpoint
- 模式切换 = 不同 agent 配置（`agent-loop` 声明式配置），同一 sidecar

### D16 权限/审批 UI
- **默认 `danger-full-access`**（Cursor 风格自动执行，无逐次弹窗）
- dsh approval 事件 → **Chat 内审批卡片**（确认/拒绝/总是允许）；settings 可调权限档
- 写文件仍受 dsh sandbox 策略约束（sidecar 内）

### D17 模型选择器
- 读 settings.yaml providers（wps/deepseek/moonshot…）→ Chat 底部选择器 provider×model
- 每会话独立记忆选择；全局默认在 settings 设置

### D18 上下文注入
- 自动：当前选中 + 打开编辑器（可开关）
- 手动：@file / @folder / @codebase 检索
- host-dsh 新增 `context.get` 方法（读取 VSCode 传入的上下文文件列表）

---

## 4. 数据与状态 ✅

### D19 会话存储
- **独立 JSON 文件**（`~/.dsh-cursorkit/sessions/*.json`，schema 版本字段）——数据自主、可备份迁移；VSCode globalState 只存 UI 偏好

### D20 多窗口/多会话
- **单 sidecar 共享**（loopback 多 client 连接同一 sidecar）；多窗口 = 多 webview 视图
- 多会话并行 agent：worktree 隔离（复用 V1 已验证能力），MVP 后置 UI，先有 API

---

## 5. 分发与命名 ✅

### D21 分发
- `vsce package` → `.vsix`；`scripts/install.sh` 检查 node+dsh+凭据 → `code --install-extension`
- GitHub Actions 三平台 vsix 构建矩阵（后置，MVP 先本地构建）

### D22 命名
- **保持 `dsh-cursorkit`**：扩展显示名 "DSH CursorKit"；仓库/scope 不变

---

## 6. 里程碑 ✅

### D23 里程碑（MVP 范围，全部必须完成才算交付）
- **M0** 骨架：monorepo + 扩展激活 + sidecar 管理 + Chat 面板打通（消息流/工具卡片/停止/重连）
- **M1** 上下文与审查：@file/@codebase + diff 集成（SCM/接受拒绝）+ checkpoint 时间线 + 三模式
- **M2** Composer：多文件 agent 计划 → 逐文件 diff → 应用/撤销
- **M3** 智能与配置：Tab 补全 + Ctrl+K + Rules + 模型选择器 + Settings 面板
- **M4** 分发：vsix + install.sh + README（含 wps 凭据配置）+ 三平台验证

---

## 7. 工程补强（审视新增）✅

### D24 首启引导（onboarding）
- 首次激活：检测 node / dsh / 凭据 → 未就绪显示引导视图（复制安装命令 / 填凭据表单 / 测试连接按钮）

### D25 执行中交互
- Chat 内：停止按钮 + 工具卡片实时进度 + **steer**（agent 执行中输入 follow-up，等待下一工具调用时注入，Cursor 2026 同款）+ token 估算

### D26 键盘冲突
- **Ctrl+K**：`when: editorTextFocus && !suggestWidgetVisible`（VSCode 组合前缀问题：单按 Ctrl+K 与组合键共存，用 setTimeout 判定）
- **Tab**：InlineCompletion API 原生处理（不抢缩进）
- **Cmd+Enter**：Chat 发送；全部键位可在 settings 覆盖

### D27 多项目/多工作区
- multi-root：agent cwd = active editor 所在 workspace root；无 active → 第一个 root；每 root 独立索引/会话
- 状态栏显示当前 agent cwd

### D28 外部编辑冲突
- 写文件前检查文档 dirty 状态；冲突时 Chat 提示"文件已被修改"，提供"覆盖/跳过/手动合并"

### D29 容错矩阵
| 故障 | 策略 |
|---|---|
| sidecar 崩溃 | 自动重启（指数退避 ≤5 次），Chat 显示重连中 |
| SSE 断线 | 事件游标续传（V1 已验证） |
| 模型限流/超时 | 退避重试 2 次 → 明确报错 |
| wps 不可达 | 错误卡片 + 引导检查凭据/网络 |
| dsh 版本不符 | capability 探测 → 提示升级 |

### D30 性能
- webview 虚拟滚动（长会话分页渲染，DOM 节点上限 ~500）
- 大 diff 按文件拆分；@codebase 检索后台进程 + 结果截断
- 索引/检索绝不阻塞 UI

### D31 测试策略
- 单元：protocol / reducer / 决策纯函数（vitest）
- 集成：扩展↔真实 sidecar（wps 或 mock provider，复用 V1 fixture 思路）
- webview 组件：vitest + jsdom
- E2E 后置：vscode-extension-tester（可选）

### D32 i18n
- **跟随 VSCode locale**（zh-CN / en 双语资源，vscode-nls）；MVP 先中文 + 英文兜底

### D33 升级与迁移
- 会话 JSON 带 `schemaVersion`，扩展升级时迁移函数链；dsh 能力探测
- 卸载：清理 sidecar 进程（保留用户数据，提示手动删除）

### D34 安全基线
- 凭据（WPS_API_KEY）存 **VSCode SecretStorage**；sidecar 启动时注入 env
- webview 严格 CSP（无内联脚本）；loopback 随机端口 + token 认证（V1 已有）
- 凭据永不出现在 agent 上下文/日志

### D35 用量与成本
- Chat 底部显示当前会话 token 估算；settings 累计统计（本地计算，不依赖计费 API）

### D36 会话数据格式
```jsonc
{ "schemaVersion": 1, "id": "...", "workspace": "...", "createdAt": "...",
  "model": "wps/kimi...", "mode": "ask|edit|agent",
  "messages": [{ "role", "content", "toolCalls?", "checkpointId?", "ts" }] }
```
- 增量追加（append-only + 压缩可选）；checkpoint 通过 `checkpointId` 关联

---

## 8. 开发顺序（细粒度 git）
1. 恢复内核包（protocol/host-dsh/client）+ 根 workspace 配置
2. M0 骨架与 Chat 打通（每功能一 commit）
3. M1 上下文与审查闭环
4. M2 Composer
5. M3 智能与配置
6. M4 分发与文档
7. 测试贯穿；每 milestone 收尾跑全部测试 + 更新 README/台账

---

## 9. 实现状态（2026-09-10）

**全部里程碑已完成并验证**，231 测试全绿 + 真实 dsh/wps 端到端验证通过（详见 `docs/BUG-REPORT.md`）。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 扩展骨架 + sidecar + Chat 面板 + 动态 agent 全链路 | ✅ verify-m0 真实通过 |
| M1a | 上下文注入（context.get + @file + 选中） | ✅ |
| M1b | 审查闭环（改动列表 → diff → 还原） | ✅ |
| M1c | Checkpoint 时间线 | ✅ |
| M1d | Ask/Edit/Agent 三模式 | ✅ |
| M2 | Composer（多会话 + 计划视图 + markdown 渲染） | ✅ |
| M3a | 模型选择器（真实 settings 解析 16 模型） | ✅ verify-m3 真实通过 |
| M3b | Ctrl+K 行内编辑 | ✅ |
| M3c | Tab 补全（InlineCompletionProvider） | ✅ |
| M3d | Rules（.cursorrules/.mdc/~/.cursorrules） | ✅ |
| M4a | Settings 面板 | ✅ |
| M4b | vsix 打包 + install.sh | ✅ vsix 202KB 打包成功 |
| M4c | README + 全量测试 + 验收 | ✅ |

**关键实现细节**（供后续维护）：
- dsh 动态 agent：`session.create` 直接用 `ctx.agents.create`（factory 内部建 session+agent），
  不能先 `sessions.create`（id 冲突）；session id 用唯一格式
- agent-loop 由 dsh-base 提供（不能 insert，profile 层只能顶层覆盖配置）
- host-dsh 包内 cordis.patch.yml 只声明 host 插件（bundle 自动加载）；profile 层 patch 为占位
- model.list 读 `$DSH_HOME/settings.yaml` 的 llm-pi-ai.providers（轻量 YAML 扫描）
- vitest 的 node:http 对 SSE 流式响应有限制 → fixtures 测试用 bus 直驱 store，
  SSE 端到端由 verify-m0.mjs（真实进程）验证
- 扩展数据目录 `~/.dsh-cursorkit`（CK_DSH_HOME 覆盖），绝不用 ambient DSH_HOME
