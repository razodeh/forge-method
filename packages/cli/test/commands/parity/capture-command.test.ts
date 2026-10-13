/**
 * `runParityCapture` — `forge parity capture`'s own orchestration (`PLAN-M16.md` P6, `13` F-TEST-9,
 * Q294 Amendment A8). This is ORCHESTRATION, not new oracle logic: every primitive this module wires
 * together (loading/validating a declaration, resolving a ref, observing the reference, the
 * stability probe, normalisation, the capture's own shape and content-addressed name) already exists
 * from M16 P2/P3/P4 and is tested on its own in this directory's sibling files. These tests exercise
 * the public entry point end to end, against real temporary git repositories and real subprocess
 * fixtures (`node -e ...`) — no mock of the engine's own observation, comparison or capture
 * primitives (`QUALITY-BAR.md` R6).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P6
 * @see process/SPEC-QUESTIONS.md Q294 Amendment A8
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { listOrphanedWorktrees } from '@forge/vcs';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  captureFileName,
  parseCapture,
  serialiseCapture,
} from '../../../src/commands/parity/capture.ts';
import {
  runParityCapture,
  type RunParityCaptureOptions,
} from '../../../src/commands/parity/capture-command.ts';

const SIGNAL_RUN = `node -e "process.kill(process.pid,'SIGTERM')"`;

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** `expect.any(String)` is typed `any` (the identical reason `like`, below, exists for
 * `expect.stringContaining`). */
const anyString = (): string => expect.any(String) as string;

/** `expect.stringContaining` is typed `any` (the identical reason `gate-commands.test.ts` gives its
 * own `like` helper); this says so once instead of an unexplained `as` at every call site. */
const like = (text: string): string => expect.stringContaining(text) as string;

/** A real, bare git repository with one commit — the minimum every test below needs. */
async function freshProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p6-capture-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  await writeFile(path.join(dir, '.gitkeep'), '', 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  return dir;
}

