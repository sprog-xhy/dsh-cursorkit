# dsh-cursorkit V2 决策记录（逐项确认）

> 本文件是 V2 重构的**唯一决策台账**：每确定一项，立即追加到对应小节并标记 ✅；未定项保持 ⏳，等待讨论。
> 配套文档：`REFACTOR-PLAN.md`（路线规划，V2 版）、本文档（决策明细）。
> 更新规则：用户确认后由开发者立即写入；本文件是 git 提交的一部分。

---

## 0. 已确定的全局前提 ✅

| 项 | 决定 | 确认时间 |
|---|---|---|
| 路线 | **VSCode 扩展**（非 fork、非自建 Monaco） | 2026-09-09 |
| 旧代码 | **全部清空**（apps/packages/fixtures/scripts 已删除，git 历史保留在 tag `v1-legacy`，提交 `79ed9ff`） | 2026-09-09 |
| 参考基准 | **Cursor 桌面版最新稳定**：`876.335.039`（2026-09 版，changelog 2026-09-02） | 2026-09-09 |
| 界面范围 | **只复刻 Cursor 的 IDE 窗口界面**（Chat 面板 / Composer / Tab 补全 / Ctrl+K / Checkpoint / Rules / Settings）；**不参考** Cursor 的 agent windows（Cloud Agents / 云端桌面） | 2026-09-09 |
| 目标用户 | 习惯 Cursor 的用户 → UI 布局、交互、快捷键与 Cursor 一致，**无痛迁移** | 2026-09-09 |
| 讨论方式 | 一次讨论完备，逐项确认，每项立即写入本文档；之后只做小修改 | 2026-09-09 |

---

## 1. 技术栈与架构决策

### D1 扩展技术栈 ⏳
- 语言：TypeScript（必须）
- 构建：esbuild（VSCode 扩展事实标准，快）还是 tsc？
- Webview UI：React（成熟、可复用组件经验）还是原生 TS + DOM？
- 推荐：TS + esbuild + React 18（webview 沙箱内渲染）

### D2 dsh 版本固定 ⏳
- 候选：`0.1.1-rc.2`（本机已装、全部能力已实测验证：事件结构/权限/插件 API/approval）
- 候选：`0.1.5-alpha.1`（npm 最新，但 alpha 阶段，API 可能变动）
- 推荐：**固定 0.1.1-rc.2**（已验证稳定；升级留待后续单独验证）

### D3 扩展↔sidecar 通信方式 ⏳
- 候选 A：sidecar 进程（`dsh --profile`）+ CKP over HTTP+SSE —— 隔离好，复用 host-dsh 插件
- 候选 B：扩展进程内嵌 dsh 库调用 —— 无独立进程，但依赖 dsh Node API 暴露程度
- 推荐：**A（sidecar + CKP）**，与 V1 相同，host-dsh 插件整体保留

### D4 是否保留 host-dsh 插件 / CKP 协议 ⏳
- 推荐：**保留**（sidecar 侧唯一 dsh 集成层：capability/approval/checkpoint/worktree/diff），VSCode 扩展只做"IDE 适配层"，不碰 dsh 内部

### D5 webview 与扩展进程职责划分 ⏳
- 扩展进程（Node）：sidecar 管理、CKP client、VSCode API 适配（diff/SCM/文件监听/终端/快捷键）
- webview（React）：Chat / Composer / Checkpoint / Settings 面板渲染
- 通信：`vscode.postMessage`（webview ↔ 扩展进程）→ CKP（扩展进程 ↔ sidecar）
- 推荐：如上分层

---

## 2. 界面复刻（Cursor IDE 窗口）

### D6 界面元素清单（待确认哪些做/不做） ⏳
Cursor 876.x IDE 窗口核心元素：
1. 活动栏 AI 图标（Chat/Composer 入口）
2. Chat 面板（侧边栏）：Ask/Edit/Agent 模式切换、多会话列表、消息流、输入框 @提及、模型选择器、发送/停止
3. Composer 面板：多文件编辑、计划 → 逐文件 diff → 应用/撤销
4. Tab 补全：编辑器内灰色 ghost text，Tab 接受
5. Ctrl+K 行内编辑：选中 → 输入 → 内联 diff 接受/拒绝
6. Checkpoint 时间线：消息旁时间线图标 → 回滚
7. Rules：`.cursorrules` / `.cursor/rules/*.mdc`
8. Settings：模型 / Rules / Features / MCP 标签页
9. 底部状态栏：模型名、索引状态、Tab 开关
10. 命令面板 Cmd+Shift+P 的 AI 命令

