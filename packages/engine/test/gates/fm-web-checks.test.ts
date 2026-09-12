/**
 * `modules/fm-web/checks/a11y.check.yaml` and `checks/bundle-size.check.yaml` (`PLAN-M10.md` P3, `19`
 * §19.1's own "a11y checks"/"bundle-size checks" row) -- the first standalone `*.check.yaml` content
 * anywhere in this repository (`modules/fm-core/module.yaml`'s own header comment: every deterministic
 * check fm-core's own gates run was declared inline inside the owning gate, never as a separately
 * shipped file).
 *
 * `19` §19.3's own Check-authoring "test" row, literally: run each real check against both a passing
 * and a failing fixture. This suite proves it two ways for each check:
 *  1. a real child process actually runs the check's own literal `run:` command (via `execa`, not a
 *     stub) against a real fixture `dist/` directory, and its real stdout is fed through
 *     `@forge/engine/gates`' own real, already-tested `evaluateGate` -- not a reimplementation of
 *     that evaluation, the genuine production function.
 *  2. the check's own declared `failOn` expression is exercised against both outcomes, proving the
 *     check.yaml's own `failOn` string is not just present but actually discriminates pass from fail.
 *
 * @see specs/19 §19.1, §19.3
 * @see PLAN-M10.md P3
 */
import { execa } from 'execa';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { evaluateGate } from '../../src/gates/evaluate.ts';
import type { CheckRunner, DeterministicCheck, GateDefinition } from '../../src/gates/types.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const checksDir = path.join(repoRoot, 'modules', 'fm-web', 'checks');

interface RawCheckFile {
  readonly id: string;
  readonly run: string;
  readonly parser?: string;
  readonly failOn: string;
  readonly remedy: string;
}

function readCheck(fileName: string): RawCheckFile {
  return parseYaml(readFileSync(path.join(checksDir, fileName), 'utf8')) as RawCheckFile;
}

function toDeterministicCheck(raw: RawCheckFile): DeterministicCheck {
  return raw.parser === undefined
    ? { id: raw.id, run: raw.run, failOn: raw.failOn }
    : { id: raw.id, run: raw.run, parser: raw.parser, failOn: raw.failOn };
}

/** A real `CheckRunner` — actually spawns `check.run` via a shell (execa) in `cwd`, matching how a
 * real project's own `forge compile --check`/gate-evaluation path would run it. Never throws on a
 * non-zero exit: `evaluateGate` only cares about `failOn` against parsed stdout, not the process's own
 * exit code, matching `evaluate.ts`'s own documented contract. */
const realRunner: CheckRunner = async (check, cwd) => {
  const result = await execa(check.run, { cwd, shell: true, reject: false });
  return { stdout: result.stdout, exitCode: result.exitCode ?? -1 };
};

function oneCheckGate(check: DeterministicCheck): GateDefinition {
  return {
    id: 'G-Test',
    checks: { deterministic: [check], advisory: [] },
    openQuestionsPolicy: 'block',
  };
}

const tempDirs: string[] = [];
async function makeFixtureDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fm-web-check-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('checks/a11y.check.yaml — real command, real parser, real failOn', () => {
  const raw = readCheck('a11y.check.yaml');

  it('has the real DeterministicCheck shape plus a non-empty remedy (19 §19.6)', () => {
    expect(raw.id).toBe('a11y:audit');
    expect(raw.run.length).toBeGreaterThan(0);
    expect(raw.failOn).toBe('violations > 0');
    expect(raw.remedy.trim().length).toBeGreaterThan(0);
  });

  it('passes against a fixture with a labelled image and a lang attribute', async () => {
    const dir = await makeFixtureDir();
    await mkdir(path.join(dir, 'dist'), { recursive: true });
    await writeFile(
      path.join(dir, 'dist', 'index.html'),
      '<html lang="en"><body><img src="a.png" alt="A description"></body></html>',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 0, filesScanned: 1 });
  });

  it('fails against a fixture missing alt text and a lang attribute', async () => {
    const dir = await makeFixtureDir();
    await mkdir(path.join(dir, 'dist'), { recursive: true });
    await writeFile(
      path.join(dir, 'dist', 'index.html'),
      '<html><body><img src="a.png"></body></html>',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    const parsed = JSON.parse(result.checks[0]!.stdout) as { violations: number };
    expect(parsed.violations).toBeGreaterThan(0);
  });

  it('passes vacuously (0 violations) against a project with no dist/ directory yet, rather than crashing', async () => {
    const dir = await makeFixtureDir();
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 0, filesScanned: 0 });
  });

  it('fails against a decoy fixture whose only "alt"/"lang"-shaped attributes are data-alt/data-lang, not the real attribute -- a real defect a critic round found and this pins: a bare \\b word-boundary regex treats the hyphen in "data-alt" exactly like real whitespace', async () => {
    const dir = await makeFixtureDir();
    await mkdir(path.join(dir, 'dist'), { recursive: true });
    await writeFile(
      path.join(dir, 'dist', 'index.html'),
      '<html data-lang="en"><body><img src="a.png" data-alt="nope"></body></html>',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 2, filesScanned: 1 });
  });
});

describe('checks/bundle-size.check.yaml — real command, real parser, real failOn', () => {
  const raw = readCheck('bundle-size.check.yaml');

  it('has the real DeterministicCheck shape plus a non-empty remedy (19 §19.6)', () => {
    expect(raw.id).toBe('bundle:size');
    expect(raw.run.length).toBeGreaterThan(0);
    expect(raw.failOn).toBe('bytes > budgetBytes');
    expect(raw.remedy.trim().length).toBeGreaterThan(0);
  });

  it('passes when the built bundle is under budget', async () => {
    const dir = await makeFixtureDir();
    await mkdir(path.join(dir, 'dist'), { recursive: true });
    await writeFile(path.join(dir, 'dist', 'app.js'), 'x'.repeat(1000));
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ bytes: 1000, budgetBytes: 250000 });
  });

  it('fails when the built bundle exceeds budget, and ignores source maps', async () => {
    const dir = await makeFixtureDir();
    await mkdir(path.join(dir, 'dist'), { recursive: true });
    await writeFile(path.join(dir, 'dist', 'app.js'), 'x'.repeat(400_000));
    await writeFile(path.join(dir, 'dist', 'app.js.map'), 'y'.repeat(9_000_000));
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ bytes: 400_000, budgetBytes: 250_000 });
  });
});