async function commitSha(dir: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

/** A real reference-side command: prints a single fixed line of stdout and exits 0 — passes the
 * engine's own command vetting (`node -e "..."` is on the probed-passing list, Q294 Decision 7), and
 * is genuinely deterministic across repeated runs (no clock, no randomness). */
const STABLE_RUN = `node -e "process.stdout.write('ok')"`;

/** A real reference-side command that reads `marker.txt` from `$TMPDIR` and prints its content.
 * `runConfinedCommand`'s own `scrubbedEnvironment` (`@forge/engine/dispatch/confined-command.ts`)
 * passes a confined child ONLY `CONFINED_ENV_ALLOWLIST` — `PATH`, `HOME`, `TMPDIR`, `TZ`, and a
 * handful of others, deliberately never an arbitrary custom variable (a first version of this
 * fixture used its own `FIXTURE_MARKER` variable, which this scrubbing silently dropped, discovered
 * when the "first" capture of the differing-re-capture test itself failed as RUN-137 — the reference
 * command saw `undefined` where it expected a path, see this piece's own report). `TMPDIR` is on
 * that allowlist for exactly this purpose ("a build or a test needs... a temp directory"), so a test
 * overrides it (never the real OS temp directory a test's own fixtures live under) to point at a
 * directory holding `marker.txt`, letting it change what the "same" reference commit observes
 * between two `runParityCapture` calls without changing the declaration or the commit either is
 * taken against — the one way this harness can make two otherwise-identical captures genuinely
 * differ. */
const MARKER_RUN = `node -e "process.stdout.write(require('fs').readFileSync(require('path').join(process.env.TMPDIR,'marker.txt'),'utf8'))"`;

/** A real reference-side command whose output is never equal twice: genuinely nondeterministic,
 * the fixture for the `unstable` refusal. */
const UNSTABLE_RUN = `node -e "process.stdout.write(String(Math.random()))"`;

async function writeDeclaration(
  dir: string,
  name: string,
  options: {
    readonly ref?: string;
    readonly run?: string;
    readonly expires?: string;
    readonly stabilityRuns?: number;
    readonly expect?: string;
    readonly unobservableExpiry?: string;
  } = {},
): Promise<void> {
  const ref = options.ref ?? (await commitSha(dir));
  const run = options.run ?? STABLE_RUN;
  const expires = options.expires ?? '2999-01-01';
  const stabilityRuns = options.stabilityRuns ?? 2;
  const unobservable =
    options.unobservableExpiry === undefined
      ? ''
      : `\nunobservable:\n  - surface: process\n    reason: fixture\n    owner: t\n    expiry: ${options.unobservableExpiry}\n`;
  // A block mapping (`expect: <value>`), not `{}` followed by a dangling extra field — `{}` is
  // already a complete, closed flow mapping, so a line after it can never add a field to it.
  const caseBody = options.expect === undefined ? '{}' : `expect: ${options.expect}`;
  const yaml = `name: ${name}
reference:
  ref: ${ref}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: ${expires}
surfaces:
  process:
    run: ${JSON.stringify(run)}
    stability:
      runs: ${String(stabilityRuns)}
    cases:
      - ${caseBody}${unobservable}`;
  await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
  await writeFile(path.join(dir, '.forge/parity', `${name}.parity.yaml`), yaml, 'utf8');
}

function baseOptions(dir: string, overrides: Partial<RunParityCaptureOptions> = {}) {
  return {
    projectRoot: dir,
    parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
    ...overrides,
  } satisfies RunParityCaptureOptions;
}

async function capturedFiles(dir: string): Promise<readonly string[]> {
  const capturesDir = path.join(dir, '.forge/parity/captures');
  try {
    return (await import('node:fs/promises').then((fs) => fs.readdir(capturesDir))).sort();
  } catch {
    return [];
  }
}

describe('runParityCapture: a stable fixture is captured, and an identical re-capture is a no-op (specs/22 M16 P6)', () => {
  it('writes exactly one new content-addressed capture file on the first run', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');

    const result = await runParityCapture(baseOptions(dir));

    expect(result).toEqual({
      captured: 1,
      unchanged: 0,
      captures: [{ name: 'sample', file: result.captures[0]?.file }],
    });
    const files = await capturedFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(result.captures[0]?.file);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);

    const raw = await readFile(path.join(dir, '.forge/parity/captures', files[0] ?? ''), 'utf8');
    const parsed = parseCapture(raw, files[0] ?? '');
    expect(parsed.problem).toBeUndefined();
    expect(parsed.capture?.name).toBe('sample');
    expect(parsed.capture?.cases).toHaveLength(1);
    expect(parsed.capture?.cases[0]?.observation).toEqual({
      surface: 'process',
      stdout: 'ok',
      stderr: '',
      exit: { kind: 'code', code: 0 },
    });

    // No stray scratch worktree survives a successful capture.
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });

  it('a second, byte-identical run reports unchanged and writes no second file', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');

    const first = await runParityCapture(baseOptions(dir));
    expect(first.captured).toBe(1);

    const second = await runParityCapture(baseOptions(dir));
    expect(second).toEqual({ captured: 0, unchanged: 1, captures: first.captures });

    const files = await capturedFiles(dir);
    expect(files).toHaveLength(1);
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });

  it('--name selects one declaration among several, leaving the others uncaptured', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'alpha');
    await writeDeclaration(dir, 'beta');

    const result = await runParityCapture(baseOptions(dir, { name: 'alpha' }));

    expect(result.captured).toBe(1);
    expect(result.captures.map((c) => c.name)).toEqual(['alpha']);
    const files = await capturedFiles(dir);
    expect(files).toHaveLength(1);
  });

  it('omitted --name captures every declaration, in name order', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'beta');
    await writeDeclaration(dir, 'alpha');

    const result = await runParityCapture(baseOptions(dir));

    expect(result.captured).toBe(2);
    expect(result.captures.map((c) => c.name)).toEqual(['alpha', 'beta']);
  });
});

