/**
 * `configSchema` — `18` §18.3's canonical config.
 *
 * @see specs/18 §18.3
 * @see specs/21 §21.3
 * @see SPEC-QUESTIONS.md Q16, Q25, Q26
 */
import { describe, expect, it } from 'vitest';

import { configSchema } from '../../src/config/schema.ts';

/**
 * `18` §18.3's canonical YAML block, transcribed as a plain object — field for field, value for
 * value — with two deliberate substitutions, both forced by the same constraint: `18` §18.3's own
 * example names banned platform-concept tokens (`SPEC-QUESTIONS.md` Q25), and the already-shipped
 * `no-platform-concept` lint rule refuses every one of them anywhere under `packages/schemas`,
 * including in test fixtures, not just production code.
 *
 * 1. `claude-code`/`claudeCode` becomes `example-adapter`/`adapterConfig` everywhere it appears
 *    (`platform.primary`, `platform.claudeCode` -> `platform.adapterConfig`,
 *    `models.tiers.*.claude-code` -> `models.tiers.*.'example-adapter'`).
 * 2. `models.tiers.{frugal,balanced,max}`'s model names — `haiku`, `sonnet`, `opus` in the spec's own
 *    example — become `small-model`/`medium-model`/`large-model`: the same lint rule's
 *    `PLATFORM_TOKENS` set bans these three words too, not only "claude".
 */
