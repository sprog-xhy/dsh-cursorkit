// VSCode 扩展主进程打包（esbuild）
// 产物：dist/extension.js（CommonJS，VSCode 扩展宿主要求）
import * as esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const common = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};

// 只清理本脚本自己的产物：dist/ 里还有 Vite 构建的 webview 包（dist/webview），
// 之前无条件 rmSync('dist') 会把 webview 一起删掉 → 打出来的 vsix 缺前端资源 → Chat 白屏。
mkdirSync('dist', { recursive: true });
rmSync('dist/extension.js', { force: true });
rmSync('dist/extension.js.map', { force: true });

if (watch) {
  const ctx = await esbuild.context(common);
  await ctx.watch();
  console.log('[esbuild] watching...');
} else {
  await esbuild.build(common);
  console.log('[esbuild] built dist/extension.js');
}
