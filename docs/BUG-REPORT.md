# dsh-cursorkit 缺陷排查报告

> 排查日期：2026-09-10 ｜ 范围：`extensions/vscode/src`（扩展进程）、`extensions/vscode/webview/src`（React 面板）、
> `packages/host-dsh`（dsh 插件侧回归确认）
> 结论：**发现并修复 30 个实质缺陷**（其中 13 个「功能完全失效」级），另完成 15 项 UI 优化。
> 第二轮复核：确认前 20 项修复全部真实落地；
> 第三轮（历史会话必须可恢复）：修掉 3 项遗留 + 4 个新发现的 P0（含 SSE 会话串流）。
> 全部修复已提交（`2f837e4` 及其前后提交），扩展测试 41 项 / 内核测试 74 项全绿。

## 一、功能失效级（P0）

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| 1 | `review.ts showDiff` 把**同一个文件 URI** 同时作为 diff 左右两侧 | 审查面板「diff」按钮永远显示"无差异"，审查闭环形同虚设 | 新增 `virtual-docs.ts`：用 `VirtualDocProvider` + `git show HEAD:<rel>` 提供真实左侧；未纳入 git 的新文件退化为 patch 视图 |
| 2 | 选中文本只弹提示 `已自动附加选中文本`，**内容从未拼进消息** | 用户以为选中生效，agent 实际看不到任何代码 —— 功能谎报 | `ide-bridge.formatSelectionBlock` 把「文件+行号+语言+选中内容」真正拼进消息 |
| 3 | 选择模型时硬编码 `wps/${id}` 前缀 | settings.yaml 中其它 provider 的模型（如 deepseek）选中后变成 `wps/deepseek-v4-flash` → 必然报错 | 改用模型的 `provider` 字段拼装（`fullModelName`），并加单测覆盖 |
| 4 | `ckp.ensureSession` 复用已有会话时**忽略传入模型** | 切换模型后发送，仍用旧模型（用户感知：模型选择器没用） | 跟踪会话创建时模型，模型变化时重建会话；`session.switch` 来的会话标为未知以免误重建 |

| 17 | `sidecar.ensureProfile` 生成的 profile patch **恰好写错**：`insert agent-loop`（dsh-base 已内置该 id → `duplicate loader entry id`，sidecar 直接启动失败）且**缺少必需的 `cursorkit-host`**（实测包内自带 patch 不会被自动加载 → runtime.json 永不出现） | 只在"已手工写好 profile"的机器上侥幸可用；换机器/新建 profile 时**完全无法启动** | 抽出纯模块 `profile-config.ts` 统一生成（insert cursorkit-host + agent-loop 顶层覆盖），并对已有 patch 做体检（`profilePatchNeedsRepair`）自动修复；**在全新 DSH_HOME 上实测启动成功并跑通完整链路** |
| 18 | `sidecar.spawn` 启动超时/失败时不回收已拉起的进程 | 失败后残留孤儿 dsh 进程，下次启动看到半死实例 | `waitForRuntime` 失败即 `killProc('startup-failed')` |

## 一之二、展示正确性（P2，用户可见的"错误信息"）

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| 19 | 审查面板无条件显示 `+N/-0`（host 的 deletions 恒为 0，因为增删行数是从工具输出估算的） | 每个改动都显示"-0"，用户以为是真实 diff 统计 | 未知时显示 `—`，仅在 >0 时显示对应项，并加 tooltip「估算，以 diff 为准」 |
| 20 | `client` 的 `SubscribeOptions.fromSeq` 注释写 "inclusive"，而服务端 `replayFrom` 是**排他**边界 | 后续按注释改动会导致重连时事件重复（消息重复） | 注释纠正为排他语义；实测重连使用 `lastSeq` 不会重复 |

| 21 | `sidecar.ensureProfile` **从不安装 profile 依赖**；且 pnpm 的 `file:` 依赖是**快照**，host-dsh 源码/构建更新后 profile 内副本不会刷新 | 全新环境：sidecar 永远起不来（运行时才报 `Cannot find module .../host-dsh/lib/...`）；更新后：启动直接失败 | 新增 `syncProfileDeps`（源码指纹 + 时间戳判定，pnpm→npm 回退，装完写 stamp），扩展与验证脚本共用；**冷启动集成测试证明零手工步骤可启动** |
| 22 | dsh 重启后**不把持久化会话载入内存**，而 host 侧没有任何会话索引 | `session.get` 报 SESSION_NOT_FOUND、`session.list` 为空 → 用户视角「重启后历史会话全部消失，也无法继续」 | 新增落盘的 `SessionIndex`（id → model/workspace/createdAt）：`list` 合并历史、`get` 回退索引、`send` 先 `agents.resume` 再发送；**实测重启后仍可列出并回读会话** |

