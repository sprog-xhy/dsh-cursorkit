# 让 agent 自己调试 CursorKit：调研与设计

> 起因：此前"用户点 → 口述现象 → agent 猜着改 → 用户再点"的循环极慢，
> 一个来回要好几分钟，而且经常改错地方。
> 目标：让 agent（或任何人）**自己启动、操作、观察、截图、取日志、断言**，把
> 人从"测试执行者"变成"需求提出者"。

---

## 一、可用的观察/驱动通道（本机实测结论）

| 通道 | 能得到什么 | 本机可用性 | 限制 |
|---|---|---|---|
| **Chromium DevTools Protocol（CDP）** | webview 内 DOM 读/写、点击、输入；`Page.captureScreenshot` 截图；console/异常采集 | ✅ 已验证 | 需 VSCode 以 `--remote-debugging-port` 启动；仅本机回环 |
| **XDG 桌面门户截屏** | **整个桌面**的画面（含其它应用） | ✅ 已验证（`org.freedesktop.portal.Screenshot`，GNOME 后端，无弹窗直接出图） | 只能截图，不能驱动 |
| **扩展活动日志**（本项目已加） | sidecar 生命周期、发送/停止/切换/审查/tool 调用、错误 | ✅ 已有 | 需扩展主动记录（已覆盖关键路径） |
| **会话事件日志**（dsh 原生） | 模型/工具的真实事件流（`session.jsonl.zstd`，多帧 zstd） | ✅ 已有 | 需要解压（Node 只解第一帧，已自行分帧） |
| **webview 自报错**（本项目已加） | 前端未捕获异常、UI 摘要（节点数/各区域/状态） | ✅ 已有 | 需前端配合上报 |
| **扩展宿主 Node inspector**（`--inspect-extensions`） | 在扩展宿主里求值：读扩展内部状态、调命令 | ⏳ 未验证 | 需再加一条 CDP 连接；属 Phase 3 |
| **`vscode-extension-tester` / `@vscode/test-electron`** | 可复现的端到端 UI 测试（page object、切 webview frame、截图） | ⏳ 未引入 | 需下载 VSCode、CI 需 xvfb；适合 CI 回归而非交互调试 |

### CDP 的关键细节（踩过的坑）

1. **端口别硬编码**：本机 9222/9333 常年被别的进程占用（实测 `dconf watch` 持有），
   VSCode 会 `bind() failed` 静默失败 → 用 `--remote-debugging-port=0`，
   端口写到 `~/.config/Code/DevToolsActivePort`。
2. **webview 是两层**：外层是 `vscode-webview://<id>` 宿主页，我们的 HTML 在**内层 iframe**。
   直接在外层求值 `document.querySelector('.topbar')` 会得到 `false`（曾误判为白屏）。
   两层**同源** → 可用 `contentDocument` 穿透。
3. **工作台页与 webview 跨源**：工作台页面**读不到** webview 的 `contentDocument`，
   但能读它的**几何位置** → 只截面板需要「工作台页取 rect + `Page.captureScreenshot` 带 clip」。
4. **截图不需要窗口在前台**：CDP 截图走渲染管线，窗口被遮挡也能出图。

---

## 二、已经做好的工具（本仓库内，零依赖）

```bash
# 1) 启动带调试端口的 VSCode（只留一个窗口，顺带清掉空白窗口）
bash scripts/open-vscode.sh /path/to/workspace --debug

# 2) 观察 / 驱动 / 取证据
node scripts/agent-debug.mjs list                 # 窗口 + webview 目标
node scripts/agent-debug.mjs shot --chat -o /tmp/a.png   # 只截 Chat 面板（agent 可直接看图）
node scripts/agent-debug.mjs shot -o /tmp/w.png          # 截整个 VSCode 窗口
node scripts/agent-debug.mjs digest               # 关键 UI 状态（状态/模型/消息数/待保留数/面板…）
node scripts/agent-debug.mjs dom ".composer"      # 打印 DOM 片段
node scripts/agent-debug.mjs eval "1+1"           # 在 webview 内求值（表达式或语句体）
node scripts/agent-debug.mjs click ".btn-stop"    # 真实派发鼠标事件（等价真人点击）
node scripts/agent-debug.mjs type "你好" --enter   # 输入并可回车发送
node scripts/agent-debug.mjs errors --seconds=8   # 采集前端 console/未捕获异常
node scripts/agent-debug.mjs log -n 40            # 扩展活动日志尾部
```

配套：`scripts/watch-activity.mjs`（持续跟踪活动日志 + 会话事件，`[⚠️]` 标出错误）。

