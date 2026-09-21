/**
 * `forge implement <storyId>` — real `owner_role` lookup from a real Story artifact, then real
 * dispatch to `implement-story` via `runWorkflow`.
 *
 * @see specs/03 §3.2.5
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { implementStory } from '../../../src/commands/loop/implement.ts';
import {
  FIXTURE_STORY_ID,
  SPECS_ROOT,
  cleanupAll,
  createTestProject,
  fixtureAdapter,
  testRunDeps,
} from './helpers.ts';

afterEach(cleanupAll);

describe('implementStory', () => {
  it('reads the real Story artifact’s own owner_role and threads it into the compiled plan', async () => {
    const project = await createTestProject();
    const result = await implementStory(testRunDeps(project), FIXTURE_STORY_ID, {
      specsRoot: SPECS_ROOT,
      dryRun: true,
      host: 'test-host',
    });
    expect(result.kind).toBe('dry-run');
    if (result.kind !== 'dry-run' || !result.plan.success) throw new Error('unreachable');
    // `agent` is real, compile-time-resolved from `{{ownerRole}}` — proves the real Story's own
    // `owner_role` (`engineer`) actually reached the workflow, not a guessed-at or hardcoded value.
    expect(result.plan.nodes[0]?.agent).toBe('engineer');
    expect(result.plan.nodes[0]?.produces).toEqual([`${FIXTURE_STORY_ID}.txt`]);
  });

  it('a real run resolves {{storyId}}/{{ownerRole}} correctly and completes', async () => {
    const project = await createTestProject();
    const deps = testRunDeps(project, fixtureAdapter(`${FIXTURE_STORY_ID}.txt`));
    const result = await implementStory(deps, FIXTURE_STORY_ID, {
      specsRoot: SPECS_ROOT,
      host: 'test-host',
    });
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('completed');
  });

  it('throws SPEC-024 for an unknown story id', async () => {
    const project = await createTestProject();
    await expect(
      implementStory(testRunDeps(project), 'STORY-999', {
        specsRoot: SPECS_ROOT,
        dryRun: true,
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'SPEC-024' });
  });

  it('honours a different real owner_role from a second, real fixture story', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, SPECS_ROOT, 'stories'), { recursive: true });
    await writeFile(
      path.join(project.dir, SPECS_ROOT, 'stories', 'STORY-020.md'),
      `---
id: STORY-020
type: Story
schemaVersion: 1
title: Second fixture story
status: ready
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
owner_role: frontend
depends_on: []
blocked_by: []
interfaces: []
data: []
files_expected: []
context_refs: []
acceptance: []
tests: []
dod_profile: default
---
`,
    );
    const result = await implementStory(testRunDeps(project), 'STORY-020', {
      specsRoot: SPECS_ROOT,
      dryRun: true,
      host: 'test-host',
    });
    if (result.kind !== 'dry-run' || !result.plan.success) throw new Error('unreachable');
    expect(result.plan.nodes[0]?.agent).toBe('frontend');
  });

  it('throws SPEC-025 when a real Story artifact has no real, valid owner_role', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, SPECS_ROOT, 'stories'), { recursive: true });
    await writeFile(
      path.join(project.dir, SPECS_ROOT, 'stories', 'STORY-030.md'),
      `---
id: STORY-030
type: Story
schemaVersion: 1
title: Broken fixture story
status: ready
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
owner_role: ''
depends_on: []
blocked_by: []
interfaces: []
data: []
files_expected: []
context_refs: []
acceptance: []
tests: []
dod_profile: default
---
`,
    );
    await expect(
      implementStory(testRunDeps(project), 'STORY-030', {
        specsRoot: SPECS_ROOT,
        dryRun: true,
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'SPEC-025' });
  });

  it('throws SPEC-024 for a real, non-Story artifact — a matching id alone is not enough', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, SPECS_ROOT, 'epics'), { recursive: true });
    await writeFile(
      path.join(project.dir, SPECS_ROOT, 'epics', 'EPIC-999.md'),
      `---
id: EPIC-999
type: Epic
schemaVersion: 1
title: Not actually a Story
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
capability: CAP-001
stories: []
---
`,
    );
    await expect(
      implementStory(testRunDeps(project), 'EPIC-999', {
        specsRoot: SPECS_ROOT,
        dryRun: true,
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'SPEC-024' });
  });
});
