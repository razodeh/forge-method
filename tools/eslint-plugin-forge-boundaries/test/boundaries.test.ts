/**
 * The `specs/02` §2.2 boundary rules and the data they share, in one file.
 *
 * `graph.mjs`, `locate.mjs` and the three rule modules are consolidated into a single test file
 * rather than one file per module. They were split by module at first, which is the more idiomatic
 * layout — but `graph.mjs` and `locate.mjs` are imported by every rule's tests, and running that
 * many files that all import the same two modules under vitest's default forked-process pool
 * produced under-reported per-file coverage for exactly those shared modules: verified by running
 * each file alone (95-100% coverage each) versus the full suite together (60-75%), with the
 * consolidated file used here restoring the isolated numbers. Recorded as a tooling limitation
 * rather than a testing gap in `SPEC-QUESTIONS.md` Q17.
 *
 * @see specs/02 §2.2
 * @see PLAN-M1.md P2
 * @see SPEC-QUESTIONS.md Q17
 */
import { Linter, RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';

import boundariesPlugin from '../src/index.mjs';
import { FORGE_PACKAGES, PACKAGE_GRAPH } from '../src/graph.mjs';
import { locateFile, locateSpecifier } from '../src/locate.mjs';
import noDeepRule from '../src/rules/no-deep-package-import.mjs';
import noPlatformRule from '../src/rules/no-platform-concept.mjs';
import noUndeclaredRule from '../src/rules/no-undeclared-package-import.mjs';

// ESLint's documented integration point for a non-Mocha runner (eslint.org/docs/latest/integrate/
// nodejs-api#ruletester): flatten RuleTester's internal describe/it into direct calls, so its
// assertions surface inside the single vitest `it` below. @types/eslint types both as an untyped
// `Function`, hence the explicit annotation on the replacement rather than trusting inference.
const flatten: (name: string, fn: () => void) => void = (_name, fn) => {
  fn();
};
RuleTester.describe = flatten;
RuleTester.it = flatten;

// One RuleTester instance, reused for all three rules: `tester.run(name, rule, cases)` takes the
// rule as an argument each call, so nothing about the tester itself is rule-specific.
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

// Plain espree cannot parse `type X = import('@forge/y').Z` — it is TypeScript-only syntax — so the
// TSImportType regression cases below need the real TS parser, not the default one every other case
// in this file uses.
const tsTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2024, sourceType: 'module' },
});

const core = (relative: string) => `/repo/packages/core/${relative}`;
const engine = (relative: string) => `/repo/packages/engine/${relative}`;
const schemas = (relative: string) => `/repo/packages/schemas/${relative}`;
const adapter = (relative: string) => `/repo/packages/adapter-claude-code/${relative}`;

/**
 * Transcribed verbatim from the `specs/02` §2.2 dependency-rules block. Three rows are checked
 * separately below instead of through this table, each for its own documented reason:
 * `templates` and `testkit` have no spec entry at all (`SPEC-QUESTIONS.md` Q16); `engine` has a spec
 * entry, but `PACKAGE_GRAPH.engine` deliberately carries two edges beyond it (`SPEC-QUESTIONS.md`
 * Q77, and `PLAN-M10.md` P10's own `engine -> sessions` edge) — so asserting `engine` here, against
 * the literal spec text alone, would fail on a graph that is correct on purpose.
 */
const SPEC_TABLE: Readonly<Record<string, readonly string[]>> = {
  schemas: [],
  core: ['schemas'],
  kb: ['core', 'schemas', 'diagrams'],
  vcs: ['schemas'],
  telemetry: ['schemas'],
  'adapter-kit': ['schemas', 'telemetry'],
  'adapter-claude-code': ['adapter-kit', 'schemas', 'telemetry'],
  'adapter-codemachine': ['adapter-kit', 'schemas', 'telemetry'],
  'adapter-generic': ['adapter-kit', 'schemas', 'telemetry'],
  methods: ['core', 'kb', 'schemas'],
  catalog: ['schemas'],
  diagrams: ['core', 'schemas'],
  extensions: ['schemas', 'core', 'templates'],
  agents: ['core', 'kb', 'schemas', 'adapter-kit', 'templates', 'extensions'],
  sessions: ['core', 'kb', 'agents', 'schemas'],
  installer: ['core', 'schemas', 'templates', 'extensions'],
  tui: ['engine', 'core', 'kb', 'telemetry', 'schemas'],
  // "cli ← everything": the spec's own words, not a list — asserted separately below rather than
  // hand-expanded here, so this table stays a faithful transcription of what the spec actually says.
};