describe('runParityCapture: a differing re-capture under the same key is refused, never overwritten (specs/22 M16 P6)', () => {
  it('refuses RUN-135 and names the existing capture file when the reference now behaves differently', async () => {
    const dir = await freshProject();
    // The marker lives in its OWN `mkdtemp` directory, tracked in `dirs` exactly like `dir` itself —
    // never derived via `path.join(dir, '..', ...)`, which names the shared OS temp ROOT, not a
    // directory this test owns (a prior version of this test did exactly that, and `path.dirname` of
    // the result named the whole machine-wide temp root for `afterEach`'s own `rm(..., {recursive:
    // true})` to delete; caught before landing — see this piece's own report).
    const markerDir = await mkdtemp(path.join(tmpdir(), 'forge-p6-capture-marker-'));
    dirs.push(markerDir);
    const marker = path.join(markerDir, 'marker.txt');
    await writeFile(marker, 'v1', 'utf8');
    await writeDeclaration(dir, 'sample', { run: MARKER_RUN });

    const envWithMarker = { ...process.env, FORGE_RUN_ID: undefined, TMPDIR: markerDir };
    const first = await runParityCapture(baseOptions(dir, { parentEnv: envWithMarker }));
    expect(first.captured).toBe(1);
    const existingFile = first.captures[0]?.file;

    await writeFile(marker, 'v2', 'utf8');
    await expect(
      runParityCapture(baseOptions(dir, { parentEnv: envWithMarker })),
    ).rejects.toMatchObject({ code: 'RUN-135', message: like(existingFile ?? '') });

    // Nothing new was written, and the original capture is untouched.
    const files = await capturedFiles(dir);
    expect(files).toEqual([existingFile]);
    const raw = await readFile(
      path.join(dir, '.forge/parity/captures', existingFile ?? ''),
      'utf8',
    );
    expect(parseCapture(raw, existingFile ?? '').capture?.cases[0]?.observation).toMatchObject({
      stdout: 'v1',
    });
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});

describe('runParityCapture: an unstable reference is refused and writes nothing (specs/22 M16 P6)', () => {
  it('refuses RUN-134 for a case whose reference disagrees with itself across stability runs', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'flaky', { run: UNSTABLE_RUN });

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'RUN-134' });

    expect(await capturedFiles(dir)).toEqual([]);
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});

describe('runParityCapture: declaration-level refusals are each distinguishable (specs/22 M16 P6)', () => {
  it('refuses CFG-510 (reusing the existing declaration-loader code) for a structurally invalid declaration', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'bad', { ref: 'not a valid ref at all' });

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'CFG-510' });
    expect(await capturedFiles(dir)).toEqual([]);
  });

  it('refuses CFG-514 when reference.ref names a real branch rather than a stable ref', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'branchy', { ref: 'main' });

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'CFG-514' });
    expect(await capturedFiles(dir)).toEqual([]);
  });

  it('refuses RUN-133 for a well-formed sha that resolves to no real commit (distinct from CFG-510/514)', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'missingref', { ref: 'f'.repeat(40) });

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'RUN-133' });
    expect(await capturedFiles(dir)).toEqual([]);
  });

  it('refuses CFG-515 for a declaration whose own "expires" date has been reached', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'stale', { expires: '2000-01-01' });

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'CFG-515' });
    expect(await capturedFiles(dir)).toEqual([]);
  });

  it('refuses CFG-515 for a declaration whose own "unobservable" entry has expired', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'staleexempt', { unobservableExpiry: '2000-01-01' });

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'CFG-515' });
  });
});

describe(
  'runParityCapture (specs/22 M17 P14): a surface declared "unobservable" is never observed at ' +
    'all [#13], mirroring forge parity check',
  () => {
    it(
      "the exempt surface's own command is genuinely never run -- it is wired to fail loudly " +
        '(exit 3) if it ever is, and capture still succeeds because it never does',
      async () => {
        const dir = await freshProject();
        const ref = await commitSha(dir);
        const yaml = `name: sample
reference:
  ref: ${ref}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify('node -e "process.exit(3)"')}
    stability:
      runs: 2
    cases:
      - {}
  file:
    run: ${JSON.stringify("node -e \"require('fs').writeFileSync('out.txt', 'ok')\"")}
    stability:
      runs: 2
    cases:
      - outputs:
          - path: out.txt
unobservable:
  - surface: process
    reason: fixture -- this surface's own command deliberately fails if ever run
    owner: t
    expiry: 2999-01-01
`;
        await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
        await writeFile(path.join(dir, '.forge/parity', 'sample.parity.yaml'), yaml, 'utf8');

        const result = await runParityCapture(baseOptions(dir));
        expect(result.captured).toBe(1);

        const files = await capturedFiles(dir);
        const raw = await readFile(
          path.join(dir, '.forge/parity/captures', files[0] ?? ''),
          'utf8',
        );
        const parsed = parseCapture(raw, files[0] ?? '');
        // Only the `file` surface's one case was ever observed -- the `process` surface contributes
        // NOTHING to the capture, not even a failed/empty entry.
        expect(parsed.capture?.cases).toEqual([
          { surface: 'file', caseIndex: 0, observation: expect.anything() as unknown },
        ]);
      },
    );
  },
);

