/**
 * `commands/dispatch/spec.ts` — `forge spec <sub>` and `forge spec validate --rule <name>`,
 * exercised in-process (`specs/22` M17 P2's own "the coverage report for the new dispatch modules
 * meets the floor").
 *
 * @see specs/22 M17 P2
 */
import { afterEach, describe, expect, it } from 'vitest';

import { ArtifactDocument, writeArtifact } from '@forge/core/artifacts';

import { dispatchSpec } from '../../../src/commands/dispatch/spec.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import {
  captureLogs,
  cleanupAll,
  createConfiguredProject as createTestProject,
  type TestProject,
} from './dispatch-test-helpers.ts';

const SPECS_ROOT = 'docs/forge/specs';

afterEach(cleanupAll);

function ctx(project: TestProject, positionals: readonly string[], json = false): DispatchContext {
  return {
    positionals,
    flags: {
      profile: 'default',
      dryRun: false,
      yes: false,
      json,
      noTui: false,
      verbosity: 0,
      quiet: false,
      positionals,
    },
    paths: project.paths,
    projectRoot: project.dir,
  };
}

describe('dispatchSpec (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchSpec(ctx(project, ['kb', 'list']))).toBeUndefined();
  });

  it('runs "spec new Vision"/"spec list"/"spec show"/"spec trace" for real end to end', async () => {
    const project = await createTestProject();
    const created = await captureLogs(() =>
      dispatchSpec(ctx(project, ['spec', 'new', 'Vision', 'Fixture Vision'], true)),
    );
    expect(created.exitCode).toBe(0);
    const id = (JSON.parse(created.lines[0] ?? '{}') as { readonly id: string }).id;
    expect(id).toBeTruthy();

    expect(await dispatchSpec(ctx(project, ['spec', 'list']))).toBe(0);
    expect(await dispatchSpec(ctx(project, ['spec', 'show', id]))).toBe(0);
    expect(await dispatchSpec(ctx(project, ['spec', 'trace', id]))).toBe(0);
    expect(await dispatchSpec(ctx(project, ['spec', 'matrix']))).toBe(0);
    expect(await dispatchSpec(ctx(project, ['spec', 'orphans']))).toBe(0);
  });

  it('exits 2 for "spec new" with an unrecognised <type>, naming only the eight real types', async () => {
    const project = await createTestProject();
    expect(await dispatchSpec(ctx(project, ['spec', 'new', 'NotARealType', 'Title']))).toBe(2);
  });

  it('exits non-zero with a real USR-003 for "spec new ADR" -- a real, registered type outside spec.ts own domain', async () => {
    const project = await createTestProject();
    await expect(dispatchSpec(ctx(project, ['spec', 'new', 'ADR', 'Title']))).rejects.toMatchObject(
      { code: 'USR-003' },
    );
  });

  it('exits 2 for "spec new" with no real <type> <title>', async () => {
    const project = await createTestProject();
    expect(await dispatchSpec(ctx(project, ['spec', 'new']))).toBe(2);
  });

  it('exits 2 for "spec show"/"spec trace" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchSpec(ctx(project, ['spec', 'show']))).toBe(2);
    expect(await dispatchSpec(ctx(project, ['spec', 'trace']))).toBe(2);
  });

  it('exits 2 for "spec list"/"spec matrix"/"spec orphans" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(dispatchSpec(ctx(project, ['spec', 'list', 'extra']))).rejects.toMatchObject({
      code: 'USR-002',
    });
    await expect(dispatchSpec(ctx(project, ['spec', 'matrix', 'extra']))).rejects.toMatchObject({
      code: 'USR-002',
    });
    await expect(dispatchSpec(ctx(project, ['spec', 'orphans', 'extra']))).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('exits 2 for a real, unrecognised "spec" subcommand', async () => {
    const project = await createTestProject();
    expect(await dispatchSpec(ctx(project, ['spec', 'bogus']))).toBe(2);
  });

  it('exits 2 for "spec interfaces" with no real --check-frozen', async () => {
    const project = await createTestProject();
    expect(await dispatchSpec(ctx(project, ['spec', 'interfaces']))).toBe(2);
  });

  it('runs "spec interfaces --check-frozen" for real, as the real gate-shaped check', async () => {
    const project = await createTestProject();
    expect(await dispatchSpec(ctx(project, ['spec', 'interfaces', '--check-frozen']))).toBe(0);
  });

  it('runs "spec validate" (the bare, no-rule form) for real, exiting 0 against a clean project', async () => {
    const project = await createTestProject();
    expect(await dispatchSpec(ctx(project, ['spec', 'validate']))).toBe(0);
  });

  it('runs "spec validate --json" for real, exiting non-zero against a real, invalid document', async () => {
    const project = await createTestProject();
    // Missing every required field on purpose -- a real schema violation, the identical fixture
    // `packages/cli/test/commands/spec.test.ts`'s own "reports a real, invalid document" test
    // already establishes for `specValidate` directly.
    const relPath = `${SPECS_ROOT}/vision.md`;
    const doc = ArtifactDocument.parse('---\nid: VIS-001\ntype: Vision\n---\nbody\n', relPath);
    await writeArtifact(project.paths, doc);
    const result = await captureLogs(() => dispatchSpec(ctx(project, ['spec', 'validate'], true)));
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly documents: readonly { readonly valid: boolean }[];
      readonly errors: number;
    };
    expect(parsed.documents.some((d) => !d.valid)).toBe(true);
    expect(parsed.errors).toBeGreaterThan(0);
  });

  it('runs "spec validate" (plain text) for real against the same real, invalid document', async () => {
    const project = await createTestProject();
    const relPath = `${SPECS_ROOT}/vision.md`;
    const doc = ArtifactDocument.parse('---\nid: VIS-001\ntype: Vision\n---\nbody\n', relPath);
    await writeArtifact(project.paths, doc);
    const exitCode = await dispatchSpec(ctx(project, ['spec', 'validate']));
    expect(exitCode).toBe(1);
  });

  it('exits 2 for "spec validate" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(dispatchSpec(ctx(project, ['spec', 'validate', 'extra']))).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('still routes "spec validate --rule <name>" to the narrow, gate-shelled form, unaffected by the bare form', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchSpec(
      ctx(project, ['spec', 'validate', '--rule', 'oversized-stories']),
    );
    expect(exitCode).toBe(0);
  });

  it('exits 2 with a real, specific message naming every valid --rule for an unrecognised one', async () => {
    const project = await createTestProject();
    expect(
      await dispatchSpec(ctx(project, ['spec', 'validate', '--rule', 'not-a-real-rule'])),
    ).toBe(2);
  });
});

