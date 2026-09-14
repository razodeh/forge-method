/**
 * `scripts/lib/bench-fixtures.mjs`'s own fixture builders, unit tested directly — every one of
 * `21` §21.5's five benchmarks rests on its own fixture actually being the deterministic size the row
 * names ("100-artifact project", "5-layer fixture", "500 entries", "1000 entries"), which is only a
 * real guarantee if something asserts it, not merely a comment claiming it.
 *
 * @see specs/21 §21.5
 * @see scripts/lib/bench-fixtures.mjs
 * @see PLAN-M12.md P5
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ProjectPaths } from '@forge/core/fs';
import { parseKbTree, type KbParsedEntry, type KbTree } from '@forge/kb/schema';

import {
  buildCompileSources,
  buildEventLogFixture,
  buildSyntheticKbTree,
} from './lib/bench-fixtures.mjs';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '../fixtures/greenfield-service');

let cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
  cleanupDirs = [];
});

describe('buildEventLogFixture', () => {
  it('writes a real event log with exactly one RunStarted plus the requested ArtifactCreated count', () => {
    const scratchRoot = mkdtempSync(path.join(tmpdir(), 'forge-bench-fixtures-test-'));
    cleanupDirs.push(scratchRoot);
    const { projectRoot, runId } = buildEventLogFixture(scratchRoot, 100);

    const logPath = path.join(projectRoot, '.forge', 'state', 'runs', runId, 'events.ndjson');
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(101);

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events[0]?.['type']).toBe('RunStarted');
    const artifactEvents = events.filter((event) => event['type'] === 'ArtifactCreated');
    expect(artifactEvents).toHaveLength(100);

    // seq is gapless and starts at 1 — @forge/telemetry readEvents throws on any other shape.
    expect(events.map((event) => event['seq'])).toEqual(
      Array.from({ length: 101 }, (_unused, index) => index + 1),
    );

    // last-run.json points at the same runId this log was written under.
    const pointer = JSON.parse(
      readFileSync(path.join(projectRoot, '.forge', 'state', 'last-run.json'), 'utf8'),
    ) as { runId: string };
    expect(pointer.runId).toBe(runId);
  });

  it('gives every ArtifactCreated a distinct payload path, so the fixture is 100 real artifacts, not one repeated', () => {
    const scratchRoot = mkdtempSync(path.join(tmpdir(), 'forge-bench-fixtures-test-'));
    cleanupDirs.push(scratchRoot);
    const { projectRoot, runId } = buildEventLogFixture(scratchRoot, 100);
    const logPath = path.join(projectRoot, '.forge', 'state', 'runs', runId, 'events.ndjson');
    const events = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; payload: { path?: string } });
    const paths = events
      .filter((event) => event.type === 'ArtifactCreated')
      .map((event) => event.payload.path);
    expect(new Set(paths).size).toBe(100);
  });

  it('produces byte-identical event timestamps regardless of the process TZ (round-1 critic finding)', () => {
    // The original `new Date(2026, 0, 1, 0, 0, 0, seq)` form interprets its arguments as *local*
    // time before `.toISOString()` converts to UTC, so the identical seq produced different bytes
    // under a different TZ — a real R10 determinism violation this test pins against regressing.
    const originalTz = process.env['TZ'];
    try {
      process.env['TZ'] = 'Pacific/Kiritimati'; // UTC+14, about as far from UTC as a real zone gets
      const scratchA = mkdtempSync(path.join(tmpdir(), 'forge-bench-fixtures-test-'));
      cleanupDirs.push(scratchA);
      const a = buildEventLogFixture(scratchA, 5);
      const logA = readFileSync(
        path.join(a.projectRoot, '.forge', 'state', 'runs', a.runId, 'events.ndjson'),
        'utf8',
      );

      process.env['TZ'] = 'Etc/GMT+12'; // UTC-12, the opposite extreme
      const scratchB = mkdtempSync(path.join(tmpdir(), 'forge-bench-fixtures-test-'));
      cleanupDirs.push(scratchB);
      const b = buildEventLogFixture(scratchB, 5);
      const logB = readFileSync(
        path.join(b.projectRoot, '.forge', 'state', 'runs', b.runId, 'events.ndjson'),
        'utf8',
      );

      expect(logA).toBe(logB);
    } finally {
      if (originalTz === undefined) delete process.env['TZ'];
      else process.env['TZ'] = originalTz;
    }
  });
});

async function realTree(): Promise<KbTree> {
  return parseKbTree(new ProjectPaths(FIXTURE_ROOT));
}

describe('buildSyntheticKbTree', () => {
  it('adds exactly `count` synthetic entries on top of the real fixture tree, each with a distinct id', async () => {
    const tree = await realTree();
    const baseCount = tree.entries.length;

    const bigTree = buildSyntheticKbTree(tree, 500, 'kbpack');
    expect(bigTree.entries).toHaveLength(baseCount + 500);

    const syntheticIds = bigTree.entries
      .filter((entry): entry is Extract<KbParsedEntry, { kind: 'kb-entry' }> =>
        entry.path.startsWith('synthetic/kbpack-'),
      )
      .map((entry) => entry.value.id);
    expect(new Set(syntheticIds).size).toBe(500);
  });

  it('is deterministic: two independent calls over the same tree produce byte-identical synthetic entries', async () => {
    const tree = await realTree();
    const a = buildSyntheticKbTree(tree, 50, 'idxrb');
    const b = buildSyntheticKbTree(tree, 50, 'idxrb');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('throws a clear error if the real fixture has no kb-entry template to clone', () => {
    expect(() => buildSyntheticKbTree({ entries: [], errors: [] }, 10, 'x')).toThrow(/kb-entry/);
  });
});

describe('buildCompileSources', () => {
  it('gives every entity, across every document kind, a contribution at every one of the five layers', () => {
    const sources = buildCompileSources(20);
    const kinds = Object.keys(sources);
    expect(kinds.sort()).toEqual(
      ['agents', 'checks', 'frameworks', 'skills', 'templates', 'workflows'].sort(),
    );
    for (const kind of kinds) {
      const entities = sources[kind as keyof typeof sources];
      expect(Object.keys(entities)).toHaveLength(20);
      for (const contributions of Object.values(entities)) {
        expect(contributions.map((contribution) => contribution.layer)).toEqual([
          'L0',
          'L1',
          'L2',
          'L3',
          'L4',
        ]);
      }
    }
  });
});
