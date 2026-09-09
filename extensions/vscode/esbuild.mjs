// VSCode 扩展主进程打包（esbuild）
// 产物：dist/extension.js（CommonJS，VSCode 扩展宿主要求）
import * as esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

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

rmSync('dist', { recursive: true, force: true });

if (watch) {
  const ctx = await esbuild.context(common);
  await ctx.watch();
  console.log('[esbuild] watching...');
} else {
  await esbuild.build(common);
  console.log('[esbuild] built dist/extension.js');
}
