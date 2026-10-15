/**
 * `configSchema` — the whole of `.forge/config.yaml`, `18` §18.3.
 *
 * Every nested object is `.strict()`: unknown keys are refused at every level, not just the top one,
 * per `PLAN-M1.md` P8's Check.
 *
 * `platform.claudeCode` (named that in `18` §18.3's own example) does not appear here as
 * `platform.claudeCode` — it is `platform.adapterConfig`, a `Record` keyed by an opaque platform id.
 * See `SPEC-QUESTIONS.md` Q16 and Q25: the literal property name `claudeCode` is a platform concept
 * this package sits below `adapter-kit` to avoid, and — concretely, not just architecturally — is a
 * name the already-shipped `no-platform-concept` lint rule refuses anywhere under `packages/schemas`.
 *
 * @see specs/18 §18.3
 * @see specs/02 §2.8
 * @see SPEC-QUESTIONS.md Q16
 * @see SPEC-QUESTIONS.md Q25
 */
import { z } from 'zod';

import { DIAGRAM_NOTATIONS } from '../artifacts/diagram.ts';

const projectSchema = z
  .object({
    // Not `.min(1)`: the built-in defaults layer (02 §2.8's lowest-precedence layer) has no project
    // identity yet — a real project sets these in its committed config.yaml, which is a higher layer.
    name: z.string(),
    slug: z.string(),
    description: z.string(),
    level: z.enum(['L0', 'L1', 'L2', 'L3', 'L4']),
    mode: z.enum(['guided', 'express']),
    repoUrl: z.string(),
    // `17` §17.4: brownfield adjustments (narrower file-claim defaults among them) key off whether
    // this project went through `forge adopt` at all — a fact about the project's own origin, not a
    // per-run flag, so it lives here rather than in `execution` alongside the per-run autonomy level
    // it modifies. Set once by `forge adopt`'s own pipeline (`packages/cli/src/commands/adopt.ts`)
    // after a full, non-`quick` run completes; never set by this package itself (`@forge/schemas` only
    // knows the shape, never derives project facts — the same split every other config field already
    // follows). See `SPEC-QUESTIONS.md` for the record — `17` §17.2's own text names this marker only
    // in passing ("a project's own `adopted: true` marker"), with no prior piece ever having written
    // one.
    adopted: z.boolean(),
  })
  .strict();

/**
 * One `paths.release` entry (`PLAN-M14.md` P12, `SPEC-QUESTIONS.md` Q216 / Q232 decision 4): a
 * repo-relative glob naming where the project's own release-build app source lives, spliced verbatim
 * into `prepare-release-build`'s claim (`resolveClaimEntry`, `@forge/engine/plan/compile.ts`) in place
 * of a workflow guessing at the app's own layout. Refused the identical way that claim matcher's own
 * hygiene already refuses a hand-written `produces` entry (`06` §6.7, `PLAN-M13.md` P16): absolute (it
 * would resolve outside the project), a `..` segment (it could climb out of the project), or leading `!`
 * (the claim matcher reads that as an exclusion, not a literal path — this entry is spliced straight
 * into `produces`, so a `!`-leading one would silently invert its own meaning instead of claiming
 * anything).
 */
function isValidReleasePathEntry(entry: string): boolean {
  if (entry.trim() === '') return false;
  if (entry.startsWith('!')) return false;
  if (entry.startsWith('/') || entry.startsWith('\\')) return false;
  // A drive letter is refused whether or not a separator follows it (`C:\secrets` and the
  // drive-relative `C:secrets` are both absolute-ish Windows paths; only the first was caught before
  // a round-2 critic found the gap between this function's own behaviour and its documented contract).
  if (/^[A-Za-z]:/.test(entry)) return false;
  if (entry.split(/[/\\]/).some((segment) => segment === '..')) return false;
  return true;
}

