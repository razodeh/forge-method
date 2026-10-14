/**
 * `forge test binding --story <id> --hunks --base <ref> --json` — the real, spawned-subprocess CLI
 * proof that `specs/22` M16 P13's own writer extension is actually REACHED by the real dispatch in
 * `bin.ts` (`binding-evidence.ts`'s own unit tests, `binding-evidence-hunks.test.ts`, prove the writer
 * alone; this file proves `bin.ts` wires `hunkMutation` into it, and that the two surfaces this piece
 * adds — the `--json` envelope's `hunks[]` (already shipped by M16 P12) and the real, written
 * `MutationEvidence` record on disk — genuinely agree, by a real round trip (write, read back,
 * compare), never by assuming the same in-memory object fed both).
 *
 * Note on the append-only test below (round-2 gauntlet, adversarial critic, confirmed directly): it
 * never actually reaches the real `RUN-114` collision path — the SECOND real invocation is refused
 * earlier, by the pre-existing `assertCleanWorkingTree` dirty-tree check, since the first run's own
 * evidence file is untracked until committed (which the test does, deliberately, between the two
 * calls). `RUN-114` itself is real and correctly wired (`binding-evidence.ts`'s own
 * `writeNewFileAtomic`); it is provable only at the unit level with an injected clock forcing an
 * identical write path, which `binding-evidence-hunks.test.ts`'s own "is append-only" test already
 * does. What THIS file's "is append-only" test actually proves is the adjacent, still real claim: two
 * ordinary, correctly-sequenced real CLI runs for the identical story produce two distinct records,
 * and the first is never silently rewritten by the second — not that exact collision path.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-10
 * @see specs/22 M16 P13
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { mutationEvidenceSchema } from '@forge/schemas';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { readEvents } from '@forge/telemetry/events';

const LAUNCHER = fileURLToPath(new URL('../../../../bin/forge.mjs', import.meta.url));

function resolveRealVitestEntry(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('vitest/package.json');
  const packageJson = require(packageJsonPath) as {
    readonly bin?: Readonly<Record<string, string>>;
  };
  const binRelative = packageJson.bin?.['vitest'];
  if (binRelative === undefined)
    throw new Error('vitest/package.json has no real "vitest" bin entry.');
  return path.join(path.dirname(packageJsonPath), binRelative);
}

const TEST_COMMAND = `${process.execPath} ${resolveRealVitestEntry()} run --root .`;

/** `spawnSync`, not `execFileSync`: `execFileSync`'s own return value on a SUCCESSFUL run is stdout
 * alone (its own thrown error object is the only place it ever attaches `stderr`), which silently
 * loses stderr content on exit 0 -- exactly the human-output case this file's own hunk-listing tests
 * need (`13` F-TEST-10's own "report-only": a hunk's own verdict never changes the exit code, so the
 * fixture this file uses can legitimately exit 0 while still printing a real `hunk uncovered:` line
 * to stderr). `spawnSync` returns both streams uniformly regardless of exit code. */
function run(
  args: readonly string[],
  cwd: string,
  envOverlay?: Readonly<Record<string, string>>,
): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, [LAUNCHER, ...args, '-C', cwd], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    // `specs/22` M16 P15: additive -- every pre-existing call here omits `envOverlay`, which keeps
    // `spawnSync`'s own default of inheriting `process.env` as-is, byte for byte, unchanged.
    ...(envOverlay === undefined ? {} : { env: { ...process.env, ...envOverlay } }),
  });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function storyFixture(filesExpected: readonly string[], id = 'STORY-001'): string {
  return `---
id: ${id}
type: Story
schemaVersion: 1
title: Fixture story
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
status: ready
owner_role: developer
depends_on: []
blocked_by: []
interfaces: []
data: []
files_expected:
${filesExpected.map((file) => `  - ${file}`).join('\n')}
context_refs: []
acceptance:
  - id: AC-001-1
    given: two numbers
    when: add is called
    then: the sum is returned
    kind: functional
tests: []
dod_profile: default
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
---

Fixture story body.
`;
}

