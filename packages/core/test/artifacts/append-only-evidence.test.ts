/**
 * `writeNewFileAtomic` against real `MutationEvidence`/`EvidenceBundle`/`ParityEvidence` records —
 * `specs/18` §18.7's own normative text and `PLAN-M15.md` P2's own "Tests first" line, "a bundle that
 * edits an existing evidence record is refused," proven end to end: a genuine, schema-valid record of
 * each type is written to its own real registry path, and a second write to the SAME path is refused
 * rather than silently overwriting the first.
 *
 * The generic mechanism itself (`RUN-114`, the race-free `fsp.link`-based refusal, crash-safety) is
 * proven type-agnostically in `packages/core/test/fs/atomic.test.ts`; this file proves only that it
 * is the real mechanism these specific, newly-registered artifact types actually use — including,
 * for `ParityEvidence` (`specs/22` M16 P5), under REAL cross-process contention: `{slug}` is a pure
 * function of the id alone (`artifact-types.ts`'s own `registryTail`), so two concurrent `forge parity
 * check` invocations racing to allocate the identical next id for the identical declaration name
 * target the IDENTICAL path, and the only thing standing between that and two files (or a corrupted
 * one) is `writeNewFileAtomic`'s own `fsp.link`-based exclusivity — proven here with real, separate OS
 * processes, not merely raced `Promise.all` calls inside one.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see PLAN-M15.md P2
 * @see SPEC-QUESTIONS.md Q280, Q294 Decision 9
 * @see process/plans/PLAN-M16.md P5
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  evidenceBundleSchema,
  mutationEvidenceSchema,
  parityEvidenceSchema,
} from '@forge/schemas/artifacts';
import { renderArtifactPath } from '@forge/schemas/registry';

import { ArtifactDocument } from '../../src/artifacts/document.ts';
import { ProjectPaths } from '../../src/fs/paths.ts';
import { writeNewFileAtomic } from '../../src/fs/atomic.ts';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const templatesDir = path.join(repoRoot, 'packages', 'templates', 'templates', 'artifacts');

let projectRoot: string | undefined;
const scratchDirs: string[] = [];

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-append-only-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

afterEach(async () => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('MutationEvidence — a second run for the same story and timestamp is refused', () => {
  it('writes a real, schema-valid record, then refuses a second write to the identical path', async () => {
    const templateText = readFileSync(path.join(templatesDir, 'MutationEvidence.md'), 'utf8');
    const doc = ArtifactDocument.parse(templateText, 'MutationEvidence.md');
    const parsed = mutationEvidenceSchema.safeParse(doc.frontMatter);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const pathResult = renderArtifactPath('MutationEvidence', { story: 'STORY-014', ts: 't0' });
    expect(pathResult.success).toBe(true);
    if (!pathResult.success) return;

    const paths = freshProject();
    const target = paths.resolveWithin(`docs/forge/${pathResult.path}`);

    await writeNewFileAtomic(target, doc.toString());
    expect(readFileSync(target, 'utf8')).toBe(doc.toString());

    const secondRun = ArtifactDocument.parse(templateText, 'MutationEvidence.md');
    secondRun.set(['restoreVerified'], false);
    try {
      await writeNewFileAtomic(target, secondRun.toString());
      expect.unreachable('a second run at the identical story/timestamp must be refused');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('RUN-114');
    }
    // The first run's own content survives untouched — not partially overwritten by the refused one.
    expect(readFileSync(target, 'utf8')).toBe(doc.toString());
  });
});

describe('EvidenceBundle — a second assembly at the same id is refused, never edited in place', () => {
  it('writes a real, schema-valid record, then refuses a second write to the identical path', async () => {
    const templateText = readFileSync(path.join(templatesDir, 'EvidenceBundle.md'), 'utf8');
    const doc = ArtifactDocument.parse(templateText, 'EvidenceBundle.md');
    const parsed = evidenceBundleSchema.safeParse(doc.frontMatter);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const pathResult = renderArtifactPath('EvidenceBundle', { id: 'EVID-001', story: 'STORY-014' });
    expect(pathResult.success).toBe(true);
    if (!pathResult.success) return;

    const paths = freshProject();
    const target = paths.resolveWithin(`docs/forge/${pathResult.path}`);

    await writeNewFileAtomic(target, doc.toString());
    expect(readFileSync(target, 'utf8')).toBe(doc.toString());

    // "edits an existing evidence record" (PLAN-M15.md P2's own phrasing): an attempt to revise this
    // exact bundle in place, at its own id's own path, rather than assembling a new one.
    const revised = ArtifactDocument.parse(templateText, 'EvidenceBundle.md');
    revised.bumpRevision('engine', 'attempted in-place edit', '2026-09-30');
    try {
      await writeNewFileAtomic(target, revised.toString());
      expect.unreachable('editing an existing EvidenceBundle in place must be refused');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('RUN-114');
    }
    expect(readFileSync(target, 'utf8')).toBe(doc.toString());
  });

  it('a genuinely new assembly (a distinct id) is never refused — append-only means a new file, not a frozen one', async () => {
    const templateText = readFileSync(path.join(templatesDir, 'EvidenceBundle.md'), 'utf8');
    const doc = ArtifactDocument.parse(templateText, 'EvidenceBundle.md');

    const paths = freshProject();
    const first = renderArtifactPath('EvidenceBundle', { id: 'EVID-001', story: 'STORY-014' });
    const second = renderArtifactPath('EvidenceBundle', { id: 'EVID-002', story: 'STORY-014' });
    expect(first.success && second.success).toBe(true);
    if (!first.success || !second.success) return;

    await writeNewFileAtomic(paths.resolveWithin(`docs/forge/${first.path}`), doc.toString());
    await expect(
      writeNewFileAtomic(paths.resolveWithin(`docs/forge/${second.path}`), doc.toString()),
    ).resolves.toBeUndefined();
  });
});

describe('ParityEvidence — a second write to the identical {id}-{slug} path is refused (specs/22 M16 P5)', () => {
  it('writes a real, schema-valid record, then refuses a second write to the identical path', async () => {
    const templateText = readFileSync(path.join(templatesDir, 'ParityEvidence.md'), 'utf8');
    const doc = ArtifactDocument.parse(templateText, 'ParityEvidence.md');
    const parsed = parityEvidenceSchema.safeParse(doc.frontMatter);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    // `{slug}` is a pure function of the id alone (`registryTail`) -- a real writer derives it from
    // the declaration name, which this piece does not build (`PLAN-M16.md` P5's own "Not your job");
    // a plausible, concrete slug is enough to exercise the identical path-collision this test proves.
    const pathResult = renderArtifactPath('ParityEvidence', { id: 'PAR-001', slug: 'search-api' });
    expect(pathResult.success).toBe(true);
    if (!pathResult.success) return;

    const paths = freshProject();
    const target = paths.resolveWithin(`docs/forge/${pathResult.path}`);

    await writeNewFileAtomic(target, doc.toString());
    expect(readFileSync(target, 'utf8')).toBe(doc.toString());

    const secondRun = ArtifactDocument.parse(templateText, 'ParityEvidence.md');
    secondRun.set(['dirty'], true);
    try {
      await writeNewFileAtomic(target, secondRun.toString());
      expect.unreachable('a second write for the identical declaration name/id must be refused');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('RUN-114');
    }
    // The first run's own content survives untouched -- not partially overwritten by the refused one.
    expect(readFileSync(target, 'utf8')).toBe(doc.toString());
  });

  it('a genuinely new record (a distinct id) is never refused -- append-only means a new file, not a frozen one', async () => {
    const templateText = readFileSync(path.join(templatesDir, 'ParityEvidence.md'), 'utf8');
    const doc = ArtifactDocument.parse(templateText, 'ParityEvidence.md');

    const paths = freshProject();
    const first = renderArtifactPath('ParityEvidence', { id: 'PAR-001', slug: 'search-api' });
    const second = renderArtifactPath('ParityEvidence', { id: 'PAR-002', slug: 'search-api' });
    expect(first.success && second.success).toBe(true);
    if (!first.success || !second.success) return;

    await writeNewFileAtomic(paths.resolveWithin(`docs/forge/${first.path}`), doc.toString());
    await expect(
      writeNewFileAtomic(paths.resolveWithin(`docs/forge/${second.path}`), doc.toString()),
    ).resolves.toBeUndefined();
  });
});

const execFileAsync = promisify(execFile);

/** `writeNewFileAtomic`'s own module path, resolved as a real filesystem path -- the worker script
 * below needs an absolute import, not a relative one (the identical reason `kb-disclosures.test.ts`'s
 * own worker does). */