describe('runParityCapture: the rest of the suite (specs/22 M16 P6)', () => {
  it('refuses RUN-132 for a --name matching no declaration, naming those that do exist', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'real-one');

    await expect(
      runParityCapture(baseOptions(dir, { name: 'does-not-exist' })),
    ).rejects.toMatchObject({ code: 'RUN-132', message: like('real-one') });
    expect(await capturedFiles(dir)).toEqual([]);
  });

  it('refuses RUN-132 for --name when no declaration exists at all', async () => {
    const dir = await freshProject();

    await expect(runParityCapture(baseOptions(dir, { name: 'anything' }))).rejects.toMatchObject({
      code: 'RUN-132',
    });
  });

  it('succeeds with an empty result when --name is omitted and no declaration exists at all', async () => {
    const dir = await freshProject();

    const result = await runParityCapture(baseOptions(dir));
    expect(result).toEqual({ captured: 0, unchanged: 0, captures: [] });
  });
});

describe('runParityCapture: a reference that did not do what was expected is refused (specs/22 M16 P6)', () => {
  it('refuses RUN-137 when the reference exits with a code other than its declared "expect" (default 0)', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'wrongexit', { run: `node -e "process.exit(7)"` });

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'RUN-137' });
    expect(await capturedFiles(dir)).toEqual([]);
  });

  it('refuses RUN-137 when the reference produces an entirely empty observation with no "expect: empty"', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'silent', { run: `node -e ""` });

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'RUN-137' });
  });

  it('an entirely empty observation is accepted when the case declares "expect: empty"', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'silentok', { run: `node -e ""`, expect: 'empty' });

    const result = await runParityCapture(baseOptions(dir));
    expect(result.captured).toBe(1);
  });

  it('a declared exit code other than 0 is honoured via "expect"', async () => {
    const dir = await freshProject();
    // A comma, not a semicolon, sequences the two calls: `;` is a shell operator the engine's own
    // command vetting refuses anywhere in the composed line, quoted or not (`compose-args.ts`'s own
    // doc comment — `SHELL_OPERATOR_PATTERN` is checked against the whole raw string first).
    await writeDeclaration(dir, 'exitseven', {
      run: `node -e "process.stdout.write('x'),process.exit(7)"`,
      expect: '7',
    });

    const result = await runParityCapture(baseOptions(dir));
    expect(result.captured).toBe(1);
  });
});