describe('specs/02 §2.2 — the package list', () => {
  it('matches the packages/* directories the spec names, exactly', () => {
    // The §2.2 layout tree names these directories under packages/. adapter-claude-code,
    // adapter-codemachine and adapter-generic are the three concrete "adapter-*" rows; the spec's
    // shorthand row is expanded to all three, once, here.
    const fromLayout = [
      'cli',
      'core',
      'schemas',
      'kb',
      'engine',
      'agents',
      'adapter-kit',
      'adapter-claude-code',
      'adapter-codemachine',
      'adapter-generic',
      'vcs',
      'methods',
      'catalog',
      'diagrams',
      'sessions',
      'extensions',
      'templates',
      'tui',
      'telemetry',
      'installer',
      'testkit',
    ].sort();

    expect([...FORGE_PACKAGES].sort()).toEqual(fromLayout);
  });
});

describe('specs/02 §2.2 — the dependency graph', () => {
  it('gives every row from the spec table the exact edges the spec declares', () => {
    for (const [pkg, deps] of Object.entries(SPEC_TABLE)) {
      // No `?? []`: PACKAGE_GRAPH is a complete Record over every ForgePackage, so a key that is a
      // member of that type always resolves to a real array — TypeScript proves it, which is the
      // point of typing the graph that way.
      expect(
        [...PACKAGE_GRAPH[pkg as keyof typeof PACKAGE_GRAPH]].sort(),
        `${pkg}'s edges`,
      ).toEqual([...deps].sort());
    }
  });

  it('rejects a key the spec table does not declare', () => {
    // Fails on purpose if PACKAGE_GRAPH ever gains a package this test does not know about — the
    // test then has to be updated with the new spec row, rather than silently trusting the export.
    const declaredKeys = new Set(Object.keys(SPEC_TABLE));
    const undeclared = FORGE_PACKAGES.filter(
      (pkg) =>
        !declaredKeys.has(pkg) &&
        pkg !== 'cli' &&
        pkg !== 'templates' &&
        pkg !== 'testkit' &&
        pkg !== 'engine',
    );
    expect(undeclared).toEqual([]);
  });

  it('gives cli every other package as a dependency, per "cli ← everything"', () => {
    const others = FORGE_PACKAGES.filter((pkg) => pkg !== 'cli');
    expect([...PACKAGE_GRAPH.cli].sort()).toEqual([...others].sort());
  });

  it('gives templates no forge dependencies, matching its "data" description in specs/02 §2.2', () => {
    // Undeclared in the spec table; see SPEC-QUESTIONS.md Q16 for the reasoning this default codes.
    expect(PACKAGE_GRAPH.templates).toEqual([]);
  });

  it('lets testkit depend on adapter-kit and schemas, since it implements FakePlatformAdapter', () => {
    // specs/22 M4: "@forge/testkit with FakePlatformAdapter". Undeclared in the spec table; see
    // SPEC-QUESTIONS.md Q16.
    expect([...PACKAGE_GRAPH.testkit].sort()).toEqual(['adapter-kit', 'schemas']);
  });

  it("gives engine every spec-declared edge, plus testkit for its own dispatch tests' real adapter sessions, plus sessions for driving real session-step turns", () => {
    // The spec's own nine edges (specs/02 §2.2), unchanged, plus two recorded additions: PLAN-M5.md
    // P15's dispatch tests need a real FakePlatformAdapter, and testkit otherwise has no permitted
    // consumer anywhere in this graph despite existing specifically to be one (SPEC-QUESTIONS.md
    // Q77); and PLAN-M10.md P10's own `engine -> sessions` edge, the mirror image of the identical
    // `agents`-cannot-reach-`engine` structural fact Q104 already established -- `@forge/sessions`
    // stays a sibling with no edge back, `@forge/engine` is the one side that reaches across.
    expect([...PACKAGE_GRAPH.engine].sort()).toEqual(
      [
        'core',
        'kb',
        'agents',
        'adapter-kit',
        'vcs',
        'telemetry',
        'schemas',
        'methods',
        'extensions',
        'testkit',
        'sessions',
      ].sort(),
    );
  });

  it('never lets a package depend on itself', () => {
    for (const [pkg, deps] of Object.entries(PACKAGE_GRAPH)) {
      expect(deps, pkg).not.toContain(pkg);
    }
  });

  it('declares every edge target as a real package, so no row points at a typo', () => {
    const known = new Set(FORGE_PACKAGES);
    for (const [pkg, deps] of Object.entries(PACKAGE_GRAPH)) {
      for (const dep of deps) {
        expect(known.has(dep), `${pkg} declares an edge to unknown package ${dep}`).toBe(true);
      }
    }
  });

  it('is free of cycles, since a cyclic dependency graph is not a layered architecture', () => {
    const visiting = new Set<string>();
    const done = new Set<string>();

    const visit = (pkg: string, path: readonly string[]): void => {
      if (done.has(pkg)) return;
      if (visiting.has(pkg)) {
        throw new Error(`Cycle: ${[...path, pkg].join(' -> ')}`);
      }
      visiting.add(pkg);
      for (const dep of PACKAGE_GRAPH[pkg as keyof typeof PACKAGE_GRAPH]) {
        visit(dep, [...path, pkg]);
      }
      visiting.delete(pkg);
      done.add(pkg);
    };

    for (const pkg of FORGE_PACKAGES) {
      expect(() => {
        visit(pkg, []);
      }).not.toThrow();
    }
  });
});

