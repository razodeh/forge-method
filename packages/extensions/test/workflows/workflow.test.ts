/**
 * `workflowOverlaySchema`, `checkWorkflowStepRemoval`, `checkInsertAfterAnchors`, `applyInsertAfter`
 * — `15` §15.7's workflow overlay rules.
 *
 * @see specs/15 §15.7
 * @see PLAN-M2.md P6
 */
import { describe, expect, it } from 'vitest';

import {
  applyInsertAfter,
  checkInsertAfterAnchors,
  checkWorkflowStepRemoval,
  workflowOverlaySchema,
} from '../../src/workflows/workflow.ts';
import type { WorkflowStepSummary } from '../../src/workflows/types.ts';

describe('workflowOverlaySchema', () => {
  it('accepts the full 15 §15.7 worked example', () => {
    const result = workflowOverlaySchema.safeParse({
      steps: {
        $replaceWhere: [
          { id: 'review', step: { perspectives: { $append: ['accessibility', 'i18n'] } } },
        ],
        $insertAfter: [
          {
            anchor: 'merge',
            steps: [
              {
                id: 'acme-security-scan',
                kind: 'command',
                run: 'acme-scanner --sarif out.sarif',
                inline: false,
                gateEvidence: ['G-Verify'],
              },
            ],
          },
        ],
        $remove: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a bare steps array (the base-document form)', () => {
    const result = workflowOverlaySchema.safeParse({
      steps: [{ id: 'a', kind: 'command' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unrecognised operator key', () => {
    const result = workflowOverlaySchema.safeParse({ steps: { $insertBefore: [] } });
    expect(result.success).toBe(false);
  });

  it('rejects a step item with no id', () => {
    const result = workflowOverlaySchema.safeParse({ steps: { $append: [{ kind: 'command' }] } });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognised top-level field', () => {
    const result = workflowOverlaySchema.safeParse({ steps: [], extra: true });
    expect(result.success).toBe(false);
  });
});

const GATE_STEP: WorkflowStepSummary = { id: 'verify', kind: 'gate' };
const RED_STEP: WorkflowStepSummary = { id: 'generate-tests', kind: 'fanout', agent: 'sdet' };
const REVIEW_STEP: WorkflowStepSummary = { id: 'review', kind: 'fanout', agent: 'reviewer' };
const NESTED_RED_STEP: WorkflowStepSummary = {
  id: 'generate-tests',
  kind: 'fanout',
  step: { id: 'generate-tests-item', kind: 'agent', agent: 'sdet' },
};
const ORDINARY_STEP: WorkflowStepSummary = { id: 'prepare', kind: 'command' };
const BASE_STEPS = [GATE_STEP, RED_STEP, REVIEW_STEP, ORDINARY_STEP];

describe('checkWorkflowStepRemoval', () => {
  it('refuses removing a gate step', () => {
    const findings = checkWorkflowStepRemoval(BASE_STEPS, ['verify']);
    expect(findings).toContainEqual({
      severity: 'error',
      code: 'gate-step-removed',
      message: 'Step "verify" is a gate step and cannot be removed by an overlay.',
    });
  });

  it('refuses removing the red (test-first) step, identified by agent: sdet', () => {
    const findings = checkWorkflowStepRemoval(BASE_STEPS, ['generate-tests']);
    expect(findings).toContainEqual({
      severity: 'error',
      code: 'protected-step-removed',
      message:
        'Step "generate-tests" is the red (test-first) step and cannot be removed by an overlay.',
    });
  });

  it('refuses removing the review step, identified by agent: reviewer', () => {
    const findings = checkWorkflowStepRemoval(BASE_STEPS, ['review']);
    expect(findings).toContainEqual({
      severity: 'error',
      code: 'protected-step-removed',
      message: 'Step "review" is the review step and cannot be removed by an overlay.',
    });
  });

  it("resolves the red step agent through a fanout step's nested step", () => {
    const findings = checkWorkflowStepRemoval([NESTED_RED_STEP], ['generate-tests']);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('protected-step-removed');
  });

  it("gives a fanout step's nested agent priority over its own outer agent, so an unrelated outer agent cannot mask a protected nested reviewer/sdet", () => {
    const spoofedReview: WorkflowStepSummary = {
      id: 'review',
      kind: 'fanout',
      agent: 'architect',
      step: { id: 'review-item', kind: 'agent', agent: 'reviewer' },
    };
    const findings = checkWorkflowStepRemoval([spoofedReview], ['review']);
    expect(findings).toEqual([
      {
        severity: 'error',
        code: 'protected-step-removed',
        message: 'Step "review" is the review step and cannot be removed by an overlay.',
      },
    ]);
  });

  it("falls back to a fanout step's own outer agent when it has no nested step", () => {
    const outerOnly: WorkflowStepSummary = { id: 'review', kind: 'fanout', agent: 'reviewer' };
    const findings = checkWorkflowStepRemoval([outerOnly], ['review']);
    expect(findings).toHaveLength(1);
  });

  it('allows removing an ordinary step', () => {
    const findings = checkWorkflowStepRemoval(BASE_STEPS, ['prepare']);
    expect(findings).toEqual([]);
  });

  it('produces no findings when nothing in removedIds matches a base step', () => {
    const findings = checkWorkflowStepRemoval(BASE_STEPS, ['does-not-exist']);
    expect(findings).toEqual([]);
  });

  it('reports one finding per protected step removed, when several are named at once', () => {
    const findings = checkWorkflowStepRemoval(BASE_STEPS, ['verify', 'review', 'prepare']);
    expect(findings).toHaveLength(2);
  });
});

describe('applyInsertAfter', () => {
  const steps: readonly WorkflowStepSummary[] = [
    { id: 'prepare', kind: 'command' },
    { id: 'merge', kind: 'merge' },
    { id: 'verify', kind: 'gate' },
  ];

  it('inserts new steps immediately after the anchor without reordering anything else', () => {
    const result = applyInsertAfter(steps, [
      { anchor: 'merge', steps: [{ id: 'acme-security-scan', kind: 'command' }] },
    ]);
    expect(result.map((step) => step.id)).toEqual([
      'prepare',
      'merge',
      'acme-security-scan',
      'verify',
    ]);
  });

  it('applies multiple directives in order, later anchors seeing earlier insertions', () => {
    const result = applyInsertAfter(steps, [
      { anchor: 'prepare', steps: [{ id: 'a', kind: 'command' }] },
      { anchor: 'a', steps: [{ id: 'b', kind: 'command' }] },
    ]);
    expect(result.map((step) => step.id)).toEqual(['prepare', 'a', 'b', 'merge', 'verify']);
  });

  it('is a no-op for a directive whose anchor does not name an existing step', () => {
    const result = applyInsertAfter(steps, [
      { anchor: 'does-not-exist', steps: [{ id: 'x', kind: 'command' }] },
    ]);
    expect(result).toEqual(steps);
  });

  it('leaves the array unchanged when given no directives', () => {
    const result = applyInsertAfter(steps, []);
    expect(result).toEqual(steps);
  });

  it('applies two directives sharing the same anchor in LIFO order (documented, not spec-derived)', () => {
    const result = applyInsertAfter(steps, [
      { anchor: 'merge', steps: [{ id: 'p1', kind: 'command' }] },
      { anchor: 'merge', steps: [{ id: 'p2', kind: 'command' }] },
    ]);
    expect(result.map((step) => step.id)).toEqual(['prepare', 'merge', 'p2', 'p1', 'verify']);
  });
});

describe('checkInsertAfterAnchors', () => {
  const steps: readonly WorkflowStepSummary[] = [
    { id: 'prepare', kind: 'command' },
    { id: 'merge', kind: 'merge' },
    { id: 'verify', kind: 'gate' },
  ];

  it('produces no findings when every anchor resolves', () => {
    const findings = checkInsertAfterAnchors(steps, [
      { anchor: 'merge', steps: [{ id: 'x', kind: 'command' }] },
    ]);
    expect(findings).toEqual([]);
  });

  it('flags an anchor that does not name an existing step', () => {
    const findings = checkInsertAfterAnchors(steps, [
      { anchor: 'does-not-exist', steps: [{ id: 'x', kind: 'command' }] },
    ]);
    expect(findings).toEqual([
      {
        severity: 'error',
        code: 'insert-after-anchor-missing',
        message:
          '"$insertAfter" names anchor "does-not-exist", which does not name an existing step.',
      },
    ]);
  });

  it("sees an earlier directive's own insertion as a valid anchor for a later directive", () => {
    const findings = checkInsertAfterAnchors(steps, [
      { anchor: 'prepare', steps: [{ id: 'a', kind: 'command' }] },
      { anchor: 'a', steps: [{ id: 'b', kind: 'command' }] },
    ]);
    expect(findings).toEqual([]);
  });

  it('reports one finding per directive with a missing anchor, when several are given', () => {
    const findings = checkInsertAfterAnchors(steps, [
      { anchor: 'missing-1', steps: [{ id: 'x', kind: 'command' }] },
      { anchor: 'missing-2', steps: [{ id: 'y', kind: 'command' }] },
    ]);
    expect(findings).toHaveLength(2);
  });
});
