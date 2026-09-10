/**
 * Rules 支持（V2-DECISIONS D12）：兼容 Cursor 的 rules 体系。
 *
 * 读取优先级：
 * 1. 项目根 `.cursorrules`（总是生效）
 * 2. `.cursor/rules/*.mdc`（frontmatter: description / globs / alwaysApply，按 glob 匹配当前文件）
 * 3. 全局 `~/.cursorrules`（总是生效）
 *
 * 关键修复：
 * - 原先忽略 frontmatter 的 `globs` → 所有规则无条件注入（与 Cursor 语义不符）
 * - 原先把 frontmatter（--- 块）原样塞进提示词，浪费 token
 * - 原先每条消息都注入完整 rules（重复计费）→ 由调用方按会话+内容哈希去重
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';

/** 一条项目级 rule。 */
export interface ProjectRule {
  /** 文件名（用于展示）。 */
  name: string;
  /** 规则正文（已剥离 frontmatter）。 */
  body: string;
  /** frontmatter globs（undefined = 无 glob 限制）。 */
  globs?: string[];
  /** frontmatter alwaysApply。 */
  alwaysApply: boolean;
  /** frontmatter description（展示用）。 */
  description?: string;
}

export interface RulesBundle {
  global: string;
  project: ProjectRule[];
}

/** 读取 rules 全集。 */
export function loadRules(workspace: string): RulesBundle {
  return { global: loadGlobalRules(), project: loadProjectRules(workspace) };
}

function loadGlobalRules(): string {
  const p = join(homedir(), '.cursorrules');
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  } catch {
    return '';
  }
}

function loadProjectRules(workspace: string): ProjectRule[] {
  const out: ProjectRule[] = [];
  // 1. 项目根 .cursorrules（总是生效）
  const rootRules = join(workspace, '.cursorrules');
  if (existsSync(rootRules)) {
    try {
      const body = readFileSync(rootRules, 'utf8').trim();
      if (body) out.push({ name: '.cursorrules', body, alwaysApply: true });
    } catch {
      /* ignore */
    }
  }
  // 2. .cursor/rules/*.mdc
  const rulesDir = join(workspace, '.cursor', 'rules');
  if (existsSync(rulesDir)) {
    let files: string[] = [];
    try {
      files = readdirSync(rulesDir);
    } catch {
      files = [];
    }
    for (const f of files) {
      if (extname(f).toLowerCase() !== '.mdc') continue;
      try {
        const parsed = parseMdc(readFileSync(join(rulesDir, f), 'utf8'));
        if (!parsed.body.trim()) continue;
        out.push({ name: f, ...parsed });
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

/** 解析 .mdc：frontmatter（--- 包裹）+ 正文。 */
export function parseMdc(raw: string): Omit<ProjectRule, 'name'> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw.replace(/^\uFEFF/, ''));
  if (!m) return { body: raw.trim(), alwaysApply: true };
  const [, front, body] = m;
  const meta: Record<string, string> = {};
  for (const line of front.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  const globsRaw = meta['globs'] ?? '';
  const globs = globsRaw
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
  return {
    body: body.trim(),
    globs: globs.length > 0 ? globs : undefined,
    alwaysApply: meta['alwaysapply'] === 'true' || globs.length === 0,
    description: meta['description'],
  };
}

/**
 * 生成注入文本。
 * @param activeFileRel 当前活动文件的 workspace 相对路径（用于 globs 过滤）
 */
export function rulesToPrompt(rules: RulesBundle, activeFileRel?: string): string {
  const applicable = rules.project.filter((r) => ruleApplies(r, activeFileRel));
  const parts: string[] = [];
  if (applicable.length > 0) {
    parts.push(
      `【项目 Rules】\n${applicable
        .map((r) => `### ${r.name}\n${r.body}`)
        .join('\n\n')}`,
    );
  }
  if (rules.global.trim()) parts.push(`【全局 Rules】\n${rules.global.trim()}`);
  if (parts.length === 0) return '';
  return `\n\n以下规则必须遵守：\n${parts.join('\n\n')}`;
}

/** 规则是否适用于当前文件。 */
export function ruleApplies(rule: ProjectRule, activeFileRel?: string): boolean {
  if (!rule.globs || rule.globs.length === 0) return true;
  if (!activeFileRel) return true; // 无活动文件信息时不误杀
  return rule.globs.some((g) => matchGlob(g, activeFileRel));
}

/** 简化 glob 匹配（支持 `**`、`*`、`?`）。 */
export function matchGlob(glob: string, path: string): boolean {
  const norm = path.replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` 可匹配零层或多层目录
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  try {
    return new RegExp(`^${re}$`).test(norm);
  } catch {
    return false;
  }
}

/** 规则内容指纹（用于"内容变化才重新注入"）。 */
export function rulesFingerprint(rules: RulesBundle): string {
  const s = `${rules.global}|${rules.project.map((r) => `${r.name}:${r.body}`).join('|')}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}
