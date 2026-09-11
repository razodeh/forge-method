/**
 * `<DiffView>` -- `04` §4.5's own unified-diff renderer: syntax-agnostic add/remove/context colouring,
 * hunk folding beyond a configurable threshold.
 *
 * The fixture (`test/fixtures/sample.diff`) is a real, `git diff --no-index`-captured unified diff
 * against two genuine versions of a file in this repo, frozen to disk rather than built inline --
 * `PLAN-M9.md` P4's own Checks call for exactly this ("captured from an actual `git diff` in this repo,
 * fixture-frozen"). It has three real hunks: a 1-line change (1 add/1 remove), an 11-line hunk (5 pure
 * additions), and a 43-line hunk (25 adds/12 removes) deliberately large enough to exceed the default
 * fold threshold.
 *
 * @see specs/04 §4.1, §4.5
 * @see PLAN-M9.md P4
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import { DiffView, parseUnifiedDiff } from '../../src/components/diff-view.tsx';

const FIXTURE_PATH = path.join(import.meta.dirname, '..', 'fixtures', 'sample.diff');
const SAMPLE_DIFF = readFileSync(FIXTURE_PATH, 'utf8');

describe('parseUnifiedDiff', () => {
  it('parses the real, fixture-frozen multi-hunk diff into exactly 3 hunks with the correct add/remove counts', () => {
    const hunks = parseUnifiedDiff(SAMPLE_DIFF);
    expect(hunks).toHaveLength(3);

    expect(hunks[0]?.header).toBe('@@ -1,5 +1,5 @@');
    expect(hunks[0]?.addCount).toBe(1);
    expect(hunks[0]?.removeCount).toBe(1);
    expect(hunks[0]?.lines).toHaveLength(6);

    expect(hunks[1]?.header).toBe('@@ -28,6 +28,11 @@');
    expect(hunks[1]?.addCount).toBe(5);
    expect(hunks[1]?.removeCount).toBe(0);
    expect(hunks[1]?.lines).toHaveLength(11);

    expect(hunks[2]?.header).toBe(
      '@@ -48,18 +53,31 @@ export type TreeChildren = readonly TreeNode[] | (() => Promise<readonly TreeNod',
    );
    expect(hunks[2]?.addCount).toBe(25);
    expect(hunks[2]?.removeCount).toBe(12);
    expect(hunks[2]?.lines).toHaveLength(43);
  });

  it('ignores diff --git/index/---/+++ file-header lines entirely', () => {
    const hunks = parseUnifiedDiff(SAMPLE_DIFF);
    const allText = hunks.flatMap((hunk) => hunk.lines.map((line) => line.text)).join('\n');
    expect(allText).not.toContain('diff --git');
    expect(allText).not.toContain('index 7c62a4b');
  });

  it('an empty patch parses to zero hunks', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  it('a patch with no hunk headers at all (e.g. a rename-only diff) parses to zero hunks', () => {
    expect(parseUnifiedDiff('diff --git a/old.ts b/new.ts\nsimilarity index 100%\n')).toEqual([]);
  });
});

describe('DiffView', () => {
  it('renders every hunk header and its own real add/remove line count is reflected in the rendered content', () => {
    const { lastFrame } = render(<DiffView patch={SAMPLE_DIFF} mode={{ color: false }} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('@@ -1,5 +1,5 @@');
    expect(frame).toContain('@@ -28,6 +28,11 @@');
    expect(frame).toContain('@@ -48,18 +53,31 @@');
  });

  it('a small hunk (below the fold threshold) renders every one of its own lines in full, with the real +/- prefix', () => {
    // Short fragments only: the fake terminal (100 columns) word-wraps this fixture's own long
    // doc-comment lines mid-string, so a long expected literal would never match regardless of
    // correctness -- these are the short lines the fixture was built to also cover for exactly this.
    const { lastFrame } = render(<DiffView patch={SAMPLE_DIFF} mode={{ color: false }} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('+// fixture-added line 1');
    expect(frame).toContain('+// fixture-added line 5');
  });

  it('a hunk beyond the folding threshold renders collapsed with an expand affordance, not its own full content', () => {
    const { lastFrame } = render(<DiffView patch={SAMPLE_DIFF} mode={{ color: false }} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).not.toContain('fixture-replacement line 1');
    expect(frame).toContain('43 lines folded (+25 -12)');
  });

  it('a caller-supplied foldThreshold changes which hunks fold', () => {
    // At the default threshold (20), the 11-line hunk renders in full -- below the bound.
    const atDefault = render(<DiffView patch={SAMPLE_DIFF} mode={{ color: false }} />);
    expect(stripAnsi(atDefault.lastFrame() ?? '')).toContain('+// fixture-added line 1');

    // A threshold of 3 forces that same, otherwise-unfolded 11-line hunk to fold too, proving the
    // prop is actually read on every hunk, not merely applied to whichever one happens to exceed the
    // hard-coded default.
    const withLowThreshold = render(
      <DiffView patch={SAMPLE_DIFF} mode={{ color: false }} foldThreshold={3} />,
    );
    const frame = stripAnsi(withLowThreshold.lastFrame() ?? '');
    expect(frame).not.toContain('fixture-added line 1');
    expect(frame).toContain('11 lines folded (+5 -0)');
  });

  it('expandedHunks forces a specific folded hunk open, by index', () => {
    const { lastFrame } = render(
      <DiffView patch={SAMPLE_DIFF} mode={{ color: false }} expandedHunks={new Set([2])} />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('fixture-replacement line 1');
    expect(frame).not.toContain('43 lines folded');
  });

  it('an empty patch renders nothing', () => {
    const { lastFrame } = render(<DiffView patch="" mode={{ color: false }} />);
    expect(lastFrame()).toBe('');
  });

  it('color: true and color: false render identical text once ANSI codes are stripped', () => {
    const colored = render(<DiffView patch={SAMPLE_DIFF} mode={{ color: true }} />);
    const plain = render(<DiffView patch={SAMPLE_DIFF} mode={{ color: false }} />);
    expect(stripAnsi(colored.lastFrame() ?? '')).toBe(stripAnsi(plain.lastFrame() ?? ''));
  });
});
