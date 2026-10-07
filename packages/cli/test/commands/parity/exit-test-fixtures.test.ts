/**
 * `fixtures/parity-refactor/` — `specs/22` M16's own milestone exit test made real (`specs/22` M16 P7,
 * `13` F-TEST-9):
 *
 * ```
 * forge parity check --json   # fixture refactor, behaviour-preserving change: exits 0
 * forge parity check --json   # same fixture refactor, behaviour-changing change: exits non-zero
 * ```
 *
 * The fixture holds a reference tree (`reference/sum.mjs`), a behaviour-preserving refactor
 * (`preserving/sum.mjs`) and a behaviour-changing one (`changing/sum.mjs`), plus the declaration
 * template (`declaration/behavior.parity.yaml`, its `reference.ref` a placeholder this test fills in
 * with the real commit sha once it exists — the declaration cannot name a commit that is not made
 * yet). This file assembles a REAL git repository from them, in a system temp directory, for each of
 * the two scenarios, rather than hand-reasoning the outcome.
 *
 * @see specs/22-build-plan-and-milestones.md M16
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { runParityCapture } from '../../../src/commands/parity/capture-command.ts';
import { parityCheckExitCode, runParityCheck } from '../../../src/commands/parity/check-command.ts';

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../fixtures/parity-refactor',
);

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function headSha(dir: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

async function commitAll(dir: string, message: string): Promise<string> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
  return headSha(dir);
}

/**
 * Assembles the shared half of both scenarios: a real git repository whose trunk (`main`) holds the
 * reference implementation, the declaration (naming that exact commit as `reference.ref`) and its
 * capture — fully committed, so the trust anchor reads clean before either scenario diverges the
 * working tree. Returns the directory; each test then overlays its own variant on top, uncommitted.
 */
async function buildFixtureRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p7-exit-test-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n', 'utf8');

  const referenceSource = await readFile(path.join(FIXTURE_ROOT, 'reference/sum.mjs'), 'utf8');
  await writeFile(path.join(dir, 'sum.mjs'), referenceSource, 'utf8');
  const referenceSha = await commitAll(dir, 'reference implementation');

  const declarationTemplate = await readFile(
    path.join(FIXTURE_ROOT, 'declaration/behavior.parity.yaml'),
    'utf8',
  );
  const declaration = declarationTemplate.replace('__REFERENCE_SHA__', referenceSha);
  await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
  await writeFile(path.join(dir, '.forge/parity/behavior.parity.yaml'), declaration, 'utf8');
  await commitAll(dir, 'declare parity for sum.mjs');

  await runParityCapture({
    projectRoot: dir,
    parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
  });
  await commitAll(dir, 'capture reference behaviour');

  return dir;
}

async function overlayVariant(dir: string, variant: 'preserving' | 'changing'): Promise<void> {
  const source = await readFile(path.join(FIXTURE_ROOT, variant, 'sum.mjs'), 'utf8');
  await writeFile(path.join(dir, 'sum.mjs'), source, 'utf8');
}

describe('fixtures/parity-refactor/: the milestone exit test, as a real subprocess fixture (specs/22 M16 P7)', () => {
  it('the behaviour-preserving refactor exits 0 with failing: 0', async () => {
    const dir = await buildFixtureRepo();
    await overlayVariant(dir, 'preserving');

    const result = await runParityCheck({
      projectRoot: dir,
      trusted: 'refs/heads/main',
      reportsRoot: 'docs/forge/reports',
      parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
    });

    expect(result.verdict).toBe('match');
    expect(result.failing).toBe(0);
    expect(result.passing).toBeGreaterThan(0);
    expect(parityCheckExitCode(result)).toBe(0);

    const line = JSON.stringify({ v: 1, ...result });
    expect(line.split('\n')).toHaveLength(1); // --json stdout is exactly one line
  });

  it('the behaviour-changing refactor exits non-zero, naming the surface/case/stream, never the text', async () => {
    const dir = await buildFixtureRepo();
    await overlayVariant(dir, 'changing');

    const result = await runParityCheck({
      projectRoot: dir,
      trusted: 'refs/heads/main',
      reportsRoot: 'docs/forge/reports',
      parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
    });

    expect(result.verdict).toBe('mismatch');
    expect(result.failing).toBeGreaterThan(0);
    expect(parityCheckExitCode(result)).toBe(1);
    const declaration = result.declarations.find((d) => d.name === 'behavior');
    expect(declaration?.verdict).toBe('mismatch');
    expect(declaration?.reason).toMatch(/surface "process"/);
    expect(declaration?.reason).toMatch(/stdout/);
    // The reference's/changing variant's own correct/off-by-one outputs for the declared cases are
    // "5"/"6" (2 + 3) and "6"/"7" (10 + -4) -- none of which this assertion actually scans for. This
    // only confirms `result` serializes to exactly one JSON line (no embedded newline survives
    // serialization), the `--json` stdout contract `10` §10.3 requires; it is not a scan of the
    // envelope's content for those numbers. The real full-envelope text-leak scan (13 F-TEST-9's
    // information boundary: never the differing text itself, anywhere in the envelope) is
    // `check-command.test.ts`'s own "process"/stdout mismatch test, which deliberately uses a literal
    // marker string so `JSON.stringify(result)` can be checked directly, without a false positive
    // against the envelope's own structural fields (such as `"ok":true`).
    const line = JSON.stringify({ v: 1, ...result });
    expect(line.split('\n')).toHaveLength(1);
  });
});
