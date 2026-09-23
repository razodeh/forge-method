/**
 * `09` §9.8's own fenced `dod-profiles.yaml` example, parsed directly from the spec file itself (NOT
 * through `loadDodProfile`/`dodPhaseSchema` — the `describe` block at the foot of this file does that;
 * this first block proves what the SPEC TEXT says, independent of the code).
 *
 * `09` §9.8's single `done` list used to conflate two different moments (`10` §10.6 step 6, self-verify,
 * runs BEFORE step 7 review; the old list's `review:blocking-findings == 0` cannot pass there). It now
 * splits into `verify` (what the story itself can already show at step 6) and `done` (what only review
 * and the merge can show, at step 9 and in the merge queue) — `packages/methods/src/dod/schema.ts`
 * models this as of M14 P25 (`dodPhaseSchema`'s own optional `verify` field).
 *
 * @see specs/09 §9.8
 * @see specs/10 §10.6
 * @see PLAN-M14.md P1, P25
 * @see SPEC-QUESTIONS.md Q232, Q233
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { loadDodProfile } from '../../src/dod/index.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function readSpec9(): string {
  return readFileSync(path.join(repoRoot, 'specs', '09-spec-driven-development.md'), 'utf8');
}

/** The raw text of the ```yaml fenced block under `## 9.8 Definition of Ready / Definition of Done`. */
function fencedYamlText(): string {
  const specText = readSpec9();
  const section = specText.slice(specText.indexOf('## 9.8 Definition of Ready'));
  const fenced = /```yaml\n([\s\S]*?)\n```/.exec(section)?.[1];
  if (fenced === undefined) throw new Error('09 §9.8 has no yaml block');
  return fenced;
}

/** Parsed as plain YAML — no schema, no `loadDodProfile`: this proves what the SPEC TEXT says,
 * independent of whether the code (`packages/methods/src/dod/schema.ts`) has caught up to it yet. */
function parseSpecBlock(): unknown {
  return YAML.parse(fencedYamlText());
}

interface BackendDefaultProfile {
  readonly ready: readonly unknown[];
  readonly verify: readonly unknown[];
  readonly done: readonly unknown[];
}

function backendDefault(): BackendDefaultProfile {
  const parsed = parseSpecBlock() as { profiles?: Record<string, unknown> };
  const profile = parsed.profiles?.['backend-default'];
  if (profile === undefined || typeof profile !== 'object') {
    throw new Error('09 §9.8 has no profiles.backend-default');
  }
  return profile as BackendDefaultProfile;
}

describe('09 §9.8 backend-default: the DoD example splits into ready/verify/done', () => {
  it('has exactly the three phase keys ready, verify, done — no bare "done" list left over', () => {
    expect(Object.keys(backendDefault()).sort()).toEqual(['done', 'ready', 'verify']);
  });

  it('ready is untouched: the four Definition-of-Ready checks', () => {
    expect(backendDefault().ready).toEqual([
      'story.acceptance.length > 0',
      'story.files_expected.length > 0',
      { check: 'spec:story-refs-resolve' },
      { check: 'spec:no-blocking-open-questions' },
    ]);
  });

  it('verify holds exactly the six build/test checks self-verify (10 §10.6 step 6) can run alone', () => {
    expect(backendDefault().verify).toEqual([
      { check: 'build:typecheck' },
      { check: 'build:lint' },
      { check: 'test:unit --scope story' },
      { check: 'test:integration --scope story' },
      { check: 'spec:ac-coverage --story' },
      { check: 'security:secrets-scan' },
    ]);
  });

  it('done holds exactly the three post-review checks (10 §10.6 step 9 and the merge queue)', () => {
    expect(backendDefault().done).toEqual([
      { check: 'review:blocking-findings == 0' },
      { check: 'docs:public-api-documented' },
      { check: 'kb:no-new-contradictions' },
    ]);
  });

  it('no post-review check leaked into verify, and no build/test check leaked into done', () => {
    const verifyIds = backendDefault().verify.map((entry) =>
      typeof entry === 'object' && entry !== null && 'check' in entry ? entry.check : entry,
    );
    const doneIds = backendDefault().done.map((entry) =>
      typeof entry === 'object' && entry !== null && 'check' in entry ? entry.check : entry,
    );
    for (const postReview of [
      'review:blocking-findings == 0',
      'docs:public-api-documented',
      'kb:no-new-contradictions',
    ]) {
      expect(verifyIds).not.toContain(postReview);
    }
    for (const buildOrTest of [
      'build:typecheck',
      'build:lint',
      'test:unit --scope story',
      'test:integration --scope story',
      'spec:ac-coverage --story',
      'security:secrets-scan',
    ]) {
      expect(doneIds).not.toContain(buildOrTest);
    }
  });
});

describe('09 §9.8 backend-default: the same block parses through the real loadDodProfile (M14 P25)', () => {
  // The full fenced block also holds `frontend-default`/`data-default`, each an elided `{ … }` (real
  // prose, not a real profile) — `backendDefault()` already isolates the one real profile the spec
  // text fully specifies; re-serialising just that (still derived from the parsed spec text, never
  // hand-copied) is what actually round-trips through the schema.
  it('loads with zero issues and zero warnings — the schema has caught up to the spec text', () => {
    const yaml = YAML.stringify({ profiles: { 'backend-default': backendDefault() } });
    const result = loadDodProfile(yaml, '09-spec-driven-development.md');
    if (!result.success) {
      throw new Error(`expected success, got issues: ${JSON.stringify(result.issues)}`);
    }
    const profile = result.profileFile.profiles['backend-default'];
    if (profile === undefined) throw new Error('expected a backend-default profile');
    expect(profile.ready).toHaveLength(4);
    expect(profile.verify).toHaveLength(6);
    expect(profile.done).toHaveLength(3);
    // The spec's own example already has a `verify` list, so it earns no "add one" warning.
    expect(result.warnings).toEqual([]);
  });
});
