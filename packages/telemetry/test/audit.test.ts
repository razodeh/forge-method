/**
 * `queryAuditEvents` — `20` §20.9's own consolidated audit query, `PLAN-M11.md` P13's own Checks
 * section verbatim: a fixture run producing at least one real event in every real audit category is
 * fully and correctly reported; `--since` correctly excludes events before the cutoff. Also covers a
 * gauntlet critic round's own finding: one corrupted/unreadable run must not abort the whole query.
 *
 * @see specs/20 §20.9
 * @see PLAN-M11.md P13
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { appendEvent, type NewForgeEvent } from '../src/events.ts';
import { AUDIT_CATEGORIES, queryAuditEvents, type AuditCategory } from '../src/audit.ts';

async function createTempProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-telemetry-audit-'));
}

const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function ev(overrides: Partial<NewForgeEvent> = {}): NewForgeEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    runId: 'run-1',
    type: 'RunStarted',
    payload: {},
    ...overrides,
  };
}

describe('queryAuditEvents', () => {
  it('reports no entries, no unreadable runs, for a project with no runs at all', async () => {
    const root = await createTempProjectRoot();
    cleanupDirs.push(root);
    const result = await queryAuditEvents(root);
    expect(result.entries).toEqual([]);
    expect(result.unreadableRuns).toEqual([]);
  });

  it('classifies at least one real event into every real audit category, and reports the two with no producer yet as genuinely empty', async () => {
    const root = await createTempProjectRoot();
    cleanupDirs.push(root);

    await appendEvent(
      root,
      'run-1',
      ev({ type: 'GateEvaluated', stepId: 'gate-1', payload: { gate: 'G-Ready' } }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({ type: 'GateApproved', stepId: 'gate-1', payload: { owner: 'alice' } }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({ type: 'GateRejected', stepId: 'gate-2', payload: { reason: 'missing tests' } }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({
        type: 'GateWaived',
        stepId: 'gate-3',
        payload: { owner: 'bob', reason: 'hotfix', expiry: '2026-02-01' },
      }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({
        type: 'EscalationActive',
        stepId: 'step-1',
        payload: { approver: 'carol', expiry: '2026-02-01' },
      }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({ type: 'PolicyViolation', stepId: 'step-2', payload: { policy: 'network:none' } }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({ type: 'InjectionAttemptBlocked', stepId: 'step-3', payload: { source: 'mcp-fetch' } }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({ type: 'SecretRedacted', stepId: 'step-4', payload: { key: 'apiKey' } }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({
        type: 'ArtifactCreated',
        stepId: 'step-5',
        agentId: 'engineer',
        payload: { path: 'docs/forge/kb/x.md' },
      }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({
        type: 'ArtifactUpdated',
        stepId: 'step-6',
        agentId: 'engineer',
        payload: { path: 'docs/forge/kb/y.md' },
      }),
    );
    // Non-audit-relevant events must not leak into any category.
    await appendEvent(root, 'run-1', ev({ type: 'StepStarted', stepId: 'step-7' }));
    await appendEvent(
      root,
      'run-1',
      ev({
        type: 'UsageRecorded',
        stepId: 'step-7',
        agentId: 'engineer',
        payload: {
          model: 'x',
          platform: 'y',
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          costUsd: 0,
          estimated: true,
          durationMs: 1,
        },
      }),
    );

    const { entries, unreadableRuns } = await queryAuditEvents(root);
    expect(unreadableRuns).toEqual([]);
    const byCategory = new Map<AuditCategory, number>();
    for (const entry of entries) {
      byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + 1);
    }

    expect(byCategory.get('gate-decision')).toBe(4);
    expect(byCategory.get('ceiling-escalation')).toBe(1);
    expect(byCategory.get('policy-violation')).toBe(1);
    expect(byCategory.get('blocked-injection')).toBe(1);
    expect(byCategory.get('redacted-secret')).toBe(1);
    expect(byCategory.get('artifact-write')).toBe(2);
    // No producer anywhere in this codebase emits either of these two event types yet — a real,
    // disclosed gap (this module's own doc comment / SPEC-QUESTIONS.md Q178), not a bug: querying for
    // them must not throw, and must return genuinely zero entries.
    expect(byCategory.get('destructive-confirmation')).toBeUndefined();
    expect(byCategory.get('mcp-call')).toBeUndefined();
    expect(entries.length).toBe(10);

    // Every real category is a valid, queryable key, even the two that are empty.
    for (const category of AUDIT_CATEGORIES) {
      const filtered = await queryAuditEvents(root, { categories: [category] });
      expect(filtered.entries.every((entry) => entry.category === category)).toBe(true);
    }
  });

  it('excludes events strictly before --since, keeping events at or after it', async () => {
    const root = await createTempProjectRoot();
    cleanupDirs.push(root);

    await appendEvent(
      root,
      'run-1',
      ev({ type: 'PolicyViolation', ts: '2026-01-01T00:00:00.000Z', stepId: 'early' }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({ type: 'PolicyViolation', ts: '2026-01-05T00:00:00.000Z', stepId: 'boundary' }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({ type: 'PolicyViolation', ts: '2026-01-10T00:00:00.000Z', stepId: 'late' }),
    );

    const { entries } = await queryAuditEvents(root, {
      since: new Date('2026-01-05T00:00:00.000Z'),
    });
    expect(entries.map((entry) => entry.stepId)).toEqual(['boundary', 'late']);
  });

  it('aggregates across every real run directory, sorted by ts then runId then seq', async () => {
    const root = await createTempProjectRoot();
    cleanupDirs.push(root);

    await appendEvent(
      root,
      'run-b',
      ev({
        runId: 'run-b',
        type: 'PolicyViolation',
        ts: '2026-01-01T00:00:00.000Z',
        stepId: 'b-1',
      }),
    );
    await appendEvent(
      root,
      'run-a',
      ev({
        runId: 'run-a',
        type: 'PolicyViolation',
        ts: '2026-01-01T00:00:00.000Z',
        stepId: 'a-1',
      }),
    );
    await appendEvent(
      root,
      'run-a',
      ev({
        runId: 'run-a',
        type: 'InjectionAttemptBlocked',
        ts: '2025-12-31T00:00:00.000Z',
        stepId: 'a-0',
      }),
    );

    const { entries } = await queryAuditEvents(root);
    expect(entries.map((entry) => `${entry.runId}:${entry.stepId ?? ''}`)).toEqual([
      'run-a:a-0',
      'run-a:a-1',
      'run-b:b-1',
    ]);
  });

  it('an empty categories array matches nothing, distinct from the default (every category)', async () => {
    const root = await createTempProjectRoot();
    cleanupDirs.push(root);
    await appendEvent(root, 'run-1', ev({ type: 'PolicyViolation' }));

    const { entries } = await queryAuditEvents(root, { categories: [] });
    expect(entries).toEqual([]);
  });

  it('ignores non-directory entries and unreadable/unrelated files under .forge/state/runs', async () => {
    const root = await createTempProjectRoot();
    cleanupDirs.push(root);
    await appendEvent(root, 'run-1', ev({ type: 'PolicyViolation' }));
    await writeFile(path.join(root, '.forge', 'state', 'runs', 'stray-file.txt'), 'not a run');

    const { entries } = await queryAuditEvents(root);
    expect(entries.length).toBe(1);
  });

  it('a corrupted run does not abort the whole query — every other run is still reported, and the corrupt one is named in unreadableRuns', async () => {
    const root = await createTempProjectRoot();
    cleanupDirs.push(root);

    await appendEvent(root, 'run-good-a', ev({ runId: 'run-good-a', type: 'PolicyViolation' }));
    await appendEvent(root, 'run-good-b', ev({ runId: 'run-good-b', type: 'SecretRedacted' }));

    // A genuinely corrupt event log: not valid JSON on its own line — the same shape
    // `events.test.ts`'s own corruption tests construct directly, bypassing `appendEvent`.
    const corruptRunDir = path.join(root, '.forge', 'state', 'runs', 'run-corrupt');
    await mkdir(corruptRunDir, { recursive: true });
    await writeFile(path.join(corruptRunDir, 'events.ndjson'), 'not valid json at all\n');

    const { entries, unreadableRuns } = await queryAuditEvents(root);

    expect(entries.map((entry) => entry.runId).sort()).toEqual(['run-good-a', 'run-good-b']);
    expect(unreadableRuns.length).toBe(1);
    expect(unreadableRuns[0]?.runId).toBe('run-corrupt');
    expect(unreadableRuns[0]?.error).toMatch(/not a well-formed event|not valid JSON/);
  });

  it('keeps the real entries a partially-corrupt run did yield before its own failure', async () => {
    const root = await createTempProjectRoot();
    cleanupDirs.push(root);

    await appendEvent(root, 'run-1', ev({ type: 'PolicyViolation', stepId: 'before-corruption' }));
    // A seq gap after one real, valid event: readEvents yields the first event, then throws on the
    // second.
    const filePath = path.join(root, '.forge', 'state', 'runs', 'run-1', 'events.ndjson');
    const { appendFile } = await import('node:fs/promises');
    await appendFile(
      filePath,
      `${JSON.stringify({
        v: 1,
        seq: 5,
        ts: '2026-01-02T00:00:00.000Z',
        runId: 'run-1',
        type: 'PolicyViolation',
        payload: {},
      })}\n`,
    );

    const { entries, unreadableRuns } = await queryAuditEvents(root);
    expect(entries.map((entry) => entry.stepId)).toEqual(['before-corruption']);
    expect(unreadableRuns.length).toBe(1);
    expect(unreadableRuns[0]?.runId).toBe('run-1');
  });

  it('a malformed (unparseable) ts is never silently hidden by --since, and sorts last rather than corrupting order', async () => {
    const root = await createTempProjectRoot();
    cleanupDirs.push(root);

    // `appendEvent` itself only shape-checks `ts` as a string (`events.ts`'s own `NewForgeEvent`), so a
    // real caller could genuinely write one of these — not merely a hand-edited file.
    await appendEvent(
      root,
      'run-1',
      ev({ type: 'PolicyViolation', ts: 'not-a-real-date', stepId: 'malformed-ts' }),
    );
    await appendEvent(
      root,
      'run-1',
      ev({ type: 'PolicyViolation', ts: '2026-01-01T00:00:00.000Z', stepId: 'real-ts' }),
    );

    // A far-future --since cutoff would exclude every real ts above; the malformed one must still not
    // be silently swallowed by it (a bare NaN comparison would otherwise never exclude it, regardless
    // of the cutoff — this asserts the correct behaviour, not the naive one).
    const { entries } = await queryAuditEvents(root, {
      since: new Date('2099-01-01T00:00:00.000Z'),
    });
    expect(entries.map((entry) => entry.stepId)).toEqual(['malformed-ts']);

    // With no --since, the malformed-ts entry sorts last, not interleaved as if it had a real position.
    const all = await queryAuditEvents(root);
    expect(all.entries.map((entry) => entry.stepId)).toEqual(['real-ts', 'malformed-ts']);
  });
});
