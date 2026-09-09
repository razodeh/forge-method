/**
 * `shouldRunLive`/`planLiveRuns` — non-live, pure unit tests. Zero subprocess/network calls are even
 * possible here: neither function under test performs any I/O at all (`live-gate.ts`'s own doc
 * comment), so "well under a second, no network call attempted" is proven by construction, not merely
 * observed.
 *
 * `PLAN-M7.md` P9's own Check: the five safety-critical ids (`SAFETY_CRITICAL_CONFORMANCE_IDS`) must
 * never be silently skipped by anything *other* than this one, documented gate. Proven directly, at
 * the source level: neither this gate nor either real conformance fixture file references that
 * constant, or any of its five members, at all.
 *
 * @see specs/07 §7.6
 * @see PLAN-M7.md P9
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SAFETY_CRITICAL_CONFORMANCE_IDS } from '@forge/adapter-kit/conformance';

import type { AuthAvailability } from '../../src/auth.ts';
import { planLiveRuns, shouldRunLive } from './live-gate.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function auth(overrides: Partial<AuthAvailability> = {}): AuthAvailability {
  return { apiKey: false, subscription: false, ...overrides };
}

describe('shouldRunLive', () => {
  it('is false when FORGE_LIVE is unset, regardless of real credentials', () => {
    expect(shouldRunLive({}, auth({ apiKey: true, subscription: true }))).toBe(false);
  });

  it('is false when FORGE_LIVE is set to anything other than the literal string "1"', () => {
    expect(shouldRunLive({ FORGE_LIVE: '0' }, auth({ apiKey: true }))).toBe(false);
    expect(shouldRunLive({ FORGE_LIVE: 'true' }, auth({ apiKey: true }))).toBe(false);
  });

  it('is false when FORGE_LIVE=1 but no real credential exists at all', () => {
    expect(shouldRunLive({ FORGE_LIVE: '1' }, auth())).toBe(false);
  });

  it('is true when FORGE_LIVE=1 and at least one real credential exists', () => {
    expect(shouldRunLive({ FORGE_LIVE: '1' }, auth({ apiKey: true }))).toBe(true);
    expect(shouldRunLive({ FORGE_LIVE: '1' }, auth({ subscription: true }))).toBe(true);
    expect(shouldRunLive({ FORGE_LIVE: '1' }, auth({ apiKey: true, subscription: true }))).toBe(
      true,
    );
  });
});

describe('planLiveRuns', () => {
  it('returns an empty list whenever shouldRunLive would be false', () => {
    expect(planLiveRuns({}, auth({ apiKey: true, subscription: true }))).toEqual([]);
    expect(planLiveRuns({ FORGE_LIVE: '1' }, auth())).toEqual([]);
  });

  it('returns exactly one bare:true entry when only a real api key exists', () => {
    const runs = planLiveRuns({ FORGE_LIVE: '1' }, auth({ apiKey: true }));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.bare).toBe(true);
    expect(runs[0]?.reason.length).toBeGreaterThan(0);
  });

  it('returns exactly one bare:false entry when only a real subscription login exists', () => {
    const runs = planLiveRuns({ FORGE_LIVE: '1' }, auth({ subscription: true }));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.bare).toBe(false);
    expect(runs[0]?.reason.length).toBeGreaterThan(0);
  });

  it('returns both entries when both real credentials exist in the same environment at once', () => {
    const runs = planLiveRuns({ FORGE_LIVE: '1' }, auth({ apiKey: true, subscription: true }));
    expect(runs.map((run) => run.bare).sort()).toEqual([false, true]);
  });
});

describe('the five safety-critical conformance ids are never additionally special-cased', () => {
  it('confirms SAFETY_CRITICAL_CONFORMANCE_IDS is exactly the real, upstream 5-element set this test reasons about', () => {
    expect([...SAFETY_CRITICAL_CONFORMANCE_IDS].sort()).toEqual(['C13', 'C14', 'C16', 'C2', 'C5']);
  });

  /** Checks the *quoted string-literal* form (`'C13'`/`"C13"`) specifically, not a bare substring
   * search -- a real per-id skip condition (`if (id === 'C13')`) could only be written that way; a
   * bare substring search would false-positive on innocent text with no relation to test ids at all
   * (e.g. any identifier that merely happens to contain the two characters "c" and "2" in sequence). */
  function containsQuotedId(source: string, id: string): boolean {
    return source.includes(`'${id}'`) || source.includes(`"${id}"`);
  }

  it("this gate's own source never uses any of the five ids as a quoted, per-id skip condition (its own doc comment does name SAFETY_CRITICAL_CONFORMANCE_IDS in prose -- explaining this exact property -- so only the narrower, quoted-id form is checked here, not a blanket ban on the identifier)", () => {
    const source = readFileSync(path.join(HERE, 'live-gate.ts'), 'utf8');
    for (const id of SAFETY_CRITICAL_CONFORMANCE_IDS) {
      expect(containsQuotedId(source, id)).toBe(false);
    }
  });

  it('neither real conformance fixture file references SAFETY_CRITICAL_CONFORMANCE_IDS or any of its five members as a quoted id', () => {
    for (const file of ['sdk.conformance.test.ts', 'cli.conformance.test.ts']) {
      const source = readFileSync(path.join(HERE, file), 'utf8');
      expect(source).not.toContain('SAFETY_CRITICAL_CONFORMANCE_IDS');
      for (const id of SAFETY_CRITICAL_CONFORMANCE_IDS) {
        expect(containsQuotedId(source, id)).toBe(false);
      }
    }
  });
});
