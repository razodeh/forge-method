/**
 * The pre/post-merge check sets (`PLAN-M13.md` P38, `06` §6.5 steps 3 and 5, `10` §10.1's example
 * `policy: { conflict: agent, preChecks: fast, postChecks: full }`, `13` §13.1 F-TEST-1 rule 4).
 *
 * `fast` and `full` are NAMES of sets of test layers, not shell commands: a layer's command is the project's own
 * `execution.testCommands.<layer>`. Before this, the engine ran the name as a command (`fast: command not found`)
 * and every real `build-stage` merge failed its pre-check. What is pinned here is the resolution: which layers a
 * name means, that an unconfigured set is a typed refusal that names the config key (never a pass, never
 * `command not found`), that a configured command is run exactly as written, and that anything that is not a
 * name is still the literal shell command it always was.
 *
 * @see specs/06 §6.5
 * @see specs/13 §13.1
 */
import { describe, expect, it } from 'vitest';

import { CHECK_SETS, isCheckSetName, resolveMergeChecks } from '../../src/dispatch/merge-checks.ts';

describe('what a check-set name means (06 section 6.5 steps 3 and 5)', () => {
  it('fast is typecheck, lint and unit; full adds integration and contract (the layers that need no deployed environment)', () => {
    expect(CHECK_SETS.fast).toEqual(['typecheck', 'lint', 'unit']);
    expect(CHECK_SETS.full).toEqual(['typecheck', 'lint', 'unit', 'integration', 'contract']);
  });

  it('a name is a set (fast, full) or one layer (unit, lint, ...); a shell word like "false" is neither', () => {
    for (const name of ['fast', 'full', 'unit', 'integration', 'contract', 'lint', 'typecheck']) {
      expect(isCheckSetName(name)).toBe(true);
    }
    for (const notAName of ['false', 'true', 'npm test', 'exit 1', 'Fast', '']) {
      expect(isCheckSetName(notAName)).toBe(false);
    }
  });
});

describe('resolveMergeChecks', () => {
  const source = 'the merge policy preChecks';

  it('no spec at all means no checks (a merge step that declares none)', () => {
    expect(resolveMergeChecks(undefined, {}, source)).toEqual({
      ok: true,
      commands: [],
      skipped: [],
    });
  });

  it('a set runs the configured commands of its layers, in the set order, labelled by the config key', () => {
    const result = resolveMergeChecks(
      'fast',
      { unit: 'node -e "0"', typecheck: 'node -e "1"', lint: 'node -e "2"', e2e: 'never' },
      source,
    );
    expect(result).toEqual({
      ok: true,
      commands: [
        { command: 'node -e "1"', label: 'execution.testCommands.typecheck' },
        { command: 'node -e "2"', label: 'execution.testCommands.lint' },
        { command: 'node -e "0"', label: 'execution.testCommands.unit' },
      ],
      skipped: [],
    });
  });

  it('a layer of the set with no command is reported as skipped, not run and not treated as passing', () => {
    const result = resolveMergeChecks('fast', { unit: 'node -e "0"' }, source);
    expect(result).toEqual({
      ok: true,
      commands: [{ command: 'node -e "0"', label: 'execution.testCommands.unit' }],
      skipped: ['typecheck', 'lint'],
    });
  });

  it('a set none of whose layers is configured is a typed refusal naming the config keys and the alternative, never a pass', () => {
    const result = resolveMergeChecks('full', { e2e: 'x' }, source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.source).toBe('merge');
    expect(result.failure.code).toBe('MERGE-CHECKS-UNCONFIGURED');
    for (const key of [
      'execution.testCommands.typecheck',
      'execution.testCommands.lint',
      'execution.testCommands.unit',
      'execution.testCommands.integration',
      'execution.testCommands.contract',
    ]) {
      expect(result.failure.message).toContain(key);
    }
    expect(result.failure.message).toContain('"full"');
    expect(result.failure.message).toContain(source);
    expect(result.failure.message).toMatch(/Remedy/);
    expect(result.failure.message).not.toMatch(/command not found/);
  });

  it('a single layer name runs that layer alone, and refuses when it is not configured', () => {
    expect(resolveMergeChecks('lint', { lint: 'eslint .' }, source)).toEqual({
      ok: true,
      commands: [{ command: 'eslint .', label: 'execution.testCommands.lint' }],
      skipped: [],
    });
    const refused = resolveMergeChecks('lint', {}, source);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.failure.message).toContain('execution.testCommands.lint');
  });

  it('anything that is not a name is the literal shell command it always was (no label)', () => {
    expect(resolveMergeChecks('false', {}, source)).toEqual({
      ok: true,
      commands: [{ command: 'false' }],
      skipped: [],
    });
    expect(resolveMergeChecks('npm test -- --run', {}, source)).toEqual({
      ok: true,
      commands: [{ command: 'npm test -- --run' }],
      skipped: [],
    });
  });

  it('a blank spec is a refusal, not a silent pass', () => {
    const result = resolveMergeChecks('   ', {}, source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('MERGE-CHECKS-UNCONFIGURED');
  });

  it('a configured command holding a line break or NUL is refused: that is a second command, not a value', () => {
    for (const bad of ['npm test\nrm -rf x', 'npm test\rx', `npm${String.fromCharCode(0)}test`]) {
      const result = resolveMergeChecks('fast', { unit: bad }, source);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('MERGE-CHECK-COMMAND-INVALID');
        expect(result.failure.message).toContain('execution.testCommands.unit');
      }
    }
  });

  it('a trailing newline (a YAML block scalar) is not a second command', () => {
    const result = resolveMergeChecks('unit', { unit: 'npm test\n' }, source);
    expect(result).toEqual({
      ok: true,
      commands: [{ command: 'npm test', label: 'execution.testCommands.unit' }],
      skipped: [],
    });
  });

  it('a blank configured command is treated as not configured', () => {
    const result = resolveMergeChecks('unit', { unit: '  ' }, source);
    expect(result.ok).toBe(false);
  });
});
