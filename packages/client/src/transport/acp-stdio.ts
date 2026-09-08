/**
 * ACP stdio transport — [P1] placeholder. The HTTP transport is the primary
 * path (doc D1); ACP remains a remote/compat fallback.
 *
 * @module @dsh-cursorkit/client/transport/acp-stdio
 */

import type { CkpEvent } from '@dsh-cursorkit/protocol';
import type { Disposer, SubscribeOptions, Transport } from './types.ts';

export class AcpStdioTransport implements Transport {
  readonly kind = 'acp-stdio' as const;

  constructor() {
    throw new Error('AcpStdioTransport: not implemented yet ([P1] ACP adapter)');
  }

  async call(): Promise<never> {
    throw new Error('AcpStdioTransport: not implemented yet ([P1] ACP adapter)');
  }

  subscribe(_sessionId: string, _opts: SubscribeOptions): Disposer {
    throw new Error('AcpStdioTransport: not implemented yet ([P1] ACP adapter)');
  }
}

/** Re-export for a stable Transport union type in the SDK facade. */
export type { CkpEvent };
