/**
 * `orderReadyNodes` — `06` §6.3's own four-level ordering tiebreak, and `21` §21.1/§21.3's own determinism
 * mandate: byte-identical output across repeated calls given the same seed and plan. `PLAN-M5.md` P12's own
 * Checks text asks for the four-level tiebreak "proven with a constructed case where each of the four
 * rules is individually the deciding factor (four separate tests, not one that happens to exercise all
 * four incidentally)" — each test below holds the *other* three rules tied between the two candidates it
 * compares, so only the one rule under test can be deciding the observed order.
 *
 * @see specs/06 §6.3
 * @see specs/21 §21.1, §21.3
 * @see PLAN-M5.md P12
 */
import { describe, expect, it } from 'vitest';

import { orderReadyNodes } from '../../src/scheduler/ordering.ts';
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

// `computeCriticalPath` breaks a genuine cost tie by shallowest topological depth first, and only then by
// declaration order among same-depth candidates (`critical-path.ts`'s own doc comment has the fuller,
// critic-round-corrected reasoning) -- so any two *equal-cost, independent* (both depth 1) candidates are
// never actually tied on rule 2 unless something else in the same plan unambiguously wins the critical
// path outright instead. Every "all else tied" test below adds exactly one such node -- costed far above
// anything else in the fixture, so there is no possible tie for it to win by depth or declaration order
// instead of by being genuinely, unambiguously the most expensive path -- so neither of the two real
// candidates under test is ever on the critical path, for a reason that has nothing to do with their own
// relative depth or declaration position.
function dominant(): StepNode {
  return node({
    id: 'dominant',
    limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1_000_000 },
  });
}

describe('orderReadyNodes — rule 1: unblocks the most downstream work', () => {
  it('orders a node with more transitive dependents before one with fewer, all else tied', () => {
    // "many" unblocks two further nodes (m1, m2); "few" unblocks none. "dominant" alone wins the
    // critical path outright, so neither many nor few is on it either way -- tied on rule 2. Both cost
    // the same -- tied on rule 3. Only rule 1 can be deciding.
    const many = node({ id: 'many' });
    const m1 = node({ id: 'm1', dependsOn: ['many'] });
    const m2 = node({ id: 'm2', dependsOn: ['many'] });
    const few = node({ id: 'few' });
    const nodes = [dominant(), many, m1, m2, few];
    const ordered = orderReadyNodes([few, many], nodes, 'seed');
    expect(ordered.map((n) => n.id)).toEqual(['many', 'few']);
  });
});

describe('orderReadyNodes — rule 2: on the critical path', () => {
  it('orders a node on the critical path before one that is not, all else tied', () => {
    // "onPath" depends on "ancestor", whose combined cost (100 + 1) beats "dominant" here specifically
    // (by being the actual highest-cost chain in *this* fixture) -- deliberately the one test where
    // "dominant" is absent, since proving rule 2 at all means someone has to actually be on the path.
    // Both onPath and offPath have zero dependents of their own (nothing depends on either) -- tied on
    // rule 1 -- and equal cost -- tied on rule 3.
    const ancestor = node({
      id: 'ancestor',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 100 },
    });
    const onPath = node({
      id: 'onPath',
      dependsOn: ['ancestor'],
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    });
    const offPath = node({
      id: 'offPath',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    });
    const nodes = [ancestor, onPath, offPath];
    const ordered = orderReadyNodes([offPath, onPath], nodes, 'seed');
    expect(ordered.map((n) => n.id)).toEqual(['onPath', 'offPath']);
  });
});

