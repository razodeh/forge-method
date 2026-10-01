/**
 * `writeNewFileAtomic` against real `MutationEvidence`/`EvidenceBundle` records — `specs/18` §18.7's
 * own normative text and `PLAN-M15.md` P2's own "Tests first" line, "a bundle that edits an existing
 * evidence record is refused," proven end to end: a genuine, schema-valid record of each type is
 * written to its own real registry path, and a second write to the SAME path is refused rather than
 * silently overwriting the first.
 *
 * The generic mechanism itself (`RUN-114`, the race-free `fsp.link`-based refusal, crash-safety) is
 * proven type-agnostically in `packages/core/test/fs/atomic.test.ts`; this file proves only that it
 * is the real mechanism these two specific, newly-registered artifact types actually use.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see PLAN-M15.md P2
 * @see SPEC-QUESTIONS.md Q280
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { evidenceBundleSchema, mutationEvidenceSchema } from '@forge/schemas/artifacts';
import { renderArtifactPath } from '@forge/schemas/registry';

import { ArtifactDocument } from '../../src/artifacts/document.ts';
import { ProjectPaths } from '../../src/fs/paths.ts';
import { writeNewFileAtomic } from '../../src/fs/atomic.ts';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const templatesDir = path.join(repoRoot, 'packages', 'templates', 'templates', 'artifacts');

let projectRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-append-only-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
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
