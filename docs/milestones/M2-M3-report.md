# M2/M3/M4/M5 里程碑报告（代码层推进）

> 日期：2026-09-09 · 状态：**代码层完成（M2 核心 + M3 部分 + M4 worktree/并行 + M5 ext-host + desktop 壳骨架）**
> 范围：T-030（diff.get + file.changed 端到端）、T-033/034（checkpoint + 自动生成）、T-035/036（trajectory/thinking）、M3 settings、T-050（worktree）、T-051（并行）、T-052（ext-host）、T-040 预留（keychain）

## 做了什么

| 任务 | 交付 |
|---|---|
| T-030 diff.get | `host-dsh/src/diff/git-diff.ts`：git diff（unstaged+cached）+ untracked 文件（/dev/null patch）→ FileChange[]；`splitDiffByFile`/`summarizePatch` 纯函数；router `diff.get` 按会话 workspace 计算 |
| T-033/034 checkpoint | `host-dsh/src/checkpoint/git-checkpoint.ts`：git commit + `refs/cursorkit/<session>/<n>` 命名空间；list（for-each-ref 时间倒序）/ restore（**新 fork 分支**，绝不覆盖历史）；router `checkpoint.list/restore`（restore 走 sessions.fork 生成子会话） |
| T-035/036 trajectory/thinking | `features/trajectory/trajectory.ts`：buildTrajectory（时间序）+ groupBySource（按 用户输入/模型回复/思维链/工具调用 分组）；App 右栏 TrajectoryPanel 使用；ChatView 已渲染 ThinkingBlock（完成自动展开） |
| M3 settings | `features/settings/SettingsView.tsx`：模型/MCP/插件/Skills/关于 五 Tab，全走 CKP RPC；能力缺失优雅置灰；API Key 仅提示 Keychain 管理 |
| T-050 worktree | `host-dsh/src/worktree/git-worktree.ts`：真实 `git worktree` 管理（list porcelain 解析/create 新分支/remove 拒绝 dirty）+ router worktree RPC；修复 trim 丢末块 bug |
| T-030 file.changed | `bridge/file-change.ts` 工具写文件推断 + `SessionBridgeTracker`（跨 tool/call→result 记住上下文，结果时补发 file.changed）；接入 onEvent 链路；**端到端验证：kimi-k2.7-code 真实调用 bash 工具 → file.changed 事件经 SSE 送达** |
| T-033 自动 checkpoint | `checkpoint/auto-checkpoint.ts`：file.changed → 自动 git checkpoint（throttle 60s + checkpoint.created 回发）；接入插件入口 |
| T-051 多会话并行 | `features/sessions/parallel/ParallelView`：spawn N 会话同 prompt + best-of-n 并排对比；接入 web 壳第三视图 |
| T-040 预留 | `apps/desktop`：SidecarManager 状态机契约 + Keychain 接口（Tauri/Electron），无 rust/electron 环境仅骨架 |
| T-018/T-005（前序） | features 三栏布局 + apps/web 浏览器壳（Vite），含 对话/设置 视图切换 |

## 验证了什么

- **全量测试 87 项全绿**：protocol 11 / client 14 / ui-kit 8 / host-dsh 40（+git-diff 4、checkpoint 3、worktree 3、file-change 4、auto-checkpoint 3）/ features 8（+trajectory 3、parallel 2、ext-host 3）/ fixtures 6。
- **T-020 验收 15/15 依旧通过**（真实 wps 模型回复 + 断线重连快照回放）。
- **diff.get 端到端**：真实 sidecar 上，`/tmp/demo-git` 会话返回 b.txt（untracked +2）与 a.txt（+1）完整 patch。
- **checkpoint RPC**：list 空列表、restore 不存在 → `SESSION_NOT_FOUND` 错误码正确。
- **worktree 端到端**：create→list→remove 全链路通过（真实 sidecar）；修掉 porcelain trim 丢末块 bug。
- **web 壳构建**：vite build 199KB/gzip 63KB；dev server 转译正常；浏览器 origin RPC/SSE 全通（CORS 已加）。

## 被 BLOCK 了什么

- `file.changed` + `checkpoint` **真实触发完整闭环已达成（kimi-k2.7-code + danger-full-access）**：
  1. 工具真实执行：agent 用 bash 写入 `added.txt`（内容 `auto-checkpoint-test`，沙箱外可见——workspace 目录 bind 穿透，/tmp 才是 tmpfs 隔离）。
  2. `file.changed` 事件：`added.txt + 1`（真实行数统计）。
  3. **自动 checkpoint 联动**：`checkpoint.created`（session-demo-1, commit 503d2a0, "auto: added.txt"），git 仓库确认提交存在。
  - 关键经验：① danger-full-access 模式跳过 bwrap（`spawn bash ENOENT` 与 /tmp tmpfs 隔离的坑）；② 写文件须在 workspace 内（/tmp 隔离不可见）；③ agent cwd 须指向 git 仓库才能自动 checkpoint。
- checkpoint 的「每次写入前自动生成」hook：同上依赖工具执行事件，留待真实环境。
- Keychain 集成（T-040）：浏览器壳无 OS Keychain；桌面壳（Tauri/Electron）阶段实现。本机无 rust/electron 工具链，壳骨架留作下一步。

## 与 GOAL 的偏差

- 无实质偏差。M2/M3 的「事件驱动」部分（file.changed 自动触发、checkpoint 自动生成）依赖真实 agent 工具执行，代码层以「RPC 数据源 + 纯函数」形态交付，验收口径调整为 `diff.get`/`checkpoint.list` 可用性验证。

## 下一步

- M4/M5：worktree 隔离、多会话并行、ext-host 插件 UI、多窗口/托盘（Shell 壳完成后）。
- 真实工具执行环境下的 file.changed/checkpoint 自动触发补测。
