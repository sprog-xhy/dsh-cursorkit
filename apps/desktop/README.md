# dsh-cursorkit Desktop（Electron 壳）

原生桌面壳实现（Electron v44）。加载 `apps/web` 构建产物，管理 dsh sidecar 生命周期，提供 Keychain IPC。

## 运行

```bash
# 1. 构建 web 前端
cd apps/web && pnpm build

# 2. 启动桌面壳（自动复用/拉起 sidecar）
cd apps/desktop && pnpm start
```

需要显示环境（DISPLAY）。无头环境用 `xvfb-run -a pnpm start`。

## 架构

```
Electron 主进程 (electron/main.mjs)
├─ 静态服务器：127.0.0.1:<随机端口> 提供 apps/web/dist
│    （file:// 下 ESM dynamic import 被 CORS 拦，故用 loopback HTTP）
├─ SidecarManager：读 $DSH_HOME/.cursorkit/runtime.json 复用，否则 spawn dsh
├─ Keychain IPC：safeStorage 加密 + 内存 fallback（T-040）
└─ preload.cjs：contextBridge 暴露 dshDesktop.sidecarInfo / dshDesktop.keyring
```

Renderer（apps/web bootstrap）检测 `window.dshDesktop` → 走桌面桥；否则浏览器模式 fetch runtime.json。

## 验证（2026-09-09 实测）

- Electron v44.3.0 启动成功，窗口标题 dsh-cursorkit
- 三栏布局完整渲染（会话列表/聊天流/轨迹面板），真实 sidecar 数据可见
- bash 工具输出（echo hello-parallel && pwd）以代码块呈现
- Keychain IPC 通过 contextBridge 暴露，渲染进程无 nodeIntegration

## 生产化 TODO

- Tauri 2 移植（sidecar 契约已抽象在 src/sidecar.ts）
- 代码签名 + 自动更新（Tauri updater）
- 托盘 + 全局快捷键 + 多窗口（M5）
```
git add -A && git commit -m "feat: Electron 桌面壳实装——静态服务 + sidecar 管理 + Keychain IPC（桌面端到端验证）

- electron/main.mjs：loopback 静态服务提供 web dist（file:// ESM dynamic import 被 CORS 拦的解法）
- SidecarManager：runtime.json 复用/spawn dsh/健康轮询（doc §3.2/3.3）
- Keychain IPC：safeStorage 加密 + fallback（T-040）
- preload.cjs：contextBridge 暴露 dshDesktop（sidecarInfo/keyring）
- web bootstrap 增加桌面桥路径
- 实测：Electron v44 窗口渲染完整三栏 UI，真实 sidecar 数据 + 工具输出代码块可见
- desktop README（运行/架构/验证/TODO）" 2>&1 | tail -1
