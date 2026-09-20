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

const pathsSchema = z
  .object({
    kb: z.string().min(1),
    specs: z.string().min(1),
    plans: z.string().min(1),
    sessions: z.string().min(1),
    reports: z.string().min(1),
    code: z.string().min(1),
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
const testCommandsSchema = z.record(z.enum(TEST_LAYERS), z.string().min(1));

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
      })
      .strict(),
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
