import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CKP_METHODS,
  isCkpMethod,
  protocolId,
  CKP_PROTOCOL_VERSION,
  checkVersion,
  CKP_ERRORS,
  CkpError,
  okResponse,
  errResponse,
} from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('version', () => {
  it('serializes to ckp/1', () => {
    expect(protocolId()).toBe('ckp/1');
    expect(CKP_PROTOCOL_VERSION).toBe('ckp/1');
  });

  it('accepts same major, same minor', () => {
    const r = checkVersion('ckp/1');
    expect(r.compatible).toBe(true);
    expect(r.exact).toBe(true);
  });

  it('warns but continues on minor mismatch', () => {
    const r = checkVersion('ckp/1.2');
    expect(r.compatible).toBe(true);
    expect(r.exact).toBe(false);
  });

  it('blocks on major mismatch', () => {
    const r = checkVersion('ckp/2');
    expect(r.compatible).toBe(false);
  });

  it('blocks on unknown protocol', () => {
    const r = checkVersion('garbage');
    expect(r.compatible).toBe(false);
  });
});

describe('errors', () => {
  it('has all error codes with messages', () => {
    expect(CKP_ERRORS.CAPABILITY_MISSING).toBeTruthy();
    expect(CKP_ERRORS.SESSION_NOT_FOUND).toBeTruthy();
    expect(CKP_ERRORS.APPROVAL_TIMEOUT).toBeTruthy();
  });

  it('CkpError serializes to the wire shape', () => {
    const e = new CkpError('CAPABILITY_MISSING', undefined, ['sessions.fork']);
    expect(e.toJSON()).toEqual({
      code: 'CAPABILITY_MISSING',
      message: CKP_ERRORS.CAPABILITY_MISSING,
      data: ['sessions.fork'],
    });
  });

  it('CkpError.from normalizes unknown errors to INTERNAL', () => {
    expect(CkpError.from(new Error('boom')).code).toBe('INTERNAL');
    expect(CkpError.from('nope').code).toBe('INTERNAL');
    expect(CkpError.from(new CkpError('SESSION_NOT_FOUND')).code).toBe('SESSION_NOT_FOUND');
  });
});

describe('envelope', () => {
  it('builds ok/err responses', () => {
    expect(okResponse('1', { a: 1 })).toEqual({ id: '1', ok: true, result: { a: 1 } });
    expect(errResponse('1', { code: 'INTERNAL', message: 'x' })).toEqual({
      id: '1',
      ok: false,
      error: { code: 'INTERNAL', message: 'x' },
    });
  });
});

describe('methods', () => {
  it('lists every method and validates membership', () => {
    expect(CKP_METHODS).toContain('session.list');
    expect(CKP_METHODS).toContain('diff.get');
    expect(isCkpMethod('session.create')).toBe(true);
    expect(isCkpMethod('nope.nope')).toBe(false);
  });

  it('methods snapshot matches schema/methods.schema.json', () => {
    const schema = JSON.parse(
      readFileSync(join(here, '../schema/methods.schema.json'), 'utf8'),
    ) as { properties: Record<string, unknown> };
    const schemaMethods = Object.keys(schema.properties).sort();
    expect(schemaMethods).toEqual([...CKP_METHODS].sort());
  });
});
