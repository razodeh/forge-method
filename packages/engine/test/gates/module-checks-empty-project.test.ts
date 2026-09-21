/**
 * Every shipped module check FAILS on a project that has none of the inputs it reads (`PLAN-M13.md` P41, the P35 finding).
 *
 * `bundle:size`, `a11y:audit`, `contract:verify`, `lineage:coverage` and `data-quality:tests` treated a missing directory
 * as an empty list and passed, and `api:breaking-change` swallowed a failing `git diff`. A check must positively show
 * success (`10` §10.3 fails closed), so "nothing to scan" is a failure with a reason, waivable by a person.
 * Derived from the shipped `modules/*` directories, so a new module check is covered the day it is added.
 *
 * @see specs/10 §10.3
 */
import { execa } from 'execa';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { evaluateGate } from '../../src/gates/evaluate.ts';
import type { CheckRunner, DeterministicCheck } from '../../src/gates/types.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const modulesDir = path.join(repoRoot, 'modules');

interface RawCheck {
  readonly id: string;
  readonly run: string;
  readonly parser?: string;
  readonly failOn: string;
}

const checks: { readonly file: string; readonly check: RawCheck }[] = [];
for (const moduleId of readdirSync(modulesDir)) {
  const dir = path.join(modulesDir, moduleId, 'checks');
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.check.yaml'));
  } catch {
    continue;
  }
  for (const name of files) {
    checks.push({
      file: `${moduleId}/checks/${name}`,
      check: parseYaml(readFileSync(path.join(dir, name), 'utf8')) as RawCheck,
    });
  }
}

const realRunner: CheckRunner = async (check, cwd) => {
  const result = await execa(check.run, { cwd, shell: true, reject: false });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? -1 };
};

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('every shipped module check fails on an empty project', () => {
  it('finds the shipped module checks (not vacuous)', () => {
    expect(checks.map((c) => c.check.id).sort()).toEqual(
      [
        'a11y:audit',
        'api:breaking-change',
        'bundle:size',
        'contract:verify',
        'data-quality:tests',
        'device-matrix:coverage',
        'lineage:coverage',
      ].sort(),
    );
  });

  it.each(checks)('$check.id ($file)', async ({ check }) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-empty-project-'));
    tempDirs.push(dir);
    const deterministic: DeterministicCheck = {
      id: check.id,
      run: check.run,
      ...(check.parser === undefined ? {} : { parser: check.parser }),
      failOn: check.failOn,
    };
    const result = await evaluateGate(
      {
        id: 'G-Empty',
        checks: { deterministic: [deterministic], advisory: [] },
        openQuestionsPolicy: 'warn',
      },
      dir,
      realRunner,
    );
    const only = result.checks[0];
    expect(
      only?.passed,
      `${check.id} passed on a project with nothing to check: ${only?.stdout ?? ''}`,
    ).toBe(false);
    // a REAL verdict with a stated reason, not a crash the evaluator had to fail closed on
    expect(only?.reason, `${check.id} crashed rather than reporting`).toBeUndefined();
    expect(JSON.parse(only?.stdout ?? '{}')).toMatchObject({
      reason: expect.any(String) as string,
    });
  });
});