const releasePathEntrySchema = z
  .string()
  .min(1)
  .refine(isValidReleasePathEntry, (entry) => ({
    message:
      `"${entry}" is not a valid paths.release entry: it must be non-blank and repo-relative (no ` +
      'leading "/" or "\\\\", no drive letter), contain no ".." segment, and not start with "!".',
  }));

const pathsSchema = z
  .object({
    kb: z.string().min(1),
    specs: z.string().min(1),
    plans: z.string().min(1),
    sessions: z.string().min(1),
    reports: z.string().min(1),
    code: z.string().min(1),
    // `PLAN-M14.md` P12: app source paths `prepare-release-build` claims (a glob per entry), read by
    // `buildRunExpressionContext` (`@forge/cli/commands/run/expression-context.ts`) into the expression
    // language's `config` root. `forge init` writes `[]` for a fresh project (`defaults.ts`) —
    // deliberately, not guessed: a workflow that reads `config.paths.release` while it is empty (or
    // unset) is refused (`RUN-106`) before it compiles at all, rather than silently claiming nothing.
    // Optional, unlike the other `paths.*` fields, the identical reason `execution.testRoots`/
    // `execution.mergeChecks` are (`PLAN-M14.md` P5, P38): a `.forge/config.yaml` written before this
    // piece has no such key and must stay valid — every real reader treats an absent key the same as an
    // empty list (`buildRunExpressionContext`'s own `?? []`), so the two states carry no distinct meaning
    // (contrast `testRoots`, where "unset" genuinely means something else than "explicitly `[]`").
    release: z.array(releasePathEntrySchema).optional(),
  })
  .strict();

const platformRoutingSchema = z
  .object({
    onRateLimit: z.string().min(1),
    onOutage: z.string().min(1),
  })
  .strict();

const platformSchema = z
  .object({
    primary: z.string(),
    fallback: z.string().min(1).nullable(),
    perAgent: z.record(z.string(), z.string()),
    routing: platformRoutingSchema,
    // Q16 / Q25: keyed by an opaque platform id; each value is that platform's own adapter package's
    // config, entirely opaque here — @forge/schemas cannot know its shape without importing the
    // adapter, which the dependency graph forbids.
    adapterConfig: z.record(z.string(), z.record(z.string(), z.unknown())),
  })
  .strict();

const modelTierMapSchema = z.record(z.string(), z.string());

const modelsSchema = z
  .object({
    tiers: z
      .object({
        frugal: modelTierMapSchema,
        balanced: modelTierMapSchema,
        max: modelTierMapSchema,
      })
      .strict(),
    // Keyed by agent role id — roles are themselves data (roster.add/split below), not a closed set
    // this package can enumerate.
    overrides: z.record(z.string(), z.string()),
  })
  .strict();

const sharedMutablePathSchema = z
  .object({
    glob: z.string().min(1),
    // Only two examples given ("regenerate", "append-only"), with no exhaustive-enum comment —
    // left open rather than guessing the rest of the set.
    strategy: z.string().min(1),
    command: z.string().min(1).optional(),
  })
  .strict();

// `13` §13.1 F-TEST-1 rule 4: "every layer has a single command... recorded in the KB" — a record,
// not a fixed-shape object with seven optional fields: `packages/schemas/src/config/walk.ts`'s own
// `configLeafPaths` walker recurses into every `ZodObject` field individually (each would need its
// own `CONFIG_KEY_DOCS` entry and its own resolvable `DEFAULT_CONFIG` value, exactly the "leaf" shape
// this field is not), but explicitly stops at a `ZodRecord` — the identical "its own keys are data,
// not schema" treatment `platform.perAgent`/`execution.autonomyByGate` already get. A project need
// not declare every layer at once; an absent key (not present, not `undefined`) means "this layer has
// no real command yet," a real, typed finding a rule that needs it reports rather than silently
// treating as passing. The KB write F-TEST-1 names is this schema's own human-readable *description*,
// not its machine source of truth — the same "structured config for machines, KB for rationale" split
// every other machine-consumed value in this codebase already follows (gates, workflows, frameworks).
// See `SPEC-QUESTIONS.md`.
// `smoke` is not one of F-TEST-1's five pyramid layers: it is the small suite `G-Deliver` runs against the deployed
// target (`14` §14.9: "smoke and e2e green in the target environment"). It gets its own key rather than borrowing
// `e2e`, whose command runs the whole capability suite in the preview environment (`PLAN-M13.md` P25, Q219).
const TEST_LAYERS = [
  'unit',
  'integration',
  'contract',
  'e2e',
  'nfr',
  'smoke',
  'lint',
  'typecheck',
] as const;

