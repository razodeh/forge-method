/**
 * The known-gap inventory for the output contract check (`PLAN-M13.md` P7, P11; `SPEC-QUESTIONS.md` Q208
 * finding 4 and Q209): every agent step of every shipped workflow that declares `outputs` but is assigned
 * to an agent that cannot write them, derived from the real shipped workflows and the real shipped agents
 * rather than listed by hand.
 *
 * Why it exists. The output contract check fails an agent step whose declared outputs are not produced.
 * Shipped workflows used to assign file-producing steps to agents whose own grant forbade writing files
 * (`em`, `analyst`, `pm`, `po`, `architect`, `reviewer`, `security`, `test-architect`, `ux`,
 * `data-architect`, `integration-architect`), and 28 steps could not succeed. The check is deliberately not
 * exempted for any step and does not consult this inventory; this test makes the size of the gap visible
 * and makes changing it deliberate.
 *
 * One class: `no-write-grant`, the agent's `tools.write` is `false`, so its session cannot write a file at
 * all (the live case: `retro:run-retro`). `PLAN-M13.md` P15 (`SPEC-QUESTIONS.md` Q220, owner decision
 * 2026-09-20) flipped the grant of every AUTHORING role, confined by the P14 claim, and reassigned
 * `define-product:write-prd` from `po` to `pm` (`05` §5.2), so the inventory is now EMPTY (28 -> 0 with P17):
 * an entry may only be added back by a deliberate decision, and this file then fails until it is named.
 *
 * `PLAN-M13.md` P17 (`SPEC-QUESTIONS.md` Q217) took the two `swarm-review` reviewer steps
 * (`build-stage:review`, `implement-story:review`) out of it, and they are NOT exempt: the `reviewer` stays
 * `write: false` (separation of duties), a `mode: swarm-review` step now runs one read-only session per
 * perspective and the ENGINE writes and validates the `ReviewReport` in the step's own lane, after which the
 * output contract check runs on that lane like on any agent step. They are pinned below as
 * `ENGINE_WRITTEN_STEPS`, each asserted to declare only engine-written types, so a swarm-review step that
 * declared any other output its write-forbidden reviewer cannot produce is a gap again (and fails here).
 *
 * There used to be a second class, `no-write-scope` (9 steps whose agent's `parallel_safety.file_ownership`
 * does not cover the output's registry path). `PLAN-M13.md` P14 (`SPEC-QUESTIONS.md` Q212) removed it: a
 * step's claim is now its `produces` globs plus the registry paths of its declared `outputs`, and
 * `file_ownership` is enforced nowhere at run time (only `forge agent validate`'s overlap check reads it), so
 * an agent whose ownership omits the output path was never blocked by that, and under `strict` claim
 * enforcement the output is no longer reverted either. The steps are pinned below as
 * `OWNERSHIP_ONLY_STEPS` (9 when P14 landed; 32 once P15 let their agents write, because the P15 roles own
 * a narrower territory than the registry paths their steps declare: the same fact, now for the steps that
 * used to be blocked earlier); their outputs are asserted to lie inside their claim (definition level here;
 * concrete registry paths of every type through the real claim matcher in
 * `packages/engine/test/dispatch/output-claim.test.ts`). That is all "not a gap" means: the output survives
 * claim enforcement. Documents their briefs name beyond the output (`decide-repo-strategy`'s
 * `delivery/repo-strategy.md`, the `sre` pipeline Diagram, the mobile app's own build files) were outside the
 * claim and reverted; `PLAN-M13.md` P16 declares them as `produces` (`SPEC-QUESTIONS.md` Q216), and
 * `test/brief-write-paths-in-claim.test.ts` compares the paths and register entries each brief tells its agent
 * to write with the step's claim (for the default docs layout; its header lists what it cannot see).
 *
 * Only steps that are dispatched are counted (`steps:`, including fanout children and parallel/sequence
 * members); `onComplete` and `onFailure.escalations` steps are not compiled into the run plan. A step whose
 * agent is a run-time template (`{{ownerRole}}`) cannot be classified statically and is listed apart.
 *
 * Lives at the repository root for the reason `test/workflows.test.ts` documents (needs `@forge/engine`,
 * `@forge/templates` and the bare `modules/` directory, which no single package may import).
 *
 * @see specs/05 §5.5
 * @see specs/18 §18.7
 * @see PLAN-M13.md P7, P11, P15
 * @see SPEC-QUESTIONS.md Q208, Q209, Q220
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { AbsolutePath } from '@forge/core';
import { outputGlob, outputPathCoveredBy, resolveStepClaim } from '@forge/engine/dispatch';
import { parseWorkflow, type WorkflowStep } from '@forge/engine/workflow';
import { artifactTypeById } from '@forge/schemas/registry';
import { evidenceBundleSchema, mutationEvidenceSchema } from '@forge/schemas/artifacts';
import { MIGRATIONS } from '@forge/schemas/migrations';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { WORKFLOW_INDEX } from '@forge/templates';

import {
  applyNormalizeRulesToText,
  rewriteRootPaths,
  type ObservedRoot,
} from '../packages/cli/src/commands/parity/normalize.ts';

import { loadAgentRegistry, resolveExtends } from '../packages/agents/src/registry/index.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');

type GapClass = 'no-write-grant';

/**
 * The inventory. Keys are `<workflow>:<step id>`, with the module workflows prefixed `<module>/<file>:`.
 * Each entry would be a step whose agent cannot write. It is empty (P15 with P17): the authoring roles hold
 * `tools.write: true` (confined by the P14 claim), `reviewer` steps are engine-written, and the reverse
 * also holds, a step added here without an agent that cannot write it fails the first test below.
 */
