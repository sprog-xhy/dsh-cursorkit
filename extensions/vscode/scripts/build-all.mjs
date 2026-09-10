/**
 * 一次构建全部产物（顺序敏感）+ 产物校验。
 *
 * 顺序：扩展主进程（esbuild）→ webview（vite，输出到 ../dist/webview）→ 内置依赖（bundled/）
 * 校验：打包前必须确认三类产物齐全，否则打出的 vsix 会出现"Chat 白屏"（历史事故）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(here, '..');
const run = (cmd, args, cwd) => {
  console.log(`[build-all] ${cmd} ${args.join(' ')}  (cwd=${cwd.replace(extDir, '.')})`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
};

run('node', ['esbuild.mjs'], extDir);
run('pnpm', ['build'], join(extDir, 'webview'));
run('node', [join('scripts', 'bundle-deps.mjs')], extDir);

const required = [
  join(extDir, 'dist', 'extension.js'),
  join(extDir, 'dist', 'webview', 'chat.js'),
  join(extDir, 'dist', 'webview', 'chat.css'),
  join(extDir, 'bundled', 'host-dsh', 'lib', 'index.js'),
  join(extDir, 'bundled', 'protocol', 'lib', 'index.js'),
];
const missing = required.filter((p) => !existsSync(p) || statSync(p).size === 0);
if (missing.length > 0) {
  console.error('[build-all] ❌ 产物缺失（打出的 vsix 会不可用）：');
  for (const m of missing) console.error('   -', m.replace(extDir, '.'));
  process.exit(1);
}
console.log('[build-all] ✅ 产物齐全：');
for (const p of required) console.log('   -', p.replace(extDir, '.'), `${(statSync(p).size / 1024).toFixed(0)}KB`);