const WRITE_NEW_FILE_ATOMIC_MODULE_PATH = fileURLToPath(
  new URL('../../src/fs/atomic.ts', import.meta.url),
);

/** The repo root, not the system tmpdir -- the identical reasoning `kb-disclosures.test.ts`'s own
 * `REPO_ROOT` doc comment already gives (a bare `@forge/core` import needs the real,
 * pnpm-workspace-linked `node_modules/`; `.forge-test-scratch/` is outside `node_modules/` and already
 * `.gitignore`d). */
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** Every worker races `writeNewFileAtomic` against the IDENTICAL `targetPath` with its own, distinct
 * content (so a corrupted or "both winners" outcome would be visible in the surviving file's bytes),
 * after waiting for a shared gate file -- the identical "launch every process first, release them
 * together" pattern `kb-disclosures.test.ts`'s own cross-process tests already establish. */
async function writeRaceWorker(workerPath: string): Promise<void> {
  const source = `
import { existsSync } from 'node:fs';
import { writeNewFileAtomic } from ${JSON.stringify(WRITE_NEW_FILE_ATOMIC_MODULE_PATH)};

const [, , targetPath, index, gatePath] = process.argv;
const deadline = Date.now() + 10_000;
while (!existsSync(gatePath)) {
  if (Date.now() > deadline) throw new Error('gate file never appeared');
}
try {
  await writeNewFileAtomic(targetPath, \`content from worker \${index}\\n\`);
  process.stdout.write(JSON.stringify({ index, outcome: 'wrote' }));
} catch (error) {
  process.stdout.write(JSON.stringify({ index, outcome: 'refused', code: error?.code }));
}
`;
  await writeFile(workerPath, source, 'utf8');
}

describe('ParityEvidence — real cross-process concurrency on the IDENTICAL target path (specs/22 M16 P5) (Q294 Decision 9)', () => {
  it('10 real, separate OS processes racing writeNewFileAtomic for the identical declaration name/id: exactly one wins, the rest get a clean RUN-114, and the file is never two and never corrupted', async () => {
    await mkdir(path.join(REPO_ROOT, '.forge-test-scratch'), { recursive: true });
    const workerDir = await mkdtemp(path.join(REPO_ROOT, '.forge-test-scratch', 'par-race-'));
    scratchDirs.push(workerDir);
    const workerPath = path.join(workerDir, 'worker.mts');
    await writeRaceWorker(workerPath);
    const gatePath = path.join(workerDir, 'gate');

    const paths = freshProject();
    // The identical path two concurrent `forge parity check` invocations would target: `{slug}` is a
    // pure function of the id alone, so racing for the SAME next id and the SAME declaration name
    // collides on this one path, never on two different ones.
    const pathResult = renderArtifactPath('ParityEvidence', { id: 'PAR-001', slug: 'search-api' });
    expect(pathResult.success).toBe(true);
    if (!pathResult.success) return;
    const targetPath = paths.resolveWithin(`docs/forge/${pathResult.path}`);

    const workerCount = 10;
    const launches = Array.from({ length: workerCount }, (_unused, index) =>
      execFileAsync(
        process.execPath,
        [
          '--experimental-strip-types',
          '--disable-warning=ExperimentalWarning',
          workerPath,
          targetPath,
          String(index),
          gatePath,
        ],
        { cwd: workerDir },
      ),
    );
    await writeFile(gatePath, 'go', 'utf8');
    const results = await Promise.all(launches);

    const parsedResults = results.map(
      ({ stdout }) =>
        JSON.parse(stdout) as {
          readonly index: number;
          readonly outcome: string;
          readonly code?: string;
        },
    );
    const wroteCount = parsedResults.filter((result) => result.outcome === 'wrote').length;
    const refusedCount = parsedResults.filter((result) => result.outcome === 'refused').length;
    // Exactly one process wins the race; every other one gets a clean, typed refusal -- never two
    // "winners," never an uncaught crash, never a silent no-op.
    expect(wroteCount).toBe(1);
    expect(refusedCount).toBe(workerCount - 1);
    expect(
      parsedResults
        .filter((result) => result.outcome === 'refused')
        .every((result) => result.code === 'RUN-114'),
    ).toBe(true);

    // Never two files, never a corrupted one: exactly one file exists at the target path, and its
    // content is exactly the ONE winner's own -- never a mix of two writers' bytes, which a
    // non-atomic "check then write" race could otherwise produce.
    const winnerIndex = parsedResults.find((result) => result.outcome === 'wrote')?.index;
    expect(readFileSync(targetPath, 'utf8')).toBe(`content from worker ${String(winnerIndex)}\n`);
  }, 30_000);
});
