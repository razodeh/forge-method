/**
 * `supportsNativeStripTypes`'s own version-boundary logic, and `TS_NODE_FLAG`'s real shape --
 * pinned directly, not only exercised indirectly through every call site that imports it.
 *
 * @see scripts/lib/node-ts-flag.mjs
 * @see SPEC-QUESTIONS.md Q340
 */
import { describe, expect, it } from 'vitest';

import {
  SUPPORTS_NATIVE_STRIP_TYPES,
  TS_NODE_FLAG,
  supportsNativeStripTypes,
} from './node-ts-flag.mjs';

describe('supportsNativeStripTypes', () => {
  it('is false for every real Node 20.x version string, regardless of patch', () => {
    expect(supportsNativeStripTypes('20.10.0')).toBe(false);
    expect(supportsNativeStripTypes('20.19.6')).toBe(false);
    expect(supportsNativeStripTypes('20.20.2')).toBe(false);
  });

  it('is false for Node 22.x below the real 22.6.0 cutoff, true at and above it', () => {
    expect(supportsNativeStripTypes('22.0.0')).toBe(false);
    expect(supportsNativeStripTypes('22.5.9')).toBe(false);
    expect(supportsNativeStripTypes('22.6.0')).toBe(true);
    expect(supportsNativeStripTypes('22.14.0')).toBe(true);
  });

  it('is true for every Node major above 22', () => {
    expect(supportsNativeStripTypes('23.0.0')).toBe(true);
    expect(supportsNativeStripTypes('24.0.0')).toBe(true);
    expect(supportsNativeStripTypes('24.21.0')).toBe(true);
  });
});

describe('SUPPORTS_NATIVE_STRIP_TYPES / TS_NODE_FLAG — resolved for the real, currently running process', () => {
  it('SUPPORTS_NATIVE_STRIP_TYPES matches supportsNativeStripTypes(process.versions.node)', () => {
    expect(SUPPORTS_NATIVE_STRIP_TYPES).toBe(supportsNativeStripTypes(process.versions.node));
  });

  it('is the bare native flag when supported, or a real file:// URL --import= when not -- never a bare specifier and never a plain OS-native path (Q340 critic findings: a bare "tsx/esm" specifier resolves against the SPAWNED CHILD\'s own cwd, not this file\'s location, and breaks for any child spawned outside this repo; a plain OS-native absolute path breaks on Windows -- see the test below)', () => {
    if (SUPPORTS_NATIVE_STRIP_TYPES) {
      expect(TS_NODE_FLAG).toBe('--experimental-strip-types');
    } else {
      expect(TS_NODE_FLAG.startsWith('--import=')).toBe(true);
      const importValue = TS_NODE_FLAG.slice('--import='.length);
      expect(importValue.startsWith('file://')).toBe(true);
      expect(importValue.endsWith('.mjs')).toBe(true);
    }
  });
});

describe("TS_NODE_FLAG's --import value must be a real file:// URL, never a plain OS-native path (Q340 critic finding: Windows + Node 20)", () => {
  // Real, empirically-confirmed root cause (verified live on a real Node 20.19.6 binary, the identical
  // bug class packages/cli/test/preflight.test.ts already pins for dynamic import()): --import's value
  // goes through the same WHATWG-URL-based ESM specifier algorithm, and `new URL('C:\\...')` parses
  // successfully but with `protocol: 'c:'` -- the drive letter is read as a URL *scheme*, not a
  // filesystem root -- which is exactly what makes real Node.js throw `ERR_UNSUPPORTED_ESM_URL_SCHEME`
  // for a bare OS-native absolute path on Windows. A bare POSIX absolute path has no such scheme
  // prefix, which is exactly why this bug class ships unnoticed on any darwin/linux-only dev machine
  // or CI leg.
  it('a bare Windows-style drive-letter path is parsed with the drive letter as a URL scheme, not a file path', () => {
    const url = new URL('C:\\Users\\dev\\forge-method\\node_modules\\tsx\\dist\\esm\\index.mjs');
    expect(url.protocol).toBe('c:');
    expect(url.protocol).not.toBe('file:');
  });

  it("TS_NODE_FLAG's own --import value, on the tsx branch, is never a bare OS-native path", () => {
    if (SUPPORTS_NATIVE_STRIP_TYPES) return; // nothing to assert on the native-flag branch
    const importValue = TS_NODE_FLAG.slice('--import='.length);
    // new URL() on a real file:// URL always normalizes to the 'file:' protocol, on every OS --
    // the one property that distinguishes it from a plain OS-native path handed to the same parser.
    expect(new URL(importValue).protocol).toBe('file:');
  });
});
