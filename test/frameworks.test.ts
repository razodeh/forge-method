/**
 * `@forge/templates`'s 43 decision-framework files: 14 initialization/architecture frameworks (`11`
 * §11.1-§11.2, `PLAN-M6.md` T3) plus 29 data/technology/testing/debugging/delivery/operations
 * frameworks (`12`-`14`, `PLAN-M6.md` T4).
 *
 * Lives at the repository root, not inside `packages/templates/test/` or `packages/methods/test/`, for
 * the identical cross-package-check reason `test/workflows.test.ts`/`test/gates.test.ts` already
 * document: this is the one check that needs both `@forge/methods/schema` (the already-built loader/
 * validator, M6 M1) and `@forge/templates` (`FRAMEWORK_INDEX`), and `02` §2.2 gives `@forge/templates`
 * zero `@forge/*` dependencies while `@forge/methods` has no edge to `@forge/templates` either.
 *
 * @see specs/11 §11.0, §11.1, §11.2
 * @see specs/12 §12.1, §12.3
 * @see specs/13 §13.1, §13.2, §13.3
 * @see specs/14
 * @see PLAN-M6.md T3, T4
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { loadFramework } from '@forge/methods/schema';
import {
  FRAMEWORK_INDEX,
  TEMPLATE_INDEX,
  WORKFLOW_INDEX,
  type FrameworkId,
} from '@forge/templates';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesPackageRoot = path.join(repoRoot, 'packages', 'templates');

function readFrameworkSource(id: FrameworkId): string {
  return readFileSync(path.join(templatesPackageRoot, FRAMEWORK_INDEX[id]), 'utf8');
}

const ALL_FRAMEWORK_IDS = Object.keys(FRAMEWORK_INDEX) as FrameworkId[];

describe('T3+T4: all 43 decision frameworks (11-14) all load cleanly', () => {
  it.each(ALL_FRAMEWORK_IDS)('%s loads via loadFramework with a matching id', (id) => {
    const result = loadFramework(readFrameworkSource(id), FRAMEWORK_INDEX[id]);
    if (!result.success) {
      throw new Error(`${id} failed to load: ${JSON.stringify(result.issues, null, 2)}`);
    }
    expect(result.framework.id).toBe(id);
  });

  // T4's own Checks text: "a whole-set completeness test (every F-* id named anywhere in 11-14 has a
  // real shipped file), run once here, the last framework-content piece." A real per-id mapping from
  // the spec's own F-CATEGORY-N labels to this piece's own shipped `FrameworkId`s -- not two
  // independently-counted 43-length lists (a first version of this test did exactly that, which proves
  // nothing: a silently-dropped framework and a stray duplicate elsewhere could both still leave each
  // list at length 43). Every value below is checked against `FRAMEWORK_INDEX`'s own real keys, and
  // every real key is checked against this map, so a framework present in one but not the other fails
  // loudly on either side.
  it('every F-* id named anywhere in 11-14 maps to a real, distinct shipped FrameworkId, with none left over', () => {
    const F_ID_TO_FRAMEWORK_ID: Readonly<Record<string, FrameworkId>> = {
      // 11 §11.1 F-INIT-1..7
      'F-INIT-1': 'repo-strategy',
      'F-INIT-2': 'directory-layout',
      'F-INIT-3': 'build-toolchain',
      'F-INIT-4': 'vcs-conventions',
      'F-INIT-5': 'dev-environment',
      'F-INIT-6': 'coding-standards',
      'F-INIT-7': 'scaffold-generation',
      // 11 §11.2 F-ARCH-1..7
      'F-ARCH-1': 'architecture-style',
      'F-ARCH-2': 'decomposition-boundaries',
      'F-ARCH-3': 'communication-integration-patterns',
      'F-ARCH-4': 'pattern-selection',
      'F-ARCH-5': 'nfr-strategy',
      'F-ARCH-6': 'threat-modelling',
      'F-ARCH-7': 'buy-build-borrow',
      // 12 §12.1 F-DATA-1..8
      'F-DATA-1': 'conceptual-logical-modelling',
      'F-DATA-2': 'access-pattern-analysis',
      'F-DATA-3': 'storage-selection',
      'F-DATA-4': 'consistency-transaction-design',
      'F-DATA-5': 'caching-strategy',
      'F-DATA-6': 'schema-evolution-migrations',
      'F-DATA-7': 'data-lifecycle-privacy-retention',
      'F-DATA-8': 'analytical-pipeline-design',
      // 12 §12.3 F-TECH-1
      'F-TECH-1': 'stack-selection',
      // 13 §13.1 F-TEST-1..7
      'F-TEST-1': 'test-pyramid-shape',
      'F-TEST-2': 'test-oracle-design',
      'F-TEST-3': 'test-data-strategy',
      'F-TEST-4': 'test-environment-dependency-strategy',
      'F-TEST-5': 'coverage-adequacy',
      'F-TEST-6': 'flake-control',
      'F-TEST-7': 'agent-executable-tests',
      // 13 §13.2 F-DEBUG-1..3
      'F-DEBUG-1': 'rca-loop',
      'F-DEBUG-2': 'rca-loop-bounds-escalation',
      'F-DEBUG-3': 'debugging-observability-precondition',
      // 13 §13.3 F-REVIEW-1..2
      'F-REVIEW-1': 'review-perspectives',
      'F-REVIEW-2': 'review-boundaries',
      // 14 F-DELIVER-1..5, F-OPS-1..3
      'F-DELIVER-1': 'environment-strategy',
      'F-DELIVER-2': 'build-artifact-strategy',
      'F-DELIVER-3': 'cicd-pipeline-design',
      'F-DELIVER-4': 'deployment-strategy',
      'F-OPS-1': 'observability-design',
      'F-DELIVER-5': 'release-management',
      'F-OPS-2': 'operational-readiness',
      'F-OPS-3': 'cost-model',
    };

    const mappedIds = Object.keys(F_ID_TO_FRAMEWORK_ID);
    expect(mappedIds).toHaveLength(43);

    // Every F-* id maps to a real, currently-shipped FrameworkId.
    for (const [fId, frameworkId] of Object.entries(F_ID_TO_FRAMEWORK_ID)) {
      expect(
        FRAMEWORK_INDEX,
        `${fId} maps to "${frameworkId}", which is not a real FRAMEWORK_INDEX key`,
      ).toHaveProperty(frameworkId);
    }

    // No two F-* ids map to the same FrameworkId (every shipped framework covers exactly one F-* id).
    const mappedFrameworkIds = Object.values(F_ID_TO_FRAMEWORK_ID);
    expect(new Set(mappedFrameworkIds).size).toBe(mappedFrameworkIds.length);

    // Every shipped FrameworkId is covered by some F-* id -- nothing shipped that the map forgot.
    expect(ALL_FRAMEWORK_IDS.slice().sort()).toEqual(mappedFrameworkIds.slice().sort());
  });

  it.each(ALL_FRAMEWORK_IDS)("%s's criteria weights sum to 1.0 when it declares any", (id) => {
    const result = loadFramework(readFrameworkSource(id), FRAMEWORK_INDEX[id]);
    if (!result.success) throw new Error(`${id} failed to load`);
    if (result.framework.criteria === undefined) return;
    const total = result.framework.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
    expect(total).toBeCloseTo(1.0, 6);
  });

  // `frameworkSchema` (packages/methods/src/schema/schema.ts) types `produces.adr_category` as a bare
  // non-empty string, with no cross-check against `@forge/schemas`' own `adrSchema.category` enum
  // (`architecture | data | delivery | ops | process | product | security`, `08` §8.4) -- nothing
  // stops a framework file from naming a category that isn't real ADR content. Caught here rather than
  // left implicit: a first draft of several T4 frameworks used `testing`/`operations`, neither a real
  // enum value (the real value for the latter is `ops`; for testing/debugging/review content, the
  // closest real category is `process`) -- an ADR written from either would fail `adrSchema.safeParse`
  // at real write time. Fixed directly in the framework files; this test locks the fix in.
  it.each(ALL_FRAMEWORK_IDS)("%s's produces.adr_category is a real 08 §8.4 ADR category", (id) => {
    const REAL_ADR_CATEGORIES = new Set([
      'product',
      'architecture',
      'data',
      'delivery',
      'ops',
      'security',
      'process',
    ]);
    const raw = parseYaml(readFrameworkSource(id)) as { produces: { adr_category: string } };
    expect(REAL_ADR_CATEGORIES.has(raw.produces.adr_category)).toBe(true);
  });

  it("repo-strategy matches 11 §11.0's own literal worked example exactly", () => {
    const worked = `
id: repo-strategy
name: Repository strategy selection
owner_agent: platform
produces: { adr_category: delivery, kb_section: delivery/repo-strategy.md }
inputs:
  required: [ kb:constraints/**, artifact:ArchitectureSpec ]
  derived:
    - id: deployable_units
      from: "architecture.components[?deployable].length"
    - id: language_count
      from: "distinct(architecture.components[].runtime).length"
questions:
  - id: team_size
    text: "How many people (human or agent-lane) will change this codebase concurrently?"
    type: number
    default_from: "config.concurrency"
  - id: release_coupling
    text: "Must all deployables ship together?"
    type: choice
    options: [ always, usually, independent ]
options:
  - id: monorepo-single-package
  - id: monorepo-workspaces
  - id: polyrepo
  - id: meta-repo
criteria:
  - id: atomic-cross-cutting-change
    weight: 0.25
  - id: independent-release-cadence
    weight: 0.20
  - id: build-tooling-cost
    weight: 0.15
  - id: access-control-granularity
    weight: 0.10
  - id: ci-scale
    weight: 0.15
  - id: onboarding-simplicity
    weight: 0.15
scoring: rubric
rules:
  - if: "deployable_units == 1"
    then: { eliminate: [ polyrepo, meta-repo ], prefer: monorepo-single-package }
  - if: "regulatory.code_isolation_required"
    then: { eliminate: [ monorepo-single-package, monorepo-workspaces ] }
output_template: templates/adr-repo-strategy.md.hbs
follow_on:
  - create_stories_from: templates/stories/repo-bootstrap.yaml
`;
    const workedResult = loadFramework(worked, '(worked example)');
    const shippedResult = loadFramework(
      readFrameworkSource('repo-strategy'),
      FRAMEWORK_INDEX['repo-strategy'],
    );
    if (!workedResult.success) throw new Error('the worked example itself failed to load');
    if (!shippedResult.success)
      throw new Error('the shipped repo-strategy.framework.yaml failed to load');
    expect(shippedResult.framework).toEqual(workedResult.framework);
  });

  it.each(ALL_FRAMEWORK_IDS)("%s's owner_agent is a real 05 §5.2 role id", (id) => {
    const REAL_ROLE_IDS = new Set([
      'orchestrator',
      'analyst',
      'pm',
      'po',
      'ux',
      'em',
      'architect',
      'data-architect',
      'domain-modeler',
      'integration-architect',
      'security',
      'platform',
      'backend',
      'frontend',
      'mobile',
      'data-engineer',
      'ml-engineer',
      'test-architect',
      'sdet',
      'reviewer',
      'diagnostician',
      'sre',
      'release',
      'techwriter',
      'finops',
      'compliance',
      'facilitator',
      'critic',
    ]);
    const result = loadFramework(readFrameworkSource(id), FRAMEWORK_INDEX[id]);
    if (!result.success) throw new Error(`${id} failed to load`);
    expect(REAL_ROLE_IDS.has(result.framework.owner_agent)).toBe(true);
  });

  it.each(ALL_FRAMEWORK_IDS)(
    "%s's output_template names a real, shippable path (this piece or T5)",
    (id) => {
      const raw = parseYaml(readFrameworkSource(id)) as { output_template: string };
      expect(raw.output_template).toMatch(/^templates\/.+\.hbs$/);
    },
  );

  it('every follow_on create_stories_from path is well-formed (a real, shippable path for T5 to satisfy)', () => {
    for (const id of ALL_FRAMEWORK_IDS) {
      const result = loadFramework(readFrameworkSource(id), FRAMEWORK_INDEX[id]);
      if (!result.success) throw new Error(`${id} failed to load`);
      for (const followOn of result.framework.follow_on ?? []) {
        expect(followOn.create_stories_from).toMatch(/^templates\/stories\/.+\.yaml$/);
      }
    }
  });

  it('WORKFLOW_INDEX and TEMPLATE_INDEX are unaffected by this piece (sanity check on the shared index module)', () => {
    expect(Object.keys(WORKFLOW_INDEX)).toHaveLength(20);
    expect(Object.keys(TEMPLATE_INDEX)).toHaveLength(22);
  });

  // T4's own Checks text: "confirmation that F-TECH-1's own framework definition is real and
  // @forge/catalog/select-compatible per whatever convention T3/T4 settled on." @forge/catalog's own
  // selection engine (C5, a different concurrently-built piece of this same milestone) does not exist
  // yet as of this piece -- this test verifies the structural half of that convention (documented in
  // stack-selection.framework.yaml's own comment: `scoring: hybrid` + an `options` list of catalog
  // *kind* categories, not individual technologies) now, and is a real, explicit forward-reference for
  // whoever builds C5 to re-run the full round-trip check against, the same discipline T1's own
  // deferred "every agent: field names a real A2 role id" cross-check already established.
  it('stack-selection (F-TECH-1) follows the documented catalog-delegation convention -- real cross-check against @forge/catalog/select deferred until C5 exists', () => {
    const result = loadFramework(
      readFrameworkSource('stack-selection'),
      FRAMEWORK_INDEX['stack-selection'],
    );
    if (!result.success) throw new Error('stack-selection failed to load');
    expect(result.framework.scoring).toBe('hybrid');
    expect(result.framework.options.length).toBeGreaterThan(0);
  });
});
