/**
 * `revalidateArtifacts` — `PLAN-M5.md` P19's own Checks text: a hand-edited artifact between the kill
 * and the resume surfaces as a reconciliation issue naming the specific mismatch, not a silent overwrite
 * in either direction.
 *
 * @see specs/06 §6.10
 * @see PLAN-M5.md P19
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { revalidateArtifacts } from '../../src/resume/revalidate.ts';
import type { RunState } from '../../src/resume/types.ts';

// Not in a shared helper: node:os's tmpdir is R10-restricted in production code
// (packages/engine/test/dispatch/helpers.ts's own doc comment has the fuller reasoning).
async function createTempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-resume-revalidate-'));
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const adrTemplatePath = path.join(
  repoRoot,
  'packages',
  'templates',
  'templates',
  'artifacts',
  'ADR.md',
);

function emptyRunState(artifactPaths: readonly string[]): RunState {
  return {
    runId: 'run-test',
    planRef: undefined,
    runStatus: undefined,
    stepStatuses: new Map(),
    unresolvedStepIds: [],
    laneStatuses: new Map(),
    spentUsd: 0,
    sessionIds: new Map(),
    laneOrigins: new Map(),
    artifactPaths: new Set(artifactPaths),
  };
}

describe('revalidateArtifacts', () => {
  it('reports no issues for artifacts that still validate', async () => {
    const projectRoot = await createTempProject();
    const adrContent = await readFile(adrTemplatePath, 'utf8');
    await mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await writeFile(path.join(projectRoot, 'docs', 'adr-1.md'), adrContent);

    const issues = revalidateArtifacts(emptyRunState(['docs/adr-1.md']), projectRoot);
    expect(issues).toEqual([]);
  });

  it('surfaces a hand-edit that breaks schema validation (an unregistered type) as a reconciliation issue naming the path', async () => {
    const projectRoot = await createTempProject();
    const adrContent = await readFile(adrTemplatePath, 'utf8');
    const handEdited = adrContent.replace('type: ADR', 'type: NotARealType');
    await mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await writeFile(path.join(projectRoot, 'docs', 'adr-1.md'), handEdited);

    const issues = revalidateArtifacts(emptyRunState(['docs/adr-1.md']), projectRoot);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('docs/adr-1.md');
    expect(issues[0]?.reason).toContain('NotARealType');
  });

  it('surfaces a hand-edit that breaks the front-matter structure entirely (ArtifactDocument.parse itself throws)', async () => {
    const projectRoot = await createTempProject();
    await mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await writeFile(path.join(projectRoot, 'docs', 'broken.md'), 'not even front matter at all\n');

    const issues = revalidateArtifacts(emptyRunState(['docs/broken.md']), projectRoot);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('docs/broken.md');
  });

  it('surfaces a file deleted since it was produced (a hand-removal, not just a hand-edit) as its own issue', async () => {
    const projectRoot = await createTempProject();
    // Never written at all -- a produced-then-deleted artifact and a never-written one are
    // indistinguishable to a re-validation pass that only ever reads current, live filesystem state.
    const issues = revalidateArtifacts(emptyRunState(['docs/gone.md']), projectRoot);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('docs/gone.md');
  });

  it('never overwrites anything -- purely a read/validate pass, proven by the file content being unchanged after the call', async () => {
    const projectRoot = await createTempProject();
    const handEdited = 'not even front matter at all\n';
    await mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await writeFile(path.join(projectRoot, 'docs', 'broken.md'), handEdited);

    revalidateArtifacts(emptyRunState(['docs/broken.md']), projectRoot);

    await expect(readFile(path.join(projectRoot, 'docs', 'broken.md'), 'utf8')).resolves.toBe(
      handEdited,
    );
  });

  it('rejects a path that escapes the project root rather than reading outside it -- surfaced as an issue, not a thrown error', async () => {
    const projectRoot = await createTempProject();
    const issues = revalidateArtifacts(emptyRunState(['../outside.md']), projectRoot);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('../outside.md');
  });

  it('checks every artifact path independently -- one bad one does not suppress a real issue on another', async () => {
    const projectRoot = await createTempProject();
    const adrContent = await readFile(adrTemplatePath, 'utf8');
    await mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await writeFile(path.join(projectRoot, 'docs', 'ok.md'), adrContent);
    await writeFile(path.join(projectRoot, 'docs', 'broken.md'), 'not front matter\n');

    const issues = revalidateArtifacts(
      emptyRunState(['docs/ok.md', 'docs/broken.md']),
      projectRoot,
    );
    expect(issues.map((issue) => issue.path)).toEqual(['docs/broken.md']);
  });

  it('reports no issues at all for a RunState with no artifact paths', async () => {
    const projectRoot = await createTempProject();
    expect(revalidateArtifacts(emptyRunState([]), projectRoot)).toEqual([]);
  });
});
