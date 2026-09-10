/**
 * `evaluateDodProfile` — `PLAN-M8.md` P1's own Checks section.
 *
 * @see specs/09 §9.8
 * @see PLAN-M8.md P1
 */
import { describe, expect, it } from 'vitest';

import { loadDodProfile, evaluateDodProfile, type DodContext } from '../../src/dod/index.ts';
import { DOD_PROFILES } from '../fixtures/dod-profiles.ts';

function loadFixtureProfile() {
  const result = loadDodProfile(DOD_PROFILES, 'dod-profiles.yaml');
  if (!result.success) throw new Error(`fixture failed to load: ${JSON.stringify(result.issues)}`);
  return result.profileFile;
}

const ALWAYS_TRUE = (): boolean => true;

describe('evaluateDodProfile', () => {
  it('reports a violation naming the expression when a story has zero acceptance criteria', () => {
    const profileFile = loadFixtureProfile();
    const context: DodContext = { story: { acceptance: [], files_expected: ['src/**'] } };

    const violations = evaluateDodProfile(
      profileFile,
      'backend-default',
      'ready',
      context,
      ALWAYS_TRUE,
    );

    expect(violations.some((v) => v.check === 'story.acceptance.length > 0')).toBe(true);
  });

  it('reports no violations when every ready-phase condition is satisfied', () => {
    const profileFile = loadFixtureProfile();
    const context: DodContext = {
      story: { acceptance: [{ id: 'AC-1' }], files_expected: ['src/**'] },
    };

    const violations = evaluateDodProfile(
      profileFile,
      'backend-default',
      'ready',
      context,
      ALWAYS_TRUE,
    );

    expect(violations).toEqual([]);
  });

  it('reports a violation for a story with a non-empty acceptance array but empty files_expected', () => {
    const profileFile = loadFixtureProfile();
    const context: DodContext = { story: { acceptance: [{ id: 'AC-1' }], files_expected: [] } };

    const violations = evaluateDodProfile(
      profileFile,
      'backend-default',
      'ready',
      context,
      ALWAYS_TRUE,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.check).toBe('story.files_expected.length > 0');
  });

  it('calls the injected resolveCheck for a check: entry and reports a violation when it returns false', () => {
    const profileFile = loadFixtureProfile();
    const context: DodContext = {
      story: { acceptance: [{ id: 'AC-1' }], files_expected: ['src/**'] },
    };
    const seen: string[] = [];
    const resolveCheck = (id: string): boolean => {
      seen.push(id);
      return id !== 'spec:no-blocking-open-questions';
    };

    const violations = evaluateDodProfile(
      profileFile,
      'backend-default',
      'ready',
      context,
      resolveCheck,
    );

    expect(seen).toContain('spec:story-refs-resolve');
    expect(seen).toContain('spec:no-blocking-open-questions');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.profileId).toBe('backend-default');
    expect(violations[0]?.phase).toBe('ready');
    expect(violations[0]?.check).toBe('spec:no-blocking-open-questions');
    expect(violations[0]?.message).toContain('spec:no-blocking-open-questions');
  });

  it('an unrecognised check id that resolveCheck fails closed on (returns false) is a real, reported violation', () => {
    const profileFile = loadFixtureProfile();
    const context: DodContext = {
      story: { acceptance: [{ id: 'AC-1' }], files_expected: ['src/**'] },
    };

    const violations = evaluateDodProfile(
      profileFile,
      'backend-default',
      'ready',
      context,
      () => false,
    );

    expect(violations.length).toBeGreaterThan(0);
  });

  it('evaluates the done phase too (structurally supported, not just ready)', () => {
    const profileFile = loadFixtureProfile();
    const context: DodContext = { story: {} };

    const violations = evaluateDodProfile(
      profileFile,
      'backend-default',
      'done',
      context,
      ALWAYS_TRUE,
    );

    expect(violations).toEqual([]);
  });

  it('reports a single, real violation naming the profile when the profile id does not exist', () => {
    const profileFile = loadFixtureProfile();
    const context: DodContext = { story: {} };

    const violations = evaluateDodProfile(
      profileFile,
      'no-such-profile',
      'ready',
      context,
      ALWAYS_TRUE,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('no-such-profile');
  });
});
