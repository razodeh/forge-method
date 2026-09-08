/**
 * `isSupportedNodeVersion` — `03` §3.1 step 1's floor, as a pure string check.
 *
 * @see specs/03 §3.1
 */
import { describe, expect, it } from 'vitest';

import { isSupportedNodeVersion, MIN_NODE_VERSION } from '../../src/entry/node-version.ts';

describe('isSupportedNodeVersion', () => {
  it('accepts the exact floor', () => {
    expect(isSupportedNodeVersion(`v${MIN_NODE_VERSION}`)).toBe(true);
  });

  it('accepts a newer patch, minor, and major', () => {
    expect(isSupportedNodeVersion('v20.10.1')).toBe(true);
    expect(isSupportedNodeVersion('v20.11.0')).toBe(true);
    expect(isSupportedNodeVersion('v22.0.0')).toBe(true);
  });

  it('rejects an older patch, minor, and major', () => {
    expect(isSupportedNodeVersion('v20.9.9')).toBe(false);
    expect(isSupportedNodeVersion('v20.9.99')).toBe(false);
    expect(isSupportedNodeVersion('v18.17.0')).toBe(false);
  });

  it('accepts the real running Node, since the workspace itself requires a newer floor', () => {
    expect(isSupportedNodeVersion(process.version)).toBe(true);
  });

  it('treats an unparseable string as unsupported', () => {
    expect(isSupportedNodeVersion('not-a-version')).toBe(false);
    expect(isSupportedNodeVersion('')).toBe(false);
  });
});