### 它已经抓到了什么（本轮实测）

| 发现 | 证据 | 处理 |
|---|---|---|
| 每条消息在 UI 里**出现两次** | webview 内插桩计数：`message.user` 到达 2 次（ts 差 16ms）；而会话日志只有 1 条 | 定位到 `session.send` 乐观广播 + bridge 再翻译一次 → 加 `user-echo` 去重登记表 |
| **幽灵空白回复** | DOM 里 `msg-assistant` 无文本 | `turn/start → message.delta('')` → 改为不产出事件，前端另加空增量防御 |
| **工具卡永远"运行中"** | host 事件流：成功工具只发 `tool.output`（无 `tool.done`），前端收到 output 不改状态 | host 补发 `tool.done(status=success)`；前端收到 output 即置完成 |
| UI 是否真的渲染 | 面板截图 | 确认正常，避免"修不存在的白屏" |
| "思考· · ·" 是否丢内容 | DOM：`.thinking-label` + `.thinking-dots`（折叠态） | 判定为**正常**，避免误修 |

整个过程没有让用户点一次、说一次。

---

## 三、怎么把它做成"完整的调试工具"（分阶段）

### Phase 2：断言 + 场景脚本（≈0.5 天，收益最大）

把"我手点一遍"变成"跑一个脚本"：

```js
// scripts/agent-debug.mjs run scenarios/chat-smoke.json
[
  { "type": "chat.open" },
  { "type": "chat.send", "text": "只回复 OK", "mode": "ask" },
  { "type": "assert", "expr": "document.querySelectorAll('.msg-assistant').length >= 1", "timeout": 30000 },
  { "type": "assert", "expr": "!document.querySelector('.btn-stop')", "label": "生成结束后停止按钮消失" },
  { "type": "shot", "target": "chat", "out": "/tmp/step1.png" },
  { "type": "click", "selector": ".change-card .panel-btn.primary" },   // 保留
  { "type": "assert", "expr": "document.querySelector('.change-settled.accepted')" }
]
```

要点：
- `assert` 带超时重试（UI 是异步的），失败时自动截图 + dump DOM + 附活动日志尾部 → **一次失败留下完整证据**。
- 场景覆盖：发送→流式→停止、Keep/Undo、@ 提及、排队、会话切换/历史回放、markdown 渲染、面板开合。
- 每次部署后我先跑一遍，再让用户看 —— 用户的角色从"报 bug"变成"验收"。

### Phase 3：扩展宿主内省（≈1 天）

`--inspect-extensions=<port>` 让扩展宿主变成可调试的 Node 目标，于是可以：
- 直接读扩展内部状态（`controller`、`tracker`、`ckp` 的内存态），不必只看 UI 投影；
- 主动调用命令/方法（重启 sidecar、伪造事件、强制错误路径）；
- 断点/单步调试 TS 源码（配合 sourcemap）。

补充一个**dev-only 控制通道**（默认关闭、仅回环、需显式开启开关）：
让场景脚本能确定性地注入事件（如"来了个 file.changed"），这样 UI 状态机可以在**不依赖大模型**的前提下被完整测试。

### Phase 4：确定性 UI 测试（≈1–1.5 天）

大模型的不确定性是调试噪声的主要来源。做一个 **fake sidecar**（按脚本回放录制的 CKP 事件：

`message.user` → `message.delta×N` → `tool.call/tool.output/tool.done` → `file.changed` → `done/cancelled`），
于是：markdown 渲染、Keep/Undo、排队、时间线、diff 都能在毫秒级、可重复地验证。
再加**黄金截图**（同尺寸重放后像素对比 + 容差）兜住"样式回归"。

### Phase 5：CI 端到端门禁（≈1 天）

`xvfb-run` + `vscode-extension-tester`（官方 E2E 框架，支持切 webview frame、page object），
把 Phase 2 的关键场景跑在 CI 上；本地交互调试继续用 CDP 工具（更快、能看真实环境）。

---

## 四、注意事项 / 边界

- CDP 与控制通道**只能本机回环**，且**默认关闭**；发布文档里不鼓励常开。
- 截图/场景脚本会固化"当前实现"，样式大改时需要同步更新（黄金图尤其）。
- CDP 的 DOM 断言比截图断言稳；截图用于"人看"和最终验收。
- 别用 `xdg-open vscode://…`（会另起 VSCode 实例，产生空白窗口）；用 `code --open-url`。
- 调试端口改动只影响本地开发：正常使用（装 vsix）不需要任何调试开关。
