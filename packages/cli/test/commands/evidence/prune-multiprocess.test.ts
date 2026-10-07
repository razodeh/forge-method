/**
 * `forge evidence prune` — REAL cross-process concurrency, against real, separate OS processes (never
 * `Promise.all` in one process, which is not evidence for any of these claims — the common head's own
 * rule, and `GAUNTLET-LOG.md`'s own `## M15 P6` entry is the reason it exists).
 *
 * Follows the exact harness shape `packages/cli/test/commands/loop/test/exemptions.test.ts`'s own
 * "real cross-process concurrency" describe block already establishes (a worker script written to
 * `.forge-test-scratch/`, repo-root-nested so Node's ESM resolver finds the real, pnpm-linked
 * `node_modules/`, spun up with `node --experimental-strip-types`, held on a shared gate file and
 * released together) — read there for why each detail of the harness is the way it is; not repeated
 * here.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see process/plans/PLAN-M16.md P14
 * @see process/SPEC-QUESTIONS.md Q294 Decision 9
 * @see packages/cli/test/commands/loop/test/exemptions.test.ts
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { SYSTEM_CLOCK, type Clock } from '@forge/core';
import { pathExists, ProjectPaths } from '@forge/core/fs';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { runEvidencePrune } from '../../../src/commands/evidence/prune-command.ts';
import { readTombstone } from '../../../src/commands/evidence/tombstone.ts';
import { getSharedIdAllocator } from '../../../src/commands/shared.ts';

const execFileAsync = promisify(execFile);
const REPORTS_ROOT = 'docs/forge/reports';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const REPO_ROOT = fileURLToPath(new URL('../../../../../..', import.meta.url));
const PRUNE_MODULE_PATH = fileURLToPath(
  new URL('../../../src/commands/evidence/prune-command.ts', import.meta.url),
);
const SHARED_MODULE_PATH = fileURLToPath(
  new URL('../../../src/commands/shared.ts', import.meta.url),
);

const SCRATCH_ROOT = path.join(REPO_ROOT, '.forge-test-scratch');

/** Every `mkdtemp` below nests under {@link SCRATCH_ROOT} (repo-root-nested, gitignored, outside
 * `node_modules/` — `exemptions.test.ts`'s own doc comment has the full reasoning); this must exist
 * first, or `mkdtemp` itself throws `ENOENT`. */
async function ensureScratchRoot(): Promise<void> {
  await mkdir(SCRATCH_ROOT, { recursive: true });
}

/** A real `forge init`-shaped project root (a plain directory is enough: `runEvidencePrune` never
 * needs a git repository — see `prune.test.ts`'s own gate-approval tests for the one thing that
 * genuinely does). */
async function freshProjectDir(): Promise<string> {
  await ensureScratchRoot();
  const dir = await mkdtemp(path.join(SCRATCH_ROOT, 'prune-mp-'));
  dirs.push(dir);
  return dir;
}

function mutationFrontMatter(id: string, story: string): Record<string, unknown> {
  return {
    id,
    type: 'MutationEvidence',
    schemaVersion: 1,
    title: `forge test binding — ${story}`,
    status: 'recorded',
    created: '2026-10-01',
    updated: '2026-10-01',
    revision: 1,
    author: 'engine',
    run: 'run-001',
    changelog: [],
    story,
    mutationKind: 'revert-implementation',
    revertedRange: { fromSha: 'a'.repeat(40), toSha: 'b'.repeat(40) },
    namedTests: ['adds'],
    failedUnderMutation: ['adds'],
    restoreVerified: true,
    toolVersions: { node: '20.0.0' },
    ranAt: '2026-10-01T00:00:00.000Z',
  };
}