/** Two real hunks in one file: `add` is tested and killed on reversal, `sub` is never called and
 * reads `uncovered` — the identical `bin-binding-hunks-mutation.test.ts`'s own
 * `projectWithOneUncoveredHunk` shape (M16 P12), replicated here rather than imported: this file owns
 * its own fixture independently, the convention `hunks.test.ts`'s own doc comment already states for
 * a sibling piece's test file. */
async function projectWithKilledAndUncoveredHunk(): Promise<{
  readonly dir: string;
  readonly baseSha: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-hunks-evidence-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
  const config = {
    ...DEFAULT_CONFIG,
    execution: { ...DEFAULT_CONFIG.execution, testCommands: { unit: TEST_COMMAND } },
  };
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(config), 'utf8');
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
    storyFixture(['impl.js', 'impl.test.js']),
    'utf8',
  );
  await writeFile(
    path.join(dir, 'impl.js'),
    'export function add(a, b) {\n  return 0;\n}\n\nexport function sub(a, b) {\n  return 0;\n}\n',
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'base: two buggy stubs'], { cwd: dir });
  const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  await writeFile(
    path.join(dir, 'impl.js'),
    'export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'impl.test.js'),
    "import { test, expect } from 'vitest';\n" +
      "import { add } from './impl.js';\n" +
      "test('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'the story: fix both, only add() is tested'], {
    cwd: dir,
  });
  return { dir, baseSha: baseSha.trim() };
}

interface EnvelopeHunk {
  readonly id: string;
  readonly path: string;
  readonly verdict: string;
  readonly killedBy?: readonly string[];
  readonly reason?: string;
}

interface Envelope {
  readonly v: number;
  readonly passed: boolean;
  readonly evidenceId: string;
  readonly hunks?: readonly EnvelopeHunk[];
}

async function theOneMutationFile(dir: string): Promise<string> {
  const mutationDir = path.join(dir, 'docs/forge/reports/mutation');
  const names = (await readdir(mutationDir)).filter((name) => name.endsWith('.md'));
  expect(names).toHaveLength(1);
  const name = names[0];
  if (name === undefined) throw new Error('expected one mutation evidence file');
  return path.join(mutationDir, name);
}

async function readFrontMatter(filePath: string): Promise<Record<string, unknown>> {
  const text = await readFile(filePath, 'utf8');
  const frontMatterText = text.split('---\n')[1] ?? '';
  return YAML.parse(frontMatterText) as Record<string, unknown>;
}

