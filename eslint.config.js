// @ts-check
/**
 * Flat ESLint configuration (`specs/02` §2.1 pins eslint 9 flat config).
 *
 * The rules here are the ones the quality bar can be failed on mechanically — `any`, unchecked
 * assertions, unhandled promises, non-`node:` builtin imports. Style is delegated entirely to
 * prettier via `eslint-config-prettier`, so a formatting disagreement can never be reported as a
 * lint error and mask a real one.
 */
import { builtinModules } from 'node:module';

import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

import forgeBoundaries from './tools/eslint-plugin-forge-boundaries/src/index.mjs';

/**
 * Node builtins that must be imported with the `node:` prefix. Derived from the running Node so the
 * list cannot drift out of date or omit a module by oversight.
 */
/**
 * Randomness sources forbidden by R10. Declared once and used by *both* the import ban and the
 * member-expression selector: the two lists were maintained separately and drifted, leaving
 * `import { randomFillSync } from 'node:crypto'` legal because a bare named call forms no member
 * expression for the selector to match.
 */
const RANDOM_NAMES = [
  'randomUUID',
  'randomBytes',
  'randomFill',
  'randomFillSync',
  'getRandomValues',
  'randomInt',
  'webcrypto',
];

/** Host facts forbidden by R10, shared between the same two routes for the same reason. */
const HOST_FACT_NAMES = ['homedir', 'tmpdir', 'hostname', 'userInfo', 'networkInterfaces'];

/** Unordered directory listings forbidden by R10, shared between the same two routes. */
const LISTING_NAMES = ['readdir', 'readdirSync', 'opendir', 'opendirSync', 'glob', 'globSync'];

const BARE_BUILTINS = builtinModules.filter(
  (name) => !name.startsWith('node:') && !name.startsWith('_'),
);

/**
 * QUALITY-BAR.md R10: determinism. A clock, a random source or an environment read that is not
 * injected makes behaviour depend on the machine it runs on. The config layer and the test harness
 * are exempted below; nothing else is. Extracted to a const (rather than written inline in the rules
 * object) so `no-restricted-syntax` can be reused as-is by the `fs/**` block below: flat config
 * replaces a rule's value entirely for an overlapping file rather than merging it, so a file-scoped
 * addition has to restate the whole array or lose every selector here for files under `fs/**`.
 */