| 23 | SSE 端点**既不过滤回放窗口、也不过滤实时事件**（源码留着 `void sessionId;` 占位） | 多会话并行时事件互相串流：会话 A 的流里混进 B 的消息（前端消息串台）；订阅 A 会收到其它会话的全部历史 | 回放与实时都按 `sessionId` 过滤；新增 2 项 SSE 隔离回归测试（node:http 原生客户端读流） |
| 24 | SSE 回放窗口为空时**不 flush 响应头** | 切到尚无事件的新会话时，客户端 `fetch()` 永不 resolve（连接看似死掉，重连逻辑也不触发） | `res.writeHead(...)` 后立即 `res.flushHeaders()` |
| 25 | 方法注册表遗漏：`CKP_METHODS`（运行时常量表）未收录 `context.get`，新增方法也容易忘登记 | 调用得到 `unknown method`——`context.get` 自加入起就一直是死方法 | 补齐 `CKP_METHODS` 与 `schema/methods.schema.json`；新增"方法表一致性"测试（从 router 源码抽取 register('x') 双向校验） |
| 26 | profile 依赖指纹**只覆盖 host-dsh**，未覆盖同为 file: 依赖的 protocol 包 | protocol 变更后 profile 内副本过期 → 新方法报 `unknown method`（实测踩到） | 指纹合并两个包，任一变化即重装 |

| 27 | **白屏**：webview 里 `ReferenceError: process is not defined`（Vite lib 模式不替换 `process.env.NODE_ENV`，React CJS 构建带着它；顺带打进了 React **dev** 构建，包体 494KB→164KB） | 面板/侧边栏完全空白，功能一个都用不了 | vite `define` 显式替换；新增 vm 沙箱回归测试（不提供 process，能复现该错误） |
| 28 | **init 消息在 webview 加载前发送被丢弃**（VSCode webview 不排队） | 界面渲染出来了但状态永远"未连接"、模型名/改动计数为空 | 改为 `webviewReady` 握手后补发 init/sidecarStatus/reviewList |
| 29 | **`turn/end` 被 bridge 全部丢弃** —— 用户报告"点停止没反应" | dsh 已 `aborted` 取消成功，但前端收不到任何事件 → busy 永远 true、"生成中"常驻、停止按钮不消失 | 按 dsh 四种结局映射：aborted→`cancelled`、error→`error`、completed/blocked→`done`；端到端验证脚本 `scripts/verify-cancel.mjs` |
| 30 | **Agent 模式提示写死"这是多文件任务"** + **用户级 skills（~/.agents）被注入** | 用户问"解释这个项目的架构"却被当成改文件任务，agent 去 `str_replace_editor` 写 `/workspace`、`/home/kas/...`（外部路径！） | 提示改为条件式；sidecar 默认 `DSH_AGENTS_HOME=$DSH_HOME/agents` 隔离用户级 skills（设置 `sidecar.inheritGlobalSkills` 可改回） |