// Post-v1.0, `specs/22` M17 P3 (`13` F-TEST-7 point 2, `18` §18.3): the built-in parsers every
// structured `testCommands.<layer>` entry may declare, each converting its own real shape into `09`
// §9.5's `forge-test-report` before any FORGE command reads it. `forge-json` is `09` §9.5's own shape
// directly -- a project (or translator) that already emits it needs no further mapping.
export const TEST_REPORT_FORMATS = [
  'junit-xml',
  'tap',
  'forge-json',
  'vitest-json',
  'jest-json',
  'go-test-json',
] as const;

/** One of `TEST_REPORT_FORMATS` — `loop/test/parsers/index.ts`'s own `PARSERS` dispatch table takes
 * exactly this type, so a future seventh format FORGE adds here cannot silently fall through that
 * table unparsed (`pnpm typecheck` catches a missing `Record` key). */
export type TestReportFormat = (typeof TEST_REPORT_FORMATS)[number];

// `specs/22` M17 P5 (`18` §18.3's own "quality.coverage.source/.format" paragraph -- the sibling
// `path` field below is this piece's own renaming of that paragraph's "`format`", not a second,
// independent field): the coverage report shapes `loop/test/coverage.ts` can parse, replacing the
// pre-M17 hard-coded assumption that
// coverage always arrives as Istanbul/v8's own `coverage/coverage-summary.json`. `istanbul-json` is
// the real default: `quality.coverage.source` is optional precisely so a `.forge/config.yaml`
// written before this field existed (which `readConfig`, `commands/config.ts`, validates directly,
// with no defaults-merge step of its own) stays valid, and `coverage.ts`'s own resolution treats an
// absent `source` as `istanbul-json` -- behaving byte-identically to pre-M17 FORGE.
export const COVERAGE_SOURCES = ['istanbul-json', 'lcov', 'cobertura', 'jacoco'] as const;

/** One of `COVERAGE_SOURCES` — `loop/test/coverage.ts`'s own per-format reader dispatch takes exactly
 * this type, so a future fifth format cannot silently fall through unparsed. */
export type CoverageSource = (typeof COVERAGE_SOURCES)[number];

// `specs/22` M17 P5 (`13` F-TEST-2, `18` §18.3): `test:oracle-lint`'s own test-file discovery set,
// ported verbatim from `oracle-lint.ts`'s own pre-M17 hard-coded `TEST_FILE_SUFFIXES`/`isTestFile`
// logic into glob form (matched against each file's own basename, never a full path). The whole
// `quality.oracleLint` object is optional for the identical reason `source` above is: a
// `.forge/config.yaml` written before this field existed has no such key at all, and `oracle-
// lint.ts`'s own resolution treats an absent value as this exact list -- scanning exactly the files
// pre-M17 FORGE did. Deliberately asymmetric (`.spec.js`/`.spec.ts` only, no `.spec.jsx`/
// `.spec.tsx`) because the pre-M17 code being ported was asymmetric too -- not revisited here, since
// "defaults unchanged" (PLAN-M17.md P5) is the whole point.
export const DEFAULT_ORACLE_LINT_TEST_FILE_GLOBS = [
  '*.test.js',
  '*.test.jsx',
  '*.test.ts',
  '*.test.tsx',
  '*.spec.js',
  '*.spec.ts',
  'test_*.py',
  '*_test.py',
] as const;