describe('runParityCapture: FORGE_RUN_ID refuses before any real work (specs/22 M16 P6) (10 §10.3 rule 6)', () => {
  it('refuses RUN-136 even for an otherwise-perfectly-valid declaration, creating no scratch worktree', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');

    await expect(
      runParityCapture(
        baseOptions(dir, {
          parentEnv: { ...process.env, FORGE_RUN_ID: 'run-anything-at-all' },
          marker: { runId: 'run-anything-at-all' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'RUN-136' });

    // Proof the refusal fired before any real work: no worktree was ever created, and no capture
    // file exists, even though the SAME declaration captures cleanly without the marker (the "first
    // run" test above already proves that case positively).
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
    expect(await capturedFiles(dir)).toEqual([]);
  });

  it('refuses RUN-136 regardless of which run the marker names ("whichever run it names")', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');

    await expect(
      runParityCapture(
        baseOptions(dir, {
          parentEnv: { ...process.env, FORGE_RUN_ID: 'some-other-run-entirely' },
          marker: { runId: 'some-other-run-entirely' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'RUN-136' });
  });
});

describe('runParityCapture: a declared file output absent from the reference is refused (specs/22 M16 P6)', () => {
  it('refuses RUN-138 when a declared "file" output never materialises in the reference observation', async () => {
    const dir = await freshProject();
    const ref = await commitSha(dir);
    const yaml = `name: nofile
reference:
  ref: ${ref}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  file:
    run: "node -e \\"0\\""
    stability:
      runs: 2
    cases:
      - outputs:
          - path: out.txt
`;
    await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
    await writeFile(path.join(dir, '.forge/parity/nofile.parity.yaml'), yaml, 'utf8');

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'RUN-138' });
    expect(await capturedFiles(dir)).toEqual([]);
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});

describe('runParityCapture: the library and file surfaces convert and digest correctly (specs/22 M16 P6)', () => {
  it('captures a "library" surface case, converting its probe result into the stored shape', async () => {
    const dir = await freshProject();
    const ref = await commitSha(dir);
    await mkdir(path.join(dir, '.forge/parity/probes'), { recursive: true });
    await writeFile(
      path.join(dir, '.forge/parity/probes/probe.mjs'),
      'console.log(JSON.stringify({ok: true, value: 42}))',
      'utf8',
    );
    const yaml = `name: libsample
reference:
  ref: ${ref}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  library:
    run: node .forge/parity/probes/probe.mjs
    stability:
      runs: 2
    cases:
      - {}
`;
    await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
    await writeFile(path.join(dir, '.forge/parity/libsample.parity.yaml'), yaml, 'utf8');

    const result = await runParityCapture(baseOptions(dir));

    expect(result.captured).toBe(1);
    const files = await capturedFiles(dir);
    const raw = await readFile(path.join(dir, '.forge/parity/captures', files[0] ?? ''), 'utf8');
    const parsed = parseCapture(raw, files[0] ?? '');
    expect(parsed.capture?.cases[0]?.observation).toEqual({
      surface: 'library',
      result: { ok: true, value: 42 },
    });
  });

  it('refuses RUN-137 when a "library" probe is killed by a signal instead of returning normally', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'killed', { run: SIGNAL_RUN });

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'RUN-137' });
    expect(await capturedFiles(dir)).toEqual([]);
  });

  it('captures a "file" surface case with a real text output and an overlaid input', async () => {
    const dir = await freshProject();
    await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
    await writeFile(path.join(dir, '.forge/parity/overlay-src.txt'), 'overlaid content', 'utf8');
    const ref = await commitSha(dir);
    const yaml = `name: filesample
reference:
  ref: ${ref}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  file:
    run: "node -e \\"require('fs').writeFileSync('out.txt', require('fs').readFileSync('overlay-dest.txt','utf8'))\\""
    stability:
      runs: 2
    cases:
      - inputs:
          - from: .forge/parity/overlay-src.txt
            to: overlay-dest.txt
        outputs:
          - path: out.txt
`;
    await writeFile(path.join(dir, '.forge/parity/filesample.parity.yaml'), yaml, 'utf8');

    const result = await runParityCapture(baseOptions(dir));

    expect(result.captured).toBe(1);
    const files = await capturedFiles(dir);
    const raw = await readFile(path.join(dir, '.forge/parity/captures', files[0] ?? ''), 'utf8');
    const parsed = parseCapture(raw, files[0] ?? '');
    expect(parsed.capture?.cases[0]?.observation).toEqual({
      surface: 'file',
      files: [{ path: 'out.txt', content: { mode: 'text', text: 'overlaid content' } }],
    });
  });

  it('captures a "file" surface case with a declared "bytes" mode output', async () => {
    const dir = await freshProject();
    const ref = await commitSha(dir);
    const yaml = `name: bytessample
reference:
  ref: ${ref}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  file:
    run: "node -e \\"require('fs').writeFileSync('out.bin','fixed content')\\""
    stability:
      runs: 2
    cases:
      - outputs:
          - path: out.bin
            mode: bytes
`;
    await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
    await writeFile(path.join(dir, '.forge/parity/bytessample.parity.yaml'), yaml, 'utf8');

    const result = await runParityCapture(baseOptions(dir));

    expect(result.captured).toBe(1);
    const files = await capturedFiles(dir);
    const raw = await readFile(path.join(dir, '.forge/parity/captures', files[0] ?? ''), 'utf8');
    const parsed = parseCapture(raw, files[0] ?? '');
    const observation = parsed.capture?.cases[0]?.observation;
    expect(observation).toMatchObject({ surface: 'file' });
    if (observation?.surface !== 'file') throw new Error('expected a file observation');
    expect(observation.files[0]?.content.mode).toBe('bytes');
  });

  it('refuses RUN-128 when a case declares an overlay "from" source that does not exist on disk', async () => {
    const dir = await freshProject();
    const ref = await commitSha(dir);
    const yaml = `name: missingoverlay
reference:
  ref: ${ref}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify(STABLE_RUN)}
    stability:
      runs: 2
    cases:
      - inputs:
          - from: this-file-does-not-exist.txt
            to: dest.txt
`;
    await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
    await writeFile(path.join(dir, '.forge/parity/missingoverlay.parity.yaml'), yaml, 'utf8');

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'RUN-128' });
    expect(await capturedFiles(dir)).toEqual([]);
  });

  it('skips a stray non-".json" entry under .forge/parity/captures/ when selecting an existing capture', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await mkdir(path.join(dir, '.forge/parity/captures'), { recursive: true });
    await writeFile(path.join(dir, '.forge/parity/captures/.DS_Store'), 'not a capture', 'utf8');

    const result = await runParityCapture(baseOptions(dir));

    expect(result.captured).toBe(1);
    const files = await capturedFiles(dir);
    expect(files).toContain('.DS_Store');
    expect(files.some((f) => f.endsWith('.json'))).toBe(true);
  });
});