function goldenConfig(): Record<string, unknown> {
  return {
    version: 1,
    project: {
      name: 'acme-billing',
      slug: 'acme-billing',
      description: 'Invoicing for small agencies',
      level: 'L3',
      mode: 'guided',
      repoUrl: 'https://github.com/acme/billing',
      // Not part of `18` §18.3's own literal example (written before `PLAN-M10.md` P20 added this
      // field) — `false` is the honest default for a hand-authored config transcription that never
      // went through `forge adopt`.
      adopted: false,
    },
    paths: {
      kb: 'docs/forge/kb',
      specs: 'docs/forge/specs',
      plans: 'docs/forge/plans',
      sessions: 'docs/forge/sessions',
      reports: 'docs/forge/reports',
      code: '.',
      // `PLAN-M14.md` P12: empty by default in `18` §18.3's own example (written before this piece).
      release: [],
    },
    platform: {
      primary: 'example-adapter',
      fallback: null,
      perAgent: {},
      routing: { onRateLimit: 'fallback', onOutage: 'fallback' },
      adapterConfig: {
        'example-adapter': { transport: 'sdk', bare: true, minimumVersion: '2.0.0' },
      },
    },
    models: {
      tiers: {
        frugal: { 'example-adapter': 'small-model' },
        balanced: { 'example-adapter': 'medium-model' },
        max: { 'example-adapter': 'large-model' },
      },
      overrides: { architect: 'max', diagnostician: 'max' },
    },
    execution: {
      concurrency: 'auto',
      autonomy: 'guided',
      autonomyByGate: { 'G-Deliver': 'supervised' },
      retainLaneWorktrees: 'on-failure',
      integrationBranch: 'forge/integration/{stage}',
      conflictPolicy: 'agent',
      sharedMutablePaths: [
        { glob: 'pnpm-lock.yaml', strategy: 'regenerate', command: 'pnpm install --lockfile-only' },
        { glob: 'CHANGELOG.md', strategy: 'append-only' },
      ],
      testCommands: { unit: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit' },
    },
    budget: {
      perRunUsd: 25,
      perStepUsdDefault: 2,
      dailyUsd: 100,
      onBreach: 'pause',
    },
    roster: { preset: 'startup-lean', enable: [], disable: [], alias: {}, add: [], split: {} },
    kb: {
      packBudgetTokens: 20_000,
      retrieval: { embeddings: false, graphHops: 1 },
      staleness: { architecture: 90, data: 90, delivery: 60, product: 120, ops: 60 },
    },
    skills: { packBudgetTokens: 8000, hardBodyCapTokens: 6000 },
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
    telemetry: { network: false, otlpEndpoint: null },
    output: { color: 'auto', ascii: false, style: 'acme-house' },
  };
}

describe('configSchema — the golden fixture (18 §18.3, with the Q25 platform-id substitution)', () => {
  it('parses and validates', () => {
    const result = configSchema.safeParse(goldenConfig());
    expect(result.success, !result.success ? JSON.stringify(result.error.issues) : '').toBe(true);
  });
});

describe('configSchema — unknown keys are refused, with the offending path', () => {
  it('rejects an unknown top-level key', () => {
    const result = configSchema.safeParse({ ...goldenConfig(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });

  it('rejects an unknown nested key', () => {
    const config = goldenConfig() as { project: Record<string, unknown> };
    const result = configSchema.safeParse({
      ...config,
      project: { ...config.project, nickname: 'billing' },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['project']);
  });
});

describe('configSchema — execution.testCommands (PLAN-M8.md P3)', () => {
  it('rejects an unrecognised test layer key', () => {
    const config = goldenConfig() as { execution: Record<string, unknown> };
    const result = configSchema.safeParse({
      ...config,
      execution: { ...config.execution, testCommands: { foo: 'bar' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string command', () => {
    const config = goldenConfig() as { execution: Record<string, unknown> };
    const result = configSchema.safeParse({
      ...config,
      execution: { ...config.execution, testCommands: { unit: '' } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a real subset of layers, leaving the rest absent', () => {
    const config = goldenConfig() as { execution: Record<string, unknown> };
    const result = configSchema.safeParse({
      ...config,
      execution: { ...config.execution, testCommands: { unit: 'vitest run' } },
    });
    expect(result.success).toBe(true);
  });
});

describe('configSchema — execution.testRoots (PLAN-M14.md P5)', () => {
  const withTestRoots = (testRoots: unknown) => {
    const config = goldenConfig() as { execution: Record<string, unknown> };
    return configSchema.safeParse({ ...config, execution: { ...config.execution, testRoots } });
  };

  it('is optional: a config written before it existed stays valid', () => {
    expect(configSchema.safeParse(goldenConfig()).success).toBe(true);
  });

  it('accepts a list of project-relative directories', () => {
    expect(withTestRoots(['tests', 'test/integration', 'e2e']).success).toBe(true);
  });

  it('accepts an empty list', () => {
    expect(withTestRoots([]).success).toBe(true);
  });

  it('rejects an empty-string entry', () => {
    const result = withTestRoots(['tests', '']);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['execution', 'testRoots', 1]);
  });

  it('rejects a non-array value', () => {
    expect(withTestRoots('tests').success).toBe(false);
  });
});

describe('configSchema — execution.mergeChecks (PLAN-M13.md P38)', () => {
  const withMergeChecks = (mergeChecks: unknown) => {
    const config = goldenConfig() as { execution: Record<string, unknown> };
    return configSchema.safeParse({ ...config, execution: { ...config.execution, mergeChecks } });
  };

  it('is optional: a config written before it existed stays valid', () => {
    expect(configSchema.safeParse(goldenConfig()).success).toBe(true);
  });

  it('accepts a pre and a post check, each a name or a command, either alone', () => {
    expect(withMergeChecks({ pre: 'fast', post: 'full' }).success).toBe(true);
    expect(withMergeChecks({ post: 'pnpm test' }).success).toBe(true);
    expect(withMergeChecks({}).success).toBe(true);
  });

  it('rejects a key that is not pre or post, and an empty check', () => {
    expect(withMergeChecks({ before: 'fast' }).success).toBe(false);
    expect(withMergeChecks({ pre: '' }).success).toBe(false);
  });
});

describe('configSchema — paths.release (PLAN-M14.md P12, SPEC-QUESTIONS.md Q216 / Q232 decision 4)', () => {
  const withRelease = (release: unknown) => {
    const config = goldenConfig() as { paths: Record<string, unknown> };
    return configSchema.safeParse({ ...config, paths: { ...config.paths, release } });
  };

  it('is required (present, empty by default) — not optional like testRoots/mergeChecks', () => {
    const config = goldenConfig() as { paths: Record<string, unknown> };
    const pathsWithoutRelease = Object.fromEntries(
      Object.entries(config.paths).filter(([key]) => key !== 'release'),
    );
    expect(configSchema.safeParse({ ...config, paths: pathsWithoutRelease }).success).toBe(false);
  });

  it('accepts the empty list', () => {
    expect(withRelease([]).success).toBe(true);
  });

  it('accepts a list of repo-relative glob entries', () => {
    expect(withRelease(['apps/mobile/**', 'app.json', 'pubspec.yaml']).success).toBe(true);
  });

  it('rejects a scalar (not an array)', () => {
    expect(withRelease('apps/mobile/**').success).toBe(false);
  });

  it('rejects an empty-string entry', () => {
    const result = withRelease(['apps/mobile/**', '']);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['paths', 'release', 1]);
  });

  it('rejects an absolute entry', () => {
    expect(withRelease(['/etc/passwd']).success).toBe(false);
    expect(withRelease(['C:\\secrets']).success).toBe(false);
  });

  it('rejects an entry with a ".." segment, anywhere in the path', () => {
    expect(withRelease(['../outside']).success).toBe(false);
    expect(withRelease(['apps/../../etc']).success).toBe(false);
  });

  it('rejects a leading "!" (the claim matcher reads it as an exclusion)', () => {
    expect(withRelease(['!apps/mobile/**']).success).toBe(false);
  });
});

describe('configSchema — enum keys (PLAN-M1.md P8 Check)', () => {
  const enumCases: readonly [section: string, key: string, invalidValue: string][] = [
    ['project', 'level', 'L9'],
    ['project', 'mode', 'chaotic'],
    ['execution', 'autonomy', 'unattended'],
    ['budget', 'onBreach', 'ignore'],
    ['execution', 'conflictPolicy', 'coinflip'],
    ['diagrams', 'driftPolicy', 'shrug'],
    ['security', 'destructiveOps', 'yolo'],
    ['security', 'secretSource', 'sticky-note'],
    ['execution', 'retainLaneWorktrees', 'sometimes'],
    ['diagrams', 'render', 'eventually'],
  ];

  it.each(enumCases)('rejects an invalid %s.%s', (section, key, invalidValue) => {
    const config = goldenConfig() as Record<string, Record<string, unknown>>;
    const result = configSchema.safeParse({
      ...config,
      [section]: { ...config[section], [key]: invalidValue },
    });
    expect(result.success, `${section}.${key}`).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([section, key]);
  });
});

describe('configSchema — redactPatterns compile as regular expressions (PLAN-M1.md P8 Check)', () => {
  it("accepts the (?i) case-insensitive idiom (18 §18.3's own examples, SPEC-QUESTIONS Q26)", () => {
    const config = goldenConfig() as { security: Record<string, unknown> };
    const result = configSchema.safeParse({
      ...config,
      security: { ...config.security, redactPatterns: ['(?i)api[_-]?key'] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a plain JS-syntax pattern with no (?i) prefix', () => {
    const config = goldenConfig() as { security: Record<string, unknown> };
    const result = configSchema.safeParse({
      ...config,
      security: { ...config.security, redactPatterns: ['api[_-]?key'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a pattern that does not compile, naming the array index', () => {
    const config = goldenConfig() as { security: Record<string, unknown> };
    const result = configSchema.safeParse({
      ...config,
      security: { ...config.security, redactPatterns: ['api[_-]?key', '(unclosed'] },
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['security', 'redactPatterns', 1]);
  });

  it('rejects (?i) followed by an otherwise-invalid pattern, not just bare (?i)', () => {
    const config = goldenConfig() as { security: Record<string, unknown> };
    const result = configSchema.safeParse({
      ...config,
      security: { ...config.security, redactPatterns: ['(?i)(unclosed'] },
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['security', 'redactPatterns', 0]);
  });
});
