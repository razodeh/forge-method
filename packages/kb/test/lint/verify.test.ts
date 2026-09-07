/**
 * `verifyKb` — `08` §8.8's `forge kb verify`: running every `confidence: verified` entry's
 * Verification check through an injected `runCheck`, and flagging `review_by` staleness — two
 * distinguishable `needs-review` findings.
 *
 * @see specs/08 §8.8
 * @see PLAN-M3.md P10
 */
import { describe, expect, it, vi } from 'vitest';

import type { KbEntry } from '../../src/schema/kb-entry.ts';
import { verifyKb } from '../../src/lint/verify.ts';
import { kbEntry, treeOf } from './factories.ts';

describe('verifyKb', () => {
  it('marks an entry needs-review when its injected runCheck returns false', async () => {
    const entry = kbEntry({
      confidence: 'verified',
      review_by: '2026-12-01',
      body: '## Statement\nx\n## Verification\nRun `pnpm test`.',
    });
    const tree = treeOf([{ kind: 'kb-entry', value: entry }]);
    const runCheck = vi.fn(() => Promise.resolve(false));

    const findings = await verifyKb(tree, runCheck, new Date('2026-06-01'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('kb:needs-review');
    expect(findings[0]?.severity).toBe('warn');
    expect(runCheck).toHaveBeenCalledTimes(1);
  });

  it('does not flag an entry whose injected runCheck returns true', async () => {
    const entry = kbEntry({
      confidence: 'verified',
      review_by: '2026-12-01',
      body: '## Statement\nx\n## Verification\nRun `pnpm test`.',
    });
    const tree = treeOf([{ kind: 'kb-entry', value: entry }]);
    const runCheck = vi.fn(() => Promise.resolve(true));

    expect(await verifyKb(tree, runCheck, new Date('2026-06-01'))).toEqual([]);
  });

  it('never calls runCheck for a non-verified entry', async () => {
    const entry = kbEntry({ confidence: 'high', review_by: '2026-12-01' });
    const tree = treeOf([{ kind: 'kb-entry', value: entry }]);
    const runCheck = vi.fn(() => Promise.resolve(true));

    await verifyKb(tree, runCheck, new Date('2026-06-01'));
    expect(runCheck).not.toHaveBeenCalled();
  });

  it('separately marks needs-review when now is past review_by, with a distinguishable message', async () => {
    const entry = kbEntry({ confidence: 'high', review_by: '2026-01-01' });
    const tree = treeOf([{ kind: 'kb-entry', value: entry }]);
    const runCheck = vi.fn(() => Promise.resolve(true));

    const findings = await verifyKb(tree, runCheck, new Date('2026-06-01'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('review date');
  });

  it('produces two distinct findings when an entry is both failing verification and stale', async () => {
    const entry = kbEntry({
      confidence: 'verified',
      review_by: '2026-01-01',
      body: '## Statement\nx\n## Verification\nRun `pnpm test`.',
    });
    const tree = treeOf([{ kind: 'kb-entry', value: entry }]);
    const runCheck = vi.fn(() => Promise.resolve(false));

    const findings = await verifyKb(tree, runCheck, new Date('2026-06-01'));
    expect(findings).toHaveLength(2);
    const messages = findings.map((f) => f.message);
    expect(messages.some((m) => m.includes('Verification check'))).toBe(true);
    expect(messages.some((m) => m.includes('review date'))).toBe(true);
  });

  it('never shells out itself — runCheck is the only thing ever invoked to decide pass/fail', async () => {
    const entry = kbEntry({
      confidence: 'verified',
      review_by: '2026-12-01',
      body: '## Statement\nx\n## Verification\nRun `pnpm test -- packages/kb`.',
    });
    const tree = treeOf([{ kind: 'kb-entry', value: entry }]);
    let receivedCommand = '';
    const runCheck = vi.fn((command: string) => {
      receivedCommand = command;
      return Promise.resolve(true);
    });

    await verifyKb(tree, runCheck, new Date('2026-06-01'));
    expect(receivedCommand).toContain('pnpm test -- packages/kb');
  });

  it('hands runCheck an empty string, not undefined, for a confidence: verified entry with no Verification section', async () => {
    // kbEntrySchema's own superRefine makes this combination impossible for any entry that actually
    // passed validation (confidence: 'verified' requires real "## Verification" content) — this cast
    // simulates the one way it could still reach verifyKb regardless (a caller building a KbTree by
    // hand, bypassing parseKbTree), so the `readKbBodySection(...) ?? ''` fallback is exercised for
    // real rather than left an unreachable-in-practice defensive branch.
    const entry = {
      id: 'KB-ARCH-0001',
      type: 'knowledge',
      section: 'architecture',
      title: 'A test entry',
      status: 'active',
      confidence: 'verified',
      owner: 'architect',
      sources: [{ kind: 'human', ref: 'elicitation' }],
      created: '2026-01-05',
      updated: '2026-01-05',
      review_by: '2026-12-01',
      supersedes: [],
      superseded_by: null,
      related: [],
      diagrams: [],
      tags: [],
      applies_to: [],
      body: '## Statement\nNo Verification section at all.',
    } as unknown as KbEntry;
    const tree = treeOf([{ kind: 'kb-entry', value: entry }]);
    let receivedCommand: string | undefined;
    const runCheck = vi.fn((command: string) => {
      receivedCommand = command;
      return Promise.resolve(true);
    });

    await verifyKb(tree, runCheck, new Date('2026-06-01'));
    expect(receivedCommand).toBe('');
  });
});
