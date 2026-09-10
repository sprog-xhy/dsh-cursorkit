/**
 * webview HTML 渲染（面板与侧边栏视图共用）。
 * CSP 与 panel.ts 原实现保持一致（handoff §5.1 禁止改动 CSP）。
 */
import * as vscode from 'vscode';

export function renderWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'chat.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'chat.css'));
  const nonce = getNonce();
  // 诊断用 bootstrap：
  // - VSCode 只允许调用一次 acquireVsCodeApi → 这里获取并挂到 window，业务脚本复用它
  // - 捕获 JS 运行时错误/未处理 rejection 并回报给扩展（写进 activity.log）
  // - 渲染自检：若 3s 后 #root 仍为空，回报 webviewEmpty（"面板空白"会自报）
  const bootstrap = `<script nonce="${nonce}">
  (function () {
    var api;
    try {
      api = acquireVsCodeApi();
      window.__dshApi = api;
    } catch (e) {
      api = window.__dshApi || { postMessage: function () {}, getState: function () {}, setState: function () {} };
    }
    function report(kind, message, extra) {
      try {
        api.postMessage({ type: 'webviewError', kind: kind, message: String(message || 'unknown').slice(0, 400), extra: extra ? String(extra).slice(0, 600) : '' });
      } catch (e) { /* ignore */ }
    }
    window.addEventListener('error', function (e) {
      report('error', (e && e.message) || 'window.onerror', e && e.error && e.error.stack);
    });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      report('unhandledrejection', (r && (r.message || r)) || 'unknown', r && r.stack);
    });
    window.__dshReport = report;
    function digest() {
      function n(sel) { try { return document.querySelectorAll(sel).length; } catch (e) { return -1; } }
      var root = document.getElementById('root');
      var nodes = root ? root.querySelectorAll('*').length : -1;
      var empty = document.querySelector('.empty-title');
      function attr(sel, a) { try { var e = document.querySelector(sel); return e ? (e.getAttribute(a) || e.textContent || '') : '-'; } catch (x) { return '-'; } }
      var statusText = attr('[data-dsh="status"]', 'class');
      return 'status=' + (statusText.indexOf('status-ready') >= 0 ? 'ready' : statusText.replace('dot status-', '')) +
        ' model=' + attr('[data-dsh="model"]', 'data-x') +
        ' session=' + attr('[data-dsh="session"]', 'data-x') +
        ' sidecar=' + attr('.topbar-sidecar', 'data-x') +
        ' nodes=' + nodes +
        ' topbar=' + n('.topbar') +
        ' composer=' + n('.composer') +
        ' messages=' + n('.messages') +
        ' msgItems=' + n('.msg') +
        ' panels=' + n('.panel') +
        ' empty=' + (empty ? empty.textContent : '-') +
        ' ready=' + (document.querySelector('.status-ready') ? 1 : 0) +
        ' viewport=' + window.innerWidth + 'x' + window.innerHeight;
    }
    window.addEventListener('load', function () {
      // 3s 与 12s 各报一次：前者确认挂载，后者确认数据（会话/改动）已到位
      setTimeout(function () { report('render', digest(), ''); }, 3000);
      setTimeout(function () { report('render-late', digest(), ''); }, 12000);
    });
  })();
  </script>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${styleUri}">
</head>
<body>
<div id="root"></div>
${bootstrap}
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
