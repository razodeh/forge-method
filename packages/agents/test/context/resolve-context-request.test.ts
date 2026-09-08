/**
 * `resolveContextRequest` — `05` §5.4 point 4's own `FORGE_REQUEST_CONTEXT:` expansion protocol.
 *
 * @see specs/05 §5.4
 * @see PLAN-M6.md A4
 */
import { JsonBackend, kbEntrySchema, rebuildIndex, type KbTree } from '@forge/kb';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveContextRequest } from '../../src/context/resolve-context-request.ts';

let scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

function freshBackend(): JsonBackend {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-agents-resolve-context-'));
  scratchDirs.push(dir);
  return new JsonBackend(path.join(dir, 'index.json'));
}

function fixtureTree(): KbTree {
  const entry = kbEntrySchema.parse({
    id: 'KB-ARCH-0001',
    type: 'knowledge',
    section: 'architecture',
    title: 'Billing invariants',
    status: 'active',
    confidence: 'high',
    owner: 'architect',
    sources: [{ kind: 'human', ref: 'elicitation' }],
    created: '2026-01-05',
    updated: '2026-01-05',
    review_by: '2026-04-05',
    supersedes: [],
    superseded_by: null,
    related: [],
    diagrams: [],
    tags: [],
    applies_to: [],
    body: '## Statement\nInvoices never total negative.',
  });
  return {
    entries: [{ path: 'architecture/billing-invariants.md', kind: 'kb-entry', value: entry }],
    errors: [],
  };
}

describe('resolveContextRequest', () => {
  it("a query naming a real KB entry id returns that entry's own full content as a declared input", () => {
    const tree = fixtureTree();
    const backend = freshBackend();
    rebuildIndex(tree, backend);
    const pack = resolveContextRequest('KB-ARCH-0001', backend, tree, 10_000);
    expect(pack.declaredInputs).toHaveLength(1);
    expect(pack.declaredInputs[0]?.id).toBe('KB-ARCH-0001');
    expect(pack.declaredInputs[0]?.content).toContain('Invoices never total negative.');
  });

  it('a query that does not name a real KB id falls back to a real retrieval query through the same backend', () => {
    const tree = fixtureTree();
    const backend = freshBackend();
    rebuildIndex(tree, backend);
    const pack = resolveContextRequest('billing invariants', backend, tree, 10_000);
    expect(pack.declaredInputs).toEqual([]);
    expect(pack.retrieved.some((entry) => entry.id === 'KB-ARCH-0001')).toBe(true);
  });

  it('returns an empty skills array -- this protocol never injects skill content', () => {
    const tree = fixtureTree();
    const backend = freshBackend();
    rebuildIndex(tree, backend);
    const pack = resolveContextRequest('KB-ARCH-0001', backend, tree, 10_000);
    expect(pack.skills).toEqual([]);
  });
});