describe('locateFile', () => {
  it('locates a file inside a package, with its subpath', () => {
    expect(locateFile('/repo/packages/core/src/errors/codes.ts')).toEqual({
      root: 'packages',
      pkg: 'core',
      subpath: 'src/errors/codes.ts',
    });
  });

  it('locates a file at a package root, with no subpath', () => {
    expect(locateFile('/repo/packages/core/package.json')).toEqual({
      root: 'packages',
      pkg: 'core',
      subpath: 'package.json',
    });
  });

  it('locates tools/ and modules/ roots the same way', () => {
    expect(locateFile('/repo/tools/lint-fixture/src/a.ts')?.root).toBe('tools');
    expect(locateFile('/repo/modules/fm-core/agents/a.yaml')?.root).toBe('modules');
  });

  it('returns undefined for a path outside every workspace root', () => {
    expect(locateFile('/repo/scripts/run-tests.mjs')).toBeUndefined();
    expect(locateFile('/repo/test/setup.ts')).toBeUndefined();
  });

  it('normalises a Windows-style path, per specs/02 §2.7', () => {
    expect(locateFile('C:\\repo\\packages\\core\\src\\index.ts')).toEqual({
      root: 'packages',
      pkg: 'core',
      subpath: 'src/index.ts',
    });
  });

  it('does not require the package name to be a known ForgePackage', () => {
    // Deliberately permissive: an unrecognised name is a question for the rules that consume this
    // (is it declared in PACKAGE_GRAPH?), not for path resolution, which only answers "where is it".
    expect(locateFile('/repo/packages/not-a-real-package/src/a.ts')?.pkg).toBe(
      'not-a-real-package',
    );
  });
});

describe('locateSpecifier — bare @forge/* specifiers', () => {
  it('locates a package-root import', () => {
    expect(locateSpecifier('@forge/schemas', '/repo/packages/core/src/index.ts')).toEqual({
      root: 'packages',
      pkg: 'schemas',
      subpath: undefined,
    });
  });

  it('locates a subpath import', () => {
    expect(locateSpecifier('@forge/core/errors', '/x/packages/kb/src/a.ts')).toEqual({
      root: 'packages',
      pkg: 'core',
      subpath: 'errors',
    });
  });

  it('locates a deep subpath import', () => {
    expect(locateSpecifier('@forge/core/src/errors/codes.ts', '/x/packages/kb/src/a.ts')).toEqual({
      root: 'packages',
      pkg: 'core',
      subpath: 'src/errors/codes.ts',
    });
  });

  it('reports packages as the root even for a name that only exists under tools/', () => {
    // No legitimate @forge/<toolsPackage> import exists; reporting 'packages' means it is judged
    // as an unknown packages/* entry and refused as undeclared, which is the correct outcome either
    // way.
    expect(locateSpecifier('@forge/lint-fixture', '/x/packages/core/src/a.ts')?.root).toBe(
      'packages',
    );
  });

  it('returns undefined for a bare specifier missing a package name', () => {
    expect(locateSpecifier('@forge/', '/x/packages/core/src/a.ts')).toBeUndefined();
  });
});

