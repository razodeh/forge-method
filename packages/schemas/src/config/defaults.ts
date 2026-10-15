/**
 * `DEFAULT_CONFIG` — the built-in defaults layer, `02` §2.8's lowest-precedence layer 6.
 *
 * `platform.primary` defaults to `''` (unset) rather than naming any adapter: which platform is
 * installed is a project/installer decision, not something `@forge/schemas` — below `adapter-kit` in
 * the dependency graph — should presume. See `SPEC-QUESTIONS.md` Q16, Q25.
 *
 * @see specs/18 §18.3
 * @see specs/02 §2.8
 * @see PLAN-M1.md P8
 */
import { DEFAULT_ORACLE_LINT_TEST_FILE_GLOBS, type ForgeConfig } from './schema.ts';

export const DEFAULT_CONFIG: ForgeConfig = {
  version: 1,
  project: {
    name: '',
    slug: '',
    description: '',
    level: 'L0',
    mode: 'guided',
    repoUrl: '',
    adopted: false,
  },
  paths: {
    kb: 'docs/forge/kb',
    specs: 'docs/forge/specs',
    plans: 'docs/forge/plans',
    sessions: 'docs/forge/sessions',
    reports: 'docs/forge/reports',
    code: '.',
    // `PLAN-M14.md` P12: unset until a project names its own app paths — `prepare-release-build`
    // refuses (`RUN-106`) rather than guessing at the app's own layout.
    release: [],
  },
  platform: {
    primary: '',
    fallback: null,
    perAgent: {},
    routing: { onRateLimit: 'fallback', onOutage: 'fallback' },
    adapterConfig: {},
  },
  models: {
    tiers: { frugal: {}, balanced: {}, max: {} },
    overrides: {},
  },
  execution: {
    concurrency: 'auto',
    autonomy: 'guided',
    autonomyByGate: {},
    retainLaneWorktrees: 'on-failure',
    integrationBranch: 'forge/integration/{stage}',
    conflictPolicy: 'agent',
    sharedMutablePaths: [],
    testCommands: {},
    // No default (`PLAN-M14.md` P5): unset is its own meaningful value, "use the built-in test-path rule"
    // (`isTestPath`), not a default list of directories to fill in.
    testRoots: undefined,
    mergeChecks: {},
    // `specs/22` M15 P9: the documented default for how many automatic fix-and-re-review rounds
    // `implement-story`'s own `review` step runs before giving up (`RUN-113`).
    criticRounds: 3,
  },
  // `PLAN-M14.md` P16, `SPEC-QUESTIONS.md` Q232 decision 10: 90 days is the documented default cap on
  // how far past its own grant a waiver's `--expires` may fall.
  gates: {
    waiverMaxDays: 90,
  },
  budget: {
    perRunUsd: 25,
    perStepUsdDefault: 2,
    dailyUsd: 100,
    onBreach: 'pause',
  },
  roster: {
    preset: 'startup-lean',
    enable: [],
    disable: [],
    alias: {},
    add: [],
    split: {},
  },
  kb: {
    packBudgetTokens: 20_000,
    retrieval: { embeddings: false, graphHops: 1 },
    staleness: { architecture: 90, data: 90, delivery: 60, product: 120, ops: 60 },
  },
  skills: {
    packBudgetTokens: 8000,
    hardBodyCapTokens: 6000,
  },
  mcp: {
    servers: [],
    grants: {},
    defaults: { grantMode: 'explicit', injectionPosture: 'untrusted-content' },
    adoptHostServers: false,
  },
  diagrams: {
    defaultNotation: 'mermaid',
    allowedNotations: ['mermaid'],
    render: 'on-demand',
    remoteRenderer: null,
    complexity: { maxNodes: 20, maxEdges: 30, hardMaxNodes: 40 },
    driftPolicy: 'fail',
    requireCaptions: true,
  },
  quality: {
    // `specs/22` M17 P5: `source`'s default (`istanbul-json`) reproduces the pre-M17 hard-coded
    // `coverage/coverage-summary.json` assumption exactly; `path` stays unset (use `source`'s own
    // conventional path) -- the identical `execution.testRoots: undefined` convention above for an
    // optional leaf a pre-existing `.forge/config.yaml` has no key for yet. (`path`, not `18` §18.3's
    // own literal `format` -- `schema.ts`'s own `COVERAGE_SOURCES`/`path` doc comments have the full
    // naming-collision reasoning.)
    coverage: {
      lines: 85,
      branches: 80,
      ratchet: true,
      source: 'istanbul-json',
      path: undefined,
    },
    // Spread, not assigned directly: `DEFAULT_ORACLE_LINT_TEST_FILE_GLOBS` is a readonly `as const`
    // tuple (so `schema.ts`'s own `z.enum`-style precedent still gets literal types elsewhere were it
    // ever needed), while `configSchema`'s own `z.array(...)` infers a mutable `string[]` here.
    oracleLint: { testFileGlobs: [...DEFAULT_ORACLE_LINT_TEST_FILE_GLOBS] },
    flake: { maxRatePct: 2, window: 20, quarantineCap: 5 },
    pyramid: { maxE2ESharePct: 15 },
    dodProfileDefault: 'backend-default',
  },
  security: {
    secretSource: 'env',
    secretCommand: null,
    toolCeilingEscalations: [],
    destructiveOps: 'confirm',
    redactPatterns: ['(?i)api[_-]?key', '(?i)authorization'],
  },
  vcs: {
    // `18` §18.3's own "`vcs.trunk`" paragraph (`specs/22` M17 P9): `"main"` is the one value this
    // built-in-defaults layer (`02` §2.8's lowest-precedence layer) can state without a real git
    // repository to ask — `forge init` (`run-init.ts`'s own `detectRealTrunkBranch`) overrides it with
    // the real branch it finds whenever one exists, falling back to this literal default only for
    // `--no-git`. Also load-bearing for `configSchema`'s matching `.default('main')`: every config.yaml
    // committed before this field existed parses with this exact value filled in, never a hard failure.
    trunk: 'main',
    allowCommits: true,
    commitConvention: 'conventional',
    signCommits: false,
    trailers: true,
  },
  telemetry: {
    network: false,
    otlpEndpoint: null,
  },
  output: {
    color: 'auto',
    ascii: false,
    style: 'default',
  },
};