const DETERMINISM_SYNTAX_RULES = [
  // Each selector names an ambient *root* rather than a property name. Property-name-only
  // selectors were tried and rejected: `MemberExpression[property.name='now']` flags
  // `clock.now()` — the injected-clock pattern R10 exists to encourage — and
  // `[property.name='env']` flags any `config.env`. Aliasing is closed separately, by
  // forbidding the alias itself, so precision here costs no coverage.
  {
    selector:
      "MemberExpression[object.name='Date'][property.name='now'], MemberExpression[object.property.name='Date'][property.name='now']",
    message: 'R10: take the time from an injected clock, not Date.now().',
  },
  {
    // Both `new Date()` and `Date()` — the call form omits `new` and reads the same wall clock.
    selector:
      'NewExpression[callee.name="Date"][arguments.length=0], CallExpression[callee.name="Date"][arguments.length=0]',
    message: 'R10: take the time from an injected clock, not new Date().',
  },
  {
    // `process` is a global, so the node:process import ban does not reach these; they are
    // ambient clocks exactly as much as Date.now is.
    selector:
      "MemberExpression[object.name='process'][property.name=/^(hrtime|uptime)$/], MemberExpression[object.property.name='process'][property.name=/^(hrtime|uptime)$/]",
    message: 'R10: take the time from an injected clock, not process.hrtime/uptime.',
  },
  {
    selector:
      "MemberExpression[object.name='performance'][property.name=/^(now|timeOrigin)$/], MemberExpression[object.property.name='performance'][property.name=/^(now|timeOrigin)$/]",
    message: 'R10: take the time from an injected clock, not performance.now().',
  },
  {
    selector:
      "MemberExpression[object.name='Math'][property.name='random'], MemberExpression[object.property.name='Math'][property.name='random']",
    message: 'R10: use a seeded RNG, not Math.random().',
  },
  {
    // Property-name only. Root-precise selectors were defeated by an import rename
    // (`import nodeCrypto from 'node:crypto'`) and by `webcrypto`, and these names collide
    // with nothing else worth writing.
    selector: `MemberExpression[property.name=/^(${RANDOM_NAMES.join('|')})$/]`,
    message: 'R10: use a seeded RNG, not crypto randomness.',
  },
  {
    selector:
      "MemberExpression[object.name='process'][property.name='env'], MemberExpression[object.property.name='process'][property.name='env']",
    message: 'R10: read configuration through the config layer, not process.env directly.',
  },
  {
    // `const { env } = process` reaches the same object without ever forming
    // `process.env` as a member expression.
    selector: "VariableDeclarator[init.name='process'] > ObjectPattern > Property[key.name='env']",
    message: 'R10: read configuration through the config layer, not process.env directly.',
  },
  {
    // Host facts — home directory, temp directory, hostname, network interfaces — differ per
    // machine exactly as a clock does, and no rule covered them at all.
    // Property-name only, and paired with an import ban below. Root-precise selectors were
    // defeated by `import { tmpdir } from 'node:os'` and by a namespace import — the exact
    // lesson this config already records for node:crypto and then failed to apply here. These
    // names collide with nothing else worth writing.
    selector: `MemberExpression[property.name=/^(${HOST_FACT_NAMES.join('|')})$/]`,
    message: 'R10: host facts vary by machine; take them from the config layer.',
  },
  {
    // Closes every alias route at the source: with the roots un-aliasable, the precise
    // selectors above cannot be sidestepped by `const m = Math` or `const clock = Date`.
    selector:
      'VariableDeclarator[init.name=/^(Date|Math|crypto|process|performance|Intl)$/], VariableDeclarator[init.property.name=/^(Date|Math|crypto|process|performance|Intl)$/]',
    message: 'R10: do not alias an ambient global; inject a clock, a seeded RNG or config instead.',
  },
  {
    // A computed key (`Date[NOW]()`) sidesteps every `property.name` selector above, and
    // `@typescript-eslint/dot-notation` only rescues *literal* keys. Forbidding a computed
    // member on these roots closes the last spelling.
    selector:
      'MemberExpression[computed=true][object.name=/^(Date|Math|crypto|process|performance)$/]',
    message:
      'R10: do not reach an ambient global through a computed key; inject a clock, a seeded RNG or config.',
  },
  {
    // `opendir` and `glob` return entries in the same unordered fashion as `readdir`.
    selector: `MemberExpression[property.name=/^(${LISTING_NAMES.join('|')})$/]`,
    message:
      'R10: directory listings are unordered; sort explicitly via @forge/core/fs listDirSorted.',
  },
  {
    // R10: ambient locale. ICU resolves the default locale from the host environment, so a
    // call with no explicit locale produces different output on a different machine. Matching
    // the member expression rather than the call also catches a detached method reference.
    selector:
      'MemberExpression[property.name=/^toLocale(String|DateString|TimeString|UpperCase|LowerCase)$/]:not(CallExpression[arguments.length>0] > MemberExpression)',
    message: 'R10: pass an explicit locale; the default comes from the host environment.',
  },
  {
    // `localeCompare` takes the compared string first, so its locale argument is the second:
    // a zero-argument test misses `a.localeCompare(b)`, the spelling that actually appears.
    selector: 'CallExpression[callee.property.name="localeCompare"][arguments.length<2]',
    message: 'R10: pass an explicit locale; the default comes from the host environment.',
  },
  {
    selector:
      "NewExpression[callee.object.name='Intl'][arguments.length=0], CallExpression[callee.object.name='Intl'][arguments.length=0]",
    message: 'R10: pass an explicit locale to Intl; the default comes from the host.',
  },
  {
    // Argument *count* is not a proxy for "an explicit locale": passing `undefined` — which is
    // what an optional `locale?: string` parameter yields — falls back to the host locale just
    // as an omitted argument does. This is the spelling most likely to reach production.
    selector:
      'CallExpression[callee.property.name=/^(toLocale|localeCompare)/] > Identifier.arguments[name="undefined"], NewExpression[callee.object.name="Intl"] > Identifier.arguments[name="undefined"], CallExpression[callee.object.name="Intl"] > Identifier.arguments[name="undefined"]',
    message: 'R10: an undefined locale falls back to the host locale; pass a real locale string.',
  },
];