### D7 Chat 面板交互细节 ⏳
- 多线程会话（新建/切换/删除/重命名）？
- @提及范围：@file / @folder / @codebase / @web / @docs / @diff / @terminal？
- Ask（问答）/ Edit（单文件改）/ Agent（多文件自动执行）三模式映射到 dsh 什么能力？

### D8 Tab 补全 ⏳
- 做不做？（Cursor 用户核心肌肉记忆）
- 实现：InlineCompletionProvider（VSCode API）走模型 streaming；质量依赖模型与上下文
- 成本：每次击键触发 → token 成本高；需节流/延迟策略

### D9 Ctrl+K 行内编辑 ⏳
- 做（VSCode 扩展可完整实现：选中 → 输入 → 内联 diff）

### D10 @codebase 索引 ⏳
- 轻量：ripgrep 文本/符号检索（零依赖）
- 增强：TS 符号索引 / embedding 向量
- 推荐：先 ripgrep，MVP 够用

### D11 Checkpoint 时间线 ⏳
- 做：复用 git-checkpoint（每次 agent 改动后自动 checkpoint + 消息旁时间线图标 + 回滚）

### D12 Rules ⏳
- 兼容 `.cursorrules`（项目/全局）与 `.cursor/rules/*.mdc`？还是只用自研格式？
- 推荐：兼容 `.cursorrules`（无痛迁移核心）

### D13 终端集成 ⏳
- agent 读 VSCode 集成终端输出？做不做

### D14 主题 ⏳
- 跟随 VSCode 主题（深/浅自动）还是固定深色？

---

## 3. Agent 执行与 dsh 集成

### D15 agent 三模式 → dsh 能力映射 ⏳
- Ask：纯问答（dsh 对话，无工具或只读工具）
- Edit：选中文件行内修改（diff 应用）
- Agent：多文件自动执行（dsh agent-loop + worktree/权限 + 审批）
- 需要确认：模式切换是否严格对应 dsh 不同 agent 配置

### D16 权限/审批 UI ⏳
- dsh approval 事件 → 如何在 IDE 呈现？（VSCode 通知？Chat 内审批卡片？）
- 默认权限档：`danger-full-access`（Cursor 风格：自动执行）还是需要用户逐次批准？

### D17 模型选择器 ⏳
- 展示/切换 provider×model（wps / deepseek / moonshot 等，读 settings.yaml）
- 每会话独立模型？全局默认？

### D18 上下文注入 ⏳
- 当前选中 / 打开编辑器 / @file / @codebase 如何拼进 prompt？
- 需要 host-dsh 新增 `context.get` 方法？

---

## 4. 数据与状态

### D19 会话存储 ⏳
- VSCode `globalState/workspaceState`（简单，随扩展走）
- 还是独立 JSON 文件（`~/.dsh-cursorkit/sessions/`，可迁移/备份）
- 推荐：独立 JSON 文件（数据自主可控，不锁死在 VSCode 存储）

### D20 多窗口/多会话并行 ⏳
- 复用 worktree（V1 已验证）？多窗口 = 多 sidecar 还是共享 sidecar？

---

## 5. 分发与命名

### D21 分发方式 ⏳
- vsix 打包 + 一键安装脚本（检查 node+dsh+凭据）
- GitHub Actions 三平台 vsix 构建矩阵？

### D22 命名/品牌 ⏳
- 继续 `dsh-cursorkit`？还是新品牌名（如 DSH IDE / dsh-cursor / cursor-dsh）？
- 扩展显示名 / 图标 / 市场描述

---

## 6. 里程碑节奏

### D23 里程碑划分 ⏳
- 候选：M0 骨架+Chat 打通 → M1 上下文+diff 审查 → M2 Composer → M3 codebase+Rules → M4 Ctrl+K+Tab → M5 分发
- 用户要求"一次性讨论完备，之后只做小修改"→ 是否需要更细的前置冻结（UI 规格先行）？

---

## 7. 待用户确认后填充
（每一项确认后，把"⏳"改为"✅ 决定：…"，并记录日期）
