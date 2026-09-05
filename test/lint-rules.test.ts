/**
 * Proves the lint rules that carry `QUALITY-BAR.md`'s enforcement actually fire.
 *
 * Without this file the R10 rule block could be deleted entirely and `pnpm test` would stay green —
 * which is exactly what happened: two consecutive reviews found live holes in rules whose comments
 * claimed to close them (`globalThis.Math.random()`, `import proc from 'node:process'`,
 * `const { env } = process`, a detached `toLocaleString`). A rule with no test is a comment.
 *
 * Each case is a spelling a real contributor would plausibly write, linted through the repository's
 * own flat config, so these assert the shipped configuration rather than a copy of it.
 *
 * @see QUALITY-BAR.md R7, R10
 * @see PLAN-M1.md P1b
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Directory ESLint treats as production source. `eslint.config.js` exempts the test harness from R7
 * and R10, so a fixture written under `test/` would report nothing and every assertion in this file
 * would pass vacuously. `tools/lint-fixture` exists for this and nothing else; it carries its own
 * tsconfig so the type-aware rule set can resolve the file.
 *
 * The directory is named in `IGNORED_PATHS` in `test/workspace-floor.test.ts` and excluded by exact
 * path in `vitest.config.ts`. Those walks run in a sibling file, in parallel, and a fixture that
 * exists for the second or so of a lint call would otherwise surface there as a stray source file —
 * a race that fails a test which has nothing to do with linting. It is not the dot prefix that
 * protects it: excluding all dot-directories was tried and created a blind spot.
 */
const fixtureDir = path.join(repoRoot, 'tools', 'lint-fixture', '.fixtures');

/**
 * Nested under `fixtureDir` so its path matches the R11 path-concatenation rule's `**\/src/fs/**`
 * glob (`eslint.config.js`) — a case written at `fixtureDir`'s top level would not be scoped into
 * that rule at all, and every assertion below would pass while testing nothing.
 */
const fsFixtureDir = path.join(fixtureDir, 'src', 'fs');

// Remove only the transient case files; `.fixtures/placeholder.ts` is committed so this project
// always has a tsc input (see its header). Deleting the directory would take the placeholder with
// it and reintroduce the TS18003 race.
afterAll(() => {
  for (const extension of ['ts', 'mjs']) {
    rmSync(path.join(fixtureDir, `case.${extension}`), { force: true });
  }
  rmSync(path.join(fsFixtureDir, 'case.ts'), { force: true });
});

/**
 * Lints a snippet as production source and returns its messages.
 *
 * The snippet is written to disk and linted as a *file* rather than passed to `lintText` with a
 * synthetic path, because typescript-eslint's project service resolves a real path against a real
 * tsconfig; a path that does not exist on disk yields a parsing error and no rule ever runs.
 */
async function lintProductionSource(
  code: string,
  extension = 'ts',
  dir = fixtureDir,
): Promise<readonly string[]> {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `case.${extension}`);
  writeFileSync(file, code);
  try {
    const eslint = new ESLint({ cwd: repoRoot });
    const [result] = await eslint.lintFiles([file]);
    return (result?.messages ?? []).map(
      (message) => `${message.ruleId ?? 'none'}: ${message.message}`,
    );
  } finally {
    rmSync(file, { force: true });
  }
}

/** Asserts a snippet produces at least one message from `rule`. */
async function expectRuleFires(
  code: string,
  rule: string,
  extension = 'ts',
  dir = fixtureDir,
): Promise<void> {
  const messages = await lintProductionSource(code, extension, dir);
  expect(messages.filter((message) => message.startsWith(rule)).length).toBeGreaterThan(0);
}