describe('locateSpecifier — relative specifiers', () => {
  it('resolves a same-package relative import to that package', () => {
    expect(locateSpecifier('./codes.ts', '/repo/packages/core/src/errors/index.ts')).toEqual({
      root: 'packages',
      pkg: 'core',
      subpath: 'src/errors/codes.ts',
    });
  });

  it('resolves a relative import that escapes into a sibling package', () => {
    expect(
      locateSpecifier('../../engine/src/scheduler.ts', '/repo/packages/core/src/a.ts'),
    ).toEqual({
      root: 'packages',
      pkg: 'engine',
      subpath: 'src/scheduler.ts',
    });
  });

  it('resolves a relative import reaching into tools/', () => {
    expect(
      locateSpecifier('../../../tools/lint-fixture/src/a.ts', '/repo/packages/core/src/a.ts'),
    ).toEqual({ root: 'tools', pkg: 'lint-fixture', subpath: 'src/a.ts' });
  });

  it('returns undefined when a relative import resolves outside every workspace root', () => {
    expect(
      locateSpecifier('../../../../etc/passwd', '/repo/packages/core/src/a.ts'),
    ).toBeUndefined();
  });
});

describe('locateSpecifier — everything else', () => {
  it.each(['zod', 'vitest', 'node:fs', 'react', '@types/node'])(
    'ignores the non-@forge bare specifier %s',
    (specifier) => {
      expect(locateSpecifier(specifier, '/repo/packages/core/src/a.ts')).toBeUndefined();
    },
  );
});

