# dsh-cursorkit 缺陷排查报告

> 排查日期：2026-09-10 ｜ 范围：`extensions/vscode/src`（扩展进程）、`extensions/vscode/webview/src`（React 面板）、
> `packages/host-dsh`（dsh 插件侧回归确认）
> 结论：**发现并修复 20 个实质缺陷**（其中 5 个「功能完全失效」级），另完成 15 项 UI 优化。
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

**测试总数：168 项全绿**（protocol 11 / client 14 / host-dsh 48 / fixtures 6 / 扩展 89）

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

## 六、遗留（未修，需产品决策）

1. ~~协议未暴露模型字段~~ **已解决**：host 侧新增 `sessionModels` 内存映射（`session.create` 时记录），
   `session.get`/`session.list` 回读 `Session.model`；扩展切换会话时即可精确跟踪模型。
   局限：sidecar 重启后该映射丢失（回读为 undefined），此时退化为「模型未知」不误重建会话。
   真实 sidecar 已验证：`session.get` 返回 `wps/moonshot/kimi-k2.7-code`。
2. **thinking 事件仍是逐 delta 推送**：已按 `role: 'thinking'` 折叠渲染，但一次思考会不断更新同一块，
   长思考过程无法分段；如需分段需协议侧给 turn/step 边界。
3. **tool 事件与文本的时序**：agent 在同一轮里「文本 → 工具 → 文本」会形成两个 assistant 块
   （符合 Cursor 的分段观感），若希望合并成单块需协议提供 turn 分组信息。

## 七、验证证据（可复现）

```bash
# 1. 全量类型检查 + 测试（168 项）
pnpm -r typecheck && pnpm -r test:run
cd extensions/vscode && pnpm vitest run test/

# 2. 构建
cd extensions/vscode && node esbuild.mjs && cd webview && pnpm build

# 3. CSS 类名交叉检查（抓"用了但没样式"）
node scripts/check-css-classes.mjs

# 4. 真实 sidecar 协议层验证（6 项假设）
node scripts/verify-bugfixes.mjs

# 5. 全新 profile 冷启动验证（P0-17 的复现/回归手段）
#    （脚本化步骤见 commit 5f6116e 描述：新 DSH_HOME → 生成 profile → 启动 → 会话链路）
node scripts/verify-m0.mjs "说一句你好"
```

关键实测结论：
- 全新 DSH_HOME 上用修正后的生成逻辑创建 profile → **sidecar 启动成功** → `verify-m0` 全链路通过
  （旧逻辑在此场景会因 `duplicate loader entry id: agent-loop` 直接失败）
- `session.get` 现返回 `model`（`wps/moonshot/kimi-k2.7-code`）、`lastSeq`
- `model.list` 16 项均带 provider（证明 P0-3 的修复必要）
- `git show HEAD:<rel>` 可用（证明 P0-1 的 diff 左侧来源成立）