describe('QUALITY-BAR.md R10 — the determinism rules fire on every spelling', () => {
  beforeAll(async () => {
    // Guards the whole file: if the fixture path were exempt, every case below would pass while
    // asserting nothing.
    const messages = await lintProductionSource('export const t = Date.now();\n');
    expect(messages.some((message) => message.startsWith('no-restricted-syntax'))).toBe(true);
  });

  it.each([
    ['Date.now', 'export const t = Date.now();\n'],
    ['aliased Date', 'const clock = Date;\nexport const t = clock.now();\n'],
    ['globalThis Date', 'export const t = globalThis.Date.now();\n'],
    ['performance.now', 'export const t = performance.now();\n'],
    ['new Date with no argument', 'export const d = new Date();\n'],
    ['Date called without new', 'export const stamp = (): string => Date();\n'],
    ['process.hrtime', 'export const t = process.hrtime.bigint();\n'],
    ['process.uptime', 'export const u = process.uptime();\n'],
    [
      'toLocaleString with an undefined locale',
      'export const s = (1).toLocaleString(undefined);\n',
    ],
    [
      'localeCompare with an undefined locale',
      'export function c(a: string, b: string): number {\n  return a.localeCompare(b, undefined);\n}\n',
    ],
    [
      'Intl with an undefined locale',
      "export const f = new Intl.NumberFormat(undefined, { style: 'decimal' });\n",
    ],
    ['Math.random', 'export const r = Math.random();\n'],
    ['globalThis Math.random', 'export const r = globalThis.Math.random();\n'],
    ['aliased Math', 'const m = Math;\nexport const r = m.random();\n'],
    ['globalThis crypto', 'export const id = globalThis.crypto.randomUUID();\n'],
    ['performance.timeOrigin', 'export const o = performance.timeOrigin;\n'],
    ['fs.opendirSync', "import fs from 'node:fs';\nexport const d = fs.opendirSync('.');\n"],
    ['os.homedir', "import os from 'node:os';\nexport const h = os.homedir();\n"],
    ['os.tmpdir', "import os from 'node:os';\nexport const t = os.tmpdir();\n"],
    ['crypto.getRandomValues', 'export const b = crypto.getRandomValues(new Uint8Array(1));\n'],
    ['process.env member', 'export const h = process.env.HOME;\n'],
    ['process.env destructured', 'const { env } = process;\nexport const h = env.HOME;\n'],
    ['process.env spread', 'export const e = { ...process.env };\n'],
    ['globalThis process.env', 'export const h = globalThis.process.env.HOME;\n'],
    ['readdir', "import fs from 'node:fs';\nexport const f = fs.readdirSync('.');\n"],
    ['localeCompare with no locale', "export const n = 'a'.localeCompare('b');\n"],
    ['toLocaleString with no locale', 'export const s = (1).toLocaleString();\n'],
    ['detached toLocaleString', 'const f = (1).toLocaleString;\nexport const s = f;\n'],
    ['Intl with no locale', 'export const f = new Intl.NumberFormat();\n'],
    ['aliased Intl', 'const I = Intl;\nexport const f = new I.NumberFormat();\n'],
    [
      'computed key on an ambient root',
      "const NOW = 'now' as const;\nexport const t: number = Date[NOW]();\n",
    ],
    [
      'computed key on process',
      "const ENV = 'env' as const;\nexport const h = process[ENV].HOME;\n",
    ],
  ])('flags %s', async (_name, code) => {
    await expectRuleFires(code, 'no-restricted-syntax');
  });

  it.each([
    [
      'default import of node:process',
      "import proc from 'node:process';\nexport const h = proc.env.HOME;\n",
    ],
    ['named env import', "import { env } from 'node:process';\nexport const h = env.HOME;\n"],
    [
      'randomUUID named import',
      "import { randomUUID } from 'node:crypto';\nexport const i = randomUUID();\n",
    ],
    [
      'readdir from fs/promises',
      "import { readdir } from 'node:fs/promises';\nexport const f = readdir;\n",
    ],
    ['bare builtin import', "import net from 'net';\nexport const c = net.connect;\n"],
    ['bare socket builtin', "import tls from 'tls';\nexport const c = tls.connect;\n"],
    ['node:test', "import { test } from 'node:test';\nexport const t = test;\n"],
  ])('flags %s', async (_name, code) => {
    await expectRuleFires(code, 'no-restricted-imports');
  });

  it('permits an explicit locale, so the rule constrains ambience rather than the API', async () => {
    const messages = await lintProductionSource(
      "export const n = 'a'.localeCompare('b', 'en');\nexport const s = (1).toLocaleString('en');\n",
    );
    expect(messages.filter((message) => message.startsWith('no-restricted-syntax'))).toEqual([]);
  });

  it('permits an injected clock, so the rule constrains ambience rather than time', async () => {
    const messages = await lintProductionSource(
      'export function stamp(clock: { now: () => number }): number {\n  return clock.now();\n}\n',
    );
    expect(messages.filter((message) => message.startsWith('no-restricted-syntax'))).toEqual([]);
  });
});

