# DSH CursorKit

Cursor 同款 AI IDE 扩展：以 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）为 agent 内核的 AI 编程助手。

面向习惯 Cursor 的用户：界面布局、交互、快捷键与 Cursor 一致，**无痛迁移**。

## 功能

- **Chat 面板**（`Ctrl+Alt+C`）：Ask / Edit / Agent 三模式、多会话、@file 上下文注入、模型切换
- **Agent 多文件任务**：计划 → 执行 → 逐文件审查（diff / 还原 / checkpoint 回滚）
- **Tab 补全**（`Ctrl+Alt+T` 开关）：ghost text 续写，Tab 接受
- **Ctrl+K 行内编辑**：选中 → 指令 → 生成 → 内联应用
- **Checkpoint 时间线**：agent 每次改动自动打点，一键回滚
- **Rules**：兼容 `.cursorrules` / `.cursor/rules/*.mdc` / `~/.cursorrules`
- **多模型**：wps / deepseek / moonshot 等（读 settings.yaml）

## 依赖

- Node.js ≥ 18
- dsh：`npm i -g @deepseek-ai/dsh@0.1.1-rc.2`（版本已固定）
- LLM 凭据：`~/.dsh-cursorkit/settings.yaml` + `~/.dsh-cursorkit/.credentials.yaml`（见仓库 README）

## 使用

```bash
# 打包
cd extensions/vscode && npm run package
# 安装
code --install-extension dsh-cursorkit-0.1.0.vsix
```

1. 打开扩展（活动栏 ⚡ 或 `Ctrl+Alt+C`）
2. 首次使用自动启动 dsh sidecar（状态栏显示 DSH 连接）
3. 在 Chat 输入问题，或选中代码按 `Ctrl+K` 行内编辑

## 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl+Alt+C` | 打开 Chat |
| `Ctrl+K` | 行内编辑 |
| `Ctrl+Alt+T` | Tab 补全开关 |

## 安全

- 默认 `danger-full-access`（Cursor 风格自动执行），可在设置 `dshCursorkit.permission.mode` 调整
- 凭据存 VSCode SecretStorage / 独立凭据文件（0600）
- sidecar 只监听 127.0.0.1 + token 认证

## 文档

- 决策台账：`docs/V2-DECISIONS.md`
- 路线规划：`docs/REFACTOR-PLAN.md`