describe('no-undeclared-package-import', () => {
  it('accepts declared imports and refuses upward, undeclared and escaping ones', () => {
    tester.run('no-undeclared-package-import', noUndeclaredRule, {
      valid: [
        // A valid import: core -> schemas is declared.
        { code: "import { z } from '@forge/schemas';", filename: core('src/a.ts') },
        // Same-package relative imports are never this rule's concern.
        { code: "import { x } from './x.ts';", filename: core('src/a.ts') },
        // A non-forge bare specifier is not this rule's concern.
        { code: "import { z } from 'zod';", filename: core('src/a.ts') },
        // schemas has no forge dependencies at all; nothing to import, nothing to flag.
        { code: "import './local.ts';", filename: schemas('src/a.ts') },
        // A deep subpath of a declared dependency is no-deep-package-import's concern, not this
        // rule's — this rule only asks "is the package declared", and schemas is.
        { code: "import { x } from '@forge/schemas/internal';", filename: core('src/a.ts') },
      ],
      invalid: [
        {
          // An upward import: engine depends on core (specs/02 §2.2), so core -> engine is a cycle.
          code: "import { Scheduler } from '@forge/engine';",
          filename: core('src/a.ts'),
          errors: [{ message: /would create a cycle/ }],
        },
        {
          // A sibling-but-undeclared import: agents does not list catalog.
          code: "import { Catalog } from '@forge/catalog';",
          filename: '/repo/packages/agents/src/a.ts',
          errors: [{ message: /not declared as a dependency/ }],
        },
        {
          // A deep import is still an undeclared-package violation when the target package itself
          // is not declared — both rules should have something to say about this line. catalog,
          // not engine: engine depends back on core, which would fire the cycle message this test
          // is not asserting.
          code: "import { Catalog } from '@forge/catalog/src/index.ts';",
          filename: core('src/a.ts'),
          errors: [{ message: /not declared as a dependency/ }],
        },
        {
          // A relative ../../<pkg> escape into an undeclared package.
          code: "import { Catalog } from '../../catalog/src/index.ts';",
          filename: core('src/a.ts'),
          errors: [{ message: /not declared as a dependency/ }],
        },
        {
          // Re-exports are governed too, not only imports.
          code: "export { z } from '@forge/catalog';",
          filename: core('src/a.ts'),
          errors: [{ message: /not declared as a dependency/ }],
        },
        {
          code: "export * from '@forge/catalog';",
          filename: core('src/a.ts'),
          errors: [{ message: /not declared as a dependency/ }],
        },
        {
          // Dynamic import is governed too.
          code: "const m = await import('@forge/catalog');",
          filename: core('src/a.ts'),
          errors: [{ message: /not declared as a dependency/ }],
        },
        {
          // A packages/* folder specs/02 §2.2 does not name at all — a scaffold that has not been
          // added to PACKAGE_GRAPH. Every forge import from it is a violation, distinct from the
          // "declared but wrong" cases above.
          code: "import { x } from '@forge/schemas';",
          filename: '/repo/packages/not-a-real-package/src/a.ts',
          errors: [{ message: /is not a package specs\/02 §2\.2 declares/ }],
        },
      ],
    });
  });

  it('is a no-op outside packages/*, per specs/02 §2.2 governing packages/ only', () => {
    tester.run('no-undeclared-package-import (tools/)', noUndeclaredRule, {
      valid: [
        { code: "import x from '@forge/engine';", filename: '/repo/tools/lint-fixture/src/a.ts' },
        { code: "import x from '@forge/engine';", filename: '/repo/scripts/run-tests.mjs' },
      ],
      invalid: [],
    });
  });

  // Uses ESLint's Linter directly, rather than another RuleTester case: this asserts the exact
  // message text distinguishes the two failure shapes, which a regex-only `errors` assertion could
  // pass without the underlying branch actually being reached.
  it('names both packages, and says "cycle" only when the reverse edge actually holds', () => {
    // `cwd: '/repo'` is required for flat config's `files` glob to match against an absolute
    // filename at all — without it, `verify` reports "No matching configuration found" regardless
    // of the glob.
    const linter = new Linter({ cwd: '/repo' });
    const config = {
      files: ['**/*.ts'],
      languageOptions: { ecmaVersion: 2024 as const, sourceType: 'module' as const },
      plugins: { local: { rules: { 'no-undeclared-package-import': noUndeclaredRule } } },
      rules: { 'local/no-undeclared-package-import': 'error' as const },
    };

    const cycle = linter.verify("import { x } from '@forge/engine';", config, core('src/a.ts'));
    expect(cycle[0]?.message).toContain('packages/core');
    expect(cycle[0]?.message).toContain('packages/engine');
    expect(cycle[0]?.message).toContain('cycle');

    const plain = linter.verify("import { x } from '@forge/catalog';", config, engine('src/a.ts'));
    expect(plain[0]?.message).toContain('packages/engine');
    expect(plain[0]?.message).toContain('packages/catalog');
    expect(plain[0]?.message).not.toContain('cycle');
  });
});