// `output.path` is a project-relative file FORGE itself allocates and deletes before every run of
// that layer (`18` §18.3's own "a stale report is never read" guarantee) -- it is read with the same
// `ProjectPaths.resolveWithin` containment every other project-relative write/delete in this codebase
// already goes through, which rejects a traversal or an absolute path at the point of use (`CFG-003`).
// This schema-level check exists so a bad path fails fast at `forge config set`/validation time
// (`CFG-001`), not only the first time a test layer actually runs -- the identical reasoning
// `isValidReleasePathEntry` above already states for `paths.release`; reused rather than re-derived.
const testCommandOutputSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('stdout') }).strict(),
  z
    .object({
      source: z.literal('file'),
      path: z
        .string()
        .min(1)
        .refine(isValidReleasePathEntry, (path) => ({
          message:
            `"${path}" is not a valid testCommands output.path: it must be non-blank and ` +
            'project-relative (no leading "/" or "\\\\", no drive letter), contain no ".." segment, ' +
            'and not start with "!".',
        })),
    })
    .strict(),
]);

// `18` §18.3's structured `execution.testCommands.<layer>` form (post-v1.0, `specs/22` M17 P3):
// `{run, output, format, translate?, scope?, filter?, timeoutMs?}`, alongside (never mixed with) the
// legacy bare string. `run`/`translate`/`scope`/`filter` are shell-command TEMPLATES -- this schema
// validates only that each is a real, non-blank string; the `{files}`/`{name}`/`{name:regex}`/
// `{output}` placeholders inside them are a runtime (`loop/test/reporter.ts`) concern, not a shape
// this package can check without running a shell.
const structuredTestCommandSchema = z
  .object({
    run: z.string().min(1),
    output: testCommandOutputSchema,
    format: z.enum(TEST_REPORT_FORMATS),
    translate: z.string().min(1).optional(),
    scope: z.string().min(1).optional(),
    filter: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

/** One `execution.testCommands.<layer>` entry: the legacy bare string (`18` §18.3's own exact
 * current meaning, by `detectEcosystem`) or the structured form (post-v1.0, `specs/22` M17 P3).
 * Exported so `@forge/cli`'s `loop/test/reporter.ts` narrows against this exact union rather than a
 * second, hand-kept type that could drift from it -- the same discipline `run.ts`'s own pre-existing
 * `TestCommands = ForgeConfig['execution']['testCommands']` alias already follows. */
export const testCommandEntrySchema = z.union([z.string().min(1), structuredTestCommandSchema]);

/** The structured `execution.testCommands.<layer>` shape alone, narrowed out of
 * `testCommandEntrySchema` — `loop/test/reporter.ts`'s own structured-layer runner takes exactly
 * this type. */
export type StructuredTestCommand = z.infer<typeof structuredTestCommandSchema>;

/** `execution.testCommands.<layer>`'s own value type: a legacy bare string or the structured form. */
export type TestCommandEntry = z.infer<typeof testCommandEntrySchema>;

const testCommandsSchema = z.record(z.enum(TEST_LAYERS), testCommandEntrySchema);

// `06` §6.5 steps 3 and 5 (`PLAN-M13.md` P38): the pre- and post-merge check set the engine runs around a lane it
// integrates on its own (one no `merge` step lands, `06` §6.4). Same vocabulary as a merge step's `policy.preChecks`
// / `postChecks` (`10` §10.1): a check-set NAME (`fast`, `full`, or one test layer such as `unit`, resolved against
// `execution.testCommands`) or a literal shell command. A record like `testCommands` (the keys are `pre` and `post`,
// each optional; absent means no check), so an unset default stays `{}` and a project opts in.
const mergeChecksSchema = z.record(z.enum(['pre', 'post']), z.string().min(1));

const executionSchema = z
  .object({
    concurrency: z.union([z.literal('auto'), z.number().int().positive()]),
    autonomy: z.enum(['supervised', 'guided', 'autonomous']),
    // Keyed by gate id (G-Design, G-Deliver, ...) — gates are configurable per specs/15, not a set
    // this package can close.
    autonomyByGate: z.record(z.string(), z.enum(['supervised', 'guided', 'autonomous'])),
    retainLaneWorktrees: z.enum(['never', 'on-failure', 'always']),
    integrationBranch: z.string().min(1),
    conflictPolicy: z.enum(['agent', 'human', 'abort']),
    sharedMutablePaths: z.array(sharedMutablePathSchema),
    testCommands: testCommandsSchema,
    // Optional, unlike `testCommands`: a `.forge/config.yaml` written before P23 has no such key, and `undefined`
    // is its own meaningful value — "use the built-in rule" (`isTestPath`, `engine/dispatch/test-path.ts`) — not
    // a default to fill in (`PLAN-M14.md` P5, `SPEC-QUESTIONS.md` Q230's `{path}` follow-up).
    testRoots: z.array(z.string().min(1)).optional(),
    // Optional, unlike `testCommands`: a `.forge/config.yaml` written before P38 has no such key and must stay valid.
    mergeChecks: mergeChecksSchema.optional(),
    // `specs/22` M15 P9: how many automatic fix-and-re-review rounds a `swarm-review` step runs before
    // giving up (`RUN-113`) on a verdict that stays `blocked`. Optional, the identical "a
    // `.forge/config.yaml` written before this piece existed has no such key and must stay valid" reason
    // `mergeChecks`/`testRoots` already are -- `DEFAULT_CONFIG.execution.criticRounds` (3) is the real
    // default a project that never sets this gets, not "no looping at all" (unlike `mergeChecks`'s own
    // "unset: no checks"). `0` (not `.positive()`) is deliberately ALLOWED and distinct from leaving this
    // unset: it is the one real, explicit opt-out for a project whose own workflows declare a
    // `swarm-review` step with no sensible `fixAgent` to dispatch (an older or third-party workflow this
    // milestone's own shipped ones are not the only example of) -- `context.ts`'s own `?? 3` only ever
    // falls back on `undefined`/`null`, never on a real, explicit `0`, so this is the one way a project
    // can genuinely disable automatic looping rather than merely accepting whatever the default happens
    // to be. A round-1 gauntlet critic found the pre-`.nonnegative()` version of this schema made that
    // opt-out literally impossible to configure, regressing `build-stage.workflow.yaml`'s own pre-P9
    // review step (no `fixAgent`) on every real run, not merely a theoretical gap.
    criticRounds: z.number().int().nonnegative().optional(),
  })
  .strict();

/**
 * `PLAN-M14.md` P16 (`SPEC-QUESTIONS.md` Q232 decision 10): gate-wide waiver policy, independent of any
 * one gate's own document — a new top-level block, sibling to `execution` (which already carries the
 * per-gate `autonomyByGate` map above), not nested inside it: this bounds `forge gate waive` itself, not
 * one gate's own autonomy. `waiverMaxDays` caps how many days later than the moment a waiver is granted
 * its own `--expires` may fall (`10` §10.3 rule 1: "waivers require a reason, an owner, and an expiry" —
 * an unbounded expiry is a silent, permanent policy change dressed up as a temporary exception).
 *
 * Optional at the top level, the identical "a `.forge/config.yaml` written before this piece has no such
 * key and must stay valid" reason `execution.mergeChecks`/`paths.release` are already optional for: every
 * real reader (`@forge/cli`'s `gate-commands.ts`) treats an absent `gates` block the same as the
 * documented default (90 days, `defaults.ts`), never a validation gap.
 */
const gatesSchema = z
  .object({
    waiverMaxDays: z.number().int().positive(),
  })
  .strict();

const budgetSchema = z
  .object({
    perRunUsd: z.number().nonnegative(),
    perStepUsdDefault: z.number().nonnegative(),
    dailyUsd: z.number().nonnegative(),
    onBreach: z.enum(['pause', 'finish-lanes', 'abort']),
  })
  .strict();

const rosterSchema = z
  .object({
    // No closed preset list is given anywhere in the spec pack — left open.
    preset: z.string().min(1),
    enable: z.array(z.string().min(1)),
    disable: z.array(z.string().min(1)),
    alias: z.record(z.string(), z.string()),
    // Both examples are empty arrays with no element shape shown anywhere — kept fully open rather
    // than inventing a role-definition shape with no spec source.
    add: z.array(z.unknown()),
    split: z.record(z.string(), z.array(z.string())),
  })
  .strict();

const kbSchema = z
  .object({
    packBudgetTokens: z.number().int().positive(),
    retrieval: z
      .object({
        embeddings: z.boolean(),
        graphHops: z.number().int().nonnegative(),
      })
      .strict(),
    // Exactly the five sections 18 §18.3's own example names — not every KB section specs/08
    // describes, since this config key's shape is defined by what is actually in this schema.
    staleness: z
      .object({
        architecture: z.number().int().positive(),
        data: z.number().int().positive(),
        delivery: z.number().int().positive(),
        product: z.number().int().positive(),
        ops: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

const skillsSchema = z
  .object({
    packBudgetTokens: z.number().int().positive(),
    hardBodyCapTokens: z.number().int().positive(),
  })
  .strict();

const mcpSchema = z
  .object({
    // No field-level shape is given anywhere for a server entry (the example is an empty array) —
    // kept open.
    servers: z.array(z.unknown()),
    grants: z.record(z.string(), z.unknown()),
    defaults: z
      .object({
        // Only one example value each, with no "# a | b" comment — left open.
        grantMode: z.string().min(1),
        injectionPosture: z.string().min(1),
      })
      .strict(),
    adoptHostServers: z.boolean(),
  })
  .strict();

const diagramsSchema = z
  .object({
    defaultNotation: z.enum(DIAGRAM_NOTATIONS),
    allowedNotations: z.array(z.enum(DIAGRAM_NOTATIONS)),
    render: z.enum(['never', 'on-demand', 'on-gate']),
    remoteRenderer: z.string().min(1).nullable(),
    complexity: z
      .object({
        maxNodes: z.number().int().positive(),
        maxEdges: z.number().int().positive(),
        hardMaxNodes: z.number().int().positive(),
      })
      .strict(),
    driftPolicy: z.enum(['fail', 'autofix', 'warn']),
    requireCaptions: z.boolean(),
  })
  .strict();

const qualitySchema = z
  .object({
    coverage: z
      .object({
        lines: z.number().min(0).max(100),
        branches: z.number().min(0).max(100),
        ratchet: z.boolean(),
        // `specs/22` M17 P5: which coverage report shape `forge test coverage` parses -- see this
        // field's own group doc comment at `COVERAGE_SOURCES` above. Optional, unlike `lines`/
        // `branches`/`ratchet` above (every one of those predates this piece and was always
        // required): a `.forge/config.yaml` written before this field existed has no such key, and
        // `readConfig` (`commands/config.ts`) validates the raw file directly with no defaults-merge
        // step of its own, so a required field here would break every such file outright. Unset means
        // `istanbul-json` -- `coverage.ts`'s own resolution, not a schema-level default.
        source: z.enum(COVERAGE_SOURCES).optional(),
        // `specs/22` M17 P5: a project-relative OVERRIDE of `source`'s own conventional report path
        // (`coverage/coverage-summary.json` for istanbul-json, `coverage/lcov.info` for lcov,
        // `coverage/cobertura-coverage.xml` for cobertura, `coverage/jacoco.xml` for jacoco).
        // `18` §18.3's own normative text (committed by P1 before this piece) names this field
        // `format` -- NOT used here: a round-2 critic found that name collides, in the same spec
        // section, with the unrelated, already-shipped `execution.testCommands.<layer>.format`
        // (an ENUM picking a parser, `TEST_REPORT_FORMATS`) -- `quality.coverage.format: 'lcov'`, the
        // exact value a user would type by analogy with that sibling field, would otherwise pass
        // validation and get read as a literal, nonsensical path. Named `path` instead, since that is
        // genuinely what it holds -- a real, disclosed deviation from `18` §18.3's own literal text,
        // not a silent one: this piece's own report names it for the orchestrator to record in
        // `SPEC-QUESTIONS.md` and amend `18` to match (this package does not edit `process/**`
        // itself). Unset (the default): read `source`'s own conventional path.
        path: z
          .string()
          .min(1)
          .refine(isValidReleasePathEntry, (entry) => ({
            message:
              `"${entry}" is not a valid quality.coverage.path entry: it must be non-blank and ` +
              'project-relative (no leading "/" or "\\\\", no drive letter), contain no ".." segment, ' +
              'and not start with "!".',
          }))
          .optional(),
      })
      .strict(),
    // `specs/22` M17 P5 (`13` F-TEST-2): `test:oracle-lint`'s own test-file discovery set -- see
    // `DEFAULT_ORACLE_LINT_TEST_FILE_GLOBS`'s own doc comment above for what the default preserves.
    // The whole object is optional (not only `testFileGlobs` within it), the identical `gates:
    // gatesSchema.optional()` pattern above: a `.forge/config.yaml` written before this piece existed
    // has no `quality.oracleLint` key at all, not merely an empty one -- `walk.ts`'s own `unwrap()`
    // already handles an optional whole-object leaf correctly (added for `gates`, reused here
    // unchanged). Unset means `DEFAULT_ORACLE_LINT_TEST_FILE_GLOBS` -- `oracle-lint.ts`'s own
    // resolution, not a schema-level default.
    oracleLint: z
      .object({
        testFileGlobs: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .optional(),
    flake: z
      .object({
        maxRatePct: z.number().min(0).max(100),
        window: z.number().int().positive(),
        quarantineCap: z.number().int().nonnegative(),
      })
      .strict(),
    pyramid: z
      .object({
        maxE2ESharePct: z.number().min(0).max(100),
      })
      .strict(),
    // Profiles are customizable (specs/15) — left open.
    dodProfileDefault: z.string().min(1),
  })
  .strict();

const securitySchema = z
  .object({
    secretSource: z.enum(['env', 'keychain', 'file', 'command']),
    secretCommand: z.string().min(1).nullable(),
    toolCeilingEscalations: z.array(z.unknown()),
    destructiveOps: z.enum(['confirm', 'deny', 'allow-in-lane']),
    // "redactPatterns entries compile as regular expressions; an invalid pattern is a validation
    // error" (PLAN-M1.md P8's Check) — checked with a refinement, since z.string() alone cannot
    // express "compiles as a RegExp". A leading `(?i)` is recognised as the PCRE/Python
    // case-insensitivity idiom `18` §18.3's own example uses — not valid JS RegExp syntax on its own
    // (`new RegExp('(?i)x')` throws) — and translated to the JS `i` flag before compiling; every other
    // pattern compiles as plain JS RegExp syntax. See `SPEC-QUESTIONS.md` Q26 for why, and for the
    // note that whatever later piece actually applies these patterns needs the identical translation.
    redactPatterns: z.array(
      z.string().refine(
        (pattern) => {
          const caseInsensitive = pattern.startsWith('(?i)');
          const body = caseInsensitive ? pattern.slice('(?i)'.length) : pattern;
          try {
            // Constructed only to prove `body` compiles; the instance itself is never used.
            new RegExp(body, caseInsensitive ? 'i' : undefined);
            return true;
          } catch {
            return false;
          }
        },
        (pattern) => ({ message: `"${pattern}" does not compile as a regular expression.` }),
      ),
    ),
  })
  .strict();

const vcsSchema = z
  .object({
    // `specs/22` M17 P9, `18` §18.3's "`vcs.trunk`" paragraph: every place that used to assume the
    // literal string `"main"` (the integration branch's own base, `--trusted @trunk`'s resolution,
    // `forge land`) reads this instead. `.min(1)`, matching `execution.integrationBranch` immediately
    // above: a real git ref name, never validated further here (an unsafe value is refused downstream,
    // where it is actually used as one). `.default('main')` is NOT merely this field's own proposed
    // starting value for a brand-new project (`run-init.ts`'s own `detectRealTrunkBranch` already
    // writes the project's real branch there, never this default, whenever a real git repository
    // exists to ask) — it is load-bearing for every config.yaml committed before this field existed at
    // all: `readConfig` (`cli/src/commands/config.ts`) parses a raw file straight through this schema,
    // with no separate defaults-merge step anywhere, so a `.strict()` object with a bare, default-less
    // `z.string()` here would make `trunk: Required` fail EVERY pre-existing project's config on EVERY
    // command, until a human hand-edited the file — confirmed directly: deleting this field from a
    // real, otherwise-valid config object (`schema.test.ts`'s own "config written before this key
    // existed" test) reproduces exactly that `invalid_type`/`Required` failure without it.
    trunk: z.string().min(1).default('main'),
    allowCommits: z.boolean(),
    // No exhaustive convention list is given — left open.
    commitConvention: z.string().min(1),
    signCommits: z.boolean(),
    trailers: z.boolean(),
  })
  .strict();

const telemetrySchema = z
  .object({
    network: z.boolean(),
    otlpEndpoint: z.string().min(1).nullable(),
  })
  .strict();

const outputSchema = z
  .object({
    // Not in PLAN-M1.md P8's named enum-key list, and 18 §18.3's own example carries no "# a | b | c"
    // comment for it either — left open despite looking enum-shaped.
    color: z.string().min(1),
    ascii: z.boolean(),
    style: z.string().min(1),
  })
  .strict();

export const configSchema = z
  .object({
    version: z.number().int().positive(),
    project: projectSchema,
    paths: pathsSchema,
    platform: platformSchema,
    models: modelsSchema,
    execution: executionSchema,
    // `PLAN-M14.md` P16: optional (see `gatesSchema`'s own doc comment above).
    gates: gatesSchema.optional(),
    budget: budgetSchema,
    roster: rosterSchema,
    kb: kbSchema,
    skills: skillsSchema,
    mcp: mcpSchema,
    diagrams: diagramsSchema,
    quality: qualitySchema,
    security: securitySchema,
    vcs: vcsSchema,
    telemetry: telemetrySchema,
    output: outputSchema,
  })
  .strict();

export type ForgeConfig = z.infer<typeof configSchema>;

/**
 * Narrows `execution.testCommands` down to only its legacy bare-string entries, dropping any
 * structured ones (post-v1.0, `specs/22` M17 P3) — for a consumer that still declares its own
 * `testCommands` field as a plain `Readonly<Partial<Record<string, string>>>` and has not yet been
 * taught the structured shape (an exec-grant helper offering a diagnostician the project's own test
 * commands to run, a prompt-assembly or run-engine context that passes this record straight through
 * as display/constraint data). Every existing, string-only project is completely unaffected — every
 * entry survives this filter byte-identical — and a newly-structured layer's own command is simply
 * not yet visible to that one consumer, never guessed at or silently misrepresented as a plain
 * string: the same zero-change-migration guarantee `18` §18.3 states for the legacy form generally,
 * applied at this one remaining narrow-typed seam until each such consumer is itself widened.
 *
 * @see specs/18 §18.3
 * @see specs/22 M17 P3
 */
export function legacyStringTestCommands(
  testCommands: ForgeConfig['execution']['testCommands'],
): Readonly<Partial<Record<string, string>>> {
  const result: Record<string, string> = {};
  for (const [layer, entry] of Object.entries(testCommands)) {
    if (typeof entry === 'string') result[layer] = entry;
  }
  return result;
}