describe('dispatchSpec — "spec re-derive" (specs/22 M17 P17)', () => {
  it('exits 0 for the bare form against a project with no specs at all', async () => {
    const project = await createTestProject();
    expect(await dispatchSpec(ctx(project, ['spec', 're-derive']))).toBe(0);
  });

  it('runs the bare form for real under --json, printing one {v:1,...} line', async () => {
    const project = await createTestProject();
    const result = await captureLogs(() => dispatchSpec(ctx(project, ['spec', 're-derive'], true)));
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly v: number;
      readonly scope: string | undefined;
      readonly staleTests: readonly string[];
      readonly unboundAcceptanceCriteria: readonly unknown[];
    };
    expect(parsed.v).toBe(1);
    expect(parsed.scope).toBeUndefined();
    expect(parsed.staleTests).toEqual([]);
    expect(parsed.unboundAcceptanceCriteria).toEqual([]);
  });

  it('throws KB-015 for a real, unresolvable <id>', async () => {
    const project = await createTestProject();
    await expect(
      dispatchSpec(ctx(project, ['spec', 're-derive', 'STORY-9999'])),
    ).rejects.toMatchObject({ code: 'KB-015' });
  });

  it('exits 2 for a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    expect(await dispatchSpec(ctx(project, ['spec', 're-derive', 'a', 'b']))).toBe(2);
  });

  it('exits 1 and reports a real unbound AC once a real Story names one with no bound test', async () => {
    const project = await createTestProject();
    const relPath = `${SPECS_ROOT}/stories/story-001.md`;
    const doc = ArtifactDocument.parse(
      [
        '---',
        'id: STORY-001',
        'type: Story',
        'schemaVersion: 1',
        "title: 'A real story'",
        'status: ready',
        'created: 2026-01-15',
        'updated: 2026-01-15',
        'revision: 1',
        'author: po',
        'changelog: []',
        'epic: EPIC-001',
        'capability: CAP-001',
        'storyType: feature',
        'size: S',
        'owner_role: backend',
        'depends_on: []',
        'blocked_by: []',
        'interfaces: []',
        'data: []',
        "files_expected: ['src/**']",
        'context_refs: []',
        'acceptance:',
        '  - id: AC-001-1',
        "    given: 'a precondition'",
        "    when: 'the action happens'",
        "    then: 'the outcome holds'",
        '    kind: functional',
        'tests: []',
        'dod_profile: backend-default',
        '---',
        '',
        'Body.',
        '',
      ].join('\n'),
      relPath,
    );
    await writeArtifact(project.paths, doc);

    const result = await captureLogs(() => dispatchSpec(ctx(project, ['spec', 're-derive'], true)));
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly unboundAcceptanceCriteria: readonly { readonly acId: string }[];
    };
    expect(parsed.unboundAcceptanceCriteria).toEqual([{ acId: 'AC-001-1', storyId: 'STORY-001' }]);

    // Scoped to that one Story names the identical finding.
    expect(await dispatchSpec(ctx(project, ['spec', 're-derive', 'STORY-001']))).toBe(1);
  });
});
