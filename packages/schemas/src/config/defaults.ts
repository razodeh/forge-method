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
import type { ForgeConfig } from './schema.ts';

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
    mergeChecks: {},
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
    coverage: { lines: 85, branches: 80, ratchet: true },
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
