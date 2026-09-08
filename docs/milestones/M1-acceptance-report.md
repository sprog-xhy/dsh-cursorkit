# T-020 M1 集成验收报告（真实 dsh sidecar × CKP client）

> 日期：2026-09-08 · 状态：**通过（15/15）**
> 环境：本机 dsh **0.1.1-rc.2**（`@deepseek-ai/dsh`），独立 DSH_HOME `~/.dsh-cursorkit-test`，profile `cursorkit`（bundles: `@deepseek-ai/dsh-base` + host 插件 + demo-agent）

## 验收环境搭建

1. **独立 DSH_HOME**：`~/.dsh-cursorkit-test/`（不干扰正在运行的 dsh web）。
2. **自建 profile**（关闭 BLOCKED-2）：
   - `profiles/cursorkit/package.json`：`dsh.profile.bundles: ["@deepseek-ai/dsh-base"]` + `file:` 依赖 host-dsh/protocol
   - `profiles/cursorkit/cordis.patch.yml`：insert `cursorkit-host` 插件行 + 顶层 override `agent-loop`（配 `demo-agent`，`sessionId: session-demo`，`provider: deepseek-official`）
   - `dsh --dump-config` 确认插件行与 agent 配置进入组合树
3. **sidecar 启动**：`DSH_HOME=... dsh --profile cursorkit` → host 插件 apply → 写 `runtime.json`（0600，含 pid/port/token/protocolVersion/dshVersion）
4. **验收脚本**：`scripts/run-acceptance.mjs`（纯 Node，import client lib，读 runtime.json 连接）

## 验收结果（GOAL §M1 五条 × 15 断言）

| 验收项 | 结果 | 证据 |
|---|---|---|
| **AC-1 对话闭环**：新建会话→发消息→流式事件 | ✅ | `session.create` 返回真实 dsh 会话；`session.send` 返回 messageId；SSE 流出 `message.delta`/`message.user`/`message.done`/`session.started` 事件并进入 store；**真实 wps 模型（deepseek/deepseek-v4-flash-0731）流式回复 "你好" 端到端到达** |
| **AC-2 工具调用卡片** | ✅ | `tool.call/output/done` 事件投影为 ToolCall 状态机（success/output 累积/耗时） |
| **AC-3 审批卡片** | ✅ | `approval.request` → awaiting-approval；`approval.respond` 未知 id → `APPROVAL_NOT_FOUND`；`approval.resolved(once)` → 审批移除 + 决策记录 |
| **AC-4 断线重连**（验收 4 核心） | ✅ | kill sidecar（SIGTERM）→ bus 快照落盘 → 重启恢复 ring → client 从 lastSeq 增量回放，`before=10, after=13`（旧消息不丢 + 新消息到达，状态一致） |
| **AC-5 取消** | ✅ | `session.cancel` 在无运行中 agent 时返回正确的 `CAPABILITY_MISSING` 语义（不抛内部错误） |

## 真实模型验证（wps provider，2026-09-08 追加）

- **provider**：wps（`baseURL: https://ai-kas.kso.net/codeplan/v1`，`apiKeyEnv: WPS_API_KEY`，openai-completions 协议，手写声明路由），模型 `deepseek/deepseek-v4-flash-0731`，凭据 `~/.dsh-cursorkit-test/.credentials.yaml`（refs.WPS_API_KEY）。
- **事件流实证**：`message.user`（用户输入）→ `message.user`（dsh 真实事件：runtime context / skill 注入）→ `message.delta`（"你好"）→ `message.done`（assistant 完整消息）。**CKP 协议全链路（SessionBridge 翻译真实 dsh 事件 + SSE + EventStore）在真实模型回复下工作。**
- **踩坑记录（重要经验）**：
  1. `session.send` 构造的 dsh user message 必须带 `source: { kind: 'user' }` 和 `content: [{type:'text', text}]`（dsh `Message` 类型要求 source；缺 source 导致 `agent-instructions` 读 `message.source.kind` 崩溃）。
  2. settings.yaml 的 `reasoningEfforts.off: null` 键若经 YAML 1.1 解析（off→false）会破坏 schema —— 直接复制主环境 settings.yaml 原样保留语义。
  3. 旧 session 存储残留无 source 消息会导致 agent 恢复时崩溃 —— 清理 `$DSH_HOME/sessions/` 重建。
  4. 主环境 agent 配 `provider: wps-vision` 但 llm-pi-ai 只注册 `wps` —— provider 名以 llm-pi-ai settings 声明为准。

## 实现增量（本轮）

1. **SessionBridge 对齐真实 dsh 事件 shape**：`user/message`（content: ContentBlock[]）、`assistant/chunk`（chunk.text-delta）、`assistant/message`、`tool/call`（arguments JSON 字符串）、`tool/result`（tool_result block 的 output/error）——替换原假设的 `{data:{text}}` 结构。
2. **EventBus 跨进程快照**（`rpc/sse.ts`）：`saveSnapshot`/`restoreSnapshot`/`saveSnapshotSync`——优雅退出（SIGTERM/SIGINT hook + 插件卸载）落盘 ring，重启恢复 seq 与缓冲，客户端可增量回放而非强制全量重建。单元测试覆盖 round-trip。
3. **host 启动历史重放**（`replaySessionHistory`）：无快照时（崩溃场景）把 dsh 恢复的会话日志翻译进 bus，作为全量重建源；有快照时跳过（避免旧事件拿新 seq）。
4. **capability/compat 修正**：`ctx.agents`（AgentRegistry）而非 `agent`；`sessions.send` 按 sessionId 找 live agent；`ctx.approval` 探测真实审批服务。
5. **验收脚本**：`scripts/run-acceptance.mjs`，15 断言，`--only` 可按项运行。

## 已知限制（诚实声明）

- ~~本机无 LLM API key~~ → **已解决（2026-09-08）**：接入 wps provider（`ai-kas.kso.net/codeplan/v1` + `WPS_API_KEY` 凭据），**真实模型流式回复端到端验证通过**（deepseek/deepseek-v4-flash-0731 回复 "你好"）。
- AC-5 的「运行中点取消立刻停止」需运行中的 agent 才有完整语义；当前验证了取消通路与方法不抛错。

## 验证过的真实 dsh 行为（顺带核验）

- dsh 会话日志 seq = log.length 连续契约成立（`session.get.lastSeq` 与事件流一致）。
- dsh 恢复会话时日志只含初始化元数据事件（permission/preset、sandbox/mode、approval/policy）——对话事件在模型 turn 成功后才持久化，与「append-only + 持久化插件」设计一致。

## 下一步

- 配 API key 补测真实流式回复（可选）。
- T-018：features/chat 页面组装（ui-kit 组件已就绪）。
- T-005：Shell 壳（Electron 快速起）。
