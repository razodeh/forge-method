/**
 * `@forge/templates`'s 14 initialization/architecture framework files (`11` §11.1-§11.2), per
 * `PLAN-M6.md` T3's own Checks section.
 *
 * Lives at the repository root, not inside `packages/templates/test/` or `packages/methods/test/`, for
 * the identical cross-package-check reason `test/workflows.test.ts`/`test/gates.test.ts` already
 * document: this is the one check that needs both `@forge/methods/schema` (the already-built loader/
 * validator, M6 M1) and `@forge/templates` (`FRAMEWORK_INDEX`), and `02` §2.2 gives `@forge/templates`
 * zero `@forge/*` dependencies while `@forge/methods` has no edge to `@forge/templates` either.
 *
 * @see specs/11 §11.0, §11.1, §11.2
 * @see PLAN-M6.md T3
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

describe('T3: the 14 initialization/architecture frameworks (11 §11.1-§11.2) all load cleanly', () => {
  it.each(ALL_FRAMEWORK_IDS)('%s loads via loadFramework with a matching id', (id) => {
    const result = loadFramework(readFrameworkSource(id), FRAMEWORK_INDEX[id]);
    if (!result.success) {
      throw new Error(`${id} failed to load: ${JSON.stringify(result.issues, null, 2)}`);
    }
    expect(result.framework.id).toBe(id);
  });

  it('FRAMEWORK_INDEX names exactly the 14 F-INIT/F-ARCH ids 11 §11.1-§11.2 name, no more and no fewer', () => {
    expect(ALL_FRAMEWORK_IDS.sort()).toEqual(
      [
        'repo-strategy',
        'directory-layout',
        'build-toolchain',
        'vcs-conventions',
        'dev-environment',
        'coding-standards',
        'scaffold-generation',
        'architecture-style',
        'decomposition-boundaries',
        'communication-integration-patterns',
        'pattern-selection',
        'nfr-strategy',
        'threat-modelling',
        'buy-build-borrow',
      ].sort(),
    );
  });

  it.each(ALL_FRAMEWORK_IDS)("%s's criteria weights sum to 1.0 when it declares any", (id) => {
    const result = loadFramework(readFrameworkSource(id), FRAMEWORK_INDEX[id]);
    if (!result.success) throw new Error(`${id} failed to load`);
    if (result.framework.criteria === undefined) return;
    const total = result.framework.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
    expect(total).toBeCloseTo(1.0, 6);
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
    expect(Object.keys(TEMPLATE_INDEX)).toHaveLength(21);
  });
});