describe('runParityCapture: surfaces with different "stability.runs" share observation rounds (specs/22 M16 P6)', () => {
  it("a surface whose own stability.runs is smaller than its sibling's still captures correctly", async () => {
    const dir = await freshProject();
    const ref = await commitSha(dir);
    const yaml = `name: mixedstability
reference:
  ref: ${ref}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify(STABLE_RUN)}
    stability:
      runs: 2
    cases:
      - {}
  file:
    run: "node -e \\"require('fs').writeFileSync('out.txt','fixed')\\""
    stability:
      runs: 4
    cases:
      - outputs:
          - path: out.txt
`;
    await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
    await writeFile(path.join(dir, '.forge/parity/mixedstability.parity.yaml'), yaml, 'utf8');

    const result = await runParityCapture(baseOptions(dir));

    expect(result.captured).toBe(1);
    const files = await capturedFiles(dir);
    const jsonFile = files.find((f) => f.endsWith('.json'));
    const raw = await readFile(path.join(dir, '.forge/parity/captures', jsonFile ?? ''), 'utf8');
    const parsed = parseCapture(raw, jsonFile ?? '');
    expect(parsed.capture?.cases).toHaveLength(2);
    expect(parsed.capture?.cases.map((c) => c.surface).sort()).toEqual(['file', 'process']);
  });
});

describe('runParityCapture: partial progress across multiple declarations is visible on a later refusal (specs/22 M16 P6)', () => {
  it('a thrown error carries every declaration already captured before the one that failed, and gamma is never reached', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'alpha'); // succeeds
    await writeDeclaration(dir, 'beta', { expires: '2000-01-01' }); // fails: CFG-515
    await writeDeclaration(dir, 'gamma', { ref: 'f'.repeat(40) }); // would fail RUN-133, if ever reached

    let caught: unknown;
    try {
      await runParityCapture(baseOptions(dir));
      throw new Error('expected runParityCapture to reject, but it resolved');
    } catch (error) {
      caught = error;
    }

    // The thrown error is provably about beta, not gamma — if gamma had been reached, it would have
    // failed on ITS OWN malformed reference (RUN-133) instead.
    expect(caught).toMatchObject({ code: 'CFG-515' });
    expect(caught).toMatchObject({
      details: {
        partial: { captured: 1, unchanged: 0, captures: [{ name: 'alpha', file: anyString() }] },
      },
    });

    // alpha's own capture genuinely landed on disk; nothing else did.
    const files = await capturedFiles(dir);
    expect(files).toHaveLength(1);
  });

  it('retrying after fixing the failing declaration converges: alpha reads unchanged, beta is now captured', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'alpha');
    await writeDeclaration(dir, 'beta', { expires: '2000-01-01' });

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'CFG-515' });

    await writeDeclaration(dir, 'beta', { expires: '2999-01-01' }); // the human fixes it, as the remedy says
    const result = await runParityCapture(baseOptions(dir));

    expect(result).toEqual({
      captured: 1,
      unchanged: 1,
      captures: [
        { name: 'alpha', file: anyString() },
        { name: 'beta', file: anyString() },
      ],
    });
    expect((await capturedFiles(dir)).filter((f) => f.endsWith('.json'))).toHaveLength(2);
  });
});