const KNOWN_GAPS: Readonly<Record<string, GapClass>> = {};

/** Pinned on purpose, in addition to the table: P17 took it from 28 to 26 (the two reviewer steps) and P15's
 * grants from 26 to 0; any step that cannot write its declared outputs from now on is a deliberate, recorded
 * exception, not a silent one. */
const PINNED_TOTAL = 0;

/**
 * The steps whose agent cannot write but whose declared outputs the engine writes itself (`PLAN-M13.md` P17): a
 * `mode: swarm-review` step declaring only `ReviewReport`. Not gaps and not exemptions: the output check runs
 * on their lane (`packages/engine/test/interaction/swarm-review-step.test.ts` proves it, and proves a report
 * that is missing or invalid fails the step typed).
 */
const ENGINE_WRITTEN_STEPS: readonly string[] = ['build-stage:review', 'implement-story:review'];
/** The artifact types the engine writes for a step (today only the swarm-review report). */
const ENGINE_WRITTEN_TYPES: ReadonlySet<string> = new Set(['ReviewReport']);

/**
 * The steps whose agent can write but whose `file_ownership` does not cover a declared output's registry path:
 * the retired `no-write-scope` class. Not gaps since P14: the step's claim covers the output, and ownership is
 * not enforced at run time. Kept as an explicit list so the recomputed definition-level fact is visible and any
 * new such step is noticed. It is a ratchet, not a fact about the roles: a piece that changes an agent's
 * `file_ownership` or a step's outputs (P18 aligns both) changes it and updates it deliberately. The first nine are the class as P7 to P13 measured it; the rest are the steps
 * that P15's grants made writable (their roles own a narrower territory than the registry paths of what the
 * steps declare, e.g. a `HandoffRecord` in `reports/handoffs.md` for an agent that owns only its own KB
 * section), plus `plan-stages:review-stages` and `store-release:prepare-store-submission`, which P15 gave
 * `outputs` and which are therefore checked for the first time. `PLAN-M14.md` P42 (`SPEC-QUESTIONS.md`)
 * adds four more (33 -> 37): architect's own `parallel_safety.file_ownership` dropped
 * `docs/forge/kb/decisions/**`/`docs/forge/specs/interfaces/**` (both real `output-ownership-overlap`
 * violations against other roles' declared `ADR`/`InterfaceContract` outputs, `05` §5.9's new rule), so
 * the four architect-run steps that declare `ADR`/`InterfaceContract` (`shape-solution:select-architecture`,
 * `shape-solution:select-stack`, `migrate:plan-migration`, `build-stage:freeze-contracts`) are no longer
 * covered by architect's own narrower `file_ownership` either -- still not a gap, for the identical reason
 * every other entry here isn't: the step's real claim is `produces` plus its declared outputs' own
 * registry paths, not `file_ownership`.
 */
const OWNERSHIP_ONLY_STEPS: readonly string[] = [
  'initialize-project:decide-repo-strategy',
  'debug:run-rca',
  'harden:performance-pass',
  'deliver-stage:design-pipeline',
  'deliver-stage:design-deployment',
  'operate:instrument-observability',
  'operate:define-slos',
  'operate:write-runbooks',
  'fm-mobile/store-release.workflow.yaml:prepare-release-build',
  'adopt:gap-analysis',
  'adopt:reverse-derive-specs',
  'define-product:write-prd',
  'define-product:write-ux-spec',
  'define-product:write-vision',
  'discover:define-metrics',
  'discover:frame-problem',
  'fm-mobile/store-release.workflow.yaml:prepare-store-submission',
  'fm-service/contract-test-cycle.workflow.yaml:draft-contract',
  'harden:security-pass',
  'intake:capture-constraints',
  'intake:propose-level',
  'intake:seed-glossary',
  'plan-stage:write-epics',
  'plan-stage:write-test-plan',
  'plan-stages:decompose-stages',
  'plan-stages:review-stages',
  'refactor:state-invariants',
  'replan:impact-analysis',
  'replan:propose-change',
  'retro:run-retro',
  'shape-solution:model-data',
  'shape-solution:threat-model',
  'verify-stage:verify-nfrs',
  // `PLAN-M14.md` P42: newly uncovered by architect's own reconciled, narrower `file_ownership`.
  'shape-solution:select-architecture',
  'shape-solution:select-stack',
  'migrate:plan-migration',
  'build-stage:freeze-contracts',
];

