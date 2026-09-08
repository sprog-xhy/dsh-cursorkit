/**
 * CKP request/response/event envelopes.
 *
 * @module @dsh-cursorkit/protocol/envelope
 */

export interface Request<T = unknown> {
  id: string;
  method: string;
  params: T;
}

export type Response<T = unknown> =
  | { id: string; ok: true; result: T }
  | { id: string; ok: false; error: { code: string; message: string; data?: unknown } };

/** Helper to build a success response. */
export function okResponse<T>(id: string, result: T): Response<T> {
  return { id, ok: true, result };
}

/** Helper to build an error response. */
export function errResponse(id: string, error: { code: string; message: string; data?: unknown }): Response<never> {
  return { id, ok: false, error };
}
