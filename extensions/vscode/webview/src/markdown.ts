/**
 * Markdown 渲染（自实现，无第三方依赖 —— CSP 禁止外部资源）。
 *
 * 修复：原实现只认代码块/粗体/行内代码/列表，标题、引用、表格、链接、
 * 嵌套列表、斜体都按纯文本输出（用户反馈"有些 md 没有渲染"）。
 *
 * 策略：先整体 HTML 转义，再做块级/行内解析 —— 不引入未转义的用户内容。
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 行内格式：粗体 / 斜体 / 行内代码 / 链接 / 删除线。 */
export function renderInline(raw: string): string {
  let s = esc(raw);
  // 行内代码优先（避免其内部被后续规则改写）
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // 链接 [text](url)：仅允许 http(s)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) => {
    return `<a href="${url}" title="${url}">${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<i>$2</i>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // 还原行内代码
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${codes[Number(i)] ?? ''}</code>`);
  return s;
}

/** 渲染 markdown → 安全 HTML（供 dangerouslySetInnerHTML）。 */
export function renderMd(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]): void => {
    if (buf.length === 0) return;
    out.push(`<p>${buf.map(renderInline).join('<br>')}</p>`);
    buf.length = 0;
  };
  const para: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // 代码围栏
    const fence = /^\s*```([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      flushParagraph(para);
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // 跳过结束围栏
      const label = lang ? `<span class="md-lang">${esc(lang)}</span>` : '';
      out.push(`<div class="md-pre-wrap">${label}<pre>${esc(body.join('\n'))}</pre></div>`);
      continue;
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(para);
      const level = heading[1].length;
      out.push(`<div class="md-h md-h${level}">${renderInline(heading[2])}</div>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph(para);
      out.push('<hr class="md-hr">');
      i++;
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      flushParagraph(para);
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote class="md-quote">${quote.map(renderInline).join('<br>')}</blockquote>`);
      continue;
    }

    // 表格（| a | b |  +  |---|---|）
    if (/\|/.test(line) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
      flushParagraph(para);
      const parseRow = (l: string): string[] =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const head = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
        rows.push(parseRow(lines[i]));
        i++;
      }
      out.push(
        `<table class="md-table"><thead><tr>${head
          .map((c) => `<th>${renderInline(c)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }

    // 列表（支持缩进层级与有序）
    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listMatch) {
      flushParagraph(para);
      const items: { indent: number; ordered: boolean; text: string }[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push({
          indent: Math.floor(m[1].replace(/\t/g, '  ').length / 2),
          ordered: /\d/.test(m[2]),
          text: m[3],
        });
        i++;
      }
      out.push(renderList(items));
      continue;
    }

    // 空行 → 段落分隔
    if (line.trim() === '') {
      flushParagraph(para);
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushParagraph(para);
  return out.join('');
}

/** 把扁平列表项按缩进还原成嵌套 <ul>/<ol>。 */
function renderList(items: { indent: number; ordered: boolean; text: string }[]): string {
  let html = '';
  const stack: number[] = [];
  const open = (ordered: boolean): void => {
    html += ordered ? '<ol class="md-list">' : '<ul class="md-list">';
  };
  const close = (): void => {
    html += '</ul>';
  };
  for (const item of items) {
    const level = stack.length === 0 ? 0 : Math.min(item.indent, stack.length);
    while (stack.length > level) {
      close();
      stack.pop();
    }
    if (stack.length === level && (stack.length === 0 || item.indent > stack[stack.length - 1])) {
      open(item.ordered);
      stack.push(item.indent);
    }
    html += `<li>${renderInline(item.text)}</li>`;
  }
  while (stack.length > 0) {
    close();
    stack.pop();
  }
  return `<div class="md-list-wrap">${html}</div>`;
}
