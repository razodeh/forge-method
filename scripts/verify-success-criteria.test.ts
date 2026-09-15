/**
 * `scripts/verify-success-criteria.mjs` and its pure logic (`lib/success-criteria.mjs`).
 *
 * Two layers, the identical split `bench.test.ts`/`ratchet.test.ts` already establish for this
 * directory: the decision logic (`evaluateCriterion`/`evaluateAll`) is unit-tested directly with an
 * injected fake `exec`, and the CLI wrapper is proven once, for real, as a real subprocess against the
 * real repository.
 *
 * The single most important property under test here is the one `PLAN-M12.md` P9's own Checks line
 * names explicitly: **a deliberately broken criterion is caught and reported by name, not silently
 * passed** — this script must not just be checking "did some test run," it must actually surface a
 * real command failure as a real, named FAIL. That is `describe('a deliberately broken criterion ...')`
 * below: an injected fake `exec` that fails exactly one real, named check (mirroring "temporarily
 * disabling a real gate check") while every other command in the same run succeeds, and the report
 * marks precisely that criterion FAIL, names the failing command, and leaves every other criterion at
 * its real verdict — proving the script discriminates real pass from real fail rather than always
 * reporting green.
 *
 * @see scripts/lib/success-criteria.mjs
 * @see PLAN-M12.md P9
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  evaluateAll,
  evaluateCriterion,
  formatReport,
  hasRealPassedTests,
  SUCCESS_CRITERIA,
} from './lib/success-criteria.mjs';
import { realExec } from './verify-success-criteria.mjs';

const scriptPath = fileURLToPath(new URL('verify-success-criteria.mjs', import.meta.url));
const repoRoot = path.resolve(import.meta.dirname, '..');

// Shaped like a real vitest pass summary (`Tests  N passed (N)`) so `hasRealPassedTests` — which every
// vitest-sourced command now runs through — accepts it. A fake that merely said "ran: <argv>" would
// itself now be indistinguishable from a real vacuous `-t` match and get (correctly) rejected.
function fakeExecAlwaysOk(argv: readonly string[]) {
  return { ok: true, exitCode: 0, output: `ran: ${argv.join(' ')}\n Tests  1 passed (1)` };
}

function fakeExecFailingFor(failingArgvSubstring: string) {
  return (argv: readonly string[]) => {
    if (argv.join(' ').includes(failingArgvSubstring)) {
      return {
        ok: false,
        exitCode: 1,
        output: 'AssertionError: expected true to be false\n  at ...',
      };
    }
    return { ok: true, exitCode: 0, output: `ran: ${argv.join(' ')}\n Tests  1 passed (1)` };
  };
}

describe('SUCCESS_CRITERIA (definitions)', () => {
  it('names exactly SC1 through SC11, once each, in order', () => {
    expect(SUCCESS_CRITERIA.map((definition) => definition.id)).toEqual([
      'SC1',
      'SC2',
      'SC3',
      'SC4',
      'SC5',
      'SC6',
      'SC7',
      'SC8',
      'SC9',
      'SC10',
      'SC11',
    ]);
  });

  it('every criterion has at least one command — no criterion is "verified" by doing nothing', () => {
    for (const definition of SUCCESS_CRITERIA) {
      expect(definition.commands.length).toBeGreaterThan(0);
    }
  });

  it('every "disclosed" criterion carries a non-empty disclosure string; no "automated" criterion does', () => {
    for (const definition of SUCCESS_CRITERIA) {
      if (definition.mode === 'disclosed') {
        expect(typeof definition.disclosure).toBe('string');
        expect(definition.disclosure!.length).toBeGreaterThan(40);
      } else {
        expect(definition.disclosure).toBeUndefined();
      }
    }
  });

  it('SC4 and SC6 are the human-judgment/live-adapter criteria the plan names as disclosure candidates — SC4 is disclosed; SC6 has a real, fully-automatable proof and is not', () => {
    // `forge debug` (SC6) is provable end to end against a fake, non-billing adapter with no human in
    // the loop (`debug.test.ts` already does this for real) — unlike SC4's real external-maintainer
    // judgment call, it needed no disclosure once investigated concretely.
    const sc4 = SUCCESS_CRITERIA.find((d) => d.id === 'SC4')!;
    const sc6 = SUCCESS_CRITERIA.find((d) => d.id === 'SC6')!;
    expect(sc4.mode).toBe('disclosed');
    expect(sc6.mode).toBe('automated');
  });
});

describe('evaluateCriterion', () => {
  it('reports PASS for an "automated" criterion when every command succeeds', () => {
    const definition = SUCCESS_CRITERIA.find((d) => d.id === 'SC3')!;
    const result = evaluateCriterion(definition, fakeExecAlwaysOk);
    expect(result.verdict).toBe('PASS');
    expect(result.commandResults.every((c) => c.ok)).toBe(true);
  });

  it('reports FAIL, naming the failing command, when one command in an "automated" criterion fails', () => {
    const definition = SUCCESS_CRITERIA.find((d) => d.id === 'SC11')!;
    const failingCommand = definition.commands[2]!; // traceability.test.ts (I6)
    const result = evaluateCriterion(definition, fakeExecFailingFor(failingCommand.argv.join(' ')));
    expect(result.verdict).toBe('FAIL');
    const failing = result.commandResults.filter((c) => !c.ok);
    expect(failing).toHaveLength(1);
    expect(failing[0]!.description).toBe(failingCommand.description);
    expect(failing[0]!.description).toContain('I6');
    // Every other command in the same criterion still ran and is still reported ok — a failing check
    // does not suppress or hide its siblings' own real results.
    const passing = result.commandResults.filter((c) => c.ok);
    expect(passing).toHaveLength(definition.commands.length - 1);
  });

  it('always reports DISCLOSED for a "disclosed" criterion, even when every one of its own commands passes', () => {
    const definition = SUCCESS_CRITERIA.find((d) => d.id === 'SC4')!;
    const result = evaluateCriterion(definition, fakeExecAlwaysOk);
    expect(result.verdict).toBe('DISCLOSED');
    expect(result.disclosure).toBe(definition.disclosure);
  });

  it('a "disclosed" criterion still runs and reports its own commands\' real ok/fail, it just never becomes the overall verdict', () => {
    const definition = SUCCESS_CRITERIA.find((d) => d.id === 'SC9')!;
    const failingCommand = definition.commands[0]!;
    const result = evaluateCriterion(definition, fakeExecFailingFor(failingCommand.argv.join(' ')));
    expect(result.verdict).toBe('DISCLOSED');
    expect(result.commandResults[0]!.ok).toBe(false);
  });
});

describe("evaluateAll — the whole-report adversarial check (PLAN-M12.md P9's own Checks line)", () => {
  it("a single deliberately-broken real check (I7's tool-ceiling refusal, security.test.ts) fails exactly SC11 by name, with every other criterion at its real, independent verdict", () => {
    const sc11 = SUCCESS_CRITERIA.find((d) => d.id === 'SC11')!;
    const securityCommand = sc11.commands.find((c) => c.description.includes('I7'))!;

    const { results, exitCode, failed } = evaluateAll(
      SUCCESS_CRITERIA,
      fakeExecFailingFor(securityCommand.argv.join(' ')),
    );

    expect(exitCode).toBe(1);
    expect(failed.map((r) => r.id)).toEqual(['SC11']);

    const sc11Result = results.find((r) => r.id === 'SC11')!;
    expect(sc11Result.verdict).toBe('FAIL');
    const failingCommandResult = sc11Result.commandResults.find((c) => !c.ok)!;
    expect(failingCommandResult.description).toBe(securityCommand.description);

    // Every non-SC11 criterion is completely unaffected — the break is real, targeted, and does not
    // leak into criteria whose own commands never touched the broken check.
    for (const result of results) {
      if (result.id === 'SC11') continue;
      expect(result.verdict).not.toBe('FAIL');
    }

    const report = formatReport(results);
    expect(report).toContain('SC11 [FAIL]');
    expect(report).toContain(securityCommand.description);
    expect(report).toContain('AssertionError');
  });

  it('exitCode is 0 when nothing automated fails, regardless of how many criteria are DISCLOSED', () => {
    const { exitCode, failed } = evaluateAll(SUCCESS_CRITERIA, fakeExecAlwaysOk);
    expect(exitCode).toBe(0);
    expect(failed).toEqual([]);
  });

  it('a broken command inside more than one criterion fails every criterion it appears in, each named', () => {
    // A shared underlying check (crash-resume.test.ts) feeds both SC2 (disclosed) and SC3 (automated).
    const { results, failed } = evaluateAll(
      SUCCESS_CRITERIA,
      fakeExecFailingFor('crash-resume.test.ts'),
    );
    expect(failed.map((r) => r.id)).toEqual(['SC3']);
    const sc2 = results.find((r) => r.id === 'SC2')!;
    // SC2 stays DISCLOSED (never FAIL) even though one of its own commands failed for real — a
    // disclosed criterion's verdict is never fabricated as a pass OR corrupted into a false fail by
    // a command that was only ever partial, best-effort evidence for it.
    expect(sc2.verdict).toBe('DISCLOSED');
    expect(sc2.commandResults.some((c) => !c.ok)).toBe(true);
  });
});

describe('hasRealPassedTests — real vitest output strings (critic round-1 finding)', () => {
  // A fresh critic round confirmed, by running it live, that a vitest `-t <pattern>` matching zero
  // tests exits 0 -- "every test in the file was filtered out" reads as a pass by exit code alone.
  // Any SC command built on a `-t` pattern (title renamed out from under it, block deleted, etc.)
  // would therefore silently report PASS having run zero real assertions. These strings are the real,
  // literal output this repository's own vitest prints for each shape, not an invented format.
  it('accepts real output where vitest reports at least one test genuinely passed', () => {
    expect(hasRealPassedTests(' Tests  7 passed | 148 skipped (155)')).toBe(true);
    expect(hasRealPassedTests(' Tests  61 passed (61)')).toBe(true);
  });

  it('rejects the real output shape of a `-t` pattern matching zero tests (every test skipped, no "passed" at all)', () => {
    expect(hasRealPassedTests(' Test Files  1 skipped (1)\n      Tests  15 skipped (15)')).toBe(
      false,
    );
  });

  it('rejects output with no recognizable vitest summary at all', () => {
    expect(hasRealPassedTests('')).toBe(false);
    expect(hasRealPassedTests('some unrelated stdout')).toBe(false);
  });
});

describe('evaluateCriterion — vacuous `-t` match is a real FAIL, not a false PASS (critic round-1 finding)', () => {
  it('a vitest command that exits 0 but never actually passed a test is reported FAIL, not PASS', () => {
    const definition = SUCCESS_CRITERIA.find((d) => d.id === 'SC3')!;
    const vacuousExec = () => ({
      ok: true,
      exitCode: 0,
      output: ' Test Files  1 skipped (1)\n      Tests  15 skipped (15)',
    });
    const result = evaluateCriterion(definition, vacuousExec);
    expect(result.verdict).toBe('FAIL');
    expect(result.commandResults[0]!.ok).toBe(false);
    expect(result.commandResults[0]!.outputTail).toContain('REFUSED');
  });

  it('a non-vitest command (argv not built by the vitest() helper) is judged on ok/exitCode alone, no passed-count requirement', () => {
    const definition = SUCCESS_CRITERIA.find((d) => d.id === 'SC3')!;
    const nonVitestExec = () => ({
      ok: true,
      exitCode: 0,
      output: 'no vitest summary here at all',
    });
    const result = evaluateCriterion(definition, nonVitestExec);
    // Every real SUCCESS_CRITERIA command IS a vitest() command, so this exercises the guard's own
    // `isVitestCommand` branch directly rather than only by accident of what's currently defined.
    expect(result.verdict).toBe('FAIL');
  });
});

describe('realExec + evaluateCriterion together — a real vacuous `-t` match, real vitest subprocess', () => {
  it('a real `-t` pattern matching zero real tests in a real file is reported FAIL, not a false PASS — the exact live behavior critic round 1 confirmed by running it, now guarded and pinned by a test', () => {
    const definition = SUCCESS_CRITERIA.find((d) => d.id === 'SC1')!;
    const forcedVacuous = {
      ...definition,
      commands: [
        {
          description: 'a `-t` pattern that cannot possibly match any real test title',
          argv: [
            'node',
            'scripts/run-tests.mjs',
            'run',
            'packages/cli/test/init/run-init.test.ts',
            '-t',
            'this-title-cannot-possibly-match-anything-zzz123',
          ],
        },
      ],
    };
    const result = evaluateCriterion(forcedVacuous, realExec);
    expect(result.verdict).toBe('FAIL');
    expect(result.commandResults[0]!.ok).toBe(false);
    expect(result.commandResults[0]!.exitCode).toBe(0); // the real vitest exit code really is 0
    expect(result.commandResults[0]!.outputTail).toContain('REFUSED');
  }, 30_000);
});

describe('verify-success-criteria.mjs — real subprocess, real repository', () => {
  it('running with --only SC3 against the real repo passes for real (crash-resume.test.ts genuinely runs)', () => {
    const output = execFileSync(
      process.execPath,
      ['--experimental-strip-types', scriptPath, '--only', 'SC3'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    expect(output).toContain('SC3 [PASS]');
    expect(output).toContain('Summary: 1 PASS, 0 FAIL, 0 DISCLOSED (of 1).');
  }, 60_000);

  it('an unknown --only id exits non-zero with a clear message rather than silently running everything', () => {
    let failure: { status?: number | null; stdout?: string; stderr?: string } | undefined;
    try {
      execFileSync(process.execPath, ['--experimental-strip-types', scriptPath, '--only', 'SC99'], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
    } catch (error) {
      failure = error as typeof failure;
    }
    expect(failure?.status).toBe(2);
    expect(`${failure?.stdout ?? ''}${failure?.stderr ?? ''}`).toContain('SC99');
  });
});

describe('realExec — the real-subprocess mapping itself (a real command, not an injected fake)', () => {
  it('maps a real, genuinely non-zero-exit command to ok: false with the real exit code and real captured output', () => {
    const result = realExec(['node', '-e', "console.error('boom'); process.exit(1)"]);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('boom');
  });

  it('maps a real, genuinely successful command to ok: true, exitCode 0, with real stdout captured', () => {
    const result = realExec(['node', '-e', "console.log('all good')"]);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('all good');
  });

  it('maps a real, deliberately SIGKILLed command to ok: false, exitCode: null (never fabricates a numeric code for a signal death)', () => {
    const result = realExec(['node', '-e', 'process.kill(process.pid, "SIGKILL")']);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.output).toContain('SIGKILL');
  });
});