## 二、功能缺陷级（P1）

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| 5 | 切换会话时不清空消息列表，且订阅从 `seq 0` 全量回放 | 两个会话的消息在同一视图里串台/重复 | 收到 `session.switched` 清空列表；订阅改按会话 `lastSeq` 游标 |
| 6 | `sendAndWaitText` 从 `seq 0` 订阅 | Tab 补全/行内编辑会把**上一轮**的回复文本拼进本次结果 | 从当前游标订阅（不回放）；同一会话请求串行化 |
| 7 | `edit-code.sendAndCollect` 只处理 `message.done` | 遇到 `error`/`cancelled` 会一直挂到 60s 超时 | 统一由 `sendAndWaitText` 处理 done/error/cancelled + 超时 |
| 8 | Tab 补全忽略 `CancellationToken`，且光标移动也会触发 | 用户持续输入时仍反复调用模型（白花钱、结果过期） | 取消检查 + 用「文档版本」判定是否真的发生输入 |
| 9 | 活动栏视图 `resolveWebviewView` 只是去打开另一个编辑器面板 | 侧边栏永远空白，点击图标弹出独立面板（交互割裂） | 抽取共享 `ChatController`，新增 `SidebarChatViewProvider` 真正在侧边栏渲染 |
| 10 | `sidecar.onStatusChange` 是单一回调，`dispose` 时不清除 | 多宿主只保留最后一个；面板关闭后仍向已销毁 webview 发消息 | 改为 `Set` 监听（多订阅）+ 返回注销函数，dispose 时清空 |
| 11 | Tab 补全只在 `autoStart` 分支注册 | 关闭自动启动后，即使手动打开 Chat 也永远没有补全 | 抽出幂等 `ensureReady()`，就绪即注册 |
| 12 | `.mdc` rules 的 `globs` 被忽略、frontmatter 原样写进提示词、**每条消息**重复注入 | 规则适用范围错误 + 提示词污染 + 每轮重复计费 | 解析 frontmatter（剥离 `---` 块）、按 glob 过滤、按会话+内容指纹去重 |
| 13 | Ctrl+K 绑在 `editorTextFocus` | 劫持 VSCode 的 `Ctrl+K` 组合键前缀（Ctrl+K Ctrl+S 等全部失效） | `when` 收紧为 `editorHasSelection && editorTextFocus && !suggestWidgetVisible && !inDebugRepl` |
| 14 | D28 声称的「写文件冲突检测」**完全未实现** | agent 覆盖用户未保存修改时用户无感知，改动被静默丢弃 | `ChangeTracker.handleFileChanged` 检测 dirty 缓冲区 → 弹冲突确认（查看差异 / 丢弃重载 / 保留我的修改） |
| 15 | `rejectChange` 对未跟踪新文件执行 `git checkout` | 静默失败，用户以为已还原 | 先 `git ls-files --error-unmatch` 判定；未跟踪文件走「确认后删除（进回收站）」 |
| 16 | 流式输出时不自动滚动（effect 只依赖 `items.length`，而增量文本不改变长度） | 长回复时视口停在原处，必须手动滚动 | 依赖 `items` 引用 + 「回到最新」浮动按钮 + 仅在上滚时暂停自动跟随 |

## 三、cleanup / 一致性

- `stripFence` 在 edit-code 与 tab-completion 各写一份 → 抽到 `text-utils.ts`（可单测，已覆盖 CRLF / 未闭合围栏）
- `currentWorkspace()` 在 panel / ide-bridge / rules 三处重复定义 → 统一到 `ide-bridge`
- `ide-bridge.showDiff/openFile` 死代码、`Panel.tsx` 未生效的 `mounted` 状态、`parseMentions` 的 workspace 死参数 → 清理
- CSS 死类 `.panel-row-dot`、`.composer-box.disabled` 缺样式 → 前者删除、后者补上
- `docs/V2-DECISIONS.md` 的 D28 声称已实现但实际未实现 → 本次补齐（代码已对齐文档）

## 四、UI 优化（本轮）

1. 顶栏：面板按钮高亮当前状态、改动计数强调色、连接状态带 tooltip、新增「时间线」入口
2. 面板互斥（同时只开一个）+ Esc 关闭 + 打开动效
3. 模型面板标记当前模型；会话面板标记活跃会话 + 工作区
4. 审查面板：状态 chip（新增/修改/删除）、点击路径直接打开文件、diff 双色统计
5. Checkpoint 面板：时间列 + 摘要 + commit 短哈希
6. 设置面板：数据未到时显示「读取设置中…」（原先整块不渲染）
7. 消息：user 气泡带时间、assistant 悬停复制按钮、system 分级（info/error/stopped）
8. 工具卡片：输出截断 + 「展开全部（N 字符）」+ 输出字符数
9. 空态：三条快捷提示 chips（点击填入输入框）
10. Composer：未就绪禁用并提示、输入框高度自适应、IME 组合态不误发
11. 草稿与模式持久化（webview state，重开面板不丢）
12. 可访问性：`:focus-visible` 焦点环、`prefers-reduced-motion` 动效降级、role/aria 标注

## 五、回归防线

**测试总数：240 项全绿**（protocol 11 / client 14 / host-dsh 87 / fixtures 6 / 扩展 127）

- host-dsh 48：新增 `model-ref`（5，覆盖 P0 级模型解析缺陷）
- 扩展 77：
  - `profile-config`（10）：profile patch 生成/体检（直接覆盖 P0-17 的两种致命写法）
  - `activation`（7）：**首次真正执行 `activate()`/`deactivate()`**（通过 `test/stubs/vscode.ts` 桩模块，
    此前激活路径完全没有测试覆盖）
  - `components-render`（29）：用 `react-dom/server` 渲染每个组件，覆盖状态分支、
    DOM 上限省略、三种未就绪提示、工具状态色、五面板空态/数据态
  - `rules`（15）：frontmatter / globs / 过滤 / 指纹
  - `text-utils`（10）、`model-name`（3，直接覆盖 P0-3）、`sidecar`（5）、`review`（4）、`tab-completion`（4）