describe('QUALITY-BAR.md R11 — the path-concatenation rules fire under fs/**, on every spelling', () => {
  beforeAll(async () => {
    // Guards the whole block: if the fs-scoped glob in eslint.config.js stopped matching this
    // fixture's path, every case below would pass while asserting nothing — the exact failure mode
    // `test/lint-rules.test.ts`'s header describes for R10, now extended to R11.
    const messages = await lintProductionSource(
      "export function bad(dir: string, name: string): string {\n  return dir + '/' + name;\n}\n",
      'ts',
      fsFixtureDir,
    );
    expect(messages.some((message) => message.startsWith('no-restricted-syntax'))).toBe(true);
  });

  it.each([
    [
      'string concatenation with a literal that is exactly "/"',
      "export function f(dir: string, name: string): string {\n  return dir + '/' + name;\n}\n",
    ],
    [
      'string concatenation with a literal that only contains "/"',
      "export function f(dir: string, name: string): string {\n  return dir + 'sub/' + name;\n}\n",
    ],
    [
      'a joining template literal',
      'export function f(dir: string, name: string): string {\n  return `${dir}/${name}`;\n}\n',
    ],
    [
      'a joining template literal with extra text between placeholders',
      'export function f(dir: string, name: string): string {\n  return `${dir}/sub/${name}`;\n}\n',
    ],
    [
      "Array.prototype.join('/')",
      "export function f(parts: string[]): string {\n  return parts.join('/');\n}\n",
    ],
    [
      'String.prototype.concat with a "/" argument',
      "export function f(dir: string, name: string): string {\n  return ''.concat(dir, '/', name);\n}\n",
    ],
  ])('flags %s in fs/**', async (_name, code) => {
    await expectRuleFires(code, 'no-restricted-syntax', 'ts', fsFixtureDir);
  });

  it('does not flag a template literal with only a trailing separator, formatting one already-built value', async () => {
    // `${relativePosix.toLowerCase()}/` in paths.ts is not a join between two segments — it appends
    // one marker character to a single already-computed value, for a deny-list prefix comparison.
    const messages = await lintProductionSource(
      'export function isDenied(relativePosix: string): string {\n  return `${relativePosix.toLowerCase()}/`;\n}\n',
      'ts',
      fsFixtureDir,
    );
    expect(messages.filter((message) => message.startsWith('no-restricted-syntax'))).toEqual([]);
  });

  it("does not flag Array.prototype.join('/') reconstituting an already-node:path-built value", async () => {
    // `relative.split(path.sep).join('/')` (paths.ts's relativePosixWithin) reformats a path that
    // node:path already built into the POSIX-style string R11 itself calls for in a repo-relative
    // artifact ID — the opposite operation from assembling a path out of raw segments.
    const messages = await lintProductionSource(
      "export function f(relative: string, sep: string): string {\n  return relative.split(sep).join('/');\n}\n",
      'ts',
      fsFixtureDir,
    );
    expect(messages.filter((message) => message.startsWith('no-restricted-syntax'))).toEqual([]);
  });

  it('does not flag the same "/" concatenation outside fs/**, where it may be building a URL, not a disk path', async () => {
    const messages = await lintProductionSource(
      'export function f(base: string, id: string): string {\n  return `${base}/errors/${id}`;\n}\n',
    );
    expect(messages.filter((message) => message.startsWith('no-restricted-syntax'))).toEqual([]);
  });
});

