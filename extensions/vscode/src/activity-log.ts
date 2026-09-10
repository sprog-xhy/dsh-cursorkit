/**
 * 活动日志（落盘，供命令行排障与自动化监控）。
 *
 * 背景：扩展的诊断信息原先只写到 VSCode 的 OutputChannel（只能在 GUI 看），
 * 排查"用户操作触发了什么/哪里报错"时无法从外部观察。
 * 这里把关键动作与错误同步追加到 `$DSH_HOME/.cursorkit/activity.log`。
 *
 * 设计：
 * - 尽力而为：任何写入失败都不影响主流程（try/catch 吞掉）
 * - 单文件上限 1MB，超过则截断保留尾部（避免无限增长）
 * - 每行带 ISO 时间戳，便于与 session 日志对齐
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 日志文件上限（字节）。 */
export const MAX_LOG_BYTES = 1024 * 1024;

let logFile: string | null = null;

/** 绑定日志文件路径（扩展激活时调用一次）。 */
export function initActivityLog(dshHome: string): void {
  logFile = join(dshHome, '.cursorkit', 'activity.log');
}

/** 当前日志文件路径（未初始化返回 null）。 */
export function activityLogPath(): string | null {
  return logFile;
}

/** 追加一行（自动加时间戳；失败静默）。 */
export function activityLog(message: string): void {
  if (!logFile) return;
  try {
    mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
    rotateIfNeeded(logFile);
    appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`, { mode: 0o600 });
  } catch {
    /* 尽力而为 */
  }
}

/** 超过上限时截断保留尾部一半。 */
export function rotateIfNeeded(file: string, max = MAX_LOG_BYTES): boolean {
  try {
    if (!existsSync(file)) return false;
    if (statSync(file).size <= max) return false;
    const content = readFileSync(file, 'utf8');
    writeFileSync(file, `${content.slice(-Math.floor(max / 2))}`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
