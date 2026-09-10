#!/usr/bin/env bash
# dsh-cursorkit 一键安装脚本（V2-DECISIONS D21）
# 前置：Node.js ≥ 18 + dsh + LLM 凭据
# 用法：bash scripts/install.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$REPO_ROOT/extensions/vscode"
DSH_HOME="${CK_DSH_HOME:-$HOME/.dsh-cursorkit}"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

say()  { echo -e "${GREEN}[install]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
fail() { echo -e "${RED}[error]${NC} $*"; exit 1; }

# 1. 前置检查
command -v node >/dev/null 2>&1 || fail "未找到 node。请先安装 Node.js ≥ 18：https://nodejs.org"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 18 ] || fail "node 版本过低（$NODE_MAJOR），需要 ≥ 18"

if command -v dsh >/dev/null 2>&1; then
  DSH_VER=$(dsh --version 2>/dev/null | head -1 || echo "?")
  say "dsh 已安装: $DSH_VER"
else
  warn "未找到 dsh，正在安装 dsh@0.1.1-rc.2（V2-DECISIONS D2 固定版本）…"
  npm i -g @deepseek-ai/dsh@0.1.1-rc.2
fi

if [ -f "$DSH_HOME/settings.yaml" ]; then
  say "DSH_HOME=$DSH_HOME settings.yaml 已就绪"
else
  warn "未找到 $DSH_HOME/settings.yaml —— 需要配置 LLM provider 才能使用。"
  warn "参考仓库 README：复制 wps provider 配置（ai-kas.kso.net）与 .credentials.yaml"
fi

# 2. 构建
say "构建扩展（esbuild + webview）…"
command -v pnpm >/dev/null 2>&1 || fail "未找到 pnpm。请先安装：npm i -g pnpm"
cd "$REPO_ROOT"
pnpm -r build >/dev/null 2>&1 || true
cd "$EXT_DIR"
# vsce 打包需要 LICENSE（仓库 .gitignore 排除了产物，install 时从根复制）
[ -f LICENSE.txt ] || cp "$REPO_ROOT/LICENSE" LICENSE.txt
node esbuild.mjs >/dev/null 2>&1
cd webview && pnpm build >/dev/null 2>&1
cd "$EXT_DIR"

# 3. 打包 vsix
say "打包 vsix…"
npx vsce package --no-dependencies >/dev/null 2>&1 || true
VSIX=$(ls -t dsh-cursorkit-*.vsix | head -1)
[ -n "$VSIX" ] || fail "vsix 打包失败"
say "生成: $EXT_DIR/$VSIX"

# 4. 安装到 VSCode
if command -v code >/dev/null 2>&1; then
  say "安装到 VSCode…"
  code --install-extension "$EXT_DIR/$VSIX" --force
  say "✅ 安装完成！打开 VSCode，活动栏 ⚡ 或 Ctrl+Alt+C 开始使用"
else
  warn "未找到 code 命令。请手动安装：code --install-extension $EXT_DIR/$VSIX"
fi
