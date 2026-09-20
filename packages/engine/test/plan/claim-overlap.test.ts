/**
 * `claimsMayOverlap` — the one conservative file-claim overlap rule the stage run plan and
 * `forge spec validate --rule file-claim-overlap` (G-Ready, `09` §9.3 rule 4) share (`06` §6.2 rule 3).
 *
 * The contract is one-sided: it may over-report (two disjoint claims flagged) but must never miss a real
 * overlap, because a missed overlap lets two stories write the same files in parallel. The cases below
 * are exactly the ones the older `globsOverlap` (literal against pattern, both ways) answers `false` to.
 *
 * @see specs/06 §6.2
 * @see specs/09 §9.3
 * @see PLAN-M13.md P24
 */
import { describe, expect, it } from 'vitest';
import { minimatch } from 'minimatch';

import { claimsMayOverlap, globsOverlap } from '../../src/plan/index.ts';

describe('claimsMayOverlap — the known false negatives of globsOverlap', () => {
  it.each([
    ['src/auth', 'src/auth/login.ts'],
    ['src/**/*.ts', 'src/billing/**'],
    ['src/**/x.ts', 'src/a/**'],
    ['src/{a,b}/**', 'src/{b,c}/**'],
    ['{src,lib}/x.ts', 'lib/x.ts'],
    ['./src/a/**', 'src/a/**'],
    ['SRC/a/**', 'src/a/**'],
    ['**', '.github/ci.yml'],
    ['src/**', 'src/.hidden/x'],
    ['src/../lib/**', 'lib/a.ts'],
    ['src/a/..', 'src/b/x'],
    ['src/[ab]/**', 'src/a/x.ts'],
    ['src/auth/', 'src/auth/login.ts'],
    ['/src/auth', 'src/auth/login.ts'],
    ['src//auth/login.ts', 'src/auth/**'],
    ['src\\auth\\login.ts', 'src/auth/**'],
    ['!src/auth/**', 'src/auth/x.ts'],
    ['src/+(a|b)/x.ts', 'src/a/x.ts'],
    ['src/*/../../lib/x', 'lib/x'],
    ['src/a/../../lib/x', 'lib/x'],
    ['/repo/src/a', 'src/a'],
    ['C:\\repo\\src\\a', 'src/a'],
    ['caf\u00e9/x', 'cafe\u0301/x'],
    ['a/..\\lib/x', 'lib/x/y'],
    ['src/.. /lib/x', 'lib/x/y'],
    ['src/..\t/lib/x', 'lib/x/y'],
    ['src/auth./x', 'src/auth/x'],
    ['src/auth /x', 'src/auth/x'],
    ['c:foo/x', 'foo/x'],
    ['progra~1/x', 'program files/x'],
    ['', 'src/a.ts'],
    ['  src/a  ', 'src/a/b.ts'],
  ])('reports %j against %j as possibly overlapping, in both argument orders', (a, b) => {
    expect(claimsMayOverlap(a, b)).toBe(true);
    expect(claimsMayOverlap(b, a)).toBe(true);
  });

  it('is true for claims too long, or too bracket-heavy, for glob analysis (globsOverlap says false)', () => {
    const long = `src/${'a'.repeat(700)}`;
    expect(globsOverlap(`${long}/**`, `${long}/x.ts`)).toBe(false);
    expect(claimsMayOverlap(`${long}/**`, `${long}/x.ts`)).toBe(true);
    expect(claimsMayOverlap(`src/${'['.repeat(100)}/**`, 'src/x.ts')).toBe(true);
  });

  it('is true for an identical claim', () => {
    expect(claimsMayOverlap('src/a/x.ts', 'src/a/x.ts')).toBe(true);
  });
});

describe('claimsMayOverlap — claims that cannot share a file', () => {
  it.each([
    ['src/a/**', 'src/b/**'],
    ['src/auth', 'src/authz/x.ts'],
    ['src/foo.ts', 'src/foo.test.ts'],
    ['src/a/**', 'tests/a/**'],
    ['./src/a', 'src/b'],
    // ordinary directory names that contain @ ( ) + ~ are literal, not glob syntax
    ['packages/@acme/a/**', 'packages/@acme/b/**'],
    ['app/(shop)/cart/**', 'app/(shop)/checkout/**'],
    ['libs/c++/a', 'libs/c++/b'],
    ['src/~tmp/a', 'src/~tmp/b'],
  ])('leaves %j and %j disjoint', (a, b) => {
    expect(claimsMayOverlap(a, b)).toBe(false);
    expect(claimsMayOverlap(b, a)).toBe(false);
  });
});

describe('claimsMayOverlap — soundness over generated claims', () => {
  const SEGMENTS = ['src', 'a', 'b', 'x.ts', '*', '**', '{a,b}', '[ab]', 'A'];
  // Awkward segments are crossed with the plain ones at depth two, so the corpus stays small enough to compare
  // every pair against `minimatch`.
  const AWKWARD = [
    '..',
    '.',
    '?',
    '+(a|b)',
    '@(src|lib)',
    '!(a)',
    '*.ts',
    '\\a',
    '@acme',
    '(shop)',
    'c++',
    '~tmp',
  ];
  function claims(): readonly string[] {
    const out: string[] = [];
    for (const first of SEGMENTS) {
      out.push(first);
      for (const second of SEGMENTS) {
        out.push(`${first}/${second}`);
        for (const third of SEGMENTS) out.push(`${first}/${second}/${third}`);
      }
    }
    for (const odd of AWKWARD) {
      for (const first of SEGMENTS) {
        out.push(
          `${odd}/${first}`,
          `${first}/${odd}`,
          `${first}/${odd}/x.ts`,
          `${first}/*/${odd}/${odd}/x.ts`,
        );
      }
    }
    return out;
  }
  const PATHS = [
    'src/a/x.ts',
    'src/b/x.ts',
    'src/a/b/x.ts',
    'lib/a/x.ts',
    'lib/x.ts',
    'a/b/x.ts',
    'x.ts',
    'src/x.ts',
    'a/x.ts',
    'src/a/b/c/x.ts',
    'src/@acme/x.ts',
    'src/(shop)/x.ts',
    'src/c++/x.ts',
    'src/~tmp/x.ts',
    '@acme/x.ts',
  ];

  it('never says "disjoint" for two claims that match a common concrete file', () => {
    const all = claims();
    for (const a of all) {
      const matchesA = PATHS.filter((p) => minimatch(p, a, { nocase: true, dot: true }));
      if (matchesA.length === 0) continue;
      for (const b of all) {
        const shared = matchesA.some((p) => minimatch(p, b, { nocase: true, dot: true }));
        if (shared) expect(claimsMayOverlap(a, b), `${a} vs ${b}`).toBe(true);
      }
    }
  });

  it('is symmetric and deterministic', () => {
    const all = claims().slice(0, 300);
    for (const a of all) {
      for (const b of all.slice(0, 40)) {
        expect(claimsMayOverlap(a, b)).toBe(claimsMayOverlap(b, a));
        expect(claimsMayOverlap(a, b)).toBe(claimsMayOverlap(a, b));
      }
    }
  });
});
