# ADR-002：会话历史恢复（session.history）与协议可选字段扩展

- **日期**：2026-09-10
- **状态**：已接受
- **关联**：`docs/BUG-REPORT.md` P0-22；V2-DECISIONS D19/D20；`packages/protocol/src/{methods,events}.ts`

## 背景

实测发现（见 BUG-REPORT P0-22 与 "六之二"）：

1. dsh 会把会话事件持久化到 `$DSH_HOME/sessions/<ws>/<sessionId>/session.jsonl.zstd`，
   但**重启后不会把这些会话载入内存**——`ctx.sessions.get(id)` 返回 undefined。
   于是 host 的 `session.get` 报 `SESSION_NOT_FOUND`、`session.list` 为空：
   用户视角是「重启后历史会话全部消失，且无法继续对话」。
2. CKP 协议当时没有任何"读取已持久化历史"的方法，前端切到旧会话只能看到空白。
3. 顺带发现：SSE 端点既不过滤回放窗口也不过滤实时事件（源码留有 `void sessionId;`），
   多会话时事件互相串流；且回放窗口为空时不 flush 响应头，客户端 `fetch()` 永不 resolve。

dsh 侧可用能力：`ctx.agents.resume({ resumeSessionId, agentOptions })`
（加载持久化会话并新建 agent，SessionStore 随之持有该会话），
恢复后 `session.events` 返回**完整事件日志**（`dsh-session` 的 `get events()`）。

## 决策

1. **新增 CKP 方法 `session.history`**（`{ id, limit? }`）：
   - 非活跃会话先 `agents.resume()` 从持久化载入；失败且已索引 → 报「无法恢复」的可诊断错误
   - 读 `session.events`（dsh 原始日志），用既有 bridge `translateRawEvent` 翻译成 CKP 事件
   - 返回 `{ events, busSeq, lastSeq, resumed, truncated }`
   - `limit` 默认 2000，超出时保留**尾部**并置 `truncated: true`
2. **`turn`/`step` 作为可选字段加入事件**（`CkpTurnStep`，加在 `message.delta` /
   `thinking.delta` / `thinking.done` / `tool.call` / `tool.done` 上）。
   向后兼容：老客户端忽略未知字段即可；bridge 从 dsh 原始事件透传。
   目的：前端能把「同一轮的文本与工具调用」归组、把 thinking 按轮次分段
   （此前 turn/step 被 bridge 丢弃，导致分段只能靠到达顺序猜）。
3. **`session.list` / `session.get` 合并落盘的会话索引**（`SessionIndex`：
   id → model/workspace/createdAt，位于 `$DSH_HOME/.cursorkit/session-index.json`）；
   `session.send` 对非活跃但已索引的会话先 resume 再发送。
4. **SSE 端点按会话过滤**（回放与实时都过滤），并在写响应头后立即 `flushHeaders()`。

## 影响

- 协议是**向后兼容扩展**：新增 1 个方法 + 5 个可选字段，不改动既有字段语义。
- 前端渲染路径零改动：历史事件走与实时事件相同的 `handleEvent`，
  于是 user/delta/tool/thinking 的渲染逻辑完全复用。
- 客户端订阅语义更精确：`switchSession` 用 host 返回的 `busSeq` 订阅，
  既不重复回放历史、也不漏掉切换瞬间的实时事件。
- host 侧新增落盘文件 `session-index.json`（0600，上限 200 条，防抖写盘）。

## 备选方案

- **让客户端直接读 jsonl.zstd**：拒绝——前端不该解析 dsh 内部存储格式（zstd 解压 + 事件结构耦合），
  且违背「host 是唯一 dsh 集成层」的分层约定。
- **把历史塞进 `session.get` 的返回值**：拒绝——`get` 应是轻量元数据查询；
  历史可能很大，需要独立的 limit/truncated 语义。
- **订阅时由 host 主动把历史写回 EventBus 再让 SSE 回放**：拒绝——会产生跨客户端的副作用，
  且与 `seq` 语义（全局总线序号 vs 会话日志序号）纠缠，难以推理。
- **不恢复历史，只支持新会话**：拒绝——这是功能缺失（用户的诉求是历史必须可恢复）。

## 追加（Cursor 对齐批次）

同一批次又加了两个会话管理方法与一个错误码（仍为向后兼容扩展）：

| 新增 | 说明 |
|---|---|
| `session.rename { id, title }` | 用户重命名（`titleSource: 'user'`，不被 dsh 自动标题覆盖；标题会先清洗模式提示污染） |
| `session.delete { id, deleteFiles? }` | 删除会话记录；`deleteFiles` 时一并删除 `sessions/<ws>/<id>/`；**运行中的会话拒绝删除**（`SESSION_BUSY`） |
| 错误码 `INVALID_PARAMS` | 参数校验失败（HTTP 400） |

## 验证

- 单元：`session.history` 7 项（翻译/limit/resume/NOT_FOUND/busSeq）、SSE 隔离 2 项、
  方法表一致性 3 项（防"加了类型忘加运行时常量表"）
- 扩展侧：`CkpService.switchSession` 5 项（历史派发顺序、busSeq 订阅、失败退化、controller 顺序）
- 端到端（真实 dsh）：`scripts/verify-history.mjs` —— 建会话 → 发消息 → **重启 sidecar** →
  `session.history` 返回 23 个事件（含用户消息与助手回复「收到」）→ 恢复后可继续对话 ✅