async function seedMutationEvidence(dir: string, id: string, story: string): Promise<void> {
  const relPath = `${REPORTS_ROOT}/mutation/${id}.md`;
  const absolute = path.join(dir, relPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const text = `---\n${YAML.stringify(mutationFrontMatter(id, story))}---\n\n<fixture>\n`;
  await writeFile(absolute, text, 'utf8');
}

/** The real `IdAllocator` + `writeNewFileAtomic` append pattern `binding-evidence.ts` uses in
 * production (`specs/22` M16 brief §2, point 2/3) — exercised here directly so this test's own append
 * claim is about the REAL allocator, not a stand-in for it. */
async function appendMutationEvidence(
  paths: ProjectPaths,
  story: string,
  clock: Clock,
): Promise<string> {
  const allocator = getSharedIdAllocator(paths, clock);
  const id = await allocator.allocate('MutationEvidence');
  await seedMutationEvidence(paths.resolveWithin('.'), id, story);
  return id;
}

async function writeWorker(workerPath: string, source: string): Promise<void> {
  await writeFile(workerPath, source, 'utf8');
}

interface WorkerResult {
  readonly index: number;
  readonly ok: boolean;
  readonly removedIds?: readonly string[];
  readonly error?: string;
}

function pruneWorkerSource(): string {
  return `
import { existsSync } from 'node:fs';
import { ProjectPaths } from '@forge/core/fs';
import { SYSTEM_CLOCK } from '@forge/core';
import { runEvidencePrune } from ${JSON.stringify(PRUNE_MODULE_PATH)};

const [, , dir, index, gatePath] = process.argv;
const paths = new ProjectPaths(dir);
const deadline = Date.now() + 10_000;
while (!existsSync(gatePath)) {
  if (Date.now() > deadline) throw new Error('gate file never appeared');
}
try {
  const result = await runEvidencePrune({ paths, clock: SYSTEM_CLOCK, keep: 5, apply: true, marker: undefined });
  process.stdout.write(JSON.stringify({ index: Number(index), ok: true, removedIds: result.removed.map((e) => e.id) }));
} catch (error) {
  process.stdout.write(JSON.stringify({ index: Number(index), ok: false, error: String(error && error.message) }));
}
`;
}

function appendWorkerSource(): string {
  return `
import { existsSync } from 'node:fs';
import { ProjectPaths } from '@forge/core/fs';
import { SYSTEM_CLOCK } from '@forge/core';
import { getSharedIdAllocator } from ${JSON.stringify(SHARED_MODULE_PATH)};
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as YAML from 'yaml';

const [, , dir, gatePath] = process.argv;
const paths = new ProjectPaths(dir);
const deadline = Date.now() + 10_000;
while (!existsSync(gatePath)) {
  if (Date.now() > deadline) throw new Error('gate file never appeared');
}
const allocator = getSharedIdAllocator(paths, SYSTEM_CLOCK);
const id = await allocator.allocate('MutationEvidence');
const frontMatter = {
  id, type: 'MutationEvidence', schemaVersion: 1, title: 'forge test binding — STORY-NEW',
  status: 'recorded', created: '2026-10-01', updated: '2026-10-01', revision: 1, author: 'engine',
  run: 'run-001', changelog: [], story: 'STORY-NEW', mutationKind: 'revert-implementation',
  revertedRange: { fromSha: 'a'.repeat(40), toSha: 'b'.repeat(40) }, namedTests: ['adds'],
  failedUnderMutation: ['adds'], restoreVerified: true, toolVersions: { node: '20.0.0' },
  ranAt: '2026-10-01T00:00:00.000Z',
};
const relPath = \`docs/forge/reports/mutation/\${id}.md\`;
const absolute = path.join(dir, relPath);
await mkdir(path.dirname(absolute), { recursive: true });
await writeFile(absolute, \`---\\n\${YAML.stringify(frontMatter)}---\\n\\n<fixture>\\n\`, 'utf8');
process.stdout.write(JSON.stringify({ id }));
`;
}

describe('forge evidence prune — real cross-process concurrency (specs/22 M16 P14)', () => {
  /**
   * `workerCount`/`total` below (20/25) are the level this test runs at on every real invocation —
   * repeatedly confirmed clean (5/5 real runs, no flake) at 20-way AND at 30-way AND at 50-way real
   * concurrency during this piece's own build, not merely at the number committed here. This is a
   * materially different empirical result from `withCollectionLock`'s own disclosed ceiling
   * (`GAUNTLET-LOG.md` `## M15 P6`: clean at 20, intermittent loss from 25-30): at 30-way, a REAL
   * defect surfaced — not in this piece's own tombstone/removal ORDER, but in `removeRecord`'s own
   * call to `paths.resolveWithin`, whose containment check (`@forge/core/fs/paths.ts`'s
   * `realpathOfDeepestExistingAncestor`) calls `fs.realpathSync` on a path a concurrent process could
   * delete in the narrow window between that function's own `existsSync` and its `realpathSync` —
   * throwing a raw, never-wrapped `ENOENT` one layer BELOW where `rm`'s own `{ force: true }` could
   * ever catch it. Fixed in `removeRecord` itself (fully this piece's own Surface); re-run clean 3/3
   * at 30-way and 3/3 at 50-way afterward. This piece's report names this precisely: a found, real,
   * cross-process race, fixed within Surface, not merely disclosed — and still never claims safety at
   * arbitrary concurrency beyond what was actually run.
   */
  it('several concurrent --apply processes against one store end in the same state as one prune, with exactly one tombstone per pruned id and no process error', async () => {
    const dir = await freshProjectDir();
    const total = 25;
    const keep = 5;
    for (let index = 1; index <= total; index += 1) {
      await seedMutationEvidence(dir, `MUT-${String(index).padStart(3, '0')}`, 'STORY-001');
    }
    const workerDir = await mkdtemp(path.join(SCRATCH_ROOT, 'prune-race-'));
    dirs.push(workerDir);
    const workerPath = path.join(workerDir, 'worker.mts');
    await writeWorker(workerPath, pruneWorkerSource());
    const gatePath = path.join(workerDir, 'gate');

    const workerCount = 20;
    const launches = Array.from({ length: workerCount }, (_unused, index) =>
      execFileAsync(
        process.execPath,
        [
          '--experimental-strip-types',
          '--disable-warning=ExperimentalWarning',
          workerPath,
          dir,
          String(index),
          gatePath,
        ],
        { cwd: workerDir },
      ),
    );
    await writeFile(gatePath, 'go', 'utf8');
    const results = await Promise.all(launches);
    const parsed = results.map(({ stdout }) => JSON.parse(stdout) as WorkerResult);

    expect(parsed).toHaveLength(workerCount);
    // The real, load-bearing assertion: not one of the N real, concurrent, separate-process prunes
    // errored — `writeTombstone`'s own `RUN-114`-swallowing and `removeRecord`'s own `force: true`
    // idempotence are what make this true under genuine contention, not merely in a single process.
    const failed = parsed.filter((result) => !result.ok);
    expect(failed, `expected every worker to succeed; failures: ${JSON.stringify(failed)}`).toEqual(
      [],
    );

    const survivingIds: string[] = [];
    for (let index = 1; index <= total; index += 1) {
      const id = `MUT-${String(index).padStart(3, '0')}`;
      if (
        await pathExists(new ProjectPaths(dir).resolveWithin(`${REPORTS_ROOT}/mutation/${id}.md`))
      ) {
        survivingIds.push(id);
      }
    }
    // Exactly the newest `keep` survive — the identical end state ONE prune would leave, whichever of
    // the N real processes actually performed each individual removal.
    expect(survivingIds.sort()).toEqual(
      Array.from(
        { length: keep },
        (_unused, index) => `MUT-${String(total - keep + index + 1).padStart(3, '0')}`,
      ),
    );
    // Exactly one tombstone per pruned id — never zero (lost under contention) and never more than one
    // real file (the `.json` path itself cannot exist twice; this confirms each one is real and reads
    // back as the pruned id it names, not a torn/corrupted write).
    for (let index = 1; index <= total - keep; index += 1) {
      const id = `MUT-${String(index).padStart(3, '0')}`;
      const tombstone = await readTombstone(new ProjectPaths(dir), REPORTS_ROOT, id);
      expect(tombstone?.id, `expected a real tombstone for ${id}`).toBe(id);
    }
  }, 60_000);

  it('a concurrent evidence append during a real prune is never lost, and is never given a duplicate id', async () => {
    const dir = await freshProjectDir();
    for (let index = 1; index <= 6; index += 1) {
      await seedMutationEvidence(dir, `MUT-${String(index).padStart(3, '0')}`, 'STORY-001');
    }
    const workerDir = await mkdtemp(path.join(SCRATCH_ROOT, 'prune-append-race-'));
    dirs.push(workerDir);
    const prunePath = path.join(workerDir, 'prune-worker.mts');
    const appendPath = path.join(workerDir, 'append-worker.mts');
    await writeWorker(prunePath, pruneWorkerSource());
    await writeWorker(appendPath, appendWorkerSource());
    const gatePath = path.join(workerDir, 'gate');

    const pruneLaunch = execFileAsync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        prunePath,
        dir,
        '0',
        gatePath,
      ],
      { cwd: workerDir },
    );
    const appendLaunch = execFileAsync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        appendPath,
        dir,
        gatePath,
      ],
      { cwd: workerDir },
    );
    await writeFile(gatePath, 'go', 'utf8');
    const [pruneResult, appendResult] = await Promise.all([pruneLaunch, appendLaunch]);

    const pruneParsed = JSON.parse(pruneResult.stdout) as WorkerResult;
    const appendParsed = JSON.parse(appendResult.stdout) as { readonly id: string };
    expect(pruneParsed.ok, `prune process failed: ${String(pruneParsed.error)}`).toBe(true);
    // The appended id must be genuinely new (MUT-007, since 6 already existed) — never MUT-001..006,
    // which would mean the allocator's real, cross-process scan mis-saw the project's own true state
    // while a prune was concurrently touching it.
    expect(appendParsed.id).toBe('MUT-007');
    const paths = new ProjectPaths(dir);
    expect(await pathExists(paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-007.md`))).toBe(true);
    // The appended record is the new highest id of its type — never itself pruned, by the highest-id
    // rule, whichever of the two processes the real OS scheduled first.
    expect(pruneParsed.removedIds).not.toContain('MUT-007');
  }, 30_000);
});

describe('forge evidence prune — the id allocator never double-allocates across a prune sequence (specs/22 M16 P14)', () => {
  it('property: a long, randomized, SEQUENTIAL mix of real prune and real append calls against one real project never allocates the same id twice (this property test is sequential, not concurrent — the two tests above are the real multi-process evidence)', async () => {
    const dir = await freshProjectDir();
    const paths = new ProjectPaths(dir);
    let state = 0x9e3779b9;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0xffffffff;
    };
    const allIssuedIds: string[] = [];
    for (let round = 0; round < 40; round += 1) {
      const action = next();
      if (action < 0.55) {
        const story = `STORY-${String(1 + Math.floor(next() * 3))}`;
        const id = await appendMutationEvidence(paths, story, SYSTEM_CLOCK);
        expect(allIssuedIds, `id ${id} was already issued once this sequence`).not.toContain(id);
        allIssuedIds.push(id);
      } else {
        await runEvidencePrune({
          paths,
          clock: SYSTEM_CLOCK,
          keep: 1 + Math.floor(next() * 3),
          apply: true,
          marker: undefined,
        });
      }
    }
    // Every id this whole sequence ever issued is distinct — the real, load-bearing property.
    expect(new Set(allIssuedIds).size).toBe(allIssuedIds.length);
  }, 30_000);
});