describe('forge test binding --hunks — the written MutationEvidence record (specs/22 M16 P13)', () => {
  it("writes a real, schemaVersion-2 revert-hunks record whose hunkRun.hunks equals the --json envelope's own hunks[], hunk for hunk", async () => {
    const { dir, baseSha } = await projectWithKilledAndUncoveredHunk();

    const result = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', baseSha, '--json'],
      dir,
    );
    expect(result.status).toBe(0);
    const envelope = JSON.parse(result.stdout.trim()) as Envelope;
    expect(envelope.hunks).toBeDefined();
    const envelopeHunks = envelope.hunks ?? [];
    expect(envelopeHunks).toHaveLength(2);

    const filePath = await theOneMutationFile(dir);
    const frontMatter = await readFrontMatter(filePath);
    expect(frontMatter['id']).toBe(envelope.evidenceId);
    expect(frontMatter['schemaVersion']).toBe(2);
    expect(frontMatter['mutationKind']).toBe('revert-hunks');

    const parsed = mutationEvidenceSchema.safeParse(frontMatter);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) throw new Error('unreachable');
    const hunkRun = parsed.data.hunkRun;
    if (hunkRun === undefined) throw new Error('expected a hunkRun');

    // Compared by id (never by assuming the same in-memory object fed both surfaces): every field
    // the envelope and the record both carry (id, path, verdict, killedBy) must agree.
    const byId = <T extends { readonly id: string }>(items: readonly T[]): readonly T[] =>
      [...items].sort((a, b) => a.id.localeCompare(b.id));
    const sortedEnvelope = byId(envelopeHunks);
    const sortedRecord = byId(hunkRun.hunks);
    expect(sortedRecord).toHaveLength(sortedEnvelope.length);
    for (let i = 0; i < sortedEnvelope.length; i += 1) {
      const fromEnvelope = sortedEnvelope[i];
      const fromRecord = sortedRecord[i];
      if (fromEnvelope === undefined || fromRecord === undefined) {
        throw new Error('unreachable: zipped arrays of equal length');
      }
      expect(fromRecord.path).toBe(fromEnvelope.path);
      expect(fromRecord.verdict).toBe(fromEnvelope.verdict);
      expect(fromRecord.killedBy).toEqual(fromEnvelope.killedBy);
    }
    // The record carries fields the envelope does not (ranges/contentHash) — the real reason this
    // test compares field by field rather than the two arrays wholesale.
    for (const hunk of hunkRun.hunks) {
      expect(hunk.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 30_000);

  it('human (non-json) output lists the uncovered hunk by id and path, and never lists the killed one', async () => {
    // Two SEPARATE, freshly-built fixtures with byte-identical content: a hunk's own id is a pure
    // function of its path/range/contentHash (`hunks.ts`, M16 P11), never of the repository's
    // location or commit shas, so probing ids via `--json` on one and asserting human output on the
    // other (rather than running the same command twice on the one dir, which the second call's own
    // `assertCleanWorkingTree` would refuse once the first call's real evidence file is untracked) is
    // the real ids, not a guess.
    const probe = await projectWithKilledAndUncoveredHunk();
    const jsonResult = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', probe.baseSha, '--json'],
      probe.dir,
    );
    expect(jsonResult.status).toBe(0);
    const envelope = JSON.parse(jsonResult.stdout.trim()) as Envelope;
    const uncoveredHunk = (envelope.hunks ?? []).find((hunk) => hunk.verdict === 'uncovered');
    const killedHunk = (envelope.hunks ?? []).find((hunk) => hunk.verdict === 'killed');
    if (uncoveredHunk === undefined || killedHunk === undefined) {
      throw new Error('expected one killed and one uncovered hunk in the fixture');
    }

    const { dir, baseSha } = await projectWithKilledAndUncoveredHunk();
    const result = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', baseSha],
      dir,
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(uncoveredHunk.id);
    expect(result.stderr).toContain('uncovered');
    expect(result.stderr).not.toContain(killedHunk.id);
  }, 30_000);

  it('is append-only: two real forge test binding --hunks invocations for the identical story write two distinct records, neither rewriting the other', async () => {
    const { dir, baseSha } = await projectWithKilledAndUncoveredHunk();

    const first = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', baseSha, '--json'],
      dir,
    );
    expect(first.status).toBe(0);
    const firstEnvelope = JSON.parse(first.stdout.trim()) as Envelope;
    const firstFilePath = await theOneMutationFile(dir);
    const firstContentBefore = await readFile(firstFilePath, 'utf8');

    // A real, committed project tree is required before a second `forge test binding` invocation can
    // even start (`assertCleanWorkingTree`, this command's own literal first statement) — the first
    // run's own real evidence file is untracked until committed, exactly as a real user's workflow
    // would commit it between two runs.
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'record the first binding run'], { cwd: dir });

    const second = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', baseSha, '--json'],
      dir,
    );
    expect(second.status).toBe(0);
    const secondEnvelope = JSON.parse(second.stdout.trim()) as Envelope;

    expect(secondEnvelope.evidenceId).not.toBe(firstEnvelope.evidenceId);
    const mutationDir = path.join(dir, 'docs/forge/reports/mutation');
    const names = (await readdir(mutationDir)).filter((name) => name.endsWith('.md'));
    expect(names).toHaveLength(2);

    const firstContentAfter = await readFile(firstFilePath, 'utf8');
    expect(firstContentAfter).toBe(firstContentBefore);
  }, 60_000);
});