/** Steps whose agent is a run-time template: cannot be classified from the workflow alone. */
const UNRESOLVED_AGENT_STEPS: readonly string[] = ['implement-story:plan'];

interface DeclaredStep {
  readonly key: string;
  readonly agent: string;
  readonly mode: string | undefined;
  readonly perspectives: readonly string[];
  readonly outputTypes: readonly string[];
  readonly produces: readonly string[];
}

function collect(
  prefix: string,
  steps: readonly WorkflowStep[],
  into: DeclaredStep[],
  inheritedId?: string,
): void {
  for (const step of steps) {
    // A fanout's templated child carries no id of its own: the fanout step's id names it.
    if (step.kind === 'fanout') collect(prefix, [step.step], into, step.id);
    else if (step.kind === 'parallel' || step.kind === 'sequence')
      collect(prefix, step.steps, into);
    else if (step.kind === 'agent' && (step.outputs?.length ?? 0) > 0) {
      into.push({
        key: `${prefix}:${step.id ?? inheritedId ?? step.agent}`,
        agent: step.agent,
        mode: step.mode,
        perspectives: step.perspectives ?? [],
        outputTypes: (step.outputs ?? []).map((output) => output.type),
        produces: typeof step.produces === 'string' ? [step.produces] : (step.produces ?? []),
      });
    }
  }
}

function shippedSteps(): DeclaredStep[] {
  const found: DeclaredStep[] = [];
  for (const [id, relative] of Object.entries(WORKFLOW_INDEX)) {
    const parsed = parseWorkflow(readFileSync(path.join(templatesRoot, relative), 'utf8'));
    if (!parsed.success) throw new Error(`shipped workflow ${id} does not parse`);
    collect(id, parsed.workflow.steps, found);
  }
  for (const moduleName of readdirSync(modulesDir)) {
    const workflowsDir = path.join(modulesDir, moduleName, 'workflows');
    let files: string[];
    try {
      files = readdirSync(workflowsDir).filter((file) => file.endsWith('.workflow.yaml'));
    } catch {
      continue;
    }
    for (const file of files) {
      const parsed = parseWorkflow(readFileSync(path.join(workflowsDir, file), 'utf8'));
      if (!parsed.success) throw new Error(`module workflow ${moduleName}/${file} does not parse`);
      collect(`${moduleName}/${file}`, parsed.workflow.steps, found);
    }
  }
  return found;
}

const registry = await loadAgentRegistry(modulesDir as AbsolutePath);
const declared = shippedSteps();

const derived = new Map<string, GapClass>();
/** Write-forbidden agents whose outputs the engine writes (`swarm-review` + only engine-written types). */
const engineWritten: string[] = [];
const unresolved: string[] = [];
/** Steps whose agent can write but whose `file_ownership` does not cover an output: the retired class. */
const ownershipOnly: string[] = [];
for (const step of declared) {
  if (step.agent.includes('{{')) {
    unresolved.push(step.key);
    continue;
  }
  const agent = resolveExtends(step.agent, registry);
  if (!agent.tools.write) {
    if (
      step.mode === 'swarm-review' &&
      // No perspectives is RUN-046 at run time: such a step writes no report, so it is not engine-written.
      step.perspectives.length > 0 &&
      step.outputTypes.every((type) => ENGINE_WRITTEN_TYPES.has(type))
    ) {
      engineWritten.push(step.key);
      continue;
    }
    derived.set(step.key, 'no-write-grant');
    continue;
  }
  const uncovered = step.outputTypes.some((type) => {
    const definition = artifactTypeById(type);
    return (
      definition === undefined ||
      !outputPathCoveredBy(
        definition.id,
        DEFAULT_CONFIG.paths,
        agent.parallel_safety.file_ownership,
      )
    );
  });
  if (uncovered) ownershipOnly.push(step.key);
}

