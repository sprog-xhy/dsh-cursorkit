# dsh-cursorkit

**Cursor 同款 AI IDE**：以 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）为 agent 内核的 VSCode 扩展。

面向习惯 Cursor 的用户：界面布局、交互、快捷键与 Cursor 一致，**无痛迁移**。

> V1（自建 Electron/React 壳）已废弃（git tag `v1-legacy`）；V2 全面重构为 VSCode 扩展路线。
> 决策台账：[`docs/V2-DECISIONS.md`](docs/V2-DECISIONS.md) · 路线规划：[`docs/REFACTOR-PLAN.md`](docs/REFACTOR-PLAN.md)

## 架构

```
VSCode (host)
├─ 扩展进程 (Node): sidecar 管理 / CKP client / IDE 适配（diff/SCM/快捷键/文件）
│   └─ webview (React): Chat / Composer / Checkpoint / Settings 面板
└─ sidecar: dsh --profile cursorkit（host-dsh 插件） ←CKP(HTTP+SSE)→
```

- **CKP 协议**（`packages/protocol`）：前后端唯一共享契约，dsh 插件侧零改动
- **host-dsh**（`packages/host-dsh`）：dsh 插件，动态 agent 创建（`ctx.agents.create`）、checkpoint、worktree、diff、approval
- **client**（`packages/client`）：事件源 SDK（transport/store/reducer/乐观 UI）
- **extensions/vscode**：VSCode 扩展本体（本仓库核心交付物）

## 功能

| 功能 | 状态 |
|---|---|
| Chat 面板（Ask/Edit/Agent 三模式 + 多会话 + @file 上下文） | ✅ |
| Agent 多文件任务（计划 → 逐文件 diff 审查 → 还原） | ✅ |
| Tab 补全（ghost text，Tab 接受） | ✅ |
| Ctrl+K 行内编辑（选中 → 指令 → 生成 → 内联应用） | ✅ |
| Checkpoint 时间线（自动打点 + 一键回滚） | ✅ |
| **历史会话恢复**（重启后仍可列出/回读/继续，`session.history`） | ✅ |
| Rules（.cursorrules / .cursor/rules/*.mdc / ~/.cursorrules） | ✅ |
| 模型选择器（真实读取 settings.yaml provider×model） | ✅ |
| Settings 面板（Rules 查看 / Tab 开关 / 权限模式） | ✅ |
| 侧边栏会话视图 | ✅ |

## 安装

**依赖**：Node.js ≥ 18、pnpm、dsh、LLM 凭据

```bash
# 1. dsh（版本固定 0.1.1-rc.2）
npm i -g @deepseek-ai/dsh@0.1.1-rc.2

# 2. 一键安装扩展（检查依赖 → 构建 → 打包 vsix → 安装到 VSCode）
bash scripts/install.sh

# 或手动：cd extensions/vscode && npx vsce package && code --install-extension dsh-cursorkit-*.vsix
```

**LLM 凭据**（wps 示例，与 dsh 数据目录一致）：

```bash
# ~/.dsh-cursorkit/settings.yaml
llm-pi-ai:
  providers:
    wps:
      apiKeyEnv: WPS_API_KEY
      api: openai-completions
      baseURL: https://ai-kas.kso.net/codeplan/v1
      models:
        - id: deepseek/deepseek-v4-flash-0731
          contextWindow: 230000

# ~/.dsh-cursorkit/.credentials.yaml（0600）
refs:
  WPS_API_KEY: <你的 key>
```

## 使用

```bash
code  # 打开 VSCode（或任意已装扩展的窗口）
```

1. 活动栏 ⚡（DSH CursorKit）→ 打开 Chat，或 `Ctrl+Alt+C`
2. 首次使用自动启动 dsh sidecar（状态栏显示连接；数据目录 `~/.dsh-cursorkit`，可用 `CK_DSH_HOME` 覆盖）
3. Chat 输入问题；Agent 模式做多文件任务；选中代码 `Ctrl+K` 行内编辑；输入代码 Tab 补全

## 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl+Alt+C` | 打开 Chat |
| `Ctrl+K` | 行内编辑（选中代码后） |
| `Ctrl+Alt+T` | Tab 补全开关 |

## 开发

```bash
pnpm install
pnpm -r build     # 内核包构建
cd extensions/vscode && node esbuild.mjs   # 扩展主进程
cd extensions/vscode/webview && pnpm build # webview
pnpm -r test:run  # 全量测试
```

集成验证（真实 dsh + wps）：

```bash
node scripts/verify-m0.mjs        # 全链路: spawn→runtime→session→send→流式事件
node scripts/verify-m3.mjs        # model.list 真实 settings + 会话
node scripts/verify-bugfixes.mjs  # 依赖同步/会话索引/重启后历史可用/diff 来源 等 9 项
node scripts/verify-history.mjs   # 历史会话恢复（建会话→发消息→重启 sidecar→回放历史）
node scripts/check-css-classes.mjs # CSS 类名交叉检查
```

## 测试

**231 项全绿**：protocol 11 / client 14 / host-dsh 82 / fixtures 6 / 扩展 118
（含真实 sidecar 冷启动集成测试与组件渲染测试；`CK_SKIP_INTEGRATION=1` 可跳过需要 dsh 的用例）。

## 安全

- 默认 `danger-full-access`（Cursor 风格自动执行），`dshCursorkit.permission.mode` 可调
- 凭据：VSCode SecretStorage / `~/.dsh-cursorkit/.credentials.yaml`（0600）
- sidecar 只监听 127.0.0.1 + token 认证；webview 严格 CSP

## 目录

```
packages/
  protocol/    CKP 契约（方法/事件/错误码）
  host-dsh/    dsh 插件（动态 agent/checkpoint/worktree/diff/approval）
  client/      SDK（transport/store/reducer）
extensions/
  vscode/      扩展本体（src + webview React + esbuild/vite）
  vscode/webview/  React 面板（Chat/Composer/Checkpoint/Settings）
scripts/       安装 + 集成验证
fixtures/      事件流 fixture + 集成测试
docs/          决策台账 / 规划 / 审计
```