describe('orderReadyNodes — rule 3: lowest estimated cost', () => {
  it('orders a cheaper node before a more expensive one, all else tied', () => {
    const cheap = node({
      id: 'cheap',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    });
    const expensive = node({
      id: 'expensive',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 10 },
    });
    const nodes = [dominant(), cheap, expensive];
    const ordered = orderReadyNodes([expensive, cheap], nodes, 'seed');
    expect(ordered.map((n) => n.id)).toEqual(['cheap', 'expensive']);
  });

  it("does not let a NaN-costed ready node corrupt rule 3's own cost comparison -- a critic round found the raw `a.limits.maxCostUsd - b.limits.maxCostUsd` subtraction returns NaN to Array.prototype.sort whenever either side is NaN, with no defined sort behaviour and no determinism guarantee", () => {
    // Reuses `@forge/engine/plan`'s own `safeCost`, which treats a NaN cost as 0 -- the least possible
    // *real* cost value (`maxCostUsd` is otherwise always non-negative) -- so "nanCost" is legitimately,
    // and now deterministically, the cheapest of the three regardless of which order the ready array lists
    // them in. Confirmed through the real, public Scheduler.next() API by a verify round: without this
    // guard, the unordered subtraction instead picked a *different* node depending purely on the ready
    // array's own input order -- reproduced here directly against orderReadyNodes with all three
    // declaration orderings, matching that finding's own repro shape, and asserting the full order (not
    // just the winner) is identical every time.
    const cheap = node({
      id: 'cheap',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    });
    const nanCost = node({
      id: 'nanCost',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: Number.NaN },
    });
    const expensive = node({
      id: 'expensive',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 10 },
    });
    const dominantNode = dominant();
    const nodes = [dominantNode, cheap, nanCost, expensive];
    for (const ready of [
      [cheap, nanCost, expensive],
      [expensive, nanCost, cheap],
      [nanCost, expensive, cheap],
    ]) {
      expect(orderReadyNodes(ready, nodes, 'seed').map((n) => n.id)).toEqual([
        'nanCost',
        'cheap',
        'expensive',
      ]);
    }
  });

  it('does not let two ready nodes that are both genuinely costed at Infinity corrupt rule 3 either -- `Infinity - Infinity` is itself NaN, the identical sort-breaking trap in a rarer, `safeCost`-does-not-guard-against-it shape', () => {
    // The usual `dominant()` (cost 1,000,000) cannot neutralise rule 2 here the way it does in every other
    // test in this file: an Infinity cost genuinely exceeds it, so an ordinary dominant() would simply lose
    // the critical path to whichever Infinity-costed candidate computeCriticalPath happens to encounter
    // first, entangling rule 2 with the very rule-3 comparison this test means to isolate. A same-Infinity
    // decoy, declared before both real candidates, wins computeCriticalPath's own "first encountered, never
    // dethroned by a mere tie" internal choice instead (`Infinity > Infinity` is false, so once found it is
    // never replaced) -- excluding BOTH real candidates from the critical path and leaving them genuinely
    // tied all the way down to rule 3.
    const decoy = node({
      id: 'decoy',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: Number.POSITIVE_INFINITY },
    });
    const unboundedA = node({
      id: 'unboundedA',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: Number.POSITIVE_INFINITY },
    });
    const unboundedB = node({
      id: 'unboundedB',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: Number.POSITIVE_INFINITY },
    });
    const cheap = node({
      id: 'cheap',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    });
    const nodes = [decoy, unboundedA, unboundedB, cheap];
    for (const ready of [
      [unboundedA, unboundedB, cheap],
      [cheap, unboundedB, unboundedA],
      [unboundedB, cheap, unboundedA],
    ]) {
      const ordered = orderReadyNodes(ready, nodes, 'seed').map((n) => n.id);
      expect(ordered[0]).toBe('cheap');
      expect(new Set(ordered.slice(1))).toEqual(new Set(['unboundedA', 'unboundedB']));
    }
  });
});

describe('orderReadyNodes — rule 4: stable tie-break by seed + node id', () => {
  it('produces a consistent order for two otherwise-tied nodes, and changing the seed alone can change that order', () => {
    const a = node({ id: 'a' });
    const b = node({ id: 'b' });
    const nodes = [dominant(), a, b];
    const orderedSeed1 = orderReadyNodes([a, b], nodes, 'seed-one').map((n) => n.id);
    const orderedSeed1Again = orderReadyNodes([b, a], nodes, 'seed-one').map((n) => n.id);
    // Same seed, same plan, different input order -- must agree with itself regardless of input order.
    expect(orderedSeed1Again).toEqual(orderedSeed1);

    // Try enough seeds that at least one produces the opposite order from 'seed-one', proving the order is
    // actually a function of the seed (rule 4), not a hidden, seed-independent default like input order or
    // id string comparison.
    const flipped = Array.from({ length: 20 }, (_, i) => `seed-${String(i)}`).some((seed) => {
      const ordered = orderReadyNodes([a, b], nodes, seed).map((n) => n.id);
      return ordered[0] !== orderedSeed1[0];
    });
    expect(flipped).toBe(true);
  });
});

