/**
 * Protocol version and negotiation.
 *
 * Major mismatch blocks the client; minor mismatch warns and continues.
 *
 * @module @dsh-cursorkit/protocol/version
 */

/** The protocol name carried in the runtime.json and /health responses. */
export const CKP_PROTOCOL_NAME = 'ckp' as const;

/** Current protocol version. Breaking changes bump `major`. */
export const CKP_VERSION = {
  major: 1,
  minor: 0,
  patch: 0,
} as const;

/** Serialized form: `ckp/1` */
export function protocolId(version: { major: number; minor: number } = CKP_VERSION): string {
  return `${CKP_PROTOCOL_NAME}/${version.major}`;
}

/** The protocol version string this client speaks. */
export const CKP_PROTOCOL_VERSION = protocolId();

export interface VersionCheckResult {
  compatible: boolean;
  /** true when versions match exactly. */
  exact: boolean;
  /** Human-readable explanation. */
  message: string;
}

/**
 * Compare a host-reported protocol version against the client's.
 * Same major → compatible; different major → incompatible (block);
 * same major + different minor → compatible with a warning.
 */
export function checkVersion(hostProtocolVersion: string): VersionCheckResult {
  const match = /^ckp\/(\d+)(?:\.(\d+))?/.exec(hostProtocolVersion);
  if (!match) {
    return {
      compatible: false,
      exact: false,
      message: `unknown protocol version "${hostProtocolVersion}"`,
    };
  }
  const hostMajor = Number(match[1]);
  if (hostMajor !== CKP_VERSION.major) {
    return {
      compatible: false,
      exact: false,
      message: `protocol major mismatch: host speaks ${hostProtocolVersion}, client speaks ${CKP_PROTOCOL_VERSION} — upgrade the app or the host plugin`,
    };
  }
  const hostMinor = Number(match[2] ?? 0);
  if (hostMinor === CKP_VERSION.minor) {
    return { compatible: true, exact: true, message: 'protocol versions match' };
  }
  return {
    compatible: true,
    exact: false,
    message: `protocol minor mismatch: host ${hostProtocolVersion}, client ${CKP_PROTOCOL_VERSION} — continuing with warning`,
  };
}
