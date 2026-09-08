/**
 * `insertContractDependencies`/`buildClaimIntervalMap`/`applyClaimOverlaps` — `PLAN-M5.md` P11's own
 * Checks section: a contract-freeze producer/consumer pair gets the correct implicit edge without an
 * explicit `dependsOn`; two `shared`-claim steps on overlapping globs serialise; two `exclusive`-claim
 * steps on the same glob reject compilation with a specific, actionable error.
 *
 * @see specs/06 §6.2, §6.6, §6.7
 * @see PLAN-M5.md P11
 */
import { describe, expect, it } from 'vitest';

import { applyClaimOverlaps, buildClaimIntervalMap, insertContractDependencies } from '../../src/plan/dependencies.ts';
import type { StepNode } from '../../src/plan/types.ts';

function node(overrides: Partial<StepNode> & { readonly id: string }): StepNode {
  return {
    kind: 'agent',
    inputs: [],
    outputs: [],
    dependsOn: [],
    produces: [],
    consumes: [],
    retry: { maxAttempts: 1, backoffMs: [1000, 30_000], retryOn: [] },
    limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    idempotencyKey: overrides.id,
    onFailure: 'block',
    ...overrides,
  };
}

describe('insertContractDependencies', () => {
  it('makes an InterfaceContract producer an ancestor of every consumer, without an explicit dependsOn', () => {
    const producer = node({ id: 'freeze', outputs: [{ type: 'InterfaceContract', cardinality: 'many' }] });
    const consumer = node({ id: 'implement', inputs: ['artifact:InterfaceContract(*)'] });
    const [result] = insertContractDependencies([producer, consumer]).filter((n) => n.id === 'implement');
    expect(result?.dependsOn).toEqual(['freeze']);
  });

  it('does not touch a node that does not consume any InterfaceContract', () => {
    const producer = node({ id: 'freeze', outputs: [{ type: 'InterfaceContract' }] });
    const unrelated = node({ id: 'other', inputs: ['kb:engineering/standards'] });
    const [result] = insertContractDependencies([producer, unrelated]).filter((n) => n.id === 'other');
    expect(result?.dependsOn).toEqual([]);
  });

  it('does not duplicate an edge already present, and does not depend on itself', () => {
    const producer = node({ id: 'freeze', outputs: [{ type: 'InterfaceContract' }], inputs: ['artifact:InterfaceContract(*)'], dependsOn: ['freeze'] });
    const consumer = node({ id: 'implement', inputs: ['artifact:InterfaceContract(*)'], dependsOn: ['freeze'] });
    const result = insertContractDependencies([producer, consumer]);
    expect(result.find((n) => n.id === 'freeze')?.dependsOn).toEqual(['freeze']);
    expect(result.find((n) => n.id === 'implement')?.dependsOn).toEqual(['freeze']);
  });

  it('returns nodes completely unchanged (same array) when nothing produces a contract at all', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b', inputs: ['artifact:InterfaceContract(*)'] })];
    expect(insertContractDependencies(nodes)).toBe(nodes);
  });

  it('links every producer to every consumer for more than one of each (many-to-many)', () => {
    const nodes = [
      node({ id: 'p1', outputs: [{ type: 'InterfaceContract' }] }),
      node({ id: 'p2', outputs: [{ type: 'InterfaceContract' }] }),
      node({ id: 'c1', inputs: ['artifact:InterfaceContract(*)'] }),
      node({ id: 'c2', inputs: ['artifact:InterfaceContract(*)'] }),
    ];
    const result = insertContractDependencies(nodes);
    expect([...(result.find((n) => n.id === 'c1')?.dependsOn ?? [])].sort()).toEqual(['p1', 'p2']);
    expect([...(result.find((n) => n.id === 'c2')?.dependsOn ?? [])].sort()).toEqual(['p1', 'p2']);
  });
});