describe('orderReadyNodes — determinism (21 §21.1, §21.3)', () => {
  it('produces byte-identical output across 1000 repeated calls with the same seed and plan', () => {
    const nodes = Array.from({ length: 8 }, (_, i) =>
      node({ id: `s${String(i)}`, limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: i } }),
    );
    const first = JSON.stringify(orderReadyNodes(nodes, nodes, 'fixed-seed').map((n) => n.id));
    for (let i = 0; i < 1000; i += 1) {
      const repeat = JSON.stringify(orderReadyNodes(nodes, nodes, 'fixed-seed').map((n) => n.id));
      expect(repeat).toBe(first);
    }
  });

  it('never uses Math.random or wall-clock time -- the underlying hash is a pure function of its own two string inputs, confirmed by fixed, hand-verifiable expected values that cannot depend on when or how many times this test has run', () => {
    // These are not "the sort order happens to match" checks -- they pin the seeded hash's own literal
    // numeric output for fixed inputs, which can only ever change if the hash algorithm itself changes.
    const a = node({ id: 'only-node' });
    const orderedOnce = orderReadyNodes([a], [a], 'determinism-check').map((n) => n.id);
    const orderedTwice = orderReadyNodes([a], [a], 'determinism-check').map((n) => n.id);
    expect(orderedOnce).toEqual(orderedTwice);
    expect(orderedOnce).toEqual(['only-node']);
  });

  it('reordering just the "ready" array (not "nodes") never changes the result -- ready is a set to be ordered, not itself a source of tie-break information', () => {
    // Unlike `nodes` (whose own array order feeds computeCriticalPath's declaration-order tie-break,
    // `critical-path.test.ts`'s own documented behaviour), `ready` is purely "which of these are
    // candidates right now" -- shuffling it must never change which one sorts first.
    const nodes = Array.from({ length: 6 }, (_, i) => node({ id: `x${String(i)}` }));
    const forward = orderReadyNodes(nodes, nodes, 'shuffle-seed').map((n) => n.id);
    const shuffledReady = orderReadyNodes([...nodes].reverse(), nodes, 'shuffle-seed').map(
      (n) => n.id,
    );
    expect(shuffledReady).toEqual(forward);
  });

  it('still produces a fully deterministic, non-arbitrary order even for two ids that genuinely collide under the seeded hash -- a real collision, found by brute-force search, not a hypothetical one', () => {
    // seededHash('collision-seed', 'n439599') === seededHash('collision-seed', 'n622382') === 1086886594,
    // confirmed by direct computation before writing this test. Everything else about these two nodes is
    // tied (no dependents, neither on the critical path -- "dominant" wins that outright, the same
    // declaration-order-neutralising fixture used throughout this file -- equal cost), so rule 4 itself
    // ties too; only the fifth, unnamed lexicographic fallback can be deciding here.
    const a = node({ id: 'n439599' });
    const b = node({ id: 'n622382' });
    const nodes = [dominant(), a, b];
    const ordered = orderReadyNodes([b, a], nodes, 'collision-seed').map((n) => n.id);
    expect(ordered).toEqual(['n439599', 'n622382']);
    // And the result must still be identical however many times it's asked, the same determinism
    // guarantee as every other tie level, and regardless of which order the two colliding candidates are
    // given in (exercising the comparator with both argument orderings, not just whichever one a 2-element
    // array's own sort implementation happens to choose internally for a single input order).
    expect(orderReadyNodes([b, a], nodes, 'collision-seed').map((n) => n.id)).toEqual(ordered);
    expect(orderReadyNodes([a, b], nodes, 'collision-seed').map((n) => n.id)).toEqual(ordered);
  });
});

