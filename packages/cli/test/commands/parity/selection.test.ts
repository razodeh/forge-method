/**
 * `selectCapture` (specs/22 M16 P2) — `13` F-TEST-9's capture selection key
 * `(name, declaration digest, reference sha, platform)`: none selected is `missing`, two or more
 * differing captures under one key is `ambiguous`.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
import { describe, expect, it } from 'vitest';

import { selectCapture, type CaptureSelectionKey } from '../../../src/commands/parity/selection.ts';
import { minimalCapture } from './fixtures.ts';

const KEY: CaptureSelectionKey = {
  name: 'sample',
  digest: 'd'.repeat(64),
  referenceSha: 'a'.repeat(40),
  platform: 'linux-x64',
};

function matchingCapture(
  overrides: Parameters<typeof minimalCapture>[0] = {},
): ReturnType<typeof minimalCapture> {
  return minimalCapture({
    name: KEY.name,
    digest: KEY.digest,
    reference: { ref: KEY.referenceSha, sha: KEY.referenceSha },
    platform: KEY.platform,
    ...overrides,
  });
}

describe('selectCapture (specs/22 M16 P2)', () => {
  it('reads "missing" when no capture is given at all', () => {
    expect(selectCapture([], KEY)).toEqual({ outcome: 'missing' });
  });

  it('reads "missing" when captures exist but none match the key', () => {
    const other = minimalCapture({ name: 'different' });
    expect(selectCapture([other], KEY)).toEqual({ outcome: 'missing' });
  });

  it('selects the one capture that matches the full key', () => {
    const capture = matchingCapture();
    expect(selectCapture([capture], KEY)).toEqual({ outcome: 'selected', capture });
  });

  it('treats two byte-identical captures under the key as one selection, not ambiguous', () => {
    const a = matchingCapture();
    const b = matchingCapture(); // structurally identical content -> identical canonical bytes
    expect(selectCapture([a, b], KEY)).toEqual({ outcome: 'selected', capture: a });
  });

  it('reads "ambiguous" when two or more captures under the key genuinely differ', () => {
    const a = matchingCapture({
      cases: [
        {
          surface: 'process',
          caseIndex: 0,
          observation: { surface: 'process', stdout: 'one', exit: { kind: 'code', code: 0 } },
        },
      ],
    });
    const b = matchingCapture({
      cases: [
        {
          surface: 'process',
          caseIndex: 0,
          observation: { surface: 'process', stdout: 'two', exit: { kind: 'code', code: 0 } },
        },
      ],
    });
    const result = selectCapture([a, b], KEY);
    expect(result.outcome).toBe('ambiguous');
    if (result.outcome === 'ambiguous') expect(result.captures).toHaveLength(2);
  });

  it('reads "missing" for a capture taken on another platform, never silently compared', () => {
    const wrongPlatform = matchingCapture({ platform: 'darwin-arm64' });
    expect(selectCapture([wrongPlatform], KEY)).toEqual({ outcome: 'missing' });
  });

  it('reads "missing" for a capture under an older/different declaration digest', () => {
    const wrongDigest = matchingCapture({ digest: 'e'.repeat(64) });
    expect(selectCapture([wrongDigest], KEY)).toEqual({ outcome: 'missing' });
  });

  it('reads "missing" for a capture at a different reference sha (a tag that has since moved)', () => {
    const wrongSha = matchingCapture({ reference: { ref: KEY.referenceSha, sha: 'c'.repeat(40) } });
    expect(selectCapture([wrongSha], KEY)).toEqual({ outcome: 'missing' });
  });

  it('selects correctly among a mix of matching and non-matching captures', () => {
    const match = matchingCapture();
    const wrongName = minimalCapture({
      name: 'other',
      digest: KEY.digest,
      reference: { ref: KEY.referenceSha, sha: KEY.referenceSha },
      platform: KEY.platform,
    });
    const wrongPlatform = matchingCapture({ platform: 'darwin-arm64' });
    expect(selectCapture([wrongName, match, wrongPlatform], KEY)).toEqual({
      outcome: 'selected',
      capture: match,
    });
  });
});