describe('output contract: the known-gap inventory (P11 / Q208 finding 4)', () => {
  it('lists exactly the shipped agent steps that declare outputs their agent cannot write', () => {
    expect(Object.fromEntries([...derived].sort())).toEqual(
      Object.fromEntries(Object.entries(KNOWN_GAPS).sort()),
    );
  });

  it('pins the count: fixing a step (P15) must lower it deliberately', () => {
    expect(derived.size).toBe(PINNED_TOTAL);
  });

  it('the swarm-review reviewer steps are not gaps because the engine writes their report, not because they are exempt (P17)', () => {
    expect([...engineWritten].sort()).toEqual([...ENGINE_WRITTEN_STEPS].sort());
    for (const key of engineWritten) {
      expect(derived.has(key), `${key} is listed as a gap`).toBe(false);
      // Still write-forbidden: the reviewer's grant was not touched to make this pass.
      const step = declared.find((entry) => entry.key === key);
      expect(step?.agent).toBe('reviewer');
      expect(resolveExtends('reviewer', registry).tools.write).toBe(false);
    }
  });

  it('recomputes the retired no-write-scope class from the real definitions: exactly the pinned steps, none of them a gap', () => {
    expect([...ownershipOnly].sort()).toEqual([...OWNERSHIP_ONLY_STEPS].sort());
    for (const key of ownershipOnly) expect(derived.has(key), `${key} is a gap`).toBe(false);
  });

  it('every ownership-only step is covered by its own claim (produces plus declared outputs), whatever its agent owns', () => {
    for (const step of declared.filter((entry) => ownershipOnly.includes(entry.key))) {
      const claim = resolveStepClaim(
        {
          kind: 'agent',
          produces: step.produces,
          outputs: step.outputTypes.map((type) => ({ type })),
        },
        DEFAULT_CONFIG.paths,
        'warn',
      );
      expect(claim.policy, `${step.key} is enforced strict`).toBe('strict');
      for (const type of step.outputTypes) {
        const definition = artifactTypeById(type);
        expect(definition, `${step.key} declares unregistered ${type}`).toBeDefined();
        if (definition === undefined) continue;
        expect(
          outputPathCoveredBy(definition.id, DEFAULT_CONFIG.paths, claim.globs),
          `${step.key}: ${type} is outside its claim ${claim.globs.join(', ')}`,
        ).toBe(true);
      }
    }
  });

  it('the step the live smoke run found (retro:run-retro, Q208 finding 4) is no longer a gap: its agent writes and the output is checked', () => {
    expect(derived.has('retro:run-retro')).toBe(false);
    const retro = declared.find((step) => step.key === 'retro:run-retro');
    expect(retro?.agent).toBe('em');
    expect(retro?.outputTypes).toEqual(['SessionRecord']);
    expect(resolveExtends('em', registry).tools.write).toBe(true);
  });

  it('write-prd runs as pm, the role 05 §5.2 gives the PRD and the capabilities, and pm declares both of its output types', () => {
    const step = declared.find((entry) => entry.key === 'define-product:write-prd');
    expect(step?.agent).toBe('pm');
    const pmOutputs = resolveExtends('pm', registry).outputs.map((output) => output.type);
    for (const type of step?.outputTypes ?? []) expect(pmOutputs, type).toContain(type);
  });

  it('P15 gave outputs to the two steps that declared none, so P7 now covers them (Q208 finding 4 was still live for both)', () => {
    for (const key of [
      'plan-stages:review-stages',
      'fm-mobile/store-release.workflow.yaml:prepare-store-submission',
    ]) {
      const step = declared.find((entry) => entry.key === key);
      expect(step, `${key} declares no outputs`).toBeDefined();
      expect(step?.outputTypes).toEqual(['HandoffRecord']);
    }
  });

  it('every agent step that declares outputs is assigned to a role that can write them or whose report the engine writes (the inventory is empty)', () => {
    expect(derived.size).toBe(0);
    for (const step of declared) {
      if (step.agent.includes('{{')) continue;
      const writes = resolveExtends(step.agent, registry).tools.write;
      expect(writes || engineWritten.includes(step.key), `${step.key} (${step.agent})`).toBe(true);
    }
  });

  it('lists steps with a run-time agent apart, so they are not silently uncounted', () => {
    expect([...unresolved].sort()).toEqual([...UNRESOLVED_AGENT_STEPS].sort());
  });

  it('never has a declared output the check cannot locate: every output type is registered', () => {
    for (const step of declared) {
      for (const type of step.outputTypes) {
        const definition = artifactTypeById(type);
        expect(definition, `${step.key} declares unregistered type ${type}`).toBeDefined();
        if (definition !== undefined) {
          expect(outputGlob(definition.id, DEFAULT_CONFIG.paths)).toMatch(/^docs\/forge\//);
        }
      }
    }
  });
});

/**
 * What `specs/18` §18.7 named for M16 that the code did not have yet (`SPEC-QUESTIONS.md` Q294,
 * `PLAN-M16.md` P1; P1 named P5 and P13 as the pieces that would build them). A spec that names a
 * registry type, a `mutationKind`, a bundle field or a migration the code lacks is a claim about the
 * future, not an unknown: each test below reads the claim from the real spec text and checks it
 * against the real shipped registry, schemas and migrations. `specs/22` M16 P5 closed all four of
 * these (the registry type, the second `mutationKind`, the bundle field, both `1→2` migrations); each
 * test below now pins that closure the identical way it used to pin the gap, per this file's own
 * standing rule, "the day a piece builds one of them, the matching test fails until the pin is updated
 * on purpose." `P13`'s own piece is a real WRITER of a hunk-level `MutationEvidence` record, never
 * built here — P5 registers the SHAPE only (this file's own companion `PLAN-M16.md` P5 piece brief:
 * "nothing calls this type yet").
 *
 * This file's structure covers artifact types, schemas and migrations, not commands: the four M16
 * commands of `specs/03` §3.2.5 are pinned as not wired yet in `test/spec-cli-examples.test.ts`.
 */
const SPECIFIED_TYPES_NOW_REGISTERED: readonly string[] = ['ParityEvidence'];
/** The second `MutationEvidence.mutationKind` (`specs/22` M16 P5 widened the literal to an enum of
 * `revert-implementation`/`revert-hunks`). */
const HUNK_MUTATION_KIND = 'revert-hunks';
/** The `EvidenceBundle` field the strict schema now has a key for (`specs/22` M16 P5). */
const PARITY_EVIDENCE_BUNDLE_FIELD = 'parityEvidence';
/** The two types §18.7 gives a `1→2` migration, in the order it names them; `MIGRATIONS` now holds
 * both (`specs/22` M16 P5). */
const V2_MIGRATIONS: readonly string[] = ['MutationEvidence', 'EvidenceBundle'];

/** `specs/18` §18.7, as written and with its whitespace collapsed (the spec wraps its sentences). */
function registrySection(): { readonly raw: string; readonly flat: string } {
  const text = readFileSync(
    path.join(repoRoot, 'specs', '18-persistence-config-and-schemas.md'),
    'utf8',
  );
  const marker = '\n## 18.7 Artifact type registry\n';
  const start = text.indexOf(marker);
  if (start === -1 || text.includes(marker, start + 1)) {
    throw new Error('specs/18 must have exactly one "18.7 Artifact type registry" heading');
  }
  const next = text.indexOf('\n## ', start + marker.length);
  const raw = text.slice(start, next === -1 ? undefined : next);
  return { raw, flat: raw.replace(/\s+/g, ' ') };
}

describe('closed gaps: specs/18 named these for M16, and the code now has them (specs/22 M16 P5) (SPEC-QUESTIONS.md Q294, PLAN-M16.md P1/P5)', () => {
  it('M16 specs/18 §18.7: every registry type the spec lists is now known to the code registry', () => {
    const listed = [...registrySection().raw.matchAll(/^\s*- \{ id: ([A-Za-z]+),/gm)].map(
      (row) => row[1] ?? '',
    );
    expect(listed, 'the registry rows of §18.7 were read').toContain('ParityEvidence');
    expect(listed, 'the registry rows of §18.7 were read').toContain('MutationEvidence');
    const unknownToCode = listed.filter((id) => artifactTypeById(id) === undefined);
    // `SPECIFIED_TYPES_NOW_REGISTERED` names what used to be unknown, so a fresh gap introduced by a
    // LATER piece (a new §18.7 row this test has not been told about yet) still fails loudly here,
    // rather than this assertion silently widening to "whatever is missing right now".
    expect(unknownToCode).toEqual([]);
    expect(SPECIFIED_TYPES_NOW_REGISTERED.every((id) => artifactTypeById(id) !== undefined)).toBe(
      true,
    );
  });

  it('M16 specs/18 §18.7: the spec names a second mutationKind, and the shipped MutationEvidence schema now accepts it', () => {
    const named = /`mutationKind` has a second member, `([a-z-]+)`/.exec(
      registrySection().flat,
    )?.[1];
    expect(named).toBe(HUNK_MUTATION_KIND);
    const kindIssues = (mutationKind: string) => {
      const result = mutationEvidenceSchema.safeParse({ mutationKind });
      return result.success
        ? []
        : result.error.issues.filter((issue) => issue.path.join('.') === 'mutationKind');
    };
    expect(kindIssues('revert-implementation'), 'the one kind v1 has is accepted').toEqual([]);
    expect(kindIssues(HUNK_MUTATION_KIND), 'the second kind M16 P5 added is now accepted').toEqual(
      [],
    );
  });

  it('M16 specs/18 §18.7: the spec names an EvidenceBundle parityEvidence list, and the shipped schema now recognises it', () => {
    const named = /`EvidenceBundle` gains an optional `([A-Za-z]+)` list/.exec(
      registrySection().flat,
    )?.[1];
    expect(named).toBe(PARITY_EVIDENCE_BUNDLE_FIELD);
    const unrecognisedKeys = (key: string) => {
      const result = evidenceBundleSchema.safeParse({ [key]: [] });
      return result.success
        ? []
        : result.error.issues.flatMap((issue) =>
            issue.code === 'unrecognized_keys' ? issue.keys : [],
          );
    };
    expect(unrecognisedKeys('bindingEvidence'), 'a field v1 has is recognised').toEqual([]);
    expect(unrecognisedKeys(PARITY_EVIDENCE_BUNDLE_FIELD), 'M16 P5 added this key').toEqual([]);
  });

  it('M16 specs/18 §18.7: the spec names two 1→2 migrations, and the migration registry now holds both', () => {
    const named = /both `1→2`: `([A-Za-z]+)` and `([A-Za-z]+)`/.exec(registrySection().flat);
    expect([named?.[1], named?.[2]]).toEqual(V2_MIGRATIONS);
    const written = V2_MIGRATIONS.filter((type) =>
      MIGRATIONS.some(
        (migration) =>
          migration.from === 1 && migration.to === 2 && migration.types.some((t) => t === type),
      ),
    );
    expect(written).toEqual(V2_MIGRATIONS);
  });
});

/**
 * M17 Phase A (`PLAN-M17.md`, `SPEC-QUESTIONS.md` Q313): the surfaces `specs/22` M17's own spec text
 * (this piece's own amendment) names as the hardening milestone's content, established here at their
 * LARGEST, correct starting size — this list SHRINKS as later M17 pieces land, each test flipping to
 * red the day its own surface is actually built, per this file's own standing rule (see the file's own
 * header comment above: "the day a piece builds one of them, the matching test fails until the pin is
 * updated on purpose"). Every check below reads the REAL, current source (or runs it), never a
 * description of it, so a later piece that partially builds a surface is caught exactly where it still
 * falls short, not just where it is entirely absent.
 *
 * @see specs/06 §6.4, §6.5, §6.8
 * @see specs/07 §7.2, §7.3
 * @see specs/09 §9.5
 * @see specs/10 §10.3
 * @see specs/13 F-TEST-9, F-TEST-11
 * @see specs/18 §18.3
 * @see specs/22 M17
 * @see PLAN-M17.md P1
 * @see SPEC-QUESTIONS.md Q313
 */
describe('M17 Phase A: surfaces specs/22 M17 names that are not yet built (specs/22 M17 P1) (SPEC-QUESTIONS.md Q313, PLAN-M17.md P1) — this list SHRINKS as later pieces land', () => {
  const repoRootAbs = repoRoot;

  function readPkg(relativeToRepoRoot: string): string {
    return readFileSync(path.join(repoRootAbs, relativeToRepoRoot), 'utf8');
  }

  // Item 1 (the forge-test-report v1 parsers/schema module) closed: specs/22 M17 P3 built
  // packages/schemas/src/test-report.ts and reporter.ts's own structured-layer support. This list
  // shrinks as later pieces land -- see this describe block's own title.

  it('2. `forge test adopt` is not wired in bin.ts', () => {
    const bin = readPkg('packages/cli/src/bin.ts');
    expect(bin).not.toContain("'test', 'adopt'");
    expect(bin).not.toMatch(/case 'adopt':\s*{\s*\/\/ test adopt/);
  });

  it('3. the `adopt-tests` workflow template does not exist yet', () => {
    expect(
      existsSync(
        path.join(repoRootAbs, 'packages/templates/templates/workflows/adopt-tests.workflow.yaml'),
      ),
    ).toBe(false);
    expect(
      existsSync(path.join(repoRootAbs, 'packages/templates/templates/briefs/adopt-tests.md')),
    ).toBe(false);
  });

  it('4. the `G-TestAdopt` gate template does not exist yet', () => {
    expect(
      existsSync(
        path.join(repoRootAbs, 'packages/templates/templates/checks/G-TestAdopt.gate.yaml'),
      ),
    ).toBe(false);
  });

  // 5. (specs/22 M17 P18, #14) CLOSED: `forge migrate run` is wired in bin.ts
  // (`commands/migrate/run.ts`) and removed from `test/command-steps.test.ts`'s own
  // `KNOWN_UNACCEPTED` pin -- this file's own standing rule ("the day a piece builds one of them,
  // the matching test fails until the pin is updated on purpose") is why this entry moved from an
  // `it()` to a comment rather than simply being deleted.

  // 6. (specs/22 M17 P10, #3) CLOSED: `driveToCompletion` (`packages/engine/src/run/run-engine.ts`)
  // now consults `decideRetry`/`computeBackoff` on every failed outcome -- the real caller this entry
  // used to assert did not exist. Removed rather than inverted: this describe's own job is "not yet
  // built" surfaces, and a real, tested caller belongs in that test suite instead
  // (`packages/engine/test/run/run-engine.test.ts`'s own "driveToCompletion retry wiring" describe).

  it('7. [CLOSED by PLAN-M17.md P8] lane and integration worktrees moved out of the project tree, to a per-project directory under the user cache, keyed by a stable project hash — pinned the identical way the gap used to be pinned, per this file\'s own standing rule ("the day a piece builds one of them, the matching test fails until the pin is updated on purpose")', () => {
    const lanes = readPkg('packages/vcs/src/lanes.ts');
    // The old in-tree construction is gone, not merely supplemented.
    expect(lanes).not.toContain("path.join(cwd, '.forge', 'state', 'worktrees', laneId)");
    expect(lanes).toContain('worktreesRootFor');
    // `systemCacheDirRoot` (the one function allowed to read it, `system-cache-dir.ts`) is the real
    // `$XDG_CACHE_HOME` reader; `lanes.ts` itself never reads the env var directly (R10) — it only
    // ever reaches it through `worktreesRootFor`'s own default parameter.
    expect(lanes).not.toContain('XDG_CACHE_HOME');
    const worktreeRoot = readPkg('packages/vcs/src/worktree-root.ts');
    expect(worktreeRoot).toContain('systemCacheDirRoot');
    const systemCacheDir = readPkg('packages/vcs/src/system-cache-dir.ts');
    expect(systemCacheDir).toContain('XDG_CACHE_HOME');
    // `forge doctor` detects and offers to clean up a worktree left at the old, in-tree location.
    const locksAndWorktrees = readPkg('packages/cli/src/commands/doctor/locks-and-worktrees.ts');
    expect(locksAndWorktrees).toContain('checkLegacyInTreeWorktrees');
    // Parity's own former in-tree special case (observe.ts:458, the plan's own 2026-10-11 snapshot) no
    // longer hardcodes the pre-M17 path in its RUN-124 failure detail.
    const observe = readPkg('packages/cli/src/commands/parity/observe.ts');
    expect(observe).not.toContain("path.join(projectRoot, '.forge', 'state', 'worktrees')");
  });

  it('8. the root-path token rewrite still masks a replace-rule-detectable regression (a live repro, not a reading)', () => {
    // The exact repro `normalize.ts`'s own doc comment on `rewriteRootPaths` describes: two trees of
    // DIFFERENT root-path length, one real PASS, one real FAIL, and a trailing-content-trimming
    // `replace` rule that a declaration author would plausibly write for an unrelated reason.
    const refRoot: ObservedRoot = { asGiven: '/r', real: '/r' };
    const candidateRoot: ObservedRoot = { asGiven: '/candidateroot', real: '/candidateroot' };
    const refText = `${refRoot.asGiven}:XXPASS`;
    const candidateText = `${candidateRoot.asGiven}:XXFAIL`;
    const rules = [{ rule: 'replace' as const, pattern: '.{5}$', replacement: '' }];
    const refOutcome = applyNormalizeRulesToText(rewriteRootPaths(refText, refRoot), rules, {});
    const candidateOutcome = applyNormalizeRulesToText(
      rewriteRootPaths(candidateText, candidateRoot),
      rules,
      {},
    );
    expect(refOutcome.ok).toBe(true);
    expect(candidateOutcome.ok).toBe(true);
    if (!refOutcome.ok || !candidateOutcome.ok) return;
    // The real defect: a genuine PASS and a genuine FAIL read as byte-identical after normalisation,
    // because the root-token substitution did not preserve length parity between the two sides.
    expect(refOutcome.text).toBe(candidateOutcome.text);
    expect(refText).not.toBe(candidateText);
  });

  it("9. CLOSED by specs/22 M17 P14: observing the candidate now isolates .forge/parity/ from the candidate's own case commands", () => {
    // `observe.ts`'s own `observeOneCase` (process/file surfaces) and `observe-http.ts`'s own
    // `observeHttpSurfaceCases` (bracketing the http surface's whole server lifetime, since its
    // `run` stays alive across every case) now wrap the candidate's own command with
    // `candidate-isolation.ts`'s `withParityDirHidden`, which renames `.forge/parity/` away for
    // exactly that duration and restores it after -- real, live proof in
    // `packages/cli/test/commands/parity/candidate-isolation.test.ts` (the mechanism itself, incl.
    // the typed `RUN-153` refusal if a command re-creates the directory while it is hidden) and
    // `packages/cli/test/commands/parity/check-command.test.ts`'s own "a case that tries to tamper
    // with .forge/parity/..." describe block (the exact self-reverting-tamper repro this item's own
    // original title named, closed end to end through the real `forge parity check` entry point:
    // the read the tamper depends on now fails with `ENOENT` before it can do anything).
    //
    // DISCLOSED, remaining gap (named, not hidden): a case whose own composed command references a
    // path under `.forge/parity/probes/` (any surface kind -- NOT only `library`; a second critic
    // round found the original `library`-only exclusion was itself a real regression, since `13`
    // F-TEST-9's own wording already lets any surface use this pattern) is NOT isolated, since hiding
    // the directory would make the very command being observed unrunnable (confirmed directly: a
    // real probe test failed `ENOENT` on its own script before this exclusion existed). See
    // `observe.ts`'s own `referencesProbePath` check for the full account.
    const observe = readPkg('packages/cli/src/commands/parity/observe.ts');
    expect(observe).toContain("import { withParityDirHidden } from './candidate-isolation.ts';");
    expect(observe).toMatch(/side === 'candidate' && !referencesProbePath/);
    const candidateIsolation = readPkg('packages/cli/src/commands/parity/candidate-isolation.ts');
    expect(candidateIsolation).toContain('export async function withParityDirHidden');
  });

  it("10. applyReplace has no runtime wall-clock budget: a catastrophic or merely slow pattern cannot be bounded (a static reading, not a live repro — a real catastrophic-backtracking call is unbounded by construction, so pinning it live would risk hanging THIS suite rather than only the command under test; see the DECISION in Q313/this test's own header)", () => {
    const normalizeSrc = readPkg('packages/cli/src/commands/parity/normalize.ts');
    // No async/concurrency machinery that could impose or simulate a deadline exists at all.
    expect(normalizeSrc).not.toContain('worker_threads');
    expect(normalizeSrc).not.toMatch(/applyReplace[\s\S]{0,200}setTimeout/);
    expect(normalizeSrc).not.toMatch(/budgetMs|deadline|AbortSignal|AbortController|Worker\(/i);
    // `applyReplace`'s own real, current body (not a description of it): exactly a `$`-escape and one
    // synchronous `String.prototype.replace` with a `g`-flagged `RegExp` built from the declaration's
    // own `pattern` — no third argument, no wrapping, no try/catch around a time-boxed call.
    expect(normalizeSrc).toMatch(
      /export function applyReplace\(text: string, pattern: string, replacement: string\): string \{\s*const literalReplacement = replacement\.replace\(\/\\\$\/g, '\$\$\$\$'\);\s*return text\.replace\(new RegExp\(pattern, 'g'\), literalReplacement\);\s*\}/,
    );
    // Both real call sites in `applyNormalizeRulesToText`'s `replace` case pass exactly these three
    // arguments — no fourth (a deadline or signal) is threaded through from the case-level budget
    // `13` F-TEST-9 names, because no such budget exists yet at this layer.
    expect(normalizeSrc).toContain("applyReplace(before, rule.pattern, '')");
    expect(normalizeSrc).toContain('applyReplace(working, rule.pattern, rule.replacement)');
    // What this does NOT show: that a real catastrophic pattern actually hangs when run for real. A
    // genuine live repro needs a hard, out-of-process kill (a worker thread with `terminate()`, or a
    // child process with a `timeout`) to stay safe if the fix lands only partially — exactly the
    // asymmetric cost `applyReplace`'s own doc comment above states for bounding this from inside the
    // same synchronous process. That harness is more machinery than this one disclosed gap currently
    // earns, so this test stays a static pin on the absence of ANY budget-enforcing code path, not a
    // dynamic measurement of how long an unbounded one takes — a real repro is deferred to whichever
    // M17 piece actually builds the F-TEST-9 wall-clock budget, which can then prove its own bound by
    // running the adversarial case under its own hard guard.
  });

  // Items 11 ("structured_output is still discarded") and 12 ("SessionUsage has no
  // cacheReadTokens/cacheCreationTokens fields yet") were removed here, deliberately, by M17 P11: both
  // are closed (`parseCliEventLine`/`mapSdkMessage` now return `readonly AdapterEvent[]` and read the
  // real `structured_output`/`modelUsage` fields; `SessionUsage` now has both fields; `07` §7.3). The
  // closed-gap behaviour itself is proven by `packages/adapter-claude-code`'s own test suite
  // (`cli/parse-event.test.ts`, `sdk/map-message.test.ts`, `session-result.test.ts`,
  // `capabilities.test.ts`) and `packages/adapter-kit`'s own `events/normalize.test.ts`, not repeated
  // here — this describe's own job is only to surface what is NOT yet built, per its own title.
});
