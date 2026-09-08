import type { CSSProperties, ReactNode } from 'react';
import { colors, fonts } from './lib/theme.ts';

export interface MarkdownProps {
  text: string;
  className?: string;
}

/**
 * Lightweight, streaming-safe Markdown renderer. NO external dependencies.
 *
 * Supported syntax: `#`/`##`/`###` headings, fenced code blocks (```),
 * inline code (`` ` ``), bold (`**`), bullet/numbered lists, paragraphs and
 * links `[t](u)`.
 *
 * Streaming safety: an unclosed code fence renders the remaining text as a
 * code block; unclosed inline markers are shown verbatim; raw HTML is never
 * emitted (everything is escaped first). Link hrefs are restricted to
 * http/https/mailto.
 */

const H1 = 18;
const H2 = 15.5;
const H3 = 14;

const baseParagraph: CSSProperties = {
  margin: '4px 0',
  fontSize: 13.5,
  lineHeight: 1.65,
  color: colors.text,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isSafeUrl(u: string): boolean {
  return /^(https?:|mailto:)/i.test(u);
}

/** Render inline spans: `code`, **bold**, [text](url); anything else verbatim. */
function renderInline(raw: string, keyBase: string): ReactNode[] {
  const text = escapeHtml(raw);
  const re = /(`[^`]*`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\))/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const inner = token.slice(1, -1); // strip delimiters
    if (token.startsWith('`')) {
      out.push(
        <code
          key={`${keyBase}-c${i}`}
          style={{
            fontFamily: fonts.mono,
            fontSize: 12,
            backgroundColor: colors.graySoft,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            padding: '0 4px',
            color: colors.redDark,
          }}
        >
          {inner}
        </code>,
      );
    } else if (token.startsWith('**')) {
      out.push(
        <strong key={`${keyBase}-b${i}`} style={{ fontWeight: 600 }}>
          {inner}
        </strong>,
      );
    } else if (token.startsWith('[')) {
      const close = token.lastIndexOf('](');
      const label = token.slice(1, close);
      const url = token.slice(close + 2, -1);
      if (isSafeUrl(url)) {
        out.push(
          <a
            key={`${keyBase}-a${i}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{ color: colors.blue, textDecoration: 'none' }}
          >
            {label}
          </a>,
        );
      } else {
        out.push(label);
      }
    }
    last = m.index + token.length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function heading(text: string, level: number, key: string): ReactNode {
  const size = level === 1 ? H1 : level === 2 ? H2 : H3;
  const style: CSSProperties = {
    margin: '8px 0 4px',
    fontSize: size,
    fontWeight: 600,
    lineHeight: 1.4,
    color: colors.text,
  };
  const children = renderInline(text, key);
  if (level === 1) return <h1 key={key} style={style}>{children}</h1>;
  if (level === 2) return <h2 key={key} style={style}>{children}</h2>;
  return <h3 key={key} style={style}>{children}</h3>;
}

export function Markdown({ text, className }: MarkdownProps) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let key = 0;
  let inCode = false;
  let codeLines: string[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: ReactNode[][] } | null = null;

  const flushParagraph = () => {
    if (para.length === 0) return;
    blocks.push(
      <p key={`p${key++}`} style={baseParagraph}>
        {renderInline(para.join(' '), `p${key}`)}
      </p>,
    );
    para = [];
  };

  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    const listStyle: CSSProperties = {
      margin: '4px 0 4px 4px',
      paddingLeft: 20,
      fontSize: 13.5,
      lineHeight: 1.65,
      color: colors.text,
    };
    const children = items.map((item, i) => (
      <li key={`${key}-${i}`} style={{ margin: '1px 0' }}>
        {renderInline(item.join(' '), `li${key}-${i}`)}
      </li>
    ));
    blocks.push(
      ordered ? (
        <ol key={`l${key++}`} style={listStyle}>{children}</ol>
      ) : (
        <ul key={`l${key++}`} style={listStyle}>{children}</ul>
      ),
    );
    list = null;
  };

  const flushCode = () => {
    if (codeLines.length === 0) return;
    blocks.push(
      <pre
        key={`c${key++}`}
        style={{
          margin: '6px 0',
          padding: '8px 10px',
          backgroundColor: '#fafaf9',
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          overflowX: 'auto',
          fontSize: 12.5,
          lineHeight: 1.55,
          color: colors.text,
          fontFamily: fonts.mono,
        }}
      >
        <code>{codeLines.join('\n')}</code>
      </pre>,
    );
    codeLines = [];
  };

  for (const line of lines) {
    const fence = /^```/.test(line);
    if (fence) {
      flushParagraph();
      flushList();
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        // Opening fence: whatever came before was a header line we ignore
        // (the fence marker itself is never rendered).
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      flushParagraph();
      flushList();
      blocks.push(heading(h[2] ?? '', h[1]?.length ?? 1, `h${key++}`));
      continue;
    }

    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    const numbered = /^(\d+)[.)]\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      const item = (bullet?.[1] ?? numbered?.[2]) ?? '';
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push([item]);
      continue;
    }

    // Plain paragraph line (joins with previous paragraph lines).
    flushList();
    para.push(line);
  }

  flushParagraph();
  flushList();
  if (inCode) flushCode(); // streaming-safe: unclosed fence

  return (
    <div className={className ? `ck-markdown ${className}` : 'ck-markdown'} style={{ fontFamily: fonts.sans }}>
      {blocks}
    </div>
  );
}
