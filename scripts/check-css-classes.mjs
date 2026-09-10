/**
 * CSS 类名交叉检查（CI 自查）：
 * - 收集 webview 组件里用到的 className（字面量 + 模板串静态部分）
 * - 收集 chat.css / tokens.css 里定义的类
 * - 报告「用了但没样式」与「有样式但没人用」的类
 *
 * 用途：抓出此类回归（例如曾经的 .panel-open 只写不生效）。
 * 用法：node scripts/check-css-classes.mjs [--strict]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const WEBVIEW = join(ROOT, 'extensions/vscode/webview/src');
const strict = process.argv.includes('--strict');

/** 递归收集 .tsx/.ts 文件。 */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** 从源码里提取 className 候选。 */
function classesInSource(src) {
  const found = new Set();
  // className="a b c"
  for (const m of src.matchAll(/className="([^"]+)"/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach((c) => found.add(c));
  }
  // className={`a ${cond ? 'b' : ''}`} → 保留模板内的字面量片段
  for (const m of src.matchAll(/className=\{`([^`]+)`\}/g)) {
    const body = m[1];
    body.replace(/\$\{([^}]*)\}/g, (_all, expr) => {
      // 去掉 cls('...') 这类辅助调用（其参数是面板名，不是类名）
      const cleaned = expr.replace(/\bcls\('[^']*'\)/g, ' ');
      for (const lit of cleaned.matchAll(/'([^']*)'/g)) {
        lit[1].split(/\s+/).filter(Boolean).forEach((c) => found.add(c));
      }
      return ' ';
    });
    body.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean).forEach((c) => found.add(c));
  }
  // class="..."（markdown/HTML 字符串）
  for (const m of src.matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach((c) => found.add(c));
  }
  return found;
}

/** 从 CSS 里提取类名（先去掉注释，避免注释里的文件名被当成类名）。 */
function classesInCss(css) {
  const found = new Set();
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of stripped.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) found.add(m[1]);
  return found;
}

const cssFiles = ['chat.css', 'tokens.css'].map((f) => join(WEBVIEW, f));
const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const defined = classesInCss(css);

const used = new Set();
for (const file of walk(WEBVIEW)) {
  if (file.endsWith('.css')) continue;
  for (const c of classesInSource(readFileSync(file, 'utf8'))) used.add(c);
}

// 动态拼接的类名（模板里的条件片段）无法静态判定，排除已知前缀集合
const dynamicPrefixes = ['status-', 'item-', 'msg-', 'tool-', 'mode-', 'tb-', 'panel-', 'stat-'];
const isDynamicCandidate = (c) => dynamicPrefixes.some((p) => c.startsWith(p)) === false;

const usedNoStyle = [...used].filter((c) => !defined.has(c)).filter(isDynamicCandidate).sort();
const styleNoUse = [...defined]
  .filter((c) => !used.has(c))
  .filter((c) => !c.startsWith('vscode-'))
  .filter((c) => !c.startsWith('ds-'))
  .filter((c) => !dynamicPrefixes.some((p) => c.startsWith(p)))
  .sort();

console.log(`类名统计：源码使用 ${used.size} 个 / CSS 定义 ${defined.size} 个`);
if (usedNoStyle.length) {
  console.log(`\n⚠️  使用了但没有样式定义（${usedNoStyle.length}）：`);
  usedNoStyle.forEach((c) => console.log(`   - .${c}`));
} else {
  console.log('\n✅ 没有"用了但没样式"的类');
}
if (styleNoUse.length) {
  console.log(`\nℹ️  CSS 定义但未在源码中出现（${styleNoUse.length}，可能是动态拼接或历史残留）：`);
  styleNoUse.forEach((c) => console.log(`   - .${c}`));
}

if (strict && usedNoStyle.length) process.exit(1);
