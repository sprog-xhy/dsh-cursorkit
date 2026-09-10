/**
 * CKP host-side error mapping: CkpError → HTTP status.
 *
 * @module @dsh-cursorkit/host-dsh/rpc/errors
 */

import type { CkpErrorCode } from '@dsh-cursorkit/protocol';

/** HTTP status per CKP error code. */
const STATUS_BY_CODE: Record<CkpErrorCode, number> = {
  CAPABILITY_MISSING: 501,
  UNSUPPORTED_DSH_VERSION: 426,
  SESSION_NOT_FOUND: 404,
  SESSION_BUSY: 409,
  INVALID_PARAMS: 400,
  APPROVAL_TIMEOUT: 408,
  APPROVAL_NOT_FOUND: 404,
  PERMISSION_DENIED: 403,
  TRANSPORT_ERROR: 502,
  INTERNAL: 500,
};

export function httpStatusForCode(code: CkpErrorCode): number {
  return STATUS_BY_CODE[code] ?? 500;
}

/** Generic HttpError with status, for routing/body-level failures. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
