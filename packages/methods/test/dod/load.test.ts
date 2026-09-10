/**
 * `loadDodProfile`/`readDodProfile` — `PLAN-M8.md` P1's own Checks section.
 *
 * @see specs/09 §9.8
 * @see PLAN-M8.md P1
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core';
import { describe, expect, it } from 'vitest';

import { loadDodProfile, readDodProfile } from '../../src/dod/index.ts';
import { DOD_PROFILES } from '../fixtures/dod-profiles.ts';

describe('loadDodProfile', () => {
  it('round-trips the full 09 §9.8 backend-default profile (both ready and done lists) with zero issues', () => {
    const result = loadDodProfile(DOD_PROFILES, 'dod-profiles.yaml');
    if (!result.success) {
      throw new Error(`expected success, got issues: ${JSON.stringify(result.issues)}`);
    }
    const profile = result.profileFile.profiles['backend-default'];
    if (profile === undefined) throw new Error('expected a backend-default profile');
    expect(profile.ready).toHaveLength(4);
    expect(profile.done).toHaveLength(9);
    expect(profile.ready[0]).toBe('story.acceptance.length > 0');
    expect(profile.ready[1]).toBe('story.files_expected.length > 0');
    expect(profile.ready[2]).toEqual({ check: 'spec:story-refs-resolve' });
    expect(profile.ready[3]).toEqual({ check: 'spec:no-blocking-open-questions' });
    // Every `done`-list entry, including each one's own real qualifier syntax (a space-separated flag,
    // an inline `== 0` comparison) — a fresh critic round caught an earlier draft that silently
    // stripped these down to bare ids, which meant this assertion never actually proved a `{ check: id
    // }` value containing whitespace or a comparison round-trips at all.
    expect(profile.done).toEqual([
      { check: 'build:typecheck' },
      { check: 'build:lint' },
      { check: 'test:unit --scope story' },
      { check: 'test:integration --scope story' },
      { check: 'spec:ac-coverage --story' },
      { check: 'review:blocking-findings == 0' },
      { check: 'security:secrets-scan' },
      { check: 'docs:public-api-documented' },
      { check: 'kb:no-new-contradictions' },
    ]);
  });

  it('rejects a genuine YAML syntax error as a real issue, not a thrown error', () => {
    const result = loadDodProfile(
      'profiles:\n  a:\n    ready:\n  bad indentation here',
      'bad.yaml',
    );
    expect(result.success).toBe(false);
  });

  it('rejects a plain-string check that does not parse as an expression, naming the field', () => {
    const source = `
profiles:
  p:
    ready:
      - "story. .length >"
    done: []
`;
    const result = loadDodProfile(source, 'p.yaml');
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.issues.some((issue) => issue.message.includes('does not parse'))).toBe(true);
    expect(result.issues[0]?.path).toContain('p.yaml');
  });

  it('rejects an unknown top-level shape (missing profiles key) as a real schema issue', () => {
    const result = loadDodProfile('notProfiles: {}', 'bad-shape.yaml');
    expect(result.success).toBe(false);
  });

  it('accepts an empty ready or done list on a real profile', () => {
    const source = `
profiles:
  minimal:
    ready: []
    done: []
`;
    const result = loadDodProfile(source, 'minimal.yaml');
    expect(result.success).toBe(true);
  });
});

describe('readDodProfile', () => {
  it('reads and parses a real file from disk', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-dod-'));
    const paths = new ProjectPaths(dir);
    await writeFile(path.join(dir, 'dod-profiles.yaml'), DOD_PROFILES, 'utf8');

    const result = await readDodProfile(paths, 'dod-profiles.yaml');
    expect(result.success).toBe(true);
  });

  it('rejects a path that escapes the project root, rather than reading outside it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-dod-'));
    const paths = new ProjectPaths(dir);

    await expect(readDodProfile(paths, '../outside.yaml')).rejects.toMatchObject({
      code: 'CFG-003',
    });
  });

  it('rejects a real, correctly-scoped path that does not exist', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-dod-'));
    const paths = new ProjectPaths(dir);

    await expect(readDodProfile(paths, 'missing.yaml')).rejects.toMatchObject({
      code: 'RUN-034',
    });
  });
});
