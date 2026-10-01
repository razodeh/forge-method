/**
 * `assembleAndWriteMutationEvidence` — `specs/22` M15 P4, against a real, throwaway project directory.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see PLAN-M15.md P4
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths, type Clock } from '@forge/core';
import { mutationEvidenceSchema } from '@forge/schemas';
import { afterEach, describe, expect, it } from 'vitest';

import { assembleAndWriteMutationEvidence } from '../../../../src/commands/loop/test/binding-evidence.ts';
import type { BindingCheckCompleted } from '../../../../src/commands/loop/test/binding.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<ProjectPaths> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-binding-evidence-'));
  dirs.push(dir);
  return new ProjectPaths(dir);
}

function fakeClock(): Clock {
  return { now: () => '2026-09-30T12:00:00.000Z' };
}

function completedResult(overrides: Partial<BindingCheckCompleted> = {}): BindingCheckCompleted {
  return {
    outcome: 'completed',
    namedTests: ['adds'],
    failedUnderMutation: ['adds'],
    restoreVerified: true,
    revertedRange: {
      fromSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      toSha: 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5',
    },
    ranAt: '2026-09-30T12:00:00.000Z',
    ...overrides,
  };
}

describe('assembleAndWriteMutationEvidence', () => {
  it('writes a real, schema-valid MutationEvidence document and returns its real id and path', async () => {
    const paths = await freshProject();
    const written = await assembleAndWriteMutationEvidence({
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-014',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
    });

    expect(written.id).toMatch(/^MUT-\d{3}$/);
    expect(written.path).toBe('docs/forge/reports/mutation/STORY-014-2026-09-30T12-00-00.000Z.md');

    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    expect(text).toContain(`id: ${written.id}`);
    expect(text).toContain('type: MutationEvidence');
    expect(text).toContain('story: STORY-014');
  });

  it('the written front matter genuinely validates against the real mutationEvidenceSchema', async () => {
    const paths = await freshProject();
    const written = await assembleAndWriteMutationEvidence({
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-014',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
    });

    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const frontMatterText = text.split('---\n')[1] ?? '';
    const YAML = await import('yaml');
    const parsed = mutationEvidenceSchema.safeParse(YAML.parse(frontMatterText));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('two different stories at the identical clock instant get two distinct files, never colliding', async () => {
    const paths = await freshProject();
    const first = await assembleAndWriteMutationEvidence({
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-A',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
    });
    const second = await assembleAndWriteMutationEvidence({
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-B',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
    });

    expect(first.id).not.toBe(second.id);
    expect(first.path).not.toBe(second.path);
  });

  it('refuses (RUN-114) a second write to the identical story+timestamp path, never silently overwriting', async () => {
    const paths = await freshProject();
    const input = {
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-014',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
    };
    await assembleAndWriteMutationEvidence(input);

    await expect(assembleAndWriteMutationEvidence(input)).rejects.toMatchObject({
      code: 'RUN-114',
    });
  });
});
