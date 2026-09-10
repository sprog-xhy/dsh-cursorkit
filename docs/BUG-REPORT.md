# dsh-cursorkit 缺陷排查报告

> 排查日期：2026-09-10 ｜ 范围：`extensions/vscode/src`（扩展进程）、`extensions/vscode/webview/src`（React 面板）、
> `packages/host-dsh`（dsh 插件侧回归确认）
> 结论：**发现并修复 16 个实质缺陷**（其中 4 个「功能完全失效」级），另完成 12 项 UI 优化。
> 全部修复已提交（`2f837e4` 及其前后提交），扩展测试 41 项 / 内核测试 74 项全绿。

## 一、功能失效级（P0）

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| 1 | `review.ts showDiff` 把**同一个文件 URI** 同时作为 diff 左右两侧 | 审查面板「diff」按钮永远显示"无差异"，审查闭环形同虚设 | 新增 `virtual-docs.ts`：用 `VirtualDocProvider` + `git show HEAD:<rel>` 提供真实左侧；未纳入 git 的新文件退化为 patch 视图 |
| 2 | 选中文本只弹提示 `已自动附加选中文本`，**内容从未拼进消息** | 用户以为选中生效，agent 实际看不到任何代码 —— 功能谎报 | `ide-bridge.formatSelectionBlock` 把「文件+行号+语言+选中内容」真正拼进消息 |
| 3 | 选择模型时硬编码 `wps/${id}` 前缀 | settings.yaml 中其它 provider 的模型（如 deepseek）选中后变成 `wps/deepseek-v4-flash` → 必然报错 | 改用模型的 `provider` 字段拼装（`fullModelName`），并加单测覆盖 |
| 4 | `ckp.ensureSession` 复用已有会话时**忽略传入模型** | 切换模型后发送，仍用旧模型（用户感知：模型选择器没用） | 跟踪会话创建时模型，模型变化时重建会话；`session.switch` 来的会话标为未知以免误重建 |

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

- `packages/*` 74 项测试全绿（未改动协议/内核）
- 扩展 41 项测试：新增 `rules`（15，覆盖 frontmatter/globs/过滤/指纹）、
  `text-utils`（10）、`model-name`（3，直接覆盖 P0-3）
- 新增 `scripts/check-css-classes.mjs`：交叉检查「用了但没样式」的类名（本轮即抓到 `.disabled` 缺失与 2 处死 CSS）

## 六、遗留（未修，需产品决策）

1. **协议未暴露模型字段**：`session.get` 不返回 `model`，因此从会话列表切换进来的会话无法判断其模型，
   只能标记为「未知」。建议后续在 CKP `Session` 上加 `model` 字段（需 ADR）。
2. **thinking 事件仍是逐 delta 推送**：已按 `role: 'thinking'` 折叠渲染，但一次思考会不断更新同一块，
   长思考过程无法分段；如需分段需协议侧给 turn/step 边界。
3. **tool 事件与文本的时序**：agent 在同一轮里「文本 → 工具 → 文本」会形成两个 assistant 块
   （符合 Cursor 的分段观感），若希望合并成单块需协议提供 turn 分组信息。
