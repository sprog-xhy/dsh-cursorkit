# 项目交付总结（dsh-cursorkit）

> 日期：2026-09-09 · 状态：**M0–M5 全里程碑代码层完成 + 关键能力端到端实证**

## 一句话

用**纯插件 + 薄桌面外壳**把 DeepSeek Harness（dsh）包装成 Claude Desktop / Codex Desktop 风格桌面应用，**未改 dsh 一行源码**。

## 交付清单

| 层 | 交付 | 关键验证 |
|---|---|---|
| 协议 | `@dsh-cursorkit/protocol`（25 方法 / 22 事件 / 9 错误码 / 版本协商 / JSON Schema 快照） | 11 测试 + schema 一致性 CI |
| Host 插件 | `@dsh-cursorkit/host-dsh`（capability 探测 / compat 唯一 ctx 访问点 / HTTP+SSE server / EventBus 快照 / 审批桥接 / diff / checkpoint / worktree / auto-checkpoint） | 40 测试；**真实 dsh sidecar 加载运行** |
| Client SDK | `@dsh-cursorkit/client`（EventStore 事件源 / 纯函数 reducer / SSE 续传重连 / 乐观 UI / IndexedDB） | 14 测试 |
| UI | `@dsh-cursorkit/ui-kit` 17 组件 + `features` 页面容器（三栏 / 命令面板 / 并行 / settings） | 23 测试；web build 206KB/gzip 65KB |
| 桌面壳 | Electron：sidecar 管理 / Keychain(safeStorage) / 托盘 / 全局快捷键 / 多窗口 / loopback 静态服务 | **端到端渲染验证**（三栏 UI + 真实数据） |
| 浏览器壳 | Vite + React（同款前端），CORS 支持 | dev/build/preview 全通 |

## 关键实证（真实 dsh + wps 模型环境）

1. **T-020 集成验收 15/15**：建会话→发消息→流式回复（真实 wps 模型 `deepseek-v4-flash`/`kimi-k2.7-code`）→ 工具事件 → 审批 → **断线重连（kill sidecar → 重启 → 快照增量回放，before=22 after=24 状态一致）**。
2. **真实工具执行完整闭环**（danger-full-access + kimi-k2.7-code）：模型调用 bash 写文件 → `file.changed` 事件（+1 行真实统计）→ **自动 checkpoint**（git commit `503d2a0` "auto: added.txt"）。
3. **M4 并行 best-of-n**：3 会话并行同 prompt，模型真实调工具（输出 `hello-parallel`/`/tmp/demo-git2`），对比选优。
4. **Electron 桌面壳**：三栏布局完整渲染，真实 sidecar 会话历史 + 工具输出代码块可见。

## 踩坑沉淀（对后续最有价值）

| 坑 | 解法 |
|---|---|
| dsh `Message` 必须带 `source:{kind:'user'}` | session.send 补 source/content |
| settings.yaml 的 `off: null` 被 YAML1.1 转 false | 直接复制主环境文件，勿脚本重写 |
| dsh 只驱动配置的 declarative agent | 并行需 N 个预置 agent |
| bwrap ENOENT + /tmp tmpfs 隔离 | danger-full-access 模式 + workspace 内写文件 |
| file:// 下 ESM dynamic import 被 CORS 拦 | Electron loopback 静态服务 |
| porcelain `trim()` 丢末块 | flush 残留块 |
| tool/result 的 callId 在 `content[0].toolCallId` | 对齐真实结构 |

## 与 GOAL 的偏差（记录在案）

- 审批展示由 host 自实现（dsh 0.1.1-rc.2 的 `dsh-user-approval` 桥接）——ADR-001
- 事件驱动部分（file.changed/checkpoint）依赖模型工具遵循，已用真实环境补测
- Shell 用 Electron 实装（Tauri 2 契约已抽象，可移植）

## 未来工作

- 生产化：代码签名 / 自动更新（Tauri updater）/ Tauri 2 移植
- 多插件生态下的 ext-host 动态加载实证
- 更大规模会话性能（虚拟滚动已预留）
