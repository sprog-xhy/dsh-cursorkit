/**
 * 纯文本工具（无 vscode 依赖，便于单元测试）。
 */

/**
 * 去掉模型回复中的 ``` 代码围栏。
 * 支持语言标识、CRLF、以及未闭合的单侧围栏。
 */
export function stripFence(s: string): string {
  const trimmed = s.trim();
  const wrapped = /^```[a-zA-Z0-9_+#.-]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed);
  if (wrapped) return wrapped[1];
  return trimmed;
}

/** 从模型回复中抽取第一段代码块（无围栏时返回原文）。 */
export function extractCodeBlock(s: string): string {
  const m = /```[a-zA-Z0-9_+#.-]*\r?\n([\s\S]*?)```/.exec(s);
  return m ? m[1].replace(/\s+$/, '') : s.trim();
}

/** 保留末尾 n 个字符（前缀裁剪）。 */
export function tailChars(s: string, n: number): string {
  return s.length <= n ? s : s.slice(-n);
}

/** 截断长文本（带省略号）。 */
export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
