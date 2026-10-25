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

  it('is the bare native flag when supported, or an absolute-path --import= when not -- never a bare specifier (Q340 critic finding: a bare "tsx/esm" specifier resolves against the SPAWNED CHILD\'s own cwd, not this file\'s location, and breaks for any child spawned outside this repo)', () => {
    if (SUPPORTS_NATIVE_STRIP_TYPES) {
      expect(TS_NODE_FLAG).toBe('--experimental-strip-types');
    } else {
      expect(TS_NODE_FLAG.startsWith('--import=')).toBe(true);
      const importPath = TS_NODE_FLAG.slice('--import='.length);
      expect(importPath.startsWith('/')).toBe(true);
      expect(importPath.endsWith('.mjs')).toBe(true);
    }
  });
});
