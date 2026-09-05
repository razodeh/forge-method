/**
 * `applyMigrations`.
 *
 * @see specs/18 §18.9
 * @see PLAN-M1.md P10
 */
import { describe, expect, it } from 'vitest';

import { applyMigrations } from '../../src/migrations/apply.ts';
import { planMigrations } from '../../src/migrations/plan.ts';
import type { Migration, MigratableDocument, MigrationPlan } from '../../src/migrations/types.ts';

/** `18` §18.9's own worked example, rewritten pure per `SPEC-QUESTIONS.md` Q27. */
const addReversibility: Migration = {
  from: 3,
  to: 4,
  types: ['ADR'],
  description: 'Add reversibility and revisit_trigger to ADR front matter',
  reversible: true,
  up: (doc) => ({
    ...doc,
    frontmatter: {
      ...doc.frontmatter,
      reversibility: doc.frontmatter['reversibility'] ?? 'medium',
      revisit_trigger: doc.frontmatter['revisit_trigger'] ?? 'TODO: state the trigger',
    },
  }),
  down: (doc) => {
    const frontmatter = { ...doc.frontmatter };
    delete frontmatter['reversibility'];
    delete frontmatter['revisit_trigger'];
    return { ...doc, frontmatter };
  },
};

const before: MigratableDocument = {
  type: 'ADR',
  frontmatter: { id: 'ADR-0001', type: 'ADR', schemaVersion: 3, title: 'Use zod for schemas' },
  body: '# ADR-0001\n\nUse zod for schemas.\n',
};

const after: MigratableDocument = {
  type: 'ADR',
  frontmatter: {
    ...before.frontmatter,
    reversibility: 'medium',
    revisit_trigger: 'TODO: state the trigger',
  },
  body: before.body,
};

function resolvedPlan(type: MigratableDocument['type'], from: number, to: number): MigrationPlan {
  const result = planMigrations(type, from, to, [addReversibility]);
  if (!result.success)
    throw new Error(`Test fixture plan failed to resolve: ${result.reason.kind}`);
  return result.plan;
}

describe('applyMigrations', () => {
  it('applies an up plan, producing the golden-file "after" fixture', () => {
    const result = applyMigrations(before, resolvedPlan('ADR', 3, 4));
    expect(result).toEqual({
      success: true,
      document: after,
      applied: [addReversibility],
      skipped: [],
    });
  });

  it('round-trips: up then down on a real fixture restores the original document exactly', () => {
    const afterResult = applyMigrations(before, resolvedPlan('ADR', 3, 4));
    expect(afterResult.success).toBe(true);
    if (!afterResult.success) return;

    const backResult = applyMigrations(afterResult.document, resolvedPlan('ADR', 4, 3));
    expect(backResult).toEqual({
      success: true,
      document: before,
      applied: [addReversibility],
      skipped: [],
    });
  });

  it('does not mutate the document object it was given', () => {
    const original = { ...before, frontmatter: { ...before.frontmatter } };
    applyMigrations(before, resolvedPlan('ADR', 3, 4));
    expect(before).toEqual(original);
  });

  it("skips a step whose types do not include the document's current type, as a no-op", () => {
    const storyMigration: Migration = {
      from: 1,
      to: 2,
      types: ['Story'],
      description: 'Story-only migration',
      reversible: false,
      up: (doc) => ({ ...doc, body: 'corrupted' }),
    };
    const plan: MigrationPlan = { direction: 'up', steps: [storyMigration] };
    const adrDoc: MigratableDocument = { type: 'ADR', frontmatter: {}, body: 'original' };

    const result = applyMigrations(adrDoc, plan);
    expect(result).toEqual({
      success: true,
      document: adrDoc,
      applied: [],
      skipped: [storyMigration],
    });
  });

  it('catches a migration that tries to mutate its (frozen) input and reports it as a failure', () => {
    const mutating: Migration = {
      from: 1,
      to: 2,
      types: ['ADR'],
      description: 'mutates its input — not spec-conforming, per SPEC-QUESTIONS.md Q27',
      reversible: false,
      up: (doc) => {
        (doc.frontmatter as Record<string, unknown>)['mutated'] = true;
        return doc;
      },
    };
    const plan: MigrationPlan = { direction: 'up', steps: [mutating] };
    const doc: MigratableDocument = { type: 'ADR', frontmatter: {}, body: '' };

    const result = applyMigrations(doc, plan);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.failure.migration).toBe(mutating);
    expect(result.failure.cause).toBeInstanceOf(TypeError);
    expect(result.appliedBeforeFailure).toEqual([]);
  });

  it('reports every step already applied before the one that failed', () => {
    const throwing: Migration = {
      from: 4,
      to: 5,
      types: ['ADR'],
      description: 'always throws',
      reversible: false,
      up: () => {
        throw new Error('boom');
      },
    };
    const plan: MigrationPlan = { direction: 'up', steps: [addReversibility, throwing] };

    const result = applyMigrations(before, plan);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.appliedBeforeFailure).toEqual([addReversibility]);
    expect(result.failure.migration).toBe(throwing);
    expect((result.failure.cause as Error).message).toBe('boom');
  });

  it('resolves an empty plan (fromVersion === toVersion) as a no-op success', () => {
    const result = applyMigrations(before, { direction: 'up', steps: [] });
    expect(result).toEqual({ success: true, document: before, applied: [], skipped: [] });
  });

  it('fails a hand-built down-direction plan whose step has no down', () => {
    // planMigrations itself never produces this: it refuses to resolve a down chain through an
    // irreversible step (see plan.test.ts's "refuses a down-direction chain through an irreversible
    // migration"). This exercises applyMigrations's own defence against a plan built by hand.
    const irreversible: Migration = {
      from: 1,
      to: 2,
      types: ['ADR'],
      description: 'irreversible',
      reversible: false,
      up: (doc) => doc,
    };
    const plan: MigrationPlan = { direction: 'down', steps: [irreversible] };
    const doc: MigratableDocument = { type: 'ADR', frontmatter: {}, body: '' };

    const result = applyMigrations(doc, plan);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.failure.migration).toBe(irreversible);
    expect(result.failure.cause).toBeInstanceOf(Error);
    expect(result.appliedBeforeFailure).toEqual([]);
  });
});
