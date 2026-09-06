/**
 * `checkSelfReview` (I1), `checkTestImplementationSeparation` (I2) — `15` §15.10's
 * separation-of-duties invariants.
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 */
import { describe, expect, it } from 'vitest';

import {
  checkSelfReview,
  checkTestImplementationSeparation,
} from '../../src/invariants/separation.ts';

describe('checkSelfReview (I1)', () => {
  it('refuses an agent reviewing its own output', () => {
    const violations = checkSelfReview([
      {
        outputId: 'STORY-014',
        producerAgent: 'backend-agent',
        reviewerAgent: 'backend-agent',
        reviewerRole: 'reviewer',
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.id).toBe('I1');
    expect(violations[0]?.code).toBe('CFG-501');
    expect(violations[0]?.message).toContain('reviewer');
  });

  it('allows a different agent reviewing the output', () => {
    const violations = checkSelfReview([
      {
        outputId: 'STORY-014',
        producerAgent: 'backend-agent',
        reviewerAgent: 'reviewer-agent',
        reviewerRole: 'reviewer',
      },
    ]);
    expect(violations).toEqual([]);
  });

  it("refuses a test-architect reviewing its own prior output, matching 05 §5.2's own four-role list", () => {
    const violations = checkSelfReview([
      {
        outputId: 'STORY-014',
        producerAgent: 'x',
        reviewerAgent: 'x',
        reviewerRole: 'test-architect',
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('CFG-501');
  });

  it('refuses self-diagnosis and self-critique the same way as self-review', () => {
    for (const reviewerRole of ['critic', 'diagnostician'] as const) {
      const violations = checkSelfReview([
        { outputId: 'STORY-014', producerAgent: 'x', reviewerAgent: 'x', reviewerRole },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.code).toBe('CFG-501');
    }
  });

  it('reports one violation per self-reviewed output, when several are given', () => {
    const violations = checkSelfReview([
      { outputId: 'A', producerAgent: 'x', reviewerAgent: 'x', reviewerRole: 'reviewer' },
      { outputId: 'B', producerAgent: 'y', reviewerAgent: 'z', reviewerRole: 'reviewer' },
      { outputId: 'C', producerAgent: 'w', reviewerAgent: 'w', reviewerRole: 'critic' },
    ]);
    expect(violations).toHaveLength(2);
  });
});

describe('checkTestImplementationSeparation (I2)', () => {
  it('refuses the same agent authoring tests and implementing', () => {
    const violations = checkTestImplementationSeparation([
      {
        storyId: 'STORY-014',
        testAuthorAgent: 'backend-agent',
        implementerAgent: 'backend-agent',
        implementerFileOwnership: ['src/foo.ts'],
        testPaths: ['test/foo.test.ts'],
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.id).toBe('I2');
    expect(violations[0]?.code).toBe('CFG-502');
    expect(violations[0]?.message).toContain('STORY-014');
  });

  it('refuses an implementer whose file_ownership covers a real test path', () => {
    const violations = checkTestImplementationSeparation([
      {
        storyId: 'STORY-014',
        testAuthorAgent: 'sdet-agent',
        implementerAgent: 'backend-agent',
        implementerFileOwnership: ['src/foo.ts', 'test/foo.test.ts'],
        testPaths: ['test/foo.test.ts'],
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('CFG-502');
  });

  it('allows disjoint agents with disjoint file ownership', () => {
    const violations = checkTestImplementationSeparation([
      {
        storyId: 'STORY-014',
        testAuthorAgent: 'sdet-agent',
        implementerAgent: 'backend-agent',
        implementerFileOwnership: ['src/foo.ts'],
        testPaths: ['test/foo.test.ts'],
      },
    ]);
    expect(violations).toEqual([]);
  });

  it('reports both triggers when both fire for the same story', () => {
    const violations = checkTestImplementationSeparation([
      {
        storyId: 'STORY-014',
        testAuthorAgent: 'x',
        implementerAgent: 'x',
        implementerFileOwnership: ['test/foo.test.ts'],
        testPaths: ['test/foo.test.ts'],
      },
    ]);
    // The same-agent trigger short-circuits (continue) before the file_ownership check for that
    // story — only one finding per story from the same-agent branch, not a double report.
    expect(violations).toHaveLength(1);
  });

  it("refuses an implementer whose glob file_ownership genuinely covers a test path (15 §15.3.1's own worked shape)", () => {
    const violations = checkTestImplementationSeparation([
      {
        storyId: 'STORY-014',
        testAuthorAgent: 'sdet-agent',
        implementerAgent: 'backend-agent',
        implementerFileOwnership: ['src/api/**'],
        testPaths: ['src/api/__tests__/handler.test.ts'],
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('CFG-502');
    expect(violations[0]?.message).toContain('src/api/**');
  });

  it('does not flag a glob that does not actually cover the test path', () => {
    const violations = checkTestImplementationSeparation([
      {
        storyId: 'STORY-014',
        testAuthorAgent: 'sdet-agent',
        implementerAgent: 'backend-agent',
        implementerFileOwnership: ['src/ui/**'],
        testPaths: ['src/api/__tests__/handler.test.ts'],
      },
    ]);
    expect(violations).toEqual([]);
  });

  it('does not flag an implementer owning a file that merely resembles a test path by name only', () => {
    const violations = checkTestImplementationSeparation([
      {
        storyId: 'STORY-014',
        testAuthorAgent: 'sdet-agent',
        implementerAgent: 'backend-agent',
        implementerFileOwnership: ['src/foo.test-helpers.ts'],
        testPaths: ['test/foo.test.ts'],
      },
    ]);
    expect(violations).toEqual([]);
  });
});
