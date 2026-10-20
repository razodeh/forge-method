/**
 * `commands/dispatch/diagram.ts` — `forge diagram <sub>`, exercised in-process (`specs/22` M17 P2's
 * own "the coverage report for the new dispatch modules meets the floor").
 *
 * @see specs/22 M17 P2
 */
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchDiagram } from '../../../src/commands/dispatch/diagram.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import { writeDiagramFixture, writeGeneratedDiagramFixture } from '../helpers.ts';
import {
  cleanupAll,
  createConfiguredProject as createTestProject,
  type TestProject,
} from './dispatch-test-helpers.ts';

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

describe('dispatchDiagram (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchDiagram(ctx(project, ['kb', 'list']))).toBeUndefined();
  });

  it('runs "diagram list"/"show"/"validate" for real against a real diagram fixture', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    expect(await dispatchDiagram(ctx(project, ['diagram', 'list']))).toBe(0);
    expect(await dispatchDiagram(ctx(project, ['diagram', 'show', 'DIAG-001']))).toBe(0);
    // The fixture declares no real `depicts` entries, which `diagramValidate` reports as a real
    // finding (exit 1), not a bug in this dispatch wrapper.
    expect(await dispatchDiagram(ctx(project, ['diagram', 'validate', 'DIAG-001']))).toBe(1);
  });

  it('exits 2 for "diagram list" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(dispatchDiagram(ctx(project, ['diagram', 'list', 'extra']))).rejects.toMatchObject(
      { code: 'USR-002' },
    );
  });

  it('exits 2 for "diagram show" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchDiagram(ctx(project, ['diagram', 'show']))).toBe(2);
  });

  it('exits 2 for "diagram validate" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchDiagram(ctx(project, ['diagram', 'validate']))).toBe(2);
  });

  it('runs "diagram validate --gate G-Design" for real, as the real gate-shaped check', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    // The real gate check evaluates every real `GateCheckOutcome`'s own own passed/failed shape
    // through `runGateCheck`, which maps a failing outcome to exit 1 -- the identical real finding
    // the bare `diagram validate DIAG-001` case above hits.
    expect(await dispatchDiagram(ctx(project, ['diagram', 'validate', '--gate', 'G-Design']))).toBe(
      1,
    );
  });

  it('exits 2 for "diagram validate --gate" with an unrecognised gate', async () => {
    const project = await createTestProject();
    expect(await dispatchDiagram(ctx(project, ['diagram', 'validate', '--gate', 'G-Bogus']))).toBe(
      2,
    );
  });

  it('exits non-zero with a real USR-003 for "diagram render --open" -- no real browser-launch mechanism', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    await expect(
      dispatchDiagram(ctx(project, ['diagram', 'render', 'DIAG-001', '--open'])),
    ).rejects.toMatchObject({ code: 'USR-003' });
  });

  it('exits 2 for "diagram render" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchDiagram(ctx(project, ['diagram', 'render']))).toBe(2);
  });

  it('runs "diagram render <id> --json" for real, rendering a real diagram to HTML', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    const exitCode = await dispatchDiagram(ctx(project, ['diagram', 'render', 'DIAG-001'], true));
    expect(exitCode).toBe(0);
  });

  it('exits 2 for "diagram diff" with no real --input', async () => {
    const project = await createTestProject();
    await writeGeneratedDiagramFixture(project);
    expect(await dispatchDiagram(ctx(project, ['diagram', 'diff', 'DIAG-002']))).toBe(2);
  });

  it('runs "diagram diff <id> --input <json>" for real, against a real generated diagram', async () => {
    const project = await createTestProject();
    await writeGeneratedDiagramFixture(project);
    const exitCode = await dispatchDiagram(
      ctx(project, ['diagram', 'diff', 'DIAG-002', '--input', '{"modules":[]}']),
    );
    expect([0, 1]).toContain(exitCode);
  });

  it('exits 2 for "diagram diff" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchDiagram(ctx(project, ['diagram', 'diff']))).toBe(2);
  });

  it('exits 2 for "diagram sync" with no real --input', async () => {
    const project = await createTestProject();
    expect(await dispatchDiagram(ctx(project, ['diagram', 'sync']))).toBe(2);
  });

  it('refuses USR-002 for a real, malformed "diagram sync --input"', async () => {
    const project = await createTestProject();
    await expect(
      dispatchDiagram(ctx(project, ['diagram', 'sync', '--input', 'not json'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('refuses USR-002 for "diagram sync --input" naming a JSON array, not an object', async () => {
    const project = await createTestProject();
    await expect(
      dispatchDiagram(ctx(project, ['diagram', 'sync', '--input', '[]'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('runs "diagram sync --input {}" for real, reporting no real diagrams with a generator to check', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    expect(await dispatchDiagram(ctx(project, ['diagram', 'sync', '--input', '{}']))).toBe(0);
  });

  it('runs "diagram generate <generator> --json" for real, against a real built-in generator', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchDiagram(
      ctx(project, ['diagram', 'generate', 'deps-to-graph', '--input', '{"modules":[]}'], true),
    );
    expect(exitCode).toBe(0);
  });

  it('refuses USR-002 for "diagram generate" with an unrecognised generator', async () => {
    const project = await createTestProject();
    await expect(
      dispatchDiagram(ctx(project, ['diagram', 'generate', 'bogus-generator'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('runs "diagram generate --all --check" for real, as the drift-check gate shape', async () => {
    const project = await createTestProject();
    expect(await dispatchDiagram(ctx(project, ['diagram', 'generate', '--all', '--check']))).toBe(
      0,
    );
  });

  it('exits 2 for "diagram generate --all" without --check', async () => {
    const project = await createTestProject();
    expect(await dispatchDiagram(ctx(project, ['diagram', 'generate', '--all']))).toBe(2);
  });

  it('exits non-zero with a real USR-003 for "diagram legend" -- never implemented', async () => {
    const project = await createTestProject();
    await expect(dispatchDiagram(ctx(project, ['diagram', 'legend']))).rejects.toMatchObject({
      code: 'USR-003',
    });
  });

  it('exits 2 for "diagram legend" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(
      dispatchDiagram(ctx(project, ['diagram', 'legend', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits 2 for a real, unrecognised "diagram" subcommand', async () => {
    const project = await createTestProject();
    expect(await dispatchDiagram(ctx(project, ['diagram', 'bogus']))).toBe(2);
  });
});
