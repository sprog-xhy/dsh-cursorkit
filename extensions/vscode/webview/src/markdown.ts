/**
 * 轻量 markdown 渲染（阶段三产物，逻辑与旧 main.tsx 一致）。
 * 转义 HTML，支持代码块/粗体/行内代码/列表（M2 Composer 计划）。
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 渲染 markdown → 安全 HTML（供 dangerouslySetInnerHTML）。 */
export function renderMd(src: string): string {
  let out = '';
  const lines = src.split('\n');
  let inCode = false;
  let codeLines: string[] = [];
  const flushCode = () => {
    if (codeLines.length > 0) {
      out += `<pre>${esc(codeLines.join('\n'))}</pre>`;
      codeLines = [];
    }
  };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    let l = esc(line);
    if (/^\s*[-*•]\s+/.test(l)) {
      out += `<div class="md-li">${l.replace(/^\s*[-*•]\s+/, '')}</div>`;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(l)) {
      out += `<div class="md-li">${l.replace(/^\s*\d+\.\s+/, '')}</div>`;
      continue;
    }
    l = l.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    l = l.replace(/`([^`]+)`/g, '<code>$1</code>');
    if (l.trim()) out += `<div class="md-line">${l}</div>`;
  }
  flushCode();
  return out;
}
