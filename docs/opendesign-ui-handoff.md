# 交接任务：利用 OpenDesign 重构 dsh-cursorkit 的 Cursor 同款 UI

> 本文件是给**接手的 UI agent** 的完整任务书。它是自包含的：接手者不需要看过原始调研对话，
> 按本文档即可独立执行。文末有验收标准与禁止事项。
>
> 生成日期：2026-09-10 ｜ 任务类型：Webview UI 重构（视觉 + 结构）｜ 目标仓库：`dsh-cursorkit`

---

## 0. 一句话任务

基于调研过的 GitHub 流行仓库 **nexu-io/open-design**（95k ⭐，"Claude Design 开源替代"，
原生支持 DeepSeek Harness），把本项目 `extensions/vscode/webview/` 里的聊天面板 UI
从"能用"提升到 **Cursor 桌面版质感**，产出一套**跟随 VSCode 主题**的设计 token 层 +
重构后的 React 组件 + CSS。

---

## 1. 项目背景（接手者必读）

- 项目：`/home/sprogx/mycode/dsh-cursorkit`（monorepo，pnpm workspace）
- 定位（V2）：**Cursor 同款 AI IDE**——以标准 VSCode 为载体，开发扩展 `@dsh-cursorkit/vscode`，
  dsh（DeepSeek Harness）跑 sidecar，agent 执行 AI 任务，编辑器内审查/回滚。
- 技术栈：TypeScript + esbuild（扩展进程）+ **React 18 + Vite（webview）**。
- 参考基准：Cursor 桌面版 `876.335.039`（2026-09），**只复刻 IDE 窗口界面**（活动栏/Chat/Composer/Checkpoint/Settings 面板），不参考 agent windows。
- 里程碑：M0/M1（chat 闭环 + 审查闭环）已完成；**当前 UI 是 M0/M1 的功能原型，视觉尚未打磨**——这就是本次任务要解决的。
- 关键决策文档（设计需求唯一依据）：
  - `docs/V2-DECISIONS.md`（D1-D36 全部定稿）
  - `docs/REFACTOR-PLAN.md`（架构规划）
  - `docs/ADR/`（后续变更走 ADR）

### 当前 UI 现状（本次重构对象）

| 文件 | 现状 | 问题 |
|---|---|---|
| `extensions/vscode/webview/src/main.tsx`（583 行） | 单个组件撑全部：topbar + 5 个"下拉面板"（Settings/Models/Sessions/Review/Checkpoints）+ 消息流 + composer | 全部面板共用 `.review-panel` 样式，无 Cursor 质感；组件未拆分 |
| `extensions/vscode/webview/src/chat.css`（155 行） | 跟随 VSCode 主题变量的基础样式 | 无层级/无动效/无品牌色；工具卡片、消息气泡简陋 |
| `extensions/vscode/webview/vite.config.ts` | Vite 构建 | 不变 |

### webview 消息协议（**禁止改动**，重构只动视觉与内部结构）

- 收（扩展 → webview）：`init` / `sidecarStatus` / `event`（CkpEvent）/ `error` / `info` /
  `review.list` / `checkpoint.open` / `checkpoint.list` / `session.list` / `session.switched` /
  `model.list` / `settings.get`
- 发（webview → 扩展）：`send`（含 mode/model）/ `stop` / `review.diff` / `review.reject` /
  `session.switch` / `session.new` / `checkpoint.list` / `checkpoint.rollback` / `settings.get` 等
- 事件流类型：`message.user` / `message.delta` / `thinking.delta` / `tool.call` / `tool.result` /
  `file.changed` / `session.*`（详见 `packages/protocol/src/events.ts`）
- 渲染模型：`ChatItem { role: user|assistant|tool|system }`，assistant 用增量拼接（`message.delta`）

### 必须遵守的技术约束

1. **跟随 VSCode 主题（D14）**：深浅色自动适配，用 CSS 变量映射：
   `--vscode-editor-background` / `--vscode-editor-foreground` / `--vscode-descriptionForeground` /
   `--vscode-panel-border` / `--vscode-button-background` / `--vscode-button-foreground` /
   `--vscode-editorWidget-background` / `--vscode-editor-font-family` / `--vscode-font-family`
2. **CSP 严格**（panel.ts 内）：`default-src 'none'; img-src webview.cspSource data:; style-src 'unsafe-inline'; script-src nonce`
   → **不能加载任何网络字体/图片**。Cursor 的 CursorGothic/jjannon/berkeleyMono 拿不到，
   用系统字体栈（`system-ui` + `ui-monospace` 等）表达相同气质。
