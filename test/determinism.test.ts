/**
 * Enforces the determinism preconditions `specs/21` §21.1 makes mandatory for the whole suite.
 * These assert the environment every other test inherits, so they live at the root.
 *
 * The assertions here deliberately avoid reading back the environment variable that `test/setup.ts`
 * just wrote — `expect(process.env.TZ).toBe('UTC')` cannot fail independently of the line that sets
 * it. Each test below observes a *consequence* instead: how a date renders, what bytes git produces.
 *
 * Network denial has its own suite in `test/network-guard.test.ts`.
 *
 * @see specs/21 §21.1
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';

describe('specs/21 §21.1 — fixed timezone and locale', () => {
  it('formats a date in UTC, so a machine in another zone produces identical output', () => {
    expect(new Date('2026-03-04T23:30:00.000Z').toString()).toContain('GMT+0000');
    expect(new Date('2026-03-04T23:30:00.000Z').getHours()).toBe(23);
  });

  it('reports UTC as the resolved Intl timezone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  });

  it('orders identically on any host when the locale is explicit', () => {
    // The previous version of this test compared ['b','A','a','B'] with a bare `localeCompare`,
    // whose ordering happens to be the same in every realistic locale — it passed under
    // LC_ALL=sv_SE and proved nothing. 'ä' vs 'z' is the case that actually differs: en-US orders
    // ä before z, sv-SE orders it after. Naming the locale makes the result host-independent, which
    // is the discipline eslint enforces on production code (SPEC-QUESTIONS.md Q7).
    const swedish = new Intl.Collator('sv').compare('ä', 'z');
    const english = new Intl.Collator('en').compare('ä', 'z');
    expect(english).toBeLessThan(0);
    expect(swedish).toBeGreaterThan(0);
  });
});

describe('specs/21 §21.1 — git is pinned to reproducible bytes', () => {
  it('produces a fixed commit SHA, proving identity, dates and gitconfig are all controlled', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'forge-git-'));
    onTestFinished(() => {
      rmSync(repo, { recursive: true, force: true });
    });
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

    // `--initial-branch` needs git >= 2.28; without the guard an old git fails this test with an
    // unrelated message that points nowhere near the real problem.
    const version = /(\d+)\.(\d+)/.exec(git('--version'));
    expect(version, 'could not parse git version').not.toBeNull();
    const [major, minor] = [Number(version?.[1]), Number(version?.[2])];
    expect(major * 100 + minor, 'git >= 2.28 required for --initial-branch').toBeGreaterThanOrEqual(
      228,
    );

    git('init', '--quiet', '--initial-branch', 'main');
    writeFileSync(path.join(repo, 'a.txt'), 'forge\n');
    git('add', 'a.txt');
    git('commit', '--quiet', '--no-gpg-sign', '--message', 'seed');

    // A single assertion that catches every uncontrolled input at once: a different author,
    // committer, date, line-ending conversion or default branch changes this hash.
    expect(git('rev-parse', 'HEAD')).toBe('c46b38bc9538c9a3edb98bfb367ddaedf3a42731');
  });
});