describe('buildClaimIntervalMap', () => {
  it('finds an overlap between two identical globs', () => {
    const a = node({ id: 'a', produces: ['src/foo.ts'] });
    const b = node({ id: 'b', produces: ['src/foo.ts'] });
    const map = buildClaimIntervalMap([a, b]);
    expect(map.overlaps).toContainEqual({ stepIdA: 'a', stepIdB: 'b', globA: 'src/foo.ts', globB: 'src/foo.ts' });
  });

  it('finds an overlap between a literal path and a wildcard that covers it', () => {
    const a = node({ id: 'a', produces: ['src/*.ts'] });
    const b = node({ id: 'b', produces: ['src/foo.ts'] });
    const map = buildClaimIntervalMap([a, b]);
    expect(map.overlaps).toHaveLength(1);
  });

  it('reports no overlap for genuinely disjoint globs', () => {
    const a = node({ id: 'a', produces: ['src/a.ts'] });
    const b = node({ id: 'b', produces: ['test/b.ts'] });
    expect(buildClaimIntervalMap([a, b]).overlaps).toEqual([]);
  });

  it('never reports a node overlapping against itself', () => {
    const a = node({ id: 'a', produces: ['src/foo.ts', 'src/foo.ts'] });
    expect(buildClaimIntervalMap([a]).overlaps).toEqual([]);
  });

  it('does not throw when a produces glob is long enough that minimatch itself would refuse to evaluate it as a pattern (over its own 64KiB limit), treating it as not detected rather than crashing', () => {
    // minimatch@10 itself throws a raw TypeError ("pattern is too long") for a pattern over 64KiB, a
    // defensive measure of its own -- reachable via nothing more exotic than an ordinary, if unusually
    // large, produces glob (a verify round found this escaping compileRunPlan raw, contradicting its own
    // "never throws" promise). This particular glob is also well past this module's own, much smaller
    // MAX_GLOB_LENGTH_FOR_OVERLAP_CHECK (a later, separate fix), so minimatch is never actually called for
    // it at all today -- kept anyway as its own test, since either guard alone should produce the
    // identical observable outcome, and this is the shape (an ordinary long glob, not an adversarially-
    // structured one) the original finding was about.
    const overlong = 'a'.repeat(70_000);
    const a = node({ id: 'a', produces: [overlong] });
    const b = node({ id: 'b', produces: ['src/foo.ts'] });
    expect(() => buildClaimIntervalMap([a, b])).not.toThrow();
    expect(buildClaimIntervalMap([a, b]).overlaps).toEqual([]);
  });

  it('still detects a real overlap between two long-but-identical globs (the a === b fast path never needs minimatch at all)', () => {
    const overlong = 'a'.repeat(70_000);
    const a = node({ id: 'a', produces: [overlong] });
    const b = node({ id: 'b', produces: [overlong] });
    expect(buildClaimIntervalMap([a, b]).overlaps).toHaveLength(1);
  });

  it('does not hang on a produces glob shaped to make minimatch itself take O(n^2) time with no exception thrown at all -- a verify round found this well under the 64KiB length minimatch itself guards against', () => {
    // A pattern of many unmatched "[" characters drives minimatch's own bracket-class scanner into
    // quadratic time without ever throwing -- confirmed by the verify round to take multiple seconds at
    // just a few thousand characters, comfortably below the 64KiB "pattern is too long" limit the earlier
    // fix guards. This test's own 2000-char pattern would itself measurably slow a real (unguarded) call;
    // completing near-instantly is the actual assertion here, not just "eventually returns."
    const pathological = '['.repeat(2000);
    const a = node({ id: 'a', produces: [pathological] });
    const b = node({ id: 'b', produces: ['src/foo.ts'] });
    const started = performance.now();
    expect(() => buildClaimIntervalMap([a, b])).not.toThrow();
    expect(performance.now() - started).toBeLessThan(500);
    expect(buildClaimIntervalMap([a, b]).overlaps).toEqual([]);
  });

  it('does not silently swallow a stack overflow from deeply-nested extglob groups either, closed by the same length cap', () => {
    // +(...)/@(...) nested past ~700 levels reliably overflows minimatch's own AST parser with a raw
    // RangeError, not the documented TypeError -- reachable at only ~2100 characters, well under 64KiB.
    // The length cap keeps a real call from ever reaching this depth; confirmed here it doesn't hang or
    // throw either.
    const pathological = '+('.repeat(700) + ')'.repeat(700);
    const a = node({ id: 'a', produces: [pathological] });
    const b = node({ id: 'b', produces: ['src/foo.ts'] });
    expect(() => buildClaimIntervalMap([a, b])).not.toThrow();
    expect(buildClaimIntervalMap([a, b]).overlaps).toEqual([]);
  });

  it('still detects a real, ordinary overlap for globs comfortably under the length cap', () => {
    const a = node({ id: 'a', produces: ['src/**/*.ts'] });
    const b = node({ id: 'b', produces: ['src/foo.ts'] });
    expect(buildClaimIntervalMap([a, b]).overlaps).toHaveLength(1);
  });

  it('still detects a real overlap for an ordinary, bracket-free produces path exceeding the earlier length-only cap -- a verify round found a purely length-based cap falsely reports "no overlap" for a realistic fanout-generated path with no pathological content at all', () => {
    // A deeply-nested generated-file path with a descriptive slug: zero "[" characters, but long enough
    // (confirmed below) to have tripped the earlier fix's own 256-character cap, which had no way to tell
    // this apart from a genuinely adversarial string of the same length.
    const longButOrdinary = `packages/design-system/src/components/generated/${'a-descriptive-slug-segment-'.repeat(10)}/CheckoutFlowStep.generated.tsx`;
    expect(longButOrdinary.length).toBeGreaterThan(256);
    expect(longButOrdinary).not.toContain('[');
    const a = node({ id: 'a', produces: [longButOrdinary] });
    const b = node({ id: 'b', produces: ['packages/design-system/src/components/generated/**/*.tsx'] });
    expect(buildClaimIntervalMap([a, b]).overlaps).toHaveLength(1);
  });

  it('still rejects (treats as no overlap) a pattern short enough to clear the length cap but containing many unmatched "[" characters -- the dedicated bracket-count guard, not the length guard, is what catches this one', () => {
    const manyBrackets = '['.repeat(100);
    expect(manyBrackets.length).toBeLessThan(512);
    const a = node({ id: 'a', produces: [manyBrackets] });
    const b = node({ id: 'b', produces: ['src/foo.ts'] });
    const started = performance.now();
    expect(buildClaimIntervalMap([a, b]).overlaps).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('still detects a real overlap for a pattern containing a small, realistic number of "[" characters (a genuine glob character class), not just a bracket-free one', () => {
    const a = node({ id: 'a', produces: ['src/components/[A-Z]*.tsx'] });
    const b = node({ id: 'b', produces: ['src/components/Foo.tsx'] });
    expect(buildClaimIntervalMap([a, b]).overlaps).toHaveLength(1);
  });
});

describe('applyClaimOverlaps', () => {
  it('serialises two overlapping shared-claim (laneAffinity: undefined) steps, earlier-declared becoming the ancestor', () => {
    const a = node({ id: 'a', produces: ['src/foo.ts'] });
    const b = node({ id: 'b', produces: ['src/foo.ts'] });
    const map = buildClaimIntervalMap([a, b]);
    const result = applyClaimOverlaps([a, b], map);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.nodes.find((n) => n.id === 'b')?.dependsOn).toEqual(['a']);
      expect(result.nodes.find((n) => n.id === 'a')?.dependsOn).toEqual([]);
    }
  });

  it('rejects two overlapping exclusive-claim steps on the same glob with a specific, actionable error', () => {
    const a = node({ id: 'a', produces: ['src/foo.ts'], laneAffinity: 'exclusive' });
    const b = node({ id: 'b', produces: ['src/foo.ts'], laneAffinity: 'exclusive' });
    const map = buildClaimIntervalMap([a, b]);
    const result = applyClaimOverlaps([a, b], map);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.code).toBe('ambiguous-exclusive-claim');
      expect(result.issues[0]?.message).toContain('a');
      expect(result.issues[0]?.message).toContain('b');
      expect(result.issues[0]?.message).not.toBe('ambiguous');
    }
  });

  it('serialises rather than rejects when only one side of an overlapping pair is exclusive', () => {
    const a = node({ id: 'a', produces: ['src/foo.ts'], laneAffinity: 'exclusive' });
    const b = node({ id: 'b', produces: ['src/foo.ts'] });
    const map = buildClaimIntervalMap([a, b]);
    const result = applyClaimOverlaps([a, b], map);
    expect(result.success).toBe(true);
    if (result.success) expect(result.nodes.find((n) => n.id === 'b')?.dependsOn).toEqual(['a']);
  });

  it('returns nodes unchanged when there are no overlaps at all', () => {
    const a = node({ id: 'a', produces: ['src/a.ts'] });
    const b = node({ id: 'b', produces: ['src/b.ts'] });
    const result = applyClaimOverlaps([a, b], buildClaimIntervalMap([a, b]));
    expect(result).toEqual({ success: true, nodes: [a, b] });
  });

  it('does not add a duplicate dependsOn entry when the overlap-implied ancestor is already explicitly declared', () => {
    const a = node({ id: 'a', produces: ['src/foo.ts'] });
    const b = node({ id: 'b', produces: ['src/foo.ts'], dependsOn: ['a'] });
    const result = applyClaimOverlaps([a, b], buildClaimIntervalMap([a, b]));
    expect(result.success).toBe(true);
    if (result.success) expect(result.nodes.find((n) => n.id === 'b')?.dependsOn).toEqual(['a']);
  });

  it('silently ignores an overlap naming a step id that does not exist in the given nodes -- defensive, since ClaimIntervalMap is a public type a caller could hand-construct mismatched with its own node list', () => {
    const a = node({ id: 'a', produces: ['src/foo.ts'] });
    const result = applyClaimOverlaps([a], { overlaps: [{ stepIdA: 'nonexistent', stepIdB: 'also-nonexistent', globA: 'x', globB: 'y' }] });
    expect(result).toEqual({ success: true, nodes: [a] });
  });
});