3. **不新增运行时依赖**（webview 无 node_modules 之外的东西；字体/图标用系统栈或内联 SVG）。
4. **不改 CKP 协议 / host-dsh / 扩展进程逻辑**；如确需新消息，写入文档并留给后续 ADR，不要在本任务里改协议。
5. **React 18 + TypeScript strict**；跑 `pnpm --filter @dsh-cursorkit/vscode-webview typecheck`（或根 `pnpm -r typecheck`）必须通过。
6. 大消息/长会话：D30 要求虚拟滚动与 DOM 上限 ~500——重构时预留（本任务至少不做让 DOM 爆炸的改动）。

---

## 2. OpenDesign 调研结论（可直接采信的结论 + 资产位置）

### 2.1 两个同名仓库（先分清）

| 仓库 | ⭐ | 定位 | 本次用在哪 |
|---|---|---|---|
| [nexu-io/open-design](https://github.com/nexu-io/open-design) | ~95k | "Claude Design 开源替代"：本地桌面应用，用 coding agent（含 dsh）生成原型/落地页/PPT/图片/视频；附带 151 个设计系统包与模板 | **主素材 + 可选工具** |
| [qiuyiwu1989-star/opendesign](https://github.com/qiuyiwu1989-star/opendesign) | 69 | 1486 个真实网站提取的 token 规格 + MCP server | 补充素材（linear 深色 token 等） |

### 2.2 nexu-io/open-design 对本任务最有用的资产

- **`design-systems/cursor/`**（⭐ 重点）：一套"基于 Cursor 品牌视觉"的完整设计系统包：
  - `DESIGN.md` —— 9 节设计语言（视觉主题/色板/字体/组件/动效/禁忌）
  - `tokens.css` —— 可直接粘贴的 `:root` token 块（下方 3.1 有摘录）
  - `components.html` + `components.manifest.json` —— 组件配方清单
  - `tailwind-v4.css` / `design-tokens.json` / `USAGE.md`
  - **注意**：它捕获的是 **cursor.com 营销官网**的浅色暖调品牌语言，**不是 Cursor IDE 的深色壳**。
    对本项目（VSCode 深/浅主题均要适配）的正确用法：取其**品牌气质 + 组件配方 + AI 时间线状态色**，
    映射到 VSCode 主题变量上，而不是抄它的一组浅色 hex。
- **`design-systems/claude/`**：Anthropic 暖调系统（terracotta `#c96442`、羊皮纸底 `#f5f4ed`），可参考"温暖 AI 产品"的克制手法。
- **`design-systems/linear/`**（qiuyiwu 仓库 `sites/linear.json`）：深色开发者工具 token
  （底 `#08090A`、墨 `#F7F8F8`、muted `#62666D`、线 `rgba(255,255,255,0.08)`、4px 网格、
  150/160/400ms 动效）——**最接近 Cursor IDE 深色观感**的参考。
- **dsh 原生支持**：OpenDesign 可把 `dsh` 作为设计引擎（`od agent setup deepseek-harness`，
  内部协议 `dsh --profile open-design --stdio` + JSONL；其 `@open-design/dsh-runtime` 依赖
  **dsh 0.1.1-rc.2，与本项目 pin 的版本完全一致**）。

### 2.3 如何拿到这些资产（接手者任选）

```bash
# 方式 A（推荐，只需 design-system 文件）：稀疏克隆
git clone --depth 1 --filter=blob:none --sparse https://github.com/nexu-io/open-design.git /tmp/od-nexuio
cd /tmp/od-nexuio && git sparse-checkout add design-systems/cursor design-systems/claude design-systems/linear docs/design-systems.md
# 方式 B（补充素材）
git clone --depth 1 https://github.com/qiuyiwu1989-star/opendesign.git /tmp/od-qiuyiwu   # 约 200MB+，只读 sites/linear.json 即可
```

也可直接在线浏览：
- https://github.com/nexu-io/open-design/tree/main/design-systems/cursor
- https://github.com/qiuyiwu1989-star/opendesign/blob/main/sites/linear.json

### 2.4 （可选）把 OpenDesign 当工具用

下载 [open-design.ai](https://open-design.ai/zh/) 桌面版，agent 运行时选 **DeepSeek Harness**，
给 brief（如"设计一个 Cursor 风格 IDE Chat 面板 webview"）+ 选 cursor 设计系统，让它流式产出
HTML/React 原型、实时预览迭代、critique 后导出，再把结果移植进 webview。若环境允许这么做，
产出物仍然必须是 3.x 规定的最终文件形式。

---

## 3. 核心设计素材（已摘录，离线可用）

### 3.1 nexu-io design-systems/cursor 关键 token（摘自 tokens.css :root）

```css
/* 暖色品牌（营销站）——本项目取其"气质"而非照抄色值 */
--bg: #f2f1ed;                    /* 暖奶油底 */
--surface: #e6e5e0;               /* 卡片/抬升面 */
--surface-warm: #ebeae5;          /* 按钮默认面 */
--fg: #26251e;                    /* 暖近黑墨 */
--muted: rgba(38,37,30,0.55);
--border: rgba(38,37,30,0.1);     /* 暖棕 10% 边框 */
--accent: #f54e00;                /* 品牌橙 */
--success: #1f8a65;
--warn: #eab308;
--danger: #cf2d56;                /* 暖绯红——Cursor 悬停签名色 */
```

**AI 时间线状态色（⭐ 直接可用的细节）**——映射到本项目 ToolCallCard / 工具徽章：

```css
--tl-thinking: #dfa88f;  /* 思考 桃色  */  --tl-grep: #9fc9a2; /* 搜索 鼠尾草绿 */
--tl-read:    #9fbbe0;   /* 读文件 蓝 */   --tl-edit: #c0a8dd; /* 编辑 薰衣草紫 */
```

字体三声部（CursorGothic 展示 / jjannon 正文 / berkeleyMono 代码）→ 本项目用
`system-ui` + `Georgia, Iowan Old Style, serif`（仅标题点缀可选）+ `ui-monospace` 表达。
动效：150/200/400ms 三档 + `cubic-bezier(0.4,0,0.2,1)`；悬停签名是"文字变绯红"而非背景加深。
圆角体系：sm 4 / md 8 / lg 12 / pill 999；间距基准 8px（子刻度 2/3/4/6px 用于图标微对齐）。

### 3.2 Cursor IDE 桌面端界面清单（V2-DECISIONS D6，目标形态）

1. 活动栏 AI 图标（Chat/Composer 入口——VSCode ActivityBar 侧，扩展进程实现）
2. **Chat 面板（本次重点）**：Ask/Edit/Agent 三模式切换、多会话列表、消息流（含 thinking 折叠 +
   工具卡片 + 停止）、输入框 @提及、模型选择器、发送/停止
3. **Composer 面板**：多文件编辑、计划 → 逐文件 diff → 应用/撤销
4. Checkpoint 时间线：消息旁图标 → 回滚（本次做视觉）
5. Rules / Settings 面板（本次做视觉）
6. 底部状态栏：模型名、连接状态（扩展进程实现，webview 内可呼应显示）

### 3.3 Cursor IDE 质感要点（接手者的设计判据）

- 深色壳：近黑暖调底（不是纯 `#000`/`#1e1e1e` 冷灰），细 1px 边框分隔区域，**层次靠边框与透明度
  而非大面积阴影**
- 消息气泡：用户右对齐卡片（低饱和背景 + 细边框）；assistant 左对齐无气泡（正文为主）
- 工具调用：紧凑行内卡片（图标 + 工具名 + 状态徽章 + 可折叠参数/输出），状态色用 3.1 时间线色
- 输入框：圆角 8px、聚焦描边、下方模式/模型选择条；发送按钮品牌色
- 一切适配深浅主题（VSCode CSS 变量）；动效克制（≤200ms）

---

## 4. 任务清单（按序执行）

### 阶段一：准备（0.5h）
1. 通读 `docs/V2-DECISIONS.md`（D6-D18、D25、D30）、`docs/REFACTOR-PLAN.md` 第 3 节、
   当前 `extensions/vscode/webview/src/main.tsx` 与 `chat.css`、`extensions/vscode/src/panel.ts`。
2. 按 2.3 获取 OpenDesign 素材（至少拿到 `design-systems/cursor/{tokens.css,DESIGN.md,components.html}` 与 linear 深色 token）。

### 阶段二：设计 token 层（必做）
3. 新建 `extensions/vscode/webview/src/tokens.css`：
   - 定义语义变量（`--ds-bg` / `--ds-surface` / `--ds-surface-2` / `--ds-fg` / `--ds-muted` /
     `--ds-border` / `--ds-accent` / `--ds-danger` / `--ds-success` / `--ds-tl-*` / `--ds-radius-*` /
     `--ds-ease-*` / `--ds-dur-*` / `--ds-font-ui` / `--ds-font-mono`），**全部映射到 VSCode 主题变量**，
     深浅主题自动适配；品牌点缀色（如 accent）给 VSCode 变量 + 合理 fallback。
   - 文件头注释说明每个 token 的来源（OpenDesign cursor/linear 素材 → 本项目语义）。

### 阶段三：UI 重构（必做，工作量主体）
4. 将 `main.tsx` 拆分为组件（建议结构）：
   ```
   src/
     main.tsx            （入口 + 消息协议接线，逻辑不变）
     tokens.css          （阶段二产物）
     chat.css            （重写为组件级样式，引用 tokens.css 变量）
     components/
       TopBar.tsx        状态点/标题/面板开关（Models/Sessions/Review/Checkpoints/Settings）
       Panel.tsx         通用滑出/抽屉面板容器（替换 .review-panel 全家桶）
       MessageList.tsx   消息流 + 虚拟滚动预留（window 分页 ≥500 条）
       MessageItem.tsx   user/assistant/system 三类渲染
       ThinkingBlock.tsx thinking 折叠块（带 3.1 thinking 状态色）
       ToolCallCard.tsx  工具卡片：图标 + 名称 + 状态徽章（tl-* 色）+ 可折叠参数/输出
       Composer.tsx      输入框 + @提及提示 + Ask/Edit/Agent 模式条 + 模型选择器 + 发送/停止
       SessionsPanel.tsx / ModelsPanel.tsx / ReviewPanel.tsx / CheckpointsPanel.tsx / SettingsPanel.tsx
   ```
5. 视觉目标逐项对照 3.2/3.3；保持消息协议零改动；`thinking.delta` 目前注入为 system 项，
   若顺手可在不破坏协议的前提下改为折叠块渲染（保持现有事件处理语义）。
6. 交互细节：模式切换（Ask/Edit/Agent）高亮、发送中停止态、工具 running→done 状态色切换、
   面板开合动效（≤200ms）、空态文案（保留现有中文文案）。

### 阶段四：验证（必做）
7. `pnpm -r typecheck` 全绿；`cd extensions/vscode/webview && pnpm build` 通过。
8. 写一段「验收自查表」（见第 6 节），逐项打勾；可截图记录（若环境允许跑 dev）。

### 阶段五：交付物（全部要写进最终回复）
- 改动/新增文件清单（git status 为准）
- 设计要点摘要（≤1 页：token 来源映射、三声部字体替代方案、时间线状态色应用位置）
- 验收自查表结果
- 遗留事项（如 Composer/Checkpoint 面板的后续工作、需要新协议消息的点）

---

## 5. 边界与禁止事项

1. **禁止**修改 `packages/` 下任何协议/内核代码；**禁止**改动 `panel.ts` 的 CSP 与消息接线（除非写 ADR）。
2. **禁止**引入网络字体/图片/外部 CDN（CSP 不允许）。
3. **禁止**新增 npm 运行时依赖（图标用内联 SVG，字体用系统栈）。
4. **禁止**照抄 cursor 设计系统的浅色 hex 作为硬编码色——必须经 VSCode 变量 + fallback 表达。
5. 保持现有功能语义（模式、会话、审查、checkpoint、设置）完整可用，只是更好看。

---

## 6. 验收标准（自查表）

- [ ] `pnpm -r typecheck` 通过
- [ ] `extensions/vscode/webview` 构建通过
- [ ] 深浅两种 VSCode 主题下均可读（token 层全部走变量）
- [ ] 消息流：user 右卡片 / assistant 左正文 / tool 行内卡片带状态色 / system 居中弱化
- [ ] thinking 与工具卡片有 Cursor 质感（时间线状态色、可折叠、running→done 状态）
- [ ] 五个面板不再是 `.review-panel` 复制品，有统一面板容器 + 开合动效
- [ ] Composer 有 Ask/Edit/Agent 模式条、模型选择器、发送/停止，样式对标 3.2/3.3
- [ ] 无网络资源依赖；无协议改动；无新运行时依赖

---

## 7. 参考资料索引

- 本仓库：`docs/V2-DECISIONS.md`、`docs/REFACTOR-PLAN.md`、`extensions/vscode/webview/src/*`、
  `extensions/vscode/src/panel.ts`、`packages/protocol/src/events.ts`
- OpenDesign：https://github.com/nexu-io/open-design （`design-systems/cursor|claude`，
  Apache-2.0；`docs/design-systems.md`；dsh 支持见 README「Platform Compatibility」）
- qiuyiwu opendesign：https://github.com/qiuyiwu1989-star/opendesign （`sites/linear.json` 等，MIT/CC BY 4.0）
- Cursor 官网：https://www.cursor.com