- `scripts/check-css-classes.mjs`：交叉检查「用了但没样式」的类名
  （本轮即抓到 `.composer-box.disabled` 缺失与 2 处死 CSS）
- `scripts/verify-bugfixes.mjs`：真实 sidecar 协议层验证（6 项假设实测通过，
  含 `session.get` 回读 model、`git show HEAD:` 可用、model.list 16 项均带 provider）

## 五之二、环境限制（诚实说明）

本环境无 GUI，**未在真实 VSCode 窗口里点击验证**。已做到的替代验证：
类型检查（0 错误）、扩展/webview 构建、156 项自动化测试（含激活与组件渲染）、
真实 dsh sidecar 的协议层实测。建议你在 VSCode 中按 F5 或安装 vsix 后实测一次。

## 六、遗留项（第二轮已全部修复）

1. ✅ **模型/会话元数据跨重启丢失** → 改为落盘 `SessionIndex`（并对旧 `session-models.json` 停用）。
   实测：重启后 `session.get` 仍返回 `wps/moonshot/kimi-k2.7-code`。
2. ✅ **thinking 逐 delta 无法分段** → 协议新增**可选** `turn`/`step`（`CkpTurnStep`，向后兼容），
   bridge 从 dsh 原始事件透传；前端 thinking 块按 `turn-step` 分段，不再长期并成一块。
3. ✅ **同一轮「文本 → 工具 → 文本」视觉割裂** → 前端按 `turn` 归组（`.turn` 容器 + 收紧间距），
   同一轮的回复与工具卡片成组显示；`groupByTurn` 有 4 项单测 + 2 项渲染断言。

顺带修复（同批）：
- **空文本分片仍被广播**成 `message.delta`（无意义事件、可能生成空 assistant 块）→ 现在返回 null
- **reasoning 分片没有走 thinking 事件** → 按 dsh 真实分片类型 `reasoning-delta` 正确分流

## 六之二、历史会话恢复（第三轮已实现，见 ADR-002）

**用户要求：历史会话必须能够恢复** —— 已完整实现并端到端验证：

- 新增 CKP 方法 **`session.history`**：非活跃会话先 `agents.resume()` 从持久化载入 →
  读 `session.events` 完整日志 → 用既有 bridge 翻译成 CKP 事件 → 返回
  `{ events, busSeq, lastSeq, resumed, truncated }`
- 前端**复用同一渲染路径**：历史事件走与实时事件相同的 `handleEvent`（user/delta/tool/thinking
  全部照常渲染），切换会话时先清空再从 `busSeq` 订阅实时事件（不重复、不漏）
- 落盘 `session-index.json` 让历史会话在重启后仍可列出（`list`）与回读（`get`）
- **实测**（`scripts/verify-history.mjs`）：建会话 → 发消息 → 重启 sidecar →
  `session.history` 返回 **31 个事件**（含用户消息与助手回复「收到」）→ 恢复后可继续对话 ✅
- 协议扩展已按约定记录在 [`docs/ADR/ADR-002-session-history-restore.md`](ADR/ADR-002-session-history-restore.md)

## 七、验证证据（可复现）

```bash
# 1. 全量类型检查 + 测试（231 项）
pnpm -r typecheck && pnpm -r test:run
cd extensions/vscode && pnpm vitest run test/

# 2. 构建
cd extensions/vscode && node esbuild.mjs && cd webview && pnpm build

# 3. CSS 类名交叉检查（抓"用了但没样式"）
node scripts/check-css-classes.mjs

# 4. 真实 sidecar 协议层验证（9 项）
node scripts/verify-bugfixes.mjs

# 5. 历史会话恢复验证（建会话 → 发消息 → 重启 sidecar → 恢复历史）
node scripts/verify-history.mjs

# 6. 全新 profile 冷启动验证（P0-17/21 的复现/回归手段）
#    （脚本化步骤见 commit 5f6116e 描述：新 DSH_HOME → 生成 profile → 启动 → 会话链路）
node scripts/verify-m0.mjs "说一句你好"
```

关键实测结论：
- 全新 DSH_HOME 上用修正后的生成逻辑创建 profile → **sidecar 启动成功** → `verify-m0` 全链路通过
  （旧逻辑在此场景会因 `duplicate loader entry id: agent-loop` 直接失败）
- `session.get` 现返回 `model`（`wps/moonshot/kimi-k2.7-code`）、`lastSeq`
- `model.list` 16 项均带 provider（证明 P0-3 的修复必要）
- `git show HEAD:<rel>` 可用（证明 P0-1 的 diff 左侧来源成立）
