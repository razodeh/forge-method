/**
 * `configSchema` — `18` §18.3's canonical config.
 *
 * @see specs/18 §18.3
 * @see specs/21 §21.3
 * @see SPEC-QUESTIONS.md Q16, Q25, Q26
 */
import { describe, expect, it } from 'vitest';

import { configSchema, legacyStringTestCommands } from '../../src/config/schema.ts';

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
      // `18` §18.3's own example YAML carries `trunk: main` too (`specs/22` M17 P9) — added to this
      // transcription for the same reason `project.adopted` was (see that field's own comment above):
      // this piece added the field after the original transcription was written.
      trunk: 'main',
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

describe('configSchema — execution.testCommands structured form (specs/22 M17 P3) (18 §18.3)', () => {
  function withTestCommands(testCommands: unknown) {
    const config = goldenConfig() as { execution: Record<string, unknown> };
    return configSchema.safeParse({
      ...config,
      execution: { ...config.execution, testCommands },
    });
  }

  it('accepts the minimal structured shape: run, output, format only', () => {
    const result = withTestCommands({
      unit: { run: 'custom-runner', output: { source: 'stdout' }, format: 'tap' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts output: {source: "file", path: ...}', () => {
    const result = withTestCommands({
      unit: {
        run: 'custom-runner --report report.xml',
        output: { source: 'file', path: 'report.xml' },
        format: 'junit-xml',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects output: {source: "file"} with no path (18 §18.3: a real path FORGE allocates and deletes)', () => {
    const result = withTestCommands({
      unit: { run: 'custom-runner', output: { source: 'file' }, format: 'junit-xml' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects output: {source: "stdout", path: ...} -- path belongs to the file branch only', () => {
    const result = withTestCommands({
      unit: {
        run: 'custom-runner',
        output: { source: 'stdout', path: 'report.xml' },
        format: 'tap',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an output.path that escapes the project (absolute, "..", drive letter)', () => {
    for (const path of ['/etc/passwd', '../escape.xml', 'a/../../escape.xml', 'C:\\escape.xml']) {
      const result = withTestCommands({
        unit: { run: 'custom-runner', output: { source: 'file', path }, format: 'junit-xml' },
      });
      expect(result.success, path).toBe(false);
    }
  });

  it('accepts every built-in format named in 13 F-TEST-7 point 2 / 18 §18.3', () => {
    for (const format of [
      'junit-xml',
      'tap',
      'forge-json',
      'vitest-json',
      'jest-json',
      'go-test-json',
    ]) {
      const result = withTestCommands({
        unit: { run: 'custom-runner', output: { source: 'stdout' }, format },
      });
      expect(result.success, format).toBe(true);
    }
  });

  it('rejects a format outside the built-in six', () => {
    const result = withTestCommands({
      unit: { run: 'custom-runner', output: { source: 'stdout' }, format: 'xunit' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts translate, scope, filter, and timeoutMs when given', () => {
    const result = withTestCommands({
      unit: {
        run: 'custom-runner',
        output: { source: 'file', path: 'report.raw' },
        format: 'forge-json',
        translate: 'node .forge/test-translators/unit.js {output}',
        scope: 'custom-runner {files}',
        filter: 'custom-runner --name {name}',
        timeoutMs: 600_000,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-positive or non-integer timeoutMs', () => {
    for (const timeoutMs of [0, -1, 1.5]) {
      const result = withTestCommands({
        unit: { run: 'r', output: { source: 'stdout' }, format: 'tap', timeoutMs },
      });
      expect(result.success, String(timeoutMs)).toBe(false);
    }
  });

  it('rejects an unknown key on the structured object', () => {
    const result = withTestCommands({
      unit: {
        run: 'custom-runner',
        output: { source: 'stdout' },
        format: 'tap',
        extra: 'nope',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a blank run/translate/scope/filter string', () => {
    for (const field of ['run', 'translate', 'scope', 'filter'] as const) {
      const base = { run: 'r', output: { source: 'stdout' } as const, format: 'tap' as const };
      const result = withTestCommands({ unit: { ...base, [field]: '' } });
      expect(result.success, field).toBe(false);
    }
  });

  it('one layer legacy-string, a sibling layer structured, in the same testCommands record', () => {
    const result = withTestCommands({
      unit: 'vitest run',
      e2e: { run: 'custom-e2e-runner', output: { source: 'stdout' }, format: 'tap' },
    });
    expect(result.success).toBe(true);
  });

  it('legacy-string goldens stay byte-identical: a plain string is still accepted, unchanged', () => {
    const result = withTestCommands({ unit: 'vitest run', lint: 'eslint .' });
    expect(result.success).toBe(true);
  });
});

describe('legacyStringTestCommands (specs/22 M17 P3)', () => {
  it('an all-string record passes through completely unchanged', () => {
    const input = { unit: 'vitest run', lint: 'eslint .' };
    expect(legacyStringTestCommands(input)).toEqual(input);
  });

  it('drops a structured entry, keeping every string-valued sibling', () => {
    const input = {
      unit: 'vitest run',
      e2e: { run: 'custom-runner', output: { source: 'stdout' } as const, format: 'tap' as const },
    };
    expect(legacyStringTestCommands(input)).toEqual({ unit: 'vitest run' });
  });

  it('an all-structured record narrows to an empty object, never throwing', () => {
    const input = {
      unit: { run: 'custom-runner', output: { source: 'stdout' } as const, format: 'tap' as const },
    };
    expect(legacyStringTestCommands(input)).toEqual({});
  });

  it('an empty record narrows to an empty object', () => {
    expect(legacyStringTestCommands({})).toEqual({});
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

  it(
    'is optional, like execution.testRoots/execution.mergeChecks: a .forge/config.yaml written before ' +
      'this piece has no paths.release key and must stay valid',
    () => {
      const config = goldenConfig() as { paths: Record<string, unknown> };
      const pathsWithoutRelease = Object.fromEntries(
        Object.entries(config.paths).filter(([key]) => key !== 'release'),
      );
      const result = configSchema.safeParse({ ...config, paths: pathsWithoutRelease });
      expect(result.success, !result.success ? JSON.stringify(result.error.issues) : '').toBe(true);
    },
  );

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

  it('rejects a whitespace-only entry (min(1) alone would accept it)', () => {
    expect(withRelease(['   ']).success).toBe(false);
    expect(withRelease(['\t']).success).toBe(false);
  });

  it('rejects a Windows UNC path (a leading "\\\\", no drive letter)', () => {
    expect(withRelease(['\\\\server\\share']).success).toBe(false);
  });

  it('rejects a bare drive letter with no separator (drive-relative, e.g. "C:secrets")', () => {
    expect(withRelease(['C:secrets']).success).toBe(false);
    expect(withRelease(['c:secrets']).success).toBe(false);
  });
});

describe('configSchema — gates.waiverMaxDays (PLAN-M14.md P16, SPEC-QUESTIONS.md Q232 decision 10)', () => {
  const withGates = (gates: unknown) => configSchema.safeParse({ ...goldenConfig(), gates });

  it('is optional: a config written before it existed (no gates key at all) stays valid', () => {
    expect(configSchema.safeParse(goldenConfig()).success).toBe(true);
  });

  it('accepts a positive integer', () => {
    expect(withGates({ waiverMaxDays: 90 }).success).toBe(true);
    expect(withGates({ waiverMaxDays: 1 }).success).toBe(true);
  });

  it('rejects zero, a negative number, and a non-integer', () => {
    expect(withGates({ waiverMaxDays: 0 }).success).toBe(false);
    expect(withGates({ waiverMaxDays: -1 }).success).toBe(false);
    expect(withGates({ waiverMaxDays: 1.5 }).success).toBe(false);
  });

  it('rejects a non-numeric value', () => {
    expect(withGates({ waiverMaxDays: 'x' }).success).toBe(false);
  });

  it('rejects an unknown key inside gates (strict)', () => {
    const result = withGates({ waiverMaxDays: 90, extra: true });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['gates']);
  });

  it('rejects gates missing waiverMaxDays entirely', () => {
    expect(withGates({}).success).toBe(false);
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

describe('configSchema — vcs.trunk defaults to "main" for a config written before this key existed (specs/22 M17 P9)', () => {
  /** A real pre-M17 `.forge/config.yaml`, as every project's committed file actually reads today:
   * `18` §18.3's own golden fixture with the `vcs.trunk` key this piece added removed again — never
   * hand-built from scratch, so this stays byte-for-byte what every OTHER field in a real file looks
   * like, with only the one key under test actually missing. */
  function preM17Config(): Record<string, unknown> {
    const config = goldenConfig() as { vcs: Record<string, unknown> };
    const vcsWithoutTrunk = { ...config.vcs };
    delete vcsWithoutTrunk['trunk'];
    return { ...config, vcs: vcsWithoutTrunk };
  }

  it('parses successfully with no "vcs.trunk" key at all, filling the documented default "main" (never CFG-001 on every pre-existing project)', () => {
    const result = configSchema.safeParse(preM17Config());

    expect(result.success, !result.success ? JSON.stringify(result.error.issues) : '').toBe(true);
    if (result.success) expect(result.data.vcs.trunk).toBe('main');
  });

  it('still refuses a real type error on vcs.trunk when the key IS present, rather than silently defaulting past a genuine mistake', () => {
    const config = goldenConfig() as { vcs: Record<string, unknown> };
    const result = configSchema.safeParse({ ...config, vcs: { ...config.vcs, trunk: 123 } });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['vcs', 'trunk']);
  });

  it('still refuses an empty string, exactly as execution.integrationBranch (the identical .min(1) rule) does', () => {
    const config = goldenConfig() as { vcs: Record<string, unknown> };
    const result = configSchema.safeParse({ ...config, vcs: { ...config.vcs, trunk: '' } });

    expect(result.success).toBe(false);
  });
});