describe('forge test binding --hunks --json — the uncovered hunk carries a real reason (specs/22 M17 P13)', () => {
  it('the --json envelope names why no test caught the revert; the persisted record still omits it, deliberately, unchanged', async () => {
    const { dir, baseSha } = await projectWithKilledAndUncoveredHunk();
    const result = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', baseSha, '--json'],
      dir,
    );
    expect(result.status).toBe(0);
    const envelope = JSON.parse(result.stdout.trim()) as Envelope;
    const uncoveredHunk = (envelope.hunks ?? []).find((hunk) => hunk.verdict === 'uncovered');
    const killedHunk = (envelope.hunks ?? []).find((hunk) => hunk.verdict === 'killed');
    if (uncoveredHunk === undefined || killedHunk === undefined) {
      throw new Error('expected one killed and one uncovered hunk in the fixture');
    }
    // Defect #10 (`PLAN-M17.md`): `uncovered` used to carry no `reason` at all.
    expect(uncoveredHunk.reason).toBeDefined();
    expect((uncoveredHunk.reason ?? '').length).toBeGreaterThan(0);
    // `killed` never carries `reason` -- unchanged (`killedBy` is its own field).
    expect(killedHunk.reason).toBeUndefined();

    // The persisted MutationEvidence record on disk is a DIFFERENT, already-fixed-shape contract
    // (`specs/18` §18.7's own exhaustive hunk-list field names, `.strict()`-enforced by
    // `hunkEntrySchema`): `binding-evidence.ts`'s own `hunkEntryToRecord` deliberately never persists
    // `reason` for any non-killed kind, `uncovered` included -- this real round trip proves that
    // still holds (a regression that started persisting it would fail `mutationEvidenceSchema`'s own
    // `.strict()` check below, not silently pass).
    const filePath = await theOneMutationFile(dir);
    const frontMatter = await readFrontMatter(filePath);
    const parsed = mutationEvidenceSchema.safeParse(frontMatter);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  }, 30_000);
});

// `specs/22` M16 P15: the real, spawned-subprocess proof that a genuine `--hunks` run's own counts
// reach the EXISTING `CheckRun{kind:'binding'}` event additively -- `check-telemetry.test.ts`-shaped
// assertions belong here, not in a new file, since this file already has the one real fixture
// (`projectWithKilledAndUncoveredHunk`) that produces a genuine killed-and-uncovered hunk pair.
describe('forge test binding --hunks — telemetry (specs/22 M16 P15)', () => {
  it('a real FORGE_RUN_ID reaches a real CheckRun{kind:"binding"} event additively carrying the hunk counts and granularity', async () => {
    const { dir, baseSha } = await projectWithKilledAndUncoveredHunk();

    const result = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', baseSha, '--json'],
      dir,
      { FORGE_RUN_ID: 'run-hunks-telemetry' },
    );
    expect(result.status).toBe(0);

    const events = [];
    for await (const event of readEvents(dir, 'run-hunks-telemetry')) events.push(event);
    const checkRuns = events.filter((event) => event.type === 'CheckRun');
    expect(checkRuns).toHaveLength(1);
    expect(checkRuns[0]?.payload).toMatchObject({
      kind: 'binding',
      storyId: 'STORY-001',
      // Every pre-existing M15 field is unaffected by the new, additive hunk fields alongside it --
      // `bound: 1` is the CHANGE-level verdict (M15, the whole file reverted at once: `adds` fails
      // because `add` itself reverts too), a coarser, separate measure from the per-hunk verdicts
      // below (where `sub`'s own hunk reads `uncovered`, never named by any test).
      bound: 1,
      granularity: 'hunk',
      killedHunks: 1,
      uncoveredHunks: 1,
      invalidHunks: 0,
      timeoutHunks: 0,
      skippedHunks: 0,
    });
  }, 30_000);

  it('the plain change-level check (no --hunks) carries none of the six hunk fields at all -- never present as zero', async () => {
    const { dir } = await projectWithKilledAndUncoveredHunk();

    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir, {
      FORGE_RUN_ID: 'run-no-hunks-telemetry',
    });
    expect(result.status).toBe(0);

    const events = [];
    for await (const event of readEvents(dir, 'run-no-hunks-telemetry')) events.push(event);
    const checkRuns = events.filter((event) => event.type === 'CheckRun');
    expect(checkRuns).toHaveLength(1);
    const payload = checkRuns[0]?.payload as Record<string, unknown>;
    expect('granularity' in payload).toBe(false);
    expect('killedHunks' in payload).toBe(false);
  }, 30_000);
});

