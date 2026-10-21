/**
 * `commands/dispatch/test-exempt-coverage-flaky.ts` — `forge test exempt`/`coverage`/`flaky`/`adopt`
 * and the `plan`/`generate`/`report` refusals, exercised in-process (`specs/22` M17 P2's own "the
 * coverage report for the new dispatch modules meets the floor"). `forge test exempt`'s own full,
 * real-binding-check success path is already exhaustively covered by `packages/cli/test/
 * commands/story-binding.test.ts`/`bin.test.ts`'s own real subprocess tests -- this file covers
 * every usage-error branch plus the coverage/flaky/adopt/refusal commands this dispatch area owns
 * in full.
 *
 * @see specs/22 M17 P2
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchTestExemptCoverageFlaky } from '../../../src/commands/dispatch/test-exempt-coverage-flaky.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import {
  captureLogs,
  cleanupAll,
  createConfiguredProject as createTestProject,
  type TestProject,
} from './dispatch-test-helpers.ts';

/** A real `.forge/checks/G-TestAdopt.gate.yaml` -- the identical fixture
 * `loop/test/adopt.test.ts`'s own `writeGateFile` writes, reproduced here rather than imported
 * across a test/test boundary (this codebase's own convention: test fixtures are not a shared
 * runtime dependency). */
async function writeTestAdoptGateFile(project: TestProject): Promise<void> {
  await mkdir(path.join(project.dir, '.forge', 'checks'), { recursive: true });
  await writeFile(
    path.join(project.dir, '.forge', 'checks', 'G-TestAdopt.gate.yaml'),
    'id: G-TestAdopt\nname: Test adoption gate\nautonomyOverride: null\nchecks:\n  deterministic:\n    - id: test-adoption:approved\n      run: "forge test adopt --check-proof unit --json"\n      parser: forge-json\n      failOn: "unapproved > 0"\n  advisory: []\nopenQuestionsPolicy: block\napproval:\n  required: true\n  roles: [human]\n  quorum: 1\n',
  );
}

/** Strips the real, written `gates` block out of an already-configured project's own
 * `.forge/config.yaml` -- `DEFAULT_CONFIG.gates` is typed optional on `ForgeConfig` precisely for
 * a real config written before `PLAN-M14.md` P16 shipped, which `defaultWaiverMaxDays`'s own doc
 * comment names; this fixture reproduces that real, historical shape directly rather than only
 * ever exercising the common case where `gates` is always present. */
async function stripGatesConfig(project: TestProject): Promise<void> {
  const configPath = path.join(project.dir, '.forge', 'config.yaml');
  const raw = YAML.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  delete raw['gates'];
  await writeFile(configPath, YAML.stringify(raw), 'utf8');
}

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

