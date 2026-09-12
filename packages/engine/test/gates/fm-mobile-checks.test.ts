/**
 * `modules/fm-mobile/checks/device-matrix.check.yaml` (`PLAN-M10.md` P6, `19` §19.1's own
 * "device-matrix test strategy" row) -- mirrors `fm-data-checks.test.ts`'s own established pattern.
 *
 * `19` §19.3's own Check-authoring "test" row, literally: run the real check against both a passing
 * and a failing fixture. This suite proves it two ways:
 *  1. a real child process actually runs the check's own literal `run:` command (via `execa`, not a
 *     stub) against a real fixture directory tree, and its real stdout is fed through
 *     `@forge/engine/gates`' own real, already-tested `evaluateGate`.
 *  2. the check's own declared `failOn` expression is exercised against both outcomes.
 *
 * @see specs/19 §19.1, §19.3
 * @see PLAN-M10.md P6
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
const checksDir = path.join(repoRoot, 'modules', 'fm-mobile', 'checks');

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
  const dir = await mkdtemp(path.join(tmpdir(), 'fm-mobile-check-'));
  tempDirs.push(dir);
  return dir;
}

async function writeDeviceMatrix(dir: string, content: string): Promise<void> {
  const mobileDir = path.join(dir, 'docs', 'forge', 'kb', 'mobile');
  await mkdir(mobileDir, { recursive: true });
  await writeFile(path.join(mobileDir, 'device-matrix.md'), content);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('checks/device-matrix.check.yaml — real command, real parser, real failOn', () => {
  const raw = readCheck('device-matrix.check.yaml');

  it('has the real DeterministicCheck shape plus a non-empty remedy (19 §19.6), and its run: script never interpolates an untrusted/environment value into the shell', () => {
    expect(raw.id).toBe('device-matrix:coverage');
    expect(raw.run.length).toBeGreaterThan(0);
    expect(raw.failOn).toBe('violations > 0');
    expect(raw.remedy.trim().length).toBeGreaterThan(0);
    expect(raw.run).not.toContain('process.env');
    expect(raw.run).not.toContain('execSync');
    expect(raw.run).not.toContain('execFileSync');
  });

  it('passes when both an iOS and an Android device row are present and every row passed', async () => {
    const dir = await makeFixtureDir();
    await writeDeviceMatrix(
      dir,
      '# Device matrix\n\n## Coverage\n\n- Device: iPhone 15 | OS: iOS 17 | Result: pass\n- Device: Pixel 8 | OS: Android 14 | Result: pass\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 0, devicesScanned: 2 });
  });

  it('fails when a listed row did not pass', async () => {
    const dir = await makeFixtureDir();
    await writeDeviceMatrix(
      dir,
      '# Device matrix\n\n## Coverage\n\n- Device: iPhone 15 | OS: iOS 17 | Result: fail\n- Device: Pixel 8 | OS: Android 14 | Result: pass\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, devicesScanned: 2 });
  });

  it('fails when no row covers an Android device even though every listed row passed', async () => {
    const dir = await makeFixtureDir();
    await writeDeviceMatrix(
      dir,
      '# Device matrix\n\n## Coverage\n\n- Device: iPhone 15 | OS: iOS 17 | Result: pass\n- Device: iPad Air | OS: iOS 17 | Result: pass\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, devicesScanned: 2 });
  });

  it('fails when no row covers an iOS device even though every listed row passed', async () => {
    const dir = await makeFixtureDir();
    await writeDeviceMatrix(
      dir,
      '# Device matrix\n\n## Coverage\n\n- Device: Pixel 8 | OS: Android 14 | Result: pass\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, devicesScanned: 1 });
  });

  it('fails with one violation (devicesScanned: 0) when the file exists but has no "## Coverage" section at all', async () => {
    const dir = await makeFixtureDir();
    await writeDeviceMatrix(dir, '# Device matrix\n\nNo coverage section here.\n');
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, devicesScanned: 0 });
  });

  it('passes vacuously (0 violations) against a project with no device-matrix.md file at all, rather than crashing', async () => {
    const dir = await makeFixtureDir();
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 0, devicesScanned: 0 });
  });

  it('ignores a malformed bullet line (missing the Result field) rather than crashing or miscounting devicesScanned', async () => {
    const dir = await makeFixtureDir();
    await writeDeviceMatrix(
      dir,
      '# Device matrix\n\n## Coverage\n\n- Device: iPhone 15 | OS: iOS 17 | Result: pass\n- Device: Pixel 8 | OS: Android 14\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    // Only the well-formed iOS row is recognised; the malformed line is silently ignored, so the
    // matrix still has no recognised Android row and fails on that basis.
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, devicesScanned: 1 });
  });

  it('recognises a device/OS pairing case-insensitively and regardless of which field names the platform', async () => {
    const dir = await makeFixtureDir();
    await writeDeviceMatrix(
      dir,
      '# Device matrix\n\n## Coverage\n\n- Device: Galaxy S24 | OS: ANDROID 14 | Result: PASS\n- Device: iPhone SE | OS: iOS 16 | Result: pass\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 0, devicesScanned: 2 });
  });

  it('fails to credit iOS coverage from a device name that merely CONTAINS "ios" as a substring ("Kiosk") -- a critic round found the first draft\'s own plain String.includes("ios") let this device wrongly satisfy the iOS requirement', async () => {
    const dir = await makeFixtureDir();
    await writeDeviceMatrix(
      dir,
      '# Device matrix\n\n## Coverage\n\n- Device: Verifone Kiosk Terminal | OS: Linux 4.9 | Result: pass\n- Device: Pixel 8 | OS: Android 14 | Result: pass\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, devicesScanned: 2 });
  });

  it('fails to credit iOS coverage from an OS field that merely CONTAINS "ios" as a substring ("fooios") without genuinely starting with it -- the identical class of false positive as the "Kiosk" case above, for the OS field instead of the device field', async () => {
    const dir = await makeFixtureDir();
    await writeDeviceMatrix(
      dir,
      '# Device matrix\n\n## Coverage\n\n- Device: Something | OS: fooios | Result: pass\n- Device: Pixel 8 | OS: Android 14 | Result: pass\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ violations: 1, devicesScanned: 2 });
  });
});
