/**
 * 把 host-dsh / protocol 的构建产物拷进扩展包（bundled/），
 * 让安装后的 vsix 自带依赖（安装形态没有 monorepo 布局）。
 *
 * 用法：node scripts/bundle-deps.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(here, '..');
const repoRoot = resolve(extDir, '..', '..');
const outDir = join(extDir, 'bundled');

/** 拷贝一个包（含 lib 产物、清单、patch、schema）。 */
function bundle(name, extra = []) {
  const src = join(repoRoot, 'packages', name);
  if (!existsSync(join(src, 'lib'))) {
    throw new Error(`${name} 尚未构建（缺少 lib/）——先运行 pnpm -r build`);
  }
  const dest = join(outDir, name);
  mkdirSync(dest, { recursive: true });
  for (const rel of ['package.json', 'cordis.patch.yml', ...extra]) {
    const from = join(src, rel);
    if (!existsSync(from)) continue;
    cpSync(from, join(dest, rel), { recursive: true });
  }
  cpSync(join(src, 'lib'), join(dest, 'lib'), { recursive: true });
  return dest;
}

rmSync(outDir, { recursive: true, force: true });
const host = bundle('host-dsh', ['cordis.patch.yml']);
const protocol = bundle('protocol', ['schema']);
console.log('[bundle-deps] host-dsh →', host);
console.log('[bundle-deps] protocol →', protocol);
