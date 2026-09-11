#!/usr/bin/env bash
# 安全地（重）启动 VSCode：只留一个窗口，且不再恢复出空白窗口。
#
# 背景（真实事故）：反复用 `code -n` 打开 + 用 xdg-open 触发 URI（会另起实例）
# + 只杀第一个主进程 + VSCode 默认恢复上次所有窗口
# → 空白窗口越积越多。
#
# 用法：
#   scripts/open-vscode.sh [文件夹]        # 关掉所有实例 → 清空窗口恢复状态 → 只开一个窗口
#   scripts/open-vscode.sh [文件夹] --keep # 同上，但保留其它项目的窗口（只清空窗口）
#   scripts/open-vscode.sh [文件夹] --debug # 额外开启 CDP 调试端口 9222（供 agent-debug 使用）
set -uo pipefail

FOLDER="${1:-$(pwd)}"
KEEP_OTHERS="${2:-}"
FOLDER="$(cd "$FOLDER" && pwd)"
export DISPLAY="${DISPLAY:-:0}"

echo "[open-vscode] 目标窗口：$FOLDER"

# 1) 关掉**所有** VSCode 实例（此前只杀第一个 → 其余实例的窗口残留）
mapfile -t PIDS < <(ps -eo pid,cmd | grep "/usr/share/code/code" | grep -v -- "--type=" | grep -v grep | awk '{print $1}')
if [ "${#PIDS[@]}" -gt 0 ]; then
  echo "[open-vscode] 关闭 ${#PIDS[@]} 个实例（优雅退出，未保存内容走 hot exit）"
  kill -TERM "${PIDS[@]}" 2>/dev/null || true
  for _ in $(seq 1 15); do
    pgrep -f "/usr/share/code/code" >/dev/null 2>&1 || break
    sleep 1
  done
  mapfile -t LEFT < <(ps -eo pid,cmd | grep "/usr/share/code/code" | grep -v -- "--type=" | grep -v grep | awk '{print $1}')
  [ "${#LEFT[@]}" -gt 0 ] && kill -KILL "${LEFT[@]}" 2>/dev/null || true
fi

# 2) 清窗口恢复状态：清掉"空窗口"，并按需只保留目标文件夹
python3 - "$FOLDER" "$KEEP_OTHERS" <<'PY'
import json, pathlib, sys
folder, keep = sys.argv[1], sys.argv[2] == '--keep'
p = pathlib.Path.home()/'.config/Code/User/globalStorage/storage.json'
if not p.exists():
    raise SystemExit(0)
d = json.loads(p.read_text())
bw = d.get('backupWorkspaces') or {}
target = {'folderUri': f'file://{folder}'}
folders = [f for f in (bw.get('folders') or []) if f.get('folderUri') != target['folderUri']]
folders = (folders + [target]) if keep else [target]
d['backupWorkspaces'] = {
    'workspaces': bw.get('workspaces') or [],
    'folders': folders,
    'emptyWindows': [],          # ← 空白窗口就是从这恢复出来的
}
ws = d.get('windowsState')
if isinstance(ws, dict):
    ws['openedWindows'] = []
p.write_text(json.dumps(d))
print(f"[open-vscode] 恢复列表已清理：{len(folders)} 个文件夹，0 个空窗口")
PY

# 3) 只开一个窗口（不用 -n，避免叠加）
ARGS=("$FOLDER")
if [ "${KEEP_OTHERS}" = "--debug" ] || [ "${3:-}" = "--debug" ]; then
  ARGS+=(--remote-debugging-port=0)
  echo "[open-vscode] CDP 调试端口：由系统分配（读取 ~/.config/Code/DevToolsActivePort）"
fi
setsid nohup /usr/share/code/code "${ARGS[@]}" > /tmp/vscode-open.log 2>&1 < /dev/null &
sleep 3
echo "[open-vscode] 已启动 1 个窗口（其它窗口请手动打开）"