describe('the limits of static detection are stated, not papered over', () => {
  it('cannot flag a locale that is undefined only at runtime, and does not pretend to', async () => {
    // `f(n, locale?: string) => n.toLocaleString(locale)` falls back to the host locale whenever the
    // caller omits the argument, but no lint rule can decide that statically. The literal spellings
    // above are caught; this one is a review matter. Asserting it here keeps the gap visible instead
    // of leaving a reader to assume the rule set is total.
    const messages = await lintProductionSource(
      'export function f(n: number, locale?: string): string {\n  return n.toLocaleString(locale);\n}\n',
    );
    expect(messages.filter((message) => message.startsWith('no-restricted-syntax'))).toEqual([]);
  });
});

describe('QUALITY-BAR.md R7 — unfinished work and coverage dodges are lint errors', () => {
  it.each([
    ['TODO', '// TODO: finish this\nexport const a = 1;\n'],
    ['FIXME', '// FIXME: broken\nexport const a = 1;\n'],
    ['v8 ignore', '/* v8 ignore next */\nexport const a = 1;\n'],
    ['istanbul ignore', '/* istanbul ignore next */\nexport const a = 1;\n'],
    ['c8 ignore', '/* c8 ignore start */\nexport const a = 1;\n'],
  ])('flags %s', async (_name, code) => {
    await expectRuleFires(code, 'no-warning-comments');
  });
});

describe('the rules apply to .mjs production source, not only .ts', () => {
  // `.mjs` is production source in `scripts/`, where `PLAN-M1.md` P2, P3 and P9 put the boundary
  // checker, the coverage ratchet and the schema emitter — and P9's mandate is byte-stable output
  // with no timestamps, which is exactly what the R10 clock rules protect. A blanket `**/*.mjs`
  // eslint exemption, added for the two harness files that must be plain ESM, switched every R10
  // rule off for it, and no case here could see that because they all hard-coded a `.ts` fixture.
  it.each([
    ['Date.now', 'export const t = Date.now();\n'],
    ['Math.random', 'export const r = Math.random();\n'],
    ['process.env', 'export const h = process.env.HOME;\n'],
    ['toLocaleString', 'export const s = (1).toLocaleString();\n'],
  ])('flags %s in a .mjs file', async (_name, code) => {
    await expectRuleFires(code, 'no-restricted-syntax', 'mjs');
  });

  it('flags a coverage-ignore pragma in a .mjs file', async () => {
    await expectRuleFires(
      '/* v8 ignore next */\nexport const a = 1;\n',
      'no-warning-comments',
      'mjs',
    );
  });
});

describe('the R10 rules reach every path that ships production code', () => {
  // Asserts the resolved *configuration* per path rather than linting a fixture, because the hole
  // being guarded against is a glob in `eslint.config.js` that exempts a whole directory — and a
  // fixture written elsewhere cannot see it. `scripts/` was exempted, un-exempted for `packages/`,
  // and then re-exempted one glob over; this is the check that would have caught the repeat.
  it.each([
    'scripts/check-boundaries.mjs',
    'scripts/emit-schemas.mjs',
    'packages/core/src/index.ts',
    'packages/core/src/helper.mjs',
    'tools/lint-fixture/.fixtures/case.ts',
  ])('keeps the determinism rules enabled for %s', async (file) => {
    const eslint = new ESLint({ cwd: repoRoot });
    const config = (await eslint.calculateConfigForFile(path.join(repoRoot, file))) as {
      rules?: Record<string, unknown[]>;
    };
    // calculateConfigForFile reports severity numerically: 2 is error, 0 is off.
    expect(config.rules?.['no-restricted-syntax']?.[0], `${file} must keep R10`).toBe(2);
    expect(config.rules?.['no-restricted-imports']?.[0], `${file} must keep R10`).toBe(2);
  });

  it.each(['test/network-guard.mjs', 'scripts/run-tests.mjs', 'test/setup.ts'])(
    'exempts the harness file %s, which pins the clock and the environment',
    async (file) => {
      const eslint = new ESLint({ cwd: repoRoot });
      const config = (await eslint.calculateConfigForFile(path.join(repoRoot, file))) as {
        rules?: Record<string, unknown[]>;
      };
      expect(config.rules?.['no-restricted-syntax']?.[0]).toBe(0);
    },
  );
});