describe('dispatchTestExemptCoverageFlaky (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchTestExemptCoverageFlaky(ctx(project, ['kb', 'list']))).toBeUndefined();
  });

  it('returns undefined for "test" with a sub this area does not own', async () => {
    const project = await createTestProject();
    expect(
      await dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'binding'])),
    ).toBeUndefined();
  });

  it('runs "test coverage --rule acceptance-criteria --json" for real, vacuously, with no done stories', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchTestExemptCoverageFlaky(
      ctx(project, ['test', 'coverage', '--rule', 'acceptance-criteria'], true),
    );
    expect(exitCode).toBe(0);
  });

  it('runs "test coverage --json" for real end to end against a real, empty project', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchTestExemptCoverageFlaky(
      ctx(project, ['test', 'coverage'], true),
    );
    expect([0, 1]).toContain(exitCode);
  });

  it('exits 2 with a real, specific message for an unrecognised "test coverage --rule" value', async () => {
    const project = await createTestProject();
    expect(
      await dispatchTestExemptCoverageFlaky(
        ctx(project, ['test', 'coverage', '--rule', 'not-a-real-rule']),
      ),
    ).toBe(2);
  });

  it('runs "test coverage --rule ratchet --json" for real, vacuously, with no real coverage data', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchTestExemptCoverageFlaky(
      ctx(project, ['test', 'coverage', '--rule', 'ratchet'], true),
    );
    expect([0, 1]).toContain(exitCode);
  });

  it('runs "test flaky --json" for real end to end, exiting 0 against a real, clean project', async () => {
    const project = await createTestProject();
    expect(await dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'flaky'], true))).toBe(0);
  });

  it('exits 2, rather than silently running, for "test flaky --rule" (it takes no --rule at all)', async () => {
    const project = await createTestProject();
    expect(
      await dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'flaky', '--rule', 'anything'])),
    ).toBe(2);
  });

  it('exits 2 for "test exempt" with fewer than two positionals', async () => {
    const project = await createTestProject();
    expect(await dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'exempt', 'story-1']))).toBe(
      2,
    );
  });

  it('exits 2 for "test exempt" missing --reason/--owner/--expires', async () => {
    const project = await createTestProject();
    expect(
      await dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'exempt', 'story-1', 'test-1'])),
    ).toBe(2);
  });

  it('exits 2 for "test exempt" with a blank --reason', async () => {
    const project = await createTestProject();
    expect(
      await dispatchTestExemptCoverageFlaky(
        ctx(project, [
          'test',
          'exempt',
          'story-1',
          'test-1',
          '--reason',
          '   ',
          '--owner',
          'architect',
          '--expires',
          '2099-01-01',
        ]),
      ),
    ).toBe(2);
  });

  it('exits 2 for "test exempt" with a malformed --expires', async () => {
    const project = await createTestProject();
    expect(
      await dispatchTestExemptCoverageFlaky(
        ctx(project, [
          'test',
          'exempt',
          'story-1',
          'test-1',
          '--reason',
          'A real reason',
          '--owner',
          'architect',
          '--expires',
          'not-a-date',
        ]),
      ),
    ).toBe(2);
  });

  it('exits 2 for "test exempt" with a real, calendar-rolled-over --expires (isRealCalendarDate\'s own round-trip check, not just a regex match)', async () => {
    const project = await createTestProject();
    // `2026-02-30` matches `isRealCalendarDate`'s own `YYYY-MM-DD` regex just fine -- only the
    // `Date.UTC` round-trip (February genuinely has no 30th day) catches this real, distinct
    // branch `Date.parse` alone would have silently rolled over into March instead of rejecting.
    expect(
      await dispatchTestExemptCoverageFlaky(
        ctx(project, [
          'test',
          'exempt',
          'story-1',
          'test-1',
          '--reason',
          'A real reason',
          '--owner',
          'architect',
          '--expires',
          '2026-02-30',
        ]),
      ),
    ).toBe(2);
  });

  it('refuses GATE-513 for "test exempt" with an --owner that is not a real identifier', async () => {
    const project = await createTestProject();
    // `assertCleanWorkingTree` runs before the owner check (this command's own documented refusal
    // order) -- a real, clean git repo is needed to reach it at all.
    await execa('git', ['init'], { cwd: project.dir });
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-m', 'init'],
      {
        cwd: project.dir,
      },
    );
    await expect(
      dispatchTestExemptCoverageFlaky(
        ctx(project, [
          'test',
          'exempt',
          'story-1',
          'test-1',
          '--reason',
          'A real reason',
          '--owner',
          '!!!not-an-identifier',
          '--expires',
          '2099-01-01',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'GATE-513' });
  });

  it('refuses GATE-515 ("expiry-exceeds-cap") for "test exempt" with a real --owner but an --expires beyond gates.waiverMaxDays', async () => {
    const project = await createTestProject();
    await execa('git', ['init'], { cwd: project.dir });
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-m', 'init'],
      { cwd: project.dir },
    );
    // `DEFAULT_CONFIG.gates.waiverMaxDays` caps a real exemption at 90 days from grant -- far
    // beyond that, every other real precondition this command checks before it, already real and
    // satisfied (a valid --owner, a clean tree), so this is the one that actually fires.
    await expect(
      dispatchTestExemptCoverageFlaky(
        ctx(project, [
          'test',
          'exempt',
          'story-1',
          'test-1',
          '--reason',
          'A real reason',
          '--owner',
          'architect',
          '--expires',
          '2099-01-01',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'GATE-515', details: { reason: 'expiry-exceeds-cap' } });
  });

  it('refuses GATE-515 the same way when config.gates is genuinely absent, through the real defaultWaiverMaxDays fallback', async () => {
    const project = await createTestProject();
    await stripGatesConfig(project);
    await execa('git', ['init'], { cwd: project.dir });
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-m', 'init'],
      { cwd: project.dir },
    );
    await expect(
      dispatchTestExemptCoverageFlaky(
        ctx(project, [
          'test',
          'exempt',
          'story-1',
          'test-1',
          '--reason',
          'A real reason',
          '--owner',
          'architect',
          '--expires',
          '2099-01-01',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'GATE-515', details: { reason: 'expiry-exceeds-cap' } });
  });

  it('exits 2 for "test exempt" given more than two positionals', async () => {
    const project = await createTestProject();
    await expect(
      dispatchTestExemptCoverageFlaky(
        ctx(project, ['test', 'exempt', 'story-1', 'test-1', 'extra']),
      ),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('"test adopt --agent" genuinely routes into runAdoptTestsAgent, not a stub refusal (specs/22 M17 P2/P7)', async () => {
    // `specs/22` M17 P7 landed on `main` after this piece's own extraction base and closed the
    // `USR-003` "not yet built" stub this test originally asserted (reconciled here at landing
    // time: `runTestAdoptCommand`'s own doc comment and `git diff dcb145f..c96d9a8 -- bin.ts` have
    // the full account). The real, deterministic `RUN-056` below -- the bare `createTestProject()`
    // fixture has no real `.forge/agents/test-architect.yaml` roster entry -- is the correct,
    // meaningful proof that `--agent` now reaches `buildLoopDepsForProject`/`runAdoptTestsAgent` for
    // real, the identical "assert the real dependency-building refusal, not a live model call"
    // convention `debug`/`review`/`panel`'s own dispatch-layer tests already use in this codebase.
    const project = await createTestProject();
    await expect(
      dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'adopt', '--agent'])),
    ).rejects.toMatchObject({ code: 'RUN-056' });
  });

  it('exits non-zero for "test adopt" against a project with no recognisable test runner', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'adopt'], true));
    expect(exitCode).toBe(1);
  });

  it('runs "test adopt --json" for real, staging a real proposal for a confident detection', async () => {
    const project = await createTestProject();
    // The identical confident-detection fixture `loop/test/adopt.test.ts`'s own `runDetectionAndStage`
    // test already establishes: a real `devDependencies.vitest` is enough on its own.
    await writeFile(
      path.join(project.dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2' } }),
      'utf8',
    );
    const exitCode = await dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'adopt'], true));
    expect(exitCode).toBe(0);
  });

  it('exits non-zero for "test adopt --write" with no staged proposal yet', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchTestExemptCoverageFlaky(
      ctx(project, ['test', 'adopt', '--write'], true),
    );
    expect(exitCode).toBe(1);
  });

  it('exits non-zero for "test adopt --write" in plain text (no --json), rendering a real describePromotionResult message', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchTestExemptCoverageFlaky(
      ctx(project, ['test', 'adopt', '--write']),
    );
    expect(exitCode).toBe(1);
  });

  it('exits non-zero for "test adopt --write" against a real, confidently-detected proposal with no proof at all -- "gate-not-available", never "proof-not-passing" (specs/22 M17 P21\'s own fix: a bare detection does not need a translator proof)', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2' } }),
      'utf8',
    );
    await dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'adopt'], true));
    // No `writeTestAdoptGateFile(project)` call: the gate file genuinely does not exist in this
    // project (`createTestProject`'s own doc comment: it writes only a bare `.forge/config.yaml`).
    const { exitCode, lines } = await captureLogs(() =>
      dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'adopt', '--write'], true)),
    );
    // Before `specs/22` M17 P21's own fix, this real, confidently-detected proposal (no proof field
    // at all -- `runDetectionAndStage` never supplies one) could NEVER reach anything past
    // `'proof-not-passing'`: `runPromotion` refused unconditionally the instant `staged.proof ===
    // undefined`, for every source, with no carve-out for a built-in-format detection. The real,
    // live repro that found this defect was exactly this sequence (`forge init` + `forge test
    // adopt` + `forge test adopt --write`) against a fresh fixture with an ordinary Vitest/`node
    // --test` setup -- i.e. the single most common case. It now genuinely proceeds past the
    // proof check and refuses for the NEXT real, distinct reason instead (`'gate-not-available'`,
    // since this project's fixture has no `G-TestAdopt.gate.yaml` at all).
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(lines[lines.length - 1] ?? '{}') as { readonly outcome?: string };
    expect(parsed.outcome).toBe('gate-not-available');
  });

  it('exits non-zero for "test adopt --write --run <id>" against a real, confidently-detected proposal once the gate file exists but no human has approved it -- "not-approved"', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2' } }),
      'utf8',
    );
    await writeTestAdoptGateFile(project);
    await dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'adopt'], true));
    const { exitCode, lines } = await captureLogs(() =>
      dispatchTestExemptCoverageFlaky(
        ctx(project, ['test', 'adopt', '--write', '--run', 'p21-no-approval'], true),
      ),
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(lines[lines.length - 1] ?? '{}') as { readonly outcome?: string };
    expect(parsed.outcome).toBe('not-approved');
  });

  it('refuses a real, unexpected extra positional for "test adopt"', async () => {
    const project = await createTestProject();
    await expect(
      dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'adopt', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('refuses a real, disclosed USR-003 for "test plan"/"test generate"/"test report"', async () => {
    const project = await createTestProject();
    await expect(
      dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'plan'])),
    ).rejects.toMatchObject({ code: 'USR-003' });
    await expect(
      dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'generate'])),
    ).rejects.toMatchObject({ code: 'USR-003' });
    await expect(
      dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'report'])),
    ).rejects.toMatchObject({ code: 'USR-003' });
  });

  it('refuses a real, unexpected extra positional for "test plan"/"generate"/"report"', async () => {
    const project = await createTestProject();
    await expect(
      dispatchTestExemptCoverageFlaky(ctx(project, ['test', 'plan', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });
});
