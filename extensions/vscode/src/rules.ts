/**
 * Rules 支持（V2-DECISIONS D12）：兼容 Cursor 的 rules 体系。
 *
 * 读取优先级（Cursor 兼容）：
 * 1. 项目根 `.cursorrules`
 * 2. `.cursor/rules/*.mdc`（frontmatter: description/globs，匹配文件时注入）
 * 3. 全局 `~/.cursorrules`
 *
 * 注入方式：作为 system 上下文附加到首次消息（host-dsh 的 session.send 注入）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, extname } from 'node:path';
import * as vscode from 'vscode';

export interface RulesBundle {
  /** 全局 rules（~/.cursorrules） */
  global: string;
  /** 项目 rules（.cursorrules + .cursor/rules/*.mdc 全文） */
  project: string[];
}

/** 读取当前 workspace 的 rules 全集。 */
export function loadRules(workspace: string): RulesBundle {
  const global = loadGlobalRules();
  const project = loadProjectRules(workspace);
  return { global, project };
}

function loadGlobalRules(): string {
  const paths = [join(homedir(), '.cursorrules')];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        /* ignore */
      }
    }
  }
  return '';
}

function loadProjectRules(workspace: string): string[] {
  const out: string[] = [];
  // 1. 项目根 .cursorrules
  const rootRules = join(workspace, '.cursorrules');
  if (existsSync(rootRules)) {
    try {
      const content = readFileSync(rootRules, 'utf8');
      if (content.trim()) out.push(`## .cursorrules（项目根）\n${content}`);
    } catch {
      /* ignore */
    }
  }
  // 2. .cursor/rules/*.mdc
  const rulesDir = join(workspace, '.cursor', 'rules');
  if (existsSync(rulesDir)) {
    try {
      for (const f of readdirSync(rulesDir)) {
        if (extname(f).toLowerCase() === '.mdc') {
          const content = readFileSync(join(rulesDir, f), 'utf8');
          if (content.trim()) out.push(`## ${basename(f)}（.cursor/rules）\n${content}`);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** 把 rules 转成注入文本（附加到消息）。 */
export function rulesToPrompt(rules: RulesBundle): string {
  const parts: string[] = [];
  if (rules.project.length > 0) parts.push(`【项目 Rules】\n${rules.project.join('\n\n')}`);
  if (rules.global.trim()) parts.push(`【全局 Rules】\n${rules.global}`);
  if (parts.length === 0) return '';
  return `\n\n以下规则必须遵守：\n${parts.join('\n\n')}`;
}

/** 当前 workspace（无 active editor 时第一个 root）。 */
export function currentWorkspace(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return '';
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const f = vscode.workspace.getWorkspaceFolder(active);
    if (f) return f.uri.fsPath;
  }
  return folders[0].uri.fsPath;
}
