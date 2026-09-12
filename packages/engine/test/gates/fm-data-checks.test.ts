/**
 * `modules/fm-data/checks/lineage.check.yaml` and `checks/data-quality.check.yaml` (`PLAN-M10.md` P5,
 * `19` §19.1's own "lineage/quality checks" row) -- mirrors `fm-web-checks.test.ts`'s own established
 * pattern.
 *
 * `19` §19.3's own Check-authoring "test" row, literally: run each real check against both a passing
 * and a failing fixture. This suite proves it two ways for each check:
 *  1. a real child process actually runs the check's own literal `run:` command (via `execa`, not a
 *     stub) against a real fixture directory tree, and its real stdout is fed through
 *     `@forge/engine/gates`' own real, already-tested `evaluateGate`.
 *  2. the check's own declared `failOn` expression is exercised against both outcomes.
 *
 * @see specs/19 §19.1, §19.3
 * @see PLAN-M10.md P5
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
const checksDir = path.join(repoRoot, 'modules', 'fm-data', 'checks');

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

/** A real `CheckRunner` — actually spawns `check.run` via a shell (execa) in `cwd`. */
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
  const dir = await mkdtemp(path.join(tmpdir(), 'fm-data-check-'));
  tempDirs.push(dir);
  return dir;
}

async function writePipelineDoc(dir: string, name: string, content: string): Promise<void> {
  const pipelinesDir = path.join(dir, 'docs', 'forge', 'kb', 'data', 'pipelines');
  await mkdir(pipelinesDir, { recursive: true });
  await writeFile(path.join(pipelinesDir, `${name}.md`), content);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('checks/lineage.check.yaml — real command, real parser, real failOn', () => {
  const raw = readCheck('lineage.check.yaml');

  it('has the real DeterministicCheck shape plus a non-empty remedy (19 §19.6), and its run: script never interpolates an untrusted/environment value into the shell', () => {
    expect(raw.id).toBe('lineage:coverage');
    expect(raw.run.length).toBeGreaterThan(0);
    expect(raw.failOn).toBe('violations > 0');
    expect(raw.remedy.trim().length).toBeGreaterThan(0);
    expect(raw.run).not.toContain('process.env');
    expect(raw.run).not.toContain('execSync');
    expect(raw.run).not.toContain('execFileSync');
  });

  it('passes when every pipeline doc has a real Lineage section naming a Source and a Target', async () => {
    const dir = await makeFixtureDir();
    await writePipelineDoc(
      dir,
      'orders',
      '# Orders pipeline\n\n## Lineage\n\nSource: postgres.orders\nTarget: warehouse.fct_orders\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 0, pipelinesScanned: 1 });
  });

  it('fails when a pipeline doc has no Lineage section at all', async () => {
    const dir = await makeFixtureDir();
    await writePipelineDoc(dir, 'orders', '# Orders pipeline\n\nNo lineage section here.\n');
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, pipelinesScanned: 1 });
  });

  it('fails when a Lineage section is present but omits a Target', async () => {
    const dir = await makeFixtureDir();
    await writePipelineDoc(
      dir,
      'orders',
      '# Orders pipeline\n\n## Lineage\n\nSource: postgres.orders\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, pipelinesScanned: 1 });
  });

  it('passes vacuously (0 violations) against a project with no pipelines/ directory yet, rather than crashing', async () => {
    const dir = await makeFixtureDir();
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 0, pipelinesScanned: 0 });
  });

  it('fails when the "## Lineage" section itself is empty, even though an unrelated later section names Source/Target -- a critic round found the first draft\'s own regex checked the WHOLE file text, not the Lineage section\'s own content', async () => {
    const dir = await makeFixtureDir();
    await writePipelineDoc(
      dir,
      'decoy',
      '# Decoy pipeline\n\n## Lineage\n\n## Changelog\n\nSource: x\nTarget: y\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, pipelinesScanned: 1 });
  });
});

describe('checks/data-quality.check.yaml — real command, real parser, real failOn', () => {
  const raw = readCheck('data-quality.check.yaml');

  it('has the real DeterministicCheck shape plus a non-empty remedy (19 §19.6), and its run: script never interpolates an untrusted/environment value into the shell', () => {
    expect(raw.id).toBe('data-quality:tests');
    expect(raw.run.length).toBeGreaterThan(0);
    expect(raw.failOn).toBe('violations > 0');
    expect(raw.remedy.trim().length).toBeGreaterThan(0);
    expect(raw.run).not.toContain('process.env');
    expect(raw.run).not.toContain('execSync');
    expect(raw.run).not.toContain('execFileSync');
  });

  it('passes when every pipeline doc has a matching, non-empty test file', async () => {
    const dir = await makeFixtureDir();
    await writePipelineDoc(dir, 'orders', '# Orders pipeline\n');
    const testsDir = path.join(dir, 'test', 'data-quality');
    await mkdir(testsDir, { recursive: true });
    await writeFile(path.join(testsDir, 'orders.dq.test.ts'), '// real content\n');
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 0, pipelinesScanned: 1 });
  });

  it('fails when a pipeline doc has no matching test file', async () => {
    const dir = await makeFixtureDir();
    await writePipelineDoc(dir, 'orders', '# Orders pipeline\n');
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, pipelinesScanned: 1 });
  });

  it('fails when the matching test file exists but is empty', async () => {
    const dir = await makeFixtureDir();
    await writePipelineDoc(dir, 'orders', '# Orders pipeline\n');
    const testsDir = path.join(dir, 'test', 'data-quality');
    await mkdir(testsDir, { recursive: true });
    await writeFile(path.join(testsDir, 'orders.dq.test.ts'), '');
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, pipelinesScanned: 1 });
  });

  it('passes vacuously (0 violations) against a project with no pipelines/ directory yet, rather than crashing', async () => {
    const dir = await makeFixtureDir();
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 0, pipelinesScanned: 0 });
  });

  it('fails for pipeline "orders" even though an unrelated "orders-archive" test file exists -- a critic round found the first draft\'s own match used a naive startsWith prefix test, which "orders-archive.dq.test.ts".startsWith("orders") wrongly satisfied', async () => {
    const dir = await makeFixtureDir();
    await writePipelineDoc(dir, 'orders', '# Orders pipeline\n');
    await writePipelineDoc(dir, 'orders-archive', '# Orders archive pipeline\n');
    const testsDir = path.join(dir, 'test', 'data-quality');
    await mkdir(testsDir, { recursive: true });
    await writeFile(path.join(testsDir, 'orders-archive.dq.test.ts'), '// real content\n');
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, pipelinesScanned: 2 });
  });

  it("fails when the only matching entry under test/data-quality/ is a DIRECTORY, not a file -- a second critic round found the first fix's own fs.readdirSync(testsDir) (no withFileTypes) plus a bare size > 0 check let a directory entry satisfy a pipeline's own requirement", async () => {
    const dir = await makeFixtureDir();
    await writePipelineDoc(dir, 'orders', '# Orders pipeline\n');
    const decoyDir = path.join(dir, 'test', 'data-quality', 'orders.dq.test.ts');
    await mkdir(decoyDir, { recursive: true });
    await writeFile(path.join(decoyDir, 'fake.txt'), 'not a real test file\n');
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, pipelinesScanned: 1 });
  });
});
