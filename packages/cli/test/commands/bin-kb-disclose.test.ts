/**
 * `forge kb disclose`/`forge kb disclose resolve`/`forge kb disclosures` (`specs/22` M15 P10) — real
 * subprocess tests, the `bin-exempt.test.ts`-style pattern this same milestone already established for
 * P6: a real, spawned `forge` process against a real, throwaway git project, never a direct function
 * call. Both round-1 gauntlet critics independently exercised this exact surface by hand (building and
 * running the real compiled binary) and confirmed it was already correct end-to-end — this file closes
 * the automated-test gap that left that confidence undocumented, not a functional defect.
 *
 * @see specs/22 M15 P10
 * @see PLAN-M15.md P10
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@forge/schemas/config';

const LAUNCHER = fileURLToPath(new URL('../../bin/forge.mjs', import.meta.url));

function run(
  args: readonly string[],
  cwd: string,
): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args, '-C', cwd], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const execError = error as {
      readonly status: number | null;
      readonly stdout: string;
      readonly stderr: string;
    };
    return { status: execError.status ?? 1, stdout: execError.stdout, stderr: execError.stderr };
  }
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-kb-disclose-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(DEFAULT_CONFIG), 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'base project'], { cwd: dir });
  return dir;
}

describe('forge kb disclose — a real, explicitly-authored disclosure', () => {
  it('records one new DISC-### entry, readable back via forge kb disclosures', async () => {
    const dir = await freshProject();
    const recorded = run(
      [
        'kb',
        'disclose',
        '--kind',
        'trade-off',
        '--summary',
        'coverage is project-wide, not scoped to the story',
        '--owner',
        'architect',
        '--source',
        'decision:ADR-0011',
        '--json',
      ],
      dir,
    );
    expect(recorded.status, recorded.stderr).toBe(0);
    const parsed = JSON.parse(recorded.stdout) as {
      readonly recorded: boolean;
      readonly id: string;
    };
    expect(parsed.recorded).toBe(true);
    expect(parsed.id).toMatch(/^DISC-\d{3}$/);

    const text = await readFile(path.join(dir, 'docs/forge/kb/disclosures.md'), 'utf8');
    expect(text).toContain('kind: trade-off');
    expect(text).toContain('owner: architect');

    const list = run(['kb', 'disclosures', '--json'], dir);
    expect(list.status, list.stderr).toBe(0);
    const ledger = JSON.parse(list.stdout) as {
      readonly open: number;
      readonly entries: readonly { readonly id: string }[];
    };
    expect(ledger.open).toBe(1);
    expect(ledger.entries.map((entry) => entry.id)).toContain(parsed.id);
  }, 30_000);

  it('forge kb disclosures prints a real human-readable line in text mode too', async () => {
    const dir = await freshProject();
    run(
      [
        'kb',
        'disclose',
        '--kind',
        'known-gap',
        '--summary',
        'a real, disclosed gap',
        '--owner',
        'bob',
        '--source',
        'human:elicitation',
      ],
      dir,
    );
    const list = run(['kb', 'disclosures'], dir);
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toContain('known-gap');
    expect(list.stdout).toContain('bob');
  }, 30_000);
});

describe('forge kb disclose — CLI-level refusals', () => {
  it('refuses an invalid --kind', async () => {
    const dir = await freshProject();
    const result = run(
      [
        'kb',
        'disclose',
        '--kind',
        'bogus',
        '--summary',
        'x',
        '--owner',
        'alice',
        '--source',
        'human:y',
      ],
      dir,
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--kind');
  }, 30_000);

  it('refuses a missing --summary', async () => {
    const dir = await freshProject();
    const result = run(
      ['kb', 'disclose', '--kind', 'trade-off', '--owner', 'alice', '--source', 'human:y'],
      dir,
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--summary');
  }, 30_000);

  it('refuses a --summary made entirely of invisible Unicode (zero-width spaces), not merely ASCII whitespace', async () => {
    // A round-1 gauntlet critic reproduced live that a plain summary.trim() === '' check accepted a
    // --summary made entirely of U+200B (zero-width space) as "non-blank," durably recording an
    // invisible, meaningless governance entry -- the exact gap bin-exempt.test.ts's own identical test
    // already proves is closed for `forge test exempt`'s own --reason.
    const dir = await freshProject();
    const result = run(
      [
        'kb',
        'disclose',
        '--kind',
        'trade-off',
        '--summary',
        '​​​',
        '--owner',
        'alice',
        '--source',
        'human:y',
      ],
      dir,
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--summary');
  }, 30_000);

  it('refuses an --owner made entirely of invisible Unicode', async () => {
    const dir = await freshProject();
    const result = run(
      [
        'kb',
        'disclose',
        '--kind',
        'trade-off',
        '--summary',
        'x',
        '--owner',
        '​​​',
        '--source',
        'human:y',
      ],
      dir,
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--owner');
  }, 30_000);

  it('refuses a --summary made entirely of BRAILLE PATTERN BLANK (U+2800) or HANGUL FILLER (U+3164) -- real, commonly-abused blank-rendering characters neither Cc/Cf/whitespace covers', async () => {
    // A round-2 gauntlet critic reproduced live that `\p{Cc}\p{Cf}\s` alone (the fix for the
    // zero-width-space test above) still admits these two genuine "invisible text" vectors -- closed by
    // `isBlank`'s own explicit blank-rendering-code-point list (`bin.ts`).
    const dir = await freshProject();
    for (const blank of ['⠀⠀', 'ㅤㅤ']) {
      const result = run(
        [
          'kb',
          'disclose',
          '--kind',
          'trade-off',
          '--summary',
          blank,
          '--owner',
          'alice',
          '--source',
          'human:y',
        ],
        dir,
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('--summary');
    }
  }, 30_000);

  it('refuses a malformed --source (no colon)', async () => {
    const dir = await freshProject();
    const result = run(
      [
        'kb',
        'disclose',
        '--kind',
        'trade-off',
        '--summary',
        'x',
        '--owner',
        'alice',
        '--source',
        'bogus',
      ],
      dir,
    );
    expect(result.status).toBe(2);
  }, 30_000);
});

describe('forge kb disclose resolve', () => {
  it('resolves a real disclosure, and a second resolve attempt is cleanly refused (KB-018 already-resolved)', async () => {
    const dir = await freshProject();
    const recorded = run(
      [
        'kb',
        'disclose',
        '--kind',
        'trade-off',
        '--summary',
        'x',
        '--owner',
        'alice',
        '--source',
        'human:y',
        '--json',
      ],
      dir,
    );
    const { id } = JSON.parse(recorded.stdout) as { readonly id: string };

    const resolved = run(
      ['kb', 'disclose', 'resolve', id, '--reason', 'closed it', '--by', 'alice', '--json'],
      dir,
    );
    expect(resolved.status, resolved.stderr).toBe(0);
    expect((JSON.parse(resolved.stdout) as { readonly resolved: boolean }).resolved).toBe(true);

    const second = run(
      ['kb', 'disclose', 'resolve', id, '--reason', 'again', '--by', 'bob', '--json'],
      dir,
    );
    expect(second.status).toBe(2);
    const parsed = JSON.parse(second.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('KB-018');
  }, 30_000);

  it('refuses a missing id', async () => {
    const dir = await freshProject();
    const result = run(['kb', 'disclose', 'resolve', '--reason', 'r', '--by', 'alice'], dir);
    expect(result.status).toBe(2);
  }, 30_000);

  it('refuses a blank --reason cleanly, never as an uncaught crash', async () => {
    // A round-1 gauntlet critic reproduced live that a blank --reason reached `resolveDisclosure`'s own
    // schema check and crashed with a raw, uncaught RangeError instead of a clean CLI refusal.
    const dir = await freshProject();
    const recorded = run(
      [
        'kb',
        'disclose',
        '--kind',
        'trade-off',
        '--summary',
        'x',
        '--owner',
        'alice',
        '--source',
        'human:y',
        '--json',
      ],
      dir,
    );
    const { id } = JSON.parse(recorded.stdout) as { readonly id: string };
    const result = run(['kb', 'disclose', 'resolve', id, '--reason', '', '--by', 'alice'], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain('at ');
    expect(result.stderr).toContain('--reason');
  }, 30_000);

  it('refuses a blank --by cleanly, never as an uncaught crash', async () => {
    const dir = await freshProject();
    const recorded = run(
      [
        'kb',
        'disclose',
        '--kind',
        'trade-off',
        '--summary',
        'x',
        '--owner',
        'alice',
        '--source',
        'human:y',
        '--json',
      ],
      dir,
    );
    const { id } = JSON.parse(recorded.stdout) as { readonly id: string };
    const result = run(['kb', 'disclose', 'resolve', id, '--reason', 'r', '--by', '   '], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain('at ');
    expect(result.stderr).toContain('--by');
  }, 30_000);

  it('refuses a --reason/--by made entirely of invisible Unicode -- the same shared isBlank() check, not a narrower .trim() special-cased to the disclose side', async () => {
    // A round-2 gauntlet critic found the resolve path's own existing blank-check tests only ever used
    // ASCII-empty/plain-whitespace payloads, unlike `disclose`'s own `--summary`/`--owner` tests above --
    // closing that real test-coverage asymmetry for a shared helper (the underlying behavior was already
    // confirmed correct by hand; this locks it in with an automated test using the SAME newly-verified
    // blank-rendering vectors fix #2 above closes).
    const dir = await freshProject();
    const recorded = run(
      [
        'kb',
        'disclose',
        '--kind',
        'trade-off',
        '--summary',
        'x',
        '--owner',
        'alice',
        '--source',
        'human:y',
        '--json',
      ],
      dir,
    );
    const { id } = JSON.parse(recorded.stdout) as { readonly id: string };
    const reasonResult = run(
      ['kb', 'disclose', 'resolve', id, '--reason', '​⠀', '--by', 'alice'],
      dir,
    );
    expect(reasonResult.status).toBe(2);
    expect(reasonResult.stderr).not.toContain('at ');
    expect(reasonResult.stderr).toContain('--reason');
    const byResult = run(['kb', 'disclose', 'resolve', id, '--reason', 'r', '--by', 'ㅤㅤ'], dir);
    expect(byResult.status).toBe(2);
    expect(byResult.stderr).not.toContain('at ');
    expect(byResult.stderr).toContain('--by');
  }, 30_000);

  it('refuses resolving an id that was never recorded (KB-018 not-found)', async () => {
    const dir = await freshProject();
    const result = run(
      ['kb', 'disclose', 'resolve', 'DISC-999', '--reason', 'r', '--by', 'alice', '--json'],
      dir,
    );
    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('KB-018');
  }, 30_000);
});