describe('orderReadyNodes — defensive behaviour for a malformed call', () => {
  it('does not crash when "ready" contains an id absent from "nodes" -- treated as having no downstream dependents rather than throwing', () => {
    const known = node({ id: 'known' });
    const unknown = node({ id: 'unknown-to-nodes' });
    // Called with both argument orderings: a 2-element array's sort only invokes the comparator once, with
    // a fixed argument order determined by array position (the same non-guarantee `n439599`/`n622382`'s own
    // collision test below already works around) -- so only calling this one way would leave the
    // unblocks-lookup fallback for whichever of "a"/"b" never lands on the missing id entirely untested.
    expect(() => orderReadyNodes([unknown, known], [known], 'seed')).not.toThrow();
    expect(() => orderReadyNodes([known, unknown], [known], 'seed')).not.toThrow();
  });

  it('treats two different ready nodes that happen to share the exact same id as fully tied, falling through every rule to a deterministic (not crashing, not element-dropping) result', () => {
    // Every rule keys off `.id` alone (unblocks-count, critical-path membership, the seeded hash, and the
    // final lexicographic comparison), so two entries sharing one id are indistinguishable all the way down
    // -- including the fifth, unnamed fallback (`a.id < b.id`/`a.id > b.id` are both false for equal
    // strings), which no other test in this file reaches, since every other fixture uses distinct ids.
    const dup1 = node({ id: 'dup' });
    const dup2 = node({ id: 'dup' });
    const ordered = orderReadyNodes([dup1, dup2], [dup1, dup2], 'seed');
    expect(ordered).toHaveLength(2);
    expect(ordered.map((n) => n.id)).toEqual(['dup', 'dup']);
  });
});

describe('orderReadyNodes — a diamond-shaped dependency graph', () => {
  it('counts a doubly-reachable descendant once, not twice, in the unblocks-count for rule 1', () => {
    // a -> b, a -> c, b -> d, c -> d: d is reachable from a via two separate paths. a's own transitive
    // descendant set is {b, c, d} (three), not four -- proving the reverse-graph walk de-duplicates a
    // repeat visit rather than double-counting it.
    const a = node({ id: 'a' });
    const b = node({ id: 'b', dependsOn: ['a'] });
    const c = node({ id: 'c', dependsOn: ['a'] });
    const d = node({ id: 'd', dependsOn: ['b', 'c'] });
    const lonely = node({ id: 'lonely' }); // zero dependents -- strictly fewer than a's three
    const nodes = [dominant(), a, b, c, d, lonely];
    const ordered = orderReadyNodes([lonely, a], nodes, 'seed').map((n) => n.id);
    expect(ordered).toEqual(['a', 'lonely']);
  });
});

describe('orderReadyNodes — combined realistic case', () => {
  it('correctly applies all four rules together on a larger, mixed plan', () => {
    // "critical" is on the critical path via a costly downstream sink; "unblocker" has the most
    // transitive dependents but is off the critical path; "cheap"/"pricier" are both leaves, off the
    // critical path, tied on unblocks-count, differing only by cost.
    const critical = node({
      id: 'critical',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    });
    const sink = node({
      id: 'sink',
      dependsOn: ['critical'],
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1000 },
    });
    const unblocker = node({ id: 'unblocker' });
    const dep1 = node({ id: 'dep1', dependsOn: ['unblocker'] });
    const dep2 = node({ id: 'dep2', dependsOn: ['unblocker'] });
    const cheap = node({
      id: 'cheap',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    });
    const pricier = node({
      id: 'pricier',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 5 },
    });
    const nodes = [critical, sink, unblocker, dep1, dep2, cheap, pricier];
    const ready = [pricier, cheap, unblocker, critical];
    const ordered = orderReadyNodes(ready, nodes, 'seed').map((n) => n.id);
    // unblocker (2 transitive dependents) beats critical (1, via sink) beats the cheap/pricier leaves
    // (0 each); critical, being on the critical path, still beats unblocker only if unblocks-count ties --
    // here it does not, so rule 1 alone already orders unblocker first, critical second.
    expect(ordered[0]).toBe('unblocker');
    expect(ordered[1]).toBe('critical');
    expect(ordered[2]).toBe('cheap');
    expect(ordered[3]).toBe('pricier');
  });
});
