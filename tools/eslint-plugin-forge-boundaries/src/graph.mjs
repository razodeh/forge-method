/**
 * The `specs/02` §2.2 dependency graph, as one piece of data.
 *
 * Plain ESM with JSDoc, not TypeScript: `scripts/check-boundaries.mjs` (`PLAN-M1.md` P2's
 * second, non-ESLint check) runs under plain `node`, which cannot import a `.ts` file without a
 * loader the dev-toolchain floor does not have. Writing the canonical data as `.mjs` — the same
 * pattern `test/network-guard.mjs` already uses — lets the ESLint rules (typechecked, via
 * `allowJs`/`checkJs`) and the plain-Node CLI script both import the same file. The alternative was
 * two transcriptions of the graph, which is precisely the drift `PLAN-M1.md` P2 says one export
 * exists to prevent.
 *
 * Both the ESLint rules and `scripts/check-boundaries.mjs` read this file and only this file.
 * `test/graph.test.ts` checks it against a fresh transcription of the spec text.
 *
 * @see specs/02 §2.2
 */

/**
 * Every package the `specs/02` §2.2 layout names under `packages/`.
 *
 * The three concrete adapters expand the spec's `adapter-*` shorthand row, since a graph keyed by a
 * glob cannot be checked against real import specifiers.
 */
export const FORGE_PACKAGES = /** @type {const} */ ([
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
]);

/** @typedef {(typeof FORGE_PACKAGES)[number]} ForgePackage */

/**
 * `x → y` means `x` may import `y`. Read `specs/02` §2.2 as `packages/x ← y1, y2` — this is that
 * table with the arrow reversed, because "who may I import" is the question every check here asks.
 *
 * Two rows have no line in the spec's table:
 *
 * - `templates` has none, matching its description in the `specs/02` §2.2 layout tree as bundled
 *   data (templates, workflows, checklists) rather than logic with dependencies of its own.
 * - `testkit` has none, though `specs/22` M4 requires it to implement `FakePlatformAdapter`, which
 *   needs `adapter-kit`'s interface.
 *
 * Both defaults are recorded with their reasoning in `SPEC-QUESTIONS.md` Q16, proceeding per
 * `CLAUDE.md`'s rule for spec silence: record the recommendation, mark it, move on.
 *
 * One row has an edge the spec's table does not: `engine → testkit`. The spec table only ever
 * describes who a package depends on to *run*; it is silent on the identical, narrower question of
 * who a package's own *tests* may depend on, because `testkit` (whose entire declared purpose is
 * supplying `FakePlatformAdapter` to other packages' test suites, per its own doc comments and
 * `SPEC-QUESTIONS.md` Q16) otherwise has zero permitted consumers anywhere in this graph — a gap,
 * not a deliberate restriction, first hit by `PLAN-M5.md` P15's own dispatch tests, which need a real
 * adapter session rather than a locally hand-rolled fake. Recorded in `SPEC-QUESTIONS.md` Q77,
 * proceeding per the same spec-silence rule as the two rows above.
 *
 * `cli`'s row is `specs/02` §2.2's own words — "cli ← everything" — rather than a hand-expanded
 * list, so adding a package here can never leave `cli` one entry behind.
 *
 * @type {Readonly<Record<ForgePackage, readonly ForgePackage[]>>}
 */
export const PACKAGE_GRAPH = {
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
  engine: [
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
  ],
  installer: ['core', 'schemas', 'templates', 'extensions'],
  tui: ['engine', 'core', 'kb', 'telemetry', 'schemas'],
  templates: [],
  testkit: ['adapter-kit', 'schemas'],
  cli: FORGE_PACKAGES.filter((pkg) => pkg !== 'cli'),
};

/**
 * Whether `value` names a package `specs/02` §2.2 governs.
 * @param {string} value
 * @returns {value is ForgePackage}
 */
export function isForgePackage(value) {
  return /** @type {readonly string[]} */ (FORGE_PACKAGES).includes(value);
}

/**
 * Whether `from` is permitted to import `to`, per the graph. Importing oneself is never asked.
 * @param {ForgePackage} from
 * @param {ForgePackage} to
 * @returns {boolean}
 */
export function isDeclaredDependency(from, to) {
  return PACKAGE_GRAPH[from].includes(to);
}