describe('no-deep-package-import', () => {
  it('accepts a public entry point and refuses reaching src/, dist/, or crossing by relative path', () => {
    tester.run('no-deep-package-import', noDeepRule, {
      valid: [
        // A valid import: schemas's package root is its public entry point.
        { code: "import { z } from '@forge/schemas';", filename: core('src/a.ts') },
        // A declared subpath export is the public entry point too, as long as it does not name
        // src/ or dist/.
        { code: "import { renderValue } from '@forge/core/errors';", filename: core('src/a.ts') },
        // Same-package relative imports never cross a package boundary.
        { code: "import { x } from './x.ts';", filename: core('src/a.ts') },
        { code: "import { x } from '../y.ts';", filename: core('src/errors/a.ts') },
        // Not this rule's concern at all: whether the package is even declared is
        // no-undeclared-package-import's job.
        { code: "import { x } from '@forge/catalog';", filename: core('src/a.ts') },
      ],
      invalid: [
        {
          // A deep import: reaches past schemas's public entry into its build layout.
          code: "import { internal } from '@forge/schemas/src/internal.ts';",
          filename: core('src/a.ts'),
          errors: [{ message: /public entry point/ }],
        },
        {
          code: "import { internal } from '@forge/schemas/dist/internal.js';",
          filename: core('src/a.ts'),
          errors: [{ message: /public entry point/ }],
        },
        {
          // A relative ../../<pkg> escape: wrong regardless of whether schemas is a declared
          // dependency of core, because a relative path has no notion of "public entry" at all.
          code: "import { z } from '../../schemas/src/index.ts';",
          filename: core('src/a.ts'),
          errors: [{ message: /may not cross into another package/ }],
        },
        {
          // The same escape into an undeclared package is refused here too — this rule does not
          // defer to no-undeclared-package-import for the relative-path shape.
          code: "import { Scheduler } from '../../engine/src/scheduler.ts';",
          filename: core('src/a.ts'),
          errors: [{ message: /may not cross into another package/ }],
        },
        {
          code: "export { internal } from '@forge/schemas/src/internal.ts';",
          filename: core('src/a.ts'),
          errors: [{ message: /public entry point/ }],
        },
        {
          code: "export * from '@forge/schemas/src/internal.ts';",
          filename: core('src/a.ts'),
          errors: [{ message: /public entry point/ }],
        },
        {
          code: "const m = await import('@forge/schemas/src/internal.ts');",
          filename: core('src/a.ts'),
          errors: [{ message: /public entry point/ }],
        },
      ],
    });
  });

  it('is a no-op outside packages/*', () => {
    tester.run('no-deep-package-import (tools/)', noDeepRule, {
      valid: [
        {
          code: "import x from '@forge/engine/src/a.ts';",
          filename: '/repo/tools/lint-fixture/src/a.ts',
        },
      ],
      invalid: [],
    });
  });
});

describe('the inline type-import form: type X = import(...).Y', () => {
  // `TSImportType` parses to its own node, not an ImportDeclaration — round 1 of P2's own review
  // found this let an upward or deep type-only import through both rules untouched. Ordinary code
  // reaches for this form specifically to pull in one type without a value import, so it is not an
  // edge case; it needed the real TypeScript parser to even construct the fixture.
  it('no-undeclared-package-import refuses an upward type-only import', () => {
    tsTester.run('no-undeclared-package-import (TSImportType)', noUndeclaredRule, {
      valid: [{ code: "export type X = import('@forge/schemas').Y;", filename: core('src/a.ts') }],
      invalid: [
        {
          code: "export type X = import('@forge/engine').Scheduler;",
          filename: core('src/a.ts'),
          errors: [{ message: /would create a cycle/ }],
        },
      ],
    });
  });

  it('no-deep-package-import refuses a deep type-only import', () => {
    tsTester.run('no-deep-package-import (TSImportType)', noDeepRule, {
      valid: [{ code: "export type X = import('@forge/schemas').Y;", filename: core('src/a.ts') }],
      invalid: [
        {
          code: "export type X = import('@forge/schemas/src/internal.ts').Y;",
          filename: core('src/a.ts'),
          errors: [{ message: /public entry point/ }],
        },
      ],
    });
  });
});