describe('runParityCapture: two pre-existing, mutually differing captures under one key are ambiguous (specs/22 M16 P6)', () => {
  it('refuses RUN-135 naming both conflicting capture files, writing nothing new', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'ambig');

    // First, a real, valid capture under this exact (name, digest, referenceSha, platform) key.
    const first = await runParityCapture(baseOptions(dir));
    const firstFile = first.captures[0]?.file ?? '';
    const firstRaw = await readFile(path.join(dir, '.forge/parity/captures', firstFile), 'utf8');
    const firstCapture = parseCapture(firstRaw, firstFile).capture;
    if (firstCapture === undefined) throw new Error('expected the first capture to parse cleanly');

    // A second capture sharing the IDENTICAL key but differing in its one case's own observation --
    // hand-built from the real first capture's own fields (never produced by a second real
    // observation: the declaration and the reference commit are both unchanged, so nothing could
    // make a real second observation differ from the first without also making it unstable).
    const firstEntry = firstCapture.cases[0];
    if (firstEntry?.observation.surface !== 'process') {
      throw new Error('expected a single process-surface case entry');
    }
    const secondCapture = {
      ...firstCapture,
      cases: [
        {
          ...firstEntry,
          observation: {
            ...firstEntry.observation,
            stdout: 'a wholly different reference behaviour',
          },
        },
      ],
    };
    const secondBytes = serialiseCapture(secondCapture);
    const secondFile = captureFileName(secondBytes);
    await writeFile(path.join(dir, '.forge/parity/captures', secondFile), secondBytes, 'utf8');

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({
      code: 'RUN-135',
      message: like(firstFile),
    });
    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({
      code: 'RUN-135',
      message: like(secondFile),
    });

    // Nothing new was written: exactly the two capture files planted above remain.
    const files = (await capturedFiles(dir)).filter((f) => f.endsWith('.json'));
    expect(files.sort()).toEqual([firstFile, secondFile].sort());
  });
});

describe('runParityCapture: a "library" surface\'s own "setup" probe paths are gathered too (specs/22 M16 P6)', () => {
  it('a library surface with a probe named in "run" and a different one named in "setup" still captures', async () => {
    const dir = await freshProject();
    await mkdir(path.join(dir, '.forge/parity/probes'), { recursive: true });
    await writeFile(
      path.join(dir, '.forge/parity/probes/probe.mjs'),
      'console.log(JSON.stringify({ok: true, value: 7}))',
      'utf8',
    );
    await writeFile(
      path.join(dir, '.forge/parity/probes/setup-probe.mjs'),
      '// noop setup probe\n',
      'utf8',
    );
    // `setup` runs in the scratch worktree BEFORE any case's own per-case probe overlay ever
    // happens (`observe.ts`'s own `observeAgainstRoot`: `runSurfaceSetup` precedes the per-case
    // loop that writes a probe overlay) — so a probe a `setup` entry names must already be
    // TRACKED at the reference commit, unlike a `run` probe, which gets overlaid just-in-time
    // regardless of git status. Committed here for exactly that reason.
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'add probes'], { cwd: dir });
    const ref = await commitSha(dir);
    const yaml = `name: libsetup
reference:
  ref: ${ref}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  library:
    run: node .forge/parity/probes/probe.mjs
    setup:
      - node .forge/parity/probes/setup-probe.mjs
    stability:
      runs: 2
    cases:
      - {}
`;
    await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
    await writeFile(path.join(dir, '.forge/parity/libsetup.parity.yaml'), yaml, 'utf8');

    const result = await runParityCapture(baseOptions(dir));

    expect(result.captured).toBe(1);
    const files = await capturedFiles(dir);
    const jsonFile = files.find((f) => f.endsWith('.json'));
    const raw = await readFile(path.join(dir, '.forge/parity/captures', jsonFile ?? ''), 'utf8');
    expect(parseCapture(raw, jsonFile ?? '').capture?.cases[0]?.observation).toEqual({
      surface: 'library',
      result: { ok: true, value: 7 },
    });
  });
});

describe("runParityCapture: a case's own observation failure is propagated directly, never wrapped (specs/22 M16 P6)", () => {
  it("a reference case that times out surfaces the engine's own RUN-118 unchanged", async () => {
    const dir = await freshProject();
    const ref = await commitSha(dir);
    const yaml = `name: timesout
reference:
  ref: ${ref}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: "node -e \\"setTimeout(function(){}, 5000)\\""
    stability:
      runs: 2
    cases:
      - timeoutMs: 100
`;
    await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
    await writeFile(path.join(dir, '.forge/parity/timesout.parity.yaml'), yaml, 'utf8');

    await expect(runParityCapture(baseOptions(dir))).rejects.toMatchObject({ code: 'RUN-118' });
    expect(await capturedFiles(dir)).toEqual([]);
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});