/**
 * QUALITY-BAR.md R11: cross-platform correctness — disk paths are composed with `node:path`, never
 * by concatenating a literal `/` separator, which is wrong on Windows. Not folded into
 * `DETERMINISM_SYNTAX_RULES` above: that array applies everywhere, and a global ban on `'/'` in a
 * template literal would flag `@forge/core/errors`' `docsUrlFor`, which builds a URL — always
 * forward-slash, on every platform — not a disk path. Scoped instead to the one place a literal `/`
 * concatenation is actually a disk-path bug: `@forge/core/fs` and any future package's own `fs/`
 * subdirectory (`PLAN-M1.md` P4's Checks).
 */
const PATH_CONCAT_SYNTAX_RULES = [
  ...DETERMINISM_SYNTAX_RULES,
  {
    // `left + '/sub'` and `'/sub' + right` are each their own BinaryExpression node, so this catches
    // every position in a chain like `dir + '/' + file` without needing to match the whole chain at
    // once. Matches a literal *containing* a slash, not only a literal that is exactly `/`: `dir +
    // 'sub/' + name` is exactly as much a disk-path bug as `dir + '/' + name`, and an exact-match
    // selector missed it (found by review; verified no legitimate fs/** code concatenates a slash
    // into a string with `+` for a non-path reason, unlike the template-literal case below).
    selector:
      "BinaryExpression[operator='+'][left.value=/\\//], BinaryExpression[operator='+'][right.value=/\\//]",
    message:
      'R11: build disk paths with node:path (path.join/path.resolve), not string concatenation.',
  },
  {
    // A join between two placeholders (`${a}/${b}`, `${a}/sub/${b}`) or a leading separator
    // (`/${a}`) is a TemplateElement whose raw text contains `/` and whose `tail` is false — there is
    // an expression after it, which is what makes this a *join* rather than formatting one
    // already-built value. `tail: true` (trailing text with nothing after it, as in
    // `` `${relPosix}/` `` for a deny-list prefix check) is not a join and stays excluded: an
    // exact-equality version of this selector flagged that real, correct code before this rule was
    // narrowed to `tail`, and a substring version needs the same guard for the same reason.
    selector: 'TemplateElement[value.raw=/\\//][tail=false]',
    message:
      'R11: build disk paths with node:path (path.join/path.resolve), not a template literal.',
  },
  {
    // `segments.join('/')` builds a disk path exactly as much as `+` concatenation does, and an
    // array-of-segments-plus-join is a common alternative spelling of the same bug. Excludes
    // `x.split(path.sep).join('/')`: that is the sanctioned way to turn an already-`node:path`-built
    // disk path into the POSIX-style string R11 itself calls for in a repo-relative artifact ID
    // (`relativePosixWithin` in `paths.ts` does exactly this) — reformatting an existing path's
    // separators is not the same operation as assembling one from raw segments.
    selector:
      "CallExpression[callee.property.name='join']:not([callee.object.callee.property.name='split']) > Literal[value='/'].arguments",
    message: "R11: build disk paths with node:path (path.join), not Array.prototype.join('/').",
  },
  {
    // `''.concat(dir, '/', name)` — rare in modern code, but named explicitly in review as a spelling
    // the two selectors above do not reach: neither a BinaryExpression nor a TemplateElement.
    selector: "CallExpression[callee.property.name='concat'] > Literal[value=/\\//].arguments",
    message: 'R11: build disk paths with node:path (path.join), not String.prototype.concat.',
  },
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.turbo/**', 'fixtures/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // QUALITY-BAR.md R1: no imprecise types on any surface.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      // QUALITY-BAR.md R7: nothing unfinished reaches a commit.
      // The coverage-ignore pragmas are here because QUALITY-BAR.md §3 names adding one as a review
      // failure in itself — and a pragma is invisible to every other check, since it makes the
      // coverage report say 100%.
      'no-warning-comments': [
        'error',
        {
          terms: [
            'todo',
            'fixme',
            'xxx',
            'hack',
            'v8 ignore',
            'c8 ignore',
            'istanbul ignore',
            'node:coverage',
          ],
          location: 'anywhere',
        },
      ],

      // specs/02 §2.1: ESM only, node: protocol so a userland shadow cannot hijack a builtin. The
      // list is derived from the running Node rather than hand-typed, because a hand-typed list
      // silently omitted net/tls/dns/http2 — the four builtins that open sockets.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:test',
              message: 'specs/02 §2.1: node:test is not used; tests are written with vitest.',
            },
            {
              // The member-expression selector below misses `import { randomUUID }`, which is the
              // more common spelling; both routes have to be closed for R10 to mean anything.
              name: 'node:crypto',
              importNames: RANDOM_NAMES,
              message: 'R10: use a seeded RNG, not crypto randomness.',
            },
            {
              name: 'node:perf_hooks',
              importNames: ['performance'],
              message: 'R10: take the time from an injected clock, not perf_hooks.',
            },
            {
              name: 'node:os',
              importNames: HOST_FACT_NAMES,
              message: 'R10: host facts vary by machine; take them from the config layer.',
            },
            {
              name: 'node:fs/promises',
              importNames: LISTING_NAMES,
              message:
                'R10: directory listings are unordered; sort explicitly via @forge/core/fs listDirSorted.',
            },
            {
              name: 'node:fs',
              importNames: ['readdir', 'readdirSync', 'opendir', 'opendirSync', 'glob', 'globSync'],
              message:
                'R10: directory listings are unordered; sort explicitly via @forge/core/fs listDirSorted.',
            },
            {
              // The whole module, not just the named `env` export: a default import
              // (`import proc from 'node:process'`) reaches `proc.env` and bypassed the named ban
              // entirely. Production code has no reason to import it at all.
              name: 'node:process',
              message: 'R10: read configuration through the config layer, not node:process.',
            },
          ],
          patterns: [
            {
              regex: `^(${BARE_BUILTINS.join('|')})(/.*)?$`,
              message: 'Import Node builtins with the node: protocol (specs/02 §2.1).',
            },
          ],
        },
      ],

      // QUALITY-BAR.md R10: determinism. A clock, a random source or an environment read that is
      // not injected makes behaviour depend on the machine it runs on. The config layer and the
      // test harness are exempted below; nothing else is.
      'no-restricted-syntax': ['error', ...DETERMINISM_SYNTAX_RULES],

      // Failure handling: an ignored rejection is a silent failure path (QUALITY-BAR.md R6).
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-console': 'error',
    },
  },
  {
    // QUALITY-BAR.md R11 / PLAN-M1.md P4: disk-path composition. See PATH_CONCAT_SYNTAX_RULES above
    // for why this cannot just add a selector to the global block's `no-restricted-syntax`. Matched
    // by directory name rather than anchored to `packages/*/`, so a package under `modules/` gets the
    // same protection without a second glob added later — and so `test/lint-rules.test.ts` can prove
    // this rule fires using a fixture nested at `tools/lint-fixture/.fixtures/src/fs/`, the same way
    // every other rule in this file is proven against a real, lint-checked file rather than trusted
    // by inspection.
    files: ['**/src/fs/**/*.ts', '**/src/**/fs/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...PATH_CONCAT_SYNTAX_RULES],
    },
  },
  {
    // `@forge/core`'s own `Clock` interface (`PLAN-M1.md` P13) is the injected-clock boundary R10
    // asks every other production file to consume instead of reaching for `Date` directly — so this
    // one file has to read the real wall clock somewhere. Narrowly by name, not `packages/core/**`:
    // a package-wide exemption would switch the rule off for every other file R10 actually governs.
    files: ['**/src/clock.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // `createSystemTempPath` (`PLAN-M8.md` P3) is the identical injected-boundary split
    // `clock.ts` above already establishes, for "a real OS temp path" instead of "now" —
    // `runAndNormalize`'s pytest branch takes it as an injected function; this is the one file that
    // reads `crypto.randomUUID()`/`os.tmpdir()` directly. Narrowly by name, not by directory, and
    // narrowed to *just* the two entries this file actually needs off (a fresh critic round found
    // the first draft turned the whole rule off here, silently also lifting the `node:test`/
    // `node:process`/directory-listing/bare-builtin bans this file has no reason to need lifted).
    files: ['**/src/commands/loop/test/system-temp.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:test',
              message: 'specs/02 §2.1: node:test is not used; tests are written with vitest.',
            },
            {
              name: 'node:perf_hooks',
              importNames: ['performance'],
              message: 'R10: take the time from an injected clock, not perf_hooks.',
            },
            {
              name: 'node:fs/promises',
              importNames: LISTING_NAMES,
              message:
                'R10: directory listings are unordered; sort explicitly via @forge/core/fs listDirSorted.',
            },
            {
              name: 'node:fs',
              importNames: ['readdir', 'readdirSync', 'opendir', 'opendirSync', 'glob', 'globSync'],
              message:
                'R10: directory listings are unordered; sort explicitly via @forge/core/fs listDirSorted.',
            },
            {
              name: 'node:process',
              message: 'R10: read configuration through the config layer, not node:process.',
            },
          ],
          patterns: [
            {
              regex: `^(${BARE_BUILTINS.join('|')})(/.*)?$`,
              message: 'Import Node builtins with the node: protocol (specs/02 §2.1).',
            },
          ],
        },
      ],
    },
  },
  {
    // The test harness and the launcher are the layer that *pins* the clock, the locale and the
    // environment, so they are the one place that must read and write them directly, and the one
    // place that lists directories before @forge/core/fs exists. R10 constrains production code.
    // `scripts/run-tests.mjs` only, not all of `scripts/**`: `PLAN-M1.md` P2, P3 and P9 put real
    // production code there — P9's schema emitter has a mandate of byte-stable output with no
    // timestamps, and a blanket exemption would switch off the one rule that catches `new Date()`
    // in it, from a config that is not P9's to change.
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      'test/**/*.ts',
      'scripts/run-tests.mjs',
      '*.config.ts',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    // Plain ESM is typechecked by `pnpm typecheck` through JSDoc + checkJs, which eslint cannot
    // read — so the type-aware rules are off and tsc is the authority. R10 and R7 stay ON here:
    // `scripts/` is where `PLAN-M1.md` P2, P3 and P9 put production code.
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        globalThis: 'readonly',
        process: 'readonly',
        Request: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // The two harness files that establish the determinism guarantees are the only place allowed to
    // read the clock and the environment directly — the same carve-out the TypeScript harness gets.
    // Narrowly by name: a `scripts/**` glob here would switch R10 off for the schema emitter, whose
    // mandate is byte-stable output with no timestamps. That exact hole was reported as blocking,
    // "fixed", and then reintroduced one glob over.
    files: ['test/network-guard.mjs', 'scripts/run-tests.mjs'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    // Command entry points directly under `scripts/`: printing to the console and reading argv is
    // what they are for. Only `no-console` is relaxed — the determinism rules stay on, which is the
    // half that matters for `PLAN-M1.md` P9's schema emitter and its byte-stable-output mandate.
    // Decision logic lives in `scripts/lib/`, which gets no exemption at all.
    files: ['scripts/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // `packages/cli/src/bin.ts` — the real, minimal `forge` CLI entry point (`PLAN-M6.md` C9):
    // printing real command output/errors to stdout/stderr is this one file's own real job, the
    // identical "command entry points print to the console" carve-out `scripts/*.mjs` already gets
    // above, narrowed to this exact file by name rather than a `packages/cli/src/**` glob that would
    // silently relax the rule for every other real command module in this package too.
    files: ['packages/cli/src/bin.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Build-time config only. `test/workspace-floor.test.ts` asserts no workspace package ships
    // `.js`/`.jsx` source, so this exemption cannot silently cover production code the way the
    // `**/*.mjs` one did.
    files: ['**/*.js', '**/*.jsx'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // specs/02 §2.2's dependency graph and the platform-boundary rule, from PLAN-M1.md P2. Every
    // rule in this plugin already no-ops outside `packages/*` internally (specs/02 §2.2 does not
    // govern `tools/` or `modules/` — SPEC-QUESTIONS.md Q5), so the glob only needs to name where
    // the graph applies; it is not what keeps `tools/eslint-plugin-forge-boundaries` itself exempt.
    files: ['packages/**/*.{ts,tsx,mjs,cjs,js,jsx}'],
    plugins: { 'forge-boundaries': forgeBoundaries },
    rules: {
      'forge-boundaries/no-undeclared-package-import': 'error',
      'forge-boundaries/no-deep-package-import': 'error',
      'forge-boundaries/no-platform-concept': 'error',
    },
  },
  prettier,
);
