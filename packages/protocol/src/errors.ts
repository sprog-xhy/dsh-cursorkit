/**
 * CKP error codes and the CkpError envelope.
 *
 * @module @dsh-cursorkit/protocol/errors
 */

/** Every CKP error code with its default user-facing message. */
export const CKP_ERRORS = {
  CAPABILITY_MISSING: 'dsh 当前版本缺少该能力',
  UNSUPPORTED_DSH_VERSION: 'dsh 版本不受支持',
  SESSION_NOT_FOUND: '会话不存在',
  SESSION_BUSY: '会话正在运行中',
  APPROVAL_TIMEOUT: '审批超时',
  APPROVAL_NOT_FOUND: '审批请求已失效',
  PERMISSION_DENIED: '权限被拒绝',
  TRANSPORT_ERROR: '传输错误',
  INTERNAL: '内部错误',
} as const;

export type CkpErrorCode = keyof typeof CKP_ERRORS;

/** Error object carried inside a failed Response envelope. */
export interface CkpErrorBody {
  code: CkpErrorCode;
  message: string;
  /** Optional structured detail (e.g. the missing capability list). */
  data?: unknown;
}

/** Error class the client and host both throw for CKP-level failures. */
export class CkpError extends Error {
  readonly code: CkpErrorCode;
  readonly data?: unknown;

  constructor(code: CkpErrorCode, message?: string, data?: unknown) {
    super(message ?? CKP_ERRORS[code]);
    this.name = 'CkpError';
    this.code = code;
    this.data = data;
  }

  toJSON(): CkpErrorBody {
    return { code: this.code, message: this.message, data: this.data };
  }

  static from(err: unknown): CkpError {
    if (err instanceof CkpError) return err;
    if (typeof err === 'object' && err !== null && 'code' in err) {
      const e = err as { code: string; message?: string; data?: unknown };
      if (e.code in CKP_ERRORS) {
        return new CkpError(e.code as CkpErrorCode, e.message, e.data);
      }
      return new CkpError('INTERNAL', e.message, e.data);
    }
    const message = err instanceof Error ? err.message : String(err);
    return new CkpError('INTERNAL', message);
  }
}