/**
 * Round-2 gauntlet fix (`specs/22` M16 P13), end to end through the real CLI and the real writer:
 * `hunk-mutation.test.ts`'s own engine-level test already proves `runHunkMutationCheck` omits
 * `hunkMutation` when `computeHunks` finds zero real hunks; this closes the loop by proving neither
 * surface this piece adds ever shows the empty-hunks shape either -- the `--json` envelope carries no
 * `hunks`/`granularity`/`uncoveredHunks` fields at all (so a project-authored `failOn:
 * 'uncoveredHunks > 0'` check fails CLOSED on a missing field, never a false "0, so covered"), and the
 * written record is the plain, unchanged `schemaVersion: 1`/`revert-implementation` shape, never an
 * empty `revert-hunks` one.
 */
describe('forge test binding --hunks — zero real hunks, end to end (specs/22 M16 P13)', () => {
  it('a --base resolved further back than the implementation last changed: the envelope has no hunk fields, and the written record is the plain v1 shape', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-hunks-evidence-zero-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
    const config = {
      ...DEFAULT_CONFIG,
      execution: { ...DEFAULT_CONFIG.execution, testCommands: { unit: TEST_COMMAND } },
    };
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(config), 'utf8');
    await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
      storyFixture(['impl.js', 'impl.test.js']),
      'utf8',
    );
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) {\n  return a + b;\n}\n',
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa(
      'git',
      ['commit', '--quiet', '-m', 'base: a correct implementation already exists'],
      {
        cwd: dir,
      },
    );
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    // Only a NEW test lands; impl.js is byte-identical to baseSha.
    await writeFile(
      path.join(dir, 'impl.test.js'),
      "import { test, expect } from 'vitest';\n" +
        "import { add } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: only a new test lands'], {
      cwd: dir,
    });

    const result = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', baseSha.trim(), '--json'],
      dir,
    );

    // Exit 1: the change-level check already gives the real signal here -- the test is non-binding,
    // since nothing was actually reverted (impl.js has zero diff over this range).
    expect(result.status).toBe(1);
    const envelope = JSON.parse(result.stdout.trim()) as Envelope;
    expect(envelope.passed).toBe(false);
    // The real fix: no hunk fields at all -- never hunks: [], granularity, or uncoveredHunks: 0.
    expect(envelope.hunks).toBeUndefined();
    expect('granularity' in envelope).toBe(false);
    expect('uncoveredHunks' in envelope).toBe(false);

    const filePath = await theOneMutationFile(dir);
    const frontMatter = await readFrontMatter(filePath);
    expect(frontMatter['schemaVersion']).toBe(1);
    expect(frontMatter['mutationKind']).toBe('revert-implementation');
    expect(frontMatter['hunkRun']).toBeUndefined();
    const parsed = mutationEvidenceSchema.safeParse(frontMatter);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  }, 30_000);
});
