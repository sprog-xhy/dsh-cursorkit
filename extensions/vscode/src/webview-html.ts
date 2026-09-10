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