describe('no-platform-concept', () => {
  it('refuses the banned tokens outside adapter-*, in identifiers, strings and templates', () => {
    tester.run('no-platform-concept', noPlatformRule, {
      valid: [
        // The tokens are permitted inside an adapter package — that is exactly where they belong.
        { code: 'const ClaudeAdapter = 1;', filename: adapter('src/a.ts') },
        { code: "const model = 'opus';", filename: adapter('src/a.ts') },
        // mcp is carved out everywhere (SPEC-QUESTIONS.md Q2): the registry names servers, not
        // platforms.
        { code: 'const mcpServers = [];', filename: core('src/a.ts') },
        { code: "const s = 'mcp registry';", filename: core('src/a.ts') },
        // An unrelated word is not a whole-word match against the ban list.
        { code: 'const opusculent = 1;', filename: core('src/a.ts') },
        { code: "const s = 'sonnetary devices';", filename: core('src/a.ts') },
        // A platform id read from configuration as an opaque value, not a literal naming the
        // platform — see the rule's header and SPEC-QUESTIONS.md Q16.
        { code: 'const platformId = config.platform.primary;', filename: core('src/a.ts') },
      ],
      invalid: [
        {
          // An identifier naming the platform concept, outside adapter-*.
          code: 'const claudeAdapter = 1;',
          filename: core('src/a.ts'),
          errors: [{ message: /'claude'/ }],
        },
        {
          code: 'const SUBAGENT_TIMEOUT_MS = 1;',
          filename: core('src/a.ts'),
          errors: [{ message: /'subagent'/ }],
        },
        {
          // A string literal naming a model.
          code: "const model = 'opus';",
          filename: core('src/a.ts'),
          errors: [{ message: /'opus'/ }],
        },
        {
          // A snake_case identifier.
          code: 'const use_haiku_model = true;',
          filename: core('src/a.ts'),
          errors: [{ message: /'haiku'/ }],
        },
        {
          // A template literal.
          code: 'const s = `run on ${x} sonnet`;',
          filename: core('src/a.ts'),
          errors: [{ message: /'sonnet'/ }],
        },
      ],
    });
  });

  it('is a no-op outside packages/*', () => {
    tester.run('no-platform-concept (tools/)', noPlatformRule, {
      valid: [{ code: 'const claudeAdapter = 1;', filename: '/repo/tools/lint-fixture/src/a.ts' }],
      invalid: [],
    });
  });

  it('still fires on a static, literal import of an adapter package by name from cli', () => {
    // PACKAGE_GRAPH.cli includes adapter-claude-code (per "cli ← everything"), and it is tempting to
    // read that edge as permission to write this import — it is not. The edge exists for packaging
    // and for dynamic, config-driven loading through adapter-kit; a static literal import in cli's
    // own source is exactly the platform concept leaking into generic code this rule exists to
    // catch. See the rule's own header and SPEC-QUESTIONS.md Q16.
    const cli = (relative: string) => `/repo/packages/cli/${relative}`;
    tester.run('no-platform-concept (cli importing an adapter by name)', noPlatformRule, {
      valid: [],
      invalid: [
        {
          // Three hits, not two: a non-renamed named import (`import { X }` with no `as`) parses to
          // two separate Identifier nodes — ImportSpecifier's `imported` and `local` both name
          // `ClaudeCodeAdapter` — plus the specifier string itself.
          code: "import { ClaudeCodeAdapter } from '@forge/adapter-claude-code';",
          filename: cli('src/a.ts'),
          errors: [{ message: /'claude'/ }, { message: /'claude'/ }, { message: /'claude'/ }],
        },
      ],
    });
  });
});

describe('the plugin barrel (src/index.mjs)', () => {
  // Nothing in the test suite imports src/index.mjs directly otherwise — only eslint.config.js
  // does, at ESLint's own startup, outside any test run — so this is what src/index.mjs's own
  // coverage in pnpm coverage:boundaries actually depends on.
  it('exposes exactly the three rules under the names eslint.config.js wires up', () => {
    expect(Object.keys(boundariesPlugin.rules).sort()).toEqual([
      'no-deep-package-import',
      'no-platform-concept',
      'no-undeclared-package-import',
    ]);
  });

  it('re-exports the graph data eslint.config.js and scripts/lib/check-boundaries.mjs both rely on', () => {
    expect(boundariesPlugin.rules['no-undeclared-package-import']).toBe(noUndeclaredRule);
    expect(boundariesPlugin.rules['no-deep-package-import']).toBe(noDeepRule);
    expect(boundariesPlugin.rules['no-platform-concept']).toBe(noPlatformRule);
  });

  it('runs correctly through the assembled plugin object, not only imported directly', () => {
    // The thing eslint.config.js actually does: read a rule off the plugin object and run it. If
    // index.mjs ever assembled the `rules` map wrong, importing each rule module directly (as every
    // other case in this file does) would still pass while real linting broke.
    tester.run(
      'no-undeclared-package-import (via plugin barrel)',
      boundariesPlugin.rules['no-undeclared-package-import'],
      {
        valid: [{ code: "import { z } from '@forge/schemas';", filename: core('src/a.ts') }],
        invalid: [
          {
            code: "import { x } from '@forge/engine';",
            filename: core('src/a.ts'),
            errors: [{ message: /would create a cycle/ }],
          },
        ],
      },
    );
  });
});
