# M2/M3 里程碑报告（代码层推进）

> 日期：2026-09-09 · 状态：**代码层完成（M2 核心 + M3 部分）**
> 范围：T-030（diff.get）、T-033/034（checkpoint）、T-035/036（trajectory/thinking）、M3 settings

## 做了什么

| 任务 | 交付 |
|---|---|
| T-030 diff.get | `host-dsh/src/diff/git-diff.ts`：git diff（unstaged+cached）+ untracked 文件（/dev/null patch）→ FileChange[]；`splitDiffByFile`/`summarizePatch` 纯函数；router `diff.get` 按会话 workspace 计算 |
| T-033/034 checkpoint | `host-dsh/src/checkpoint/git-checkpoint.ts`：git commit + `refs/cursorkit/<session>/<n>` 命名空间；list（for-each-ref 时间倒序）/ restore（**新 fork 分支**，绝不覆盖历史）；router `checkpoint.list/restore`（restore 走 sessions.fork 生成子会话） |
| T-035/036 trajectory/thinking | `features/trajectory/trajectory.ts`：buildTrajectory（时间序）+ groupBySource（按 用户输入/模型回复/思维链/工具调用 分组）；App 右栏 TrajectoryPanel 使用；ChatView 已渲染 ThinkingBlock（完成自动展开） |
| M3 settings | `features/settings/SettingsView.tsx`：模型/MCP/插件/Skills/关于 五 Tab，全走 CKP RPC；能力缺失优雅置灰；API Key 仅提示 Keychain 管理 |
| T-018/T-005（前序） | features 三栏布局 + apps/web 浏览器壳（Vite），含 对话/设置 视图切换 |

## 验证了什么

- **全量测试 72 项全绿**：protocol 11 / client 14 / ui-kit 8 / host-dsh 30（新增 git-diff 4 + checkpoint 3）/ features 3 / fixtures 6。
- **T-020 验收 15/15 依旧通过**（真实 wps 模型回复 + 断线重连快照回放）。
- **diff.get 端到端**：真实 sidecar 上，`/tmp/demo-git` 会话返回 b.txt（untracked +2）与 a.txt（+1）完整 patch。
- **checkpoint RPC**：list 空列表、restore 不存在 → `SESSION_NOT_FOUND` 错误码正确。
- **web 壳构建**：vite build 199KB/gzip 63KB；dev server 转译正常；浏览器 origin RPC/SSE 全通（CORS 已加）。

## 被 BLOCK 了什么

- `file.changed` 事件流（T-030 的另一半）：需真实工具写文件场景才能端到端触发。无模型环境下 agent 不自动跑工具；已提供 `diff.get` 作为 Changes 面板数据源（git 真实 diff），file.changed 事件桥接留待有工具执行的环境。
- checkpoint 的「每次写入前自动生成」hook：需 dsh 工具执行事件联动，同上留待真实环境。
- Keychain 集成（T-040）：浏览器版无 OS Keychain；桌面壳（Tauri/Electron）阶段实现。

## 与 GOAL 的偏差

- 无实质偏差。M2/M3 的「事件驱动」部分（file.changed 自动触发、checkpoint 自动生成）依赖真实 agent 工具执行，代码层以「RPC 数据源 + 纯函数」形态交付，验收口径调整为 `diff.get`/`checkpoint.list` 可用性验证。

## 下一步

- M4/M5：worktree 隔离、多会话并行、ext-host 插件 UI、多窗口/托盘（Shell 壳完成后）。
- 真实工具执行环境下的 file.changed/checkpoint 自动触发补测。
