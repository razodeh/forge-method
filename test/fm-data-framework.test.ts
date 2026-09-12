/**
 * F-DATA-8 / `analytical-pipeline-design` (`PLAN-M10.md` P5, `19` §19.1's own "F-DATA-8" row) -- `19`
 * §19.3's own Framework-authoring row, literally: "run against a fixture KB, assert an ADR with a
 * score table is produced." Proves it end to end through `11` §11.0's own real execution contract,
 * using this codebase's own already-real primitives at every step (`@forge/methods`' own
 * `loadFramework`/`applyRules`/`score`/`killerRisk`), then rendering the framework's own real
 * `output_template` with real Handlebars and validating the result against `@forge/schemas`' own
 * real, production `adrSchema`. Mirrors `test/fm-service-framework.test.ts`'s own established pattern.
 *
 * Loads the framework via `@forge/templates`' own real `FRAMEWORK_INDEX`
 * (`packages/templates/templates/frameworks/analytical-pipeline-design.framework.yaml`), NOT a
 * module-local copy under `modules/fm-data/` -- a critic round on this piece's first draft found that
 * shipping a second, module-local copy of this file made F-DATA-8 "real" only inside this piece's own
 * isolated tests, since `FRAMEWORK_INDEX` is the ONLY mechanism anywhere in this codebase that a real
 * `forge init`/`agentValidateAll` run actually reads a framework through (confirmed: no
 * `loadFrameworkRegistry`-shaped module scanner exists for frameworks the way `@forge/agents`' own
 * `loadAgentRegistry` exists for agents). Fixed by deleting the dead module-local copy and correcting
 * `owner_agent: data-architect` -> `owner_agent: data-engineer` directly on the one real, live-loaded
 * file instead -- this test file now loads and proves that same real, corrected file, matching
 * `test/frameworks.test.ts`'s own established "read via `FRAMEWORK_INDEX` + `templatesPackageRoot`"
 * convention for every other one of the 43 shipped frameworks.
 *
 * Lives at the repository root, not inside `packages/methods/test/`, for the identical cross-package
 * reason `test/fm-service-framework.test.ts` already documents.
 *
 * @see specs/11 §11.0
 * @see specs/12 §12 (F-DATA-8)
 * @see specs/19 §19.1, §19.3
 * @see PLAN-M10.md P5
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import matter from 'gray-matter';
import { parse as parseYamlDoc } from 'yaml';
import { describe, expect, it } from 'vitest';

import { loadFramework } from '@forge/methods/schema';
import { applyRules } from '@forge/methods/score';
import { killerRisk, score } from '@forge/methods/score';
import type { EvidenceCell } from '@forge/methods/score';
import { adrSchema } from '@forge/schemas/artifacts';
import { FRAMEWORK_INDEX } from '@forge/templates';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesPackageRoot = path.join(repoRoot, 'packages', 'templates');
const frameworkPath = path.join(
  templatesPackageRoot,
  FRAMEWORK_INDEX['analytical-pipeline-design'],
);
const templatePath = path.join(
  templatesPackageRoot,
  'templates',
  'adr-analytical-pipeline-design.md.hbs',
);

function loadAnalyticalPipelineDesign() {
  const result = loadFramework(readFileSync(frameworkPath, 'utf8'), frameworkPath);
  if (!result.success) throw new Error(`failed to load: ${JSON.stringify(result.issues, null, 2)}`);
  return result.framework;
}

const CRITERIA_ORDER = [
  'freshness-fit',
  'operational-burden',
  'source-system-load',
  'cost-per-tb-scanned',
] as const;

function cellsFor(optionId: string, scores: readonly number[]): EvidenceCell[] {
  return CRITERIA_ORDER.map((criterionId, index) => ({
    optionId,
    criterionId,
    score: scores[index] ?? 0,
    evidence: `${optionId}/${criterionId} evidence (fixture KB)`,
  }));
}

describe('analytical-pipeline-design.framework.yaml (11 §11.0, 12 §12 F-DATA-8) — the real, live-loaded @forge/templates copy', () => {
  it('loads cleanly, criteria weights sum to 1.0, owner_agent is the real fm-data agent (19 §19.1), corrected in place from the stale data-architect this file previously named', () => {
    const framework = loadAnalyticalPipelineDesign();
    expect(framework.id).toBe('analytical-pipeline-design');
    expect(framework.owner_agent).toBe('data-engineer');
    const total = (framework.criteria ?? []).reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBeCloseTo(1.0, 6);
  });

  it('is genuinely the file a real forge init/agentValidateAll run reads -- FRAMEWORK_INDEX resolves to this exact path, not a module-local duplicate', () => {
    expect(FRAMEWORK_INDEX['analytical-pipeline-design']).toBe(
      'templates/frameworks/analytical-pipeline-design.framework.yaml',
    );
    expect(frameworkPath).toBe(
      path.join(
        templatesPackageRoot,
        'templates',
        'frameworks',
        'analytical-pipeline-design.framework.yaml',
      ),
    );
  });

  it('a fixture KB fact with no near-real-time freshness need prefers batch (F-DATA-8: "ingestion (batch/CDC/stream)")', () => {
    const framework = loadAnalyticalPipelineDesign();
    const { eliminated, preferred } = applyRules(framework, {
      needs_near_real_time_freshness: false,
      source_supports_change_capture: false,
    });
    expect(eliminated.size).toBe(0);
    expect(preferred).toBe('batch');
  });

  it('a fixture KB fact needing near-real-time freshness with real CDC support prefers cdc', () => {
    const framework = loadAnalyticalPipelineDesign();
    const { preferred } = applyRules(framework, {
      needs_near_real_time_freshness: true,
      source_supports_change_capture: true,
    });
    expect(preferred).toBe('cdc');
  });

  it('a fixture KB fact needing near-real-time freshness with no CDC support prefers stream', () => {
    const framework = loadAnalyticalPipelineDesign();
    const { preferred } = applyRules(framework, {
      needs_near_real_time_freshness: true,
      source_supports_change_capture: false,
    });
    expect(preferred).toBe('stream');
  });

  it('scores every option against real fixture evidence cells; ranked order matches a hand-computed weighted sum', () => {
    const framework = loadAnalyticalPipelineDesign();
    const cells = [
      ...cellsFor('batch', [3, 9, 8, 9]),
      ...cellsFor('cdc', [9, 7, 7, 7]),
      ...cellsFor('stream', [9, 3, 4, 3]),
    ];

    const result = score(framework, cells);

    // Hand-computed: 0.35*9 + 0.25*7 + 0.20*7 + 0.20*7 = 7.7
    expect(result[0]?.optionId).toBe('cdc');
    expect(result[0]?.totalScore).toBeCloseTo(7.7, 10);
  });

  it('produces a real, non-empty killer risk for the top-scoring option', () => {
    const framework = loadAnalyticalPipelineDesign();
    const cells = [...cellsFor('cdc', [9, 8, 8, 2]), ...cellsFor('batch', [3, 9, 8, 9])];
    const result = score(framework, cells);
    const top = result[0];
    if (top === undefined) throw new Error('expected a top-scoring option');
    expect(top.optionId).toBe('cdc');
    const risk = killerRisk(top, framework);
    expect(risk).toBeDefined();
    expect(risk).toContain('cost-per-tb-scanned');
  });

  it("its own output_template renders through real Handlebars into front matter that validates against @forge/schemas' own real, production adrSchema, with a real score table (11 §11.0's own 'Frameworks MUST show the score table in the ADR')", () => {
    const framework = loadAnalyticalPipelineDesign();
    const cells = [...cellsFor('cdc', [9, 7, 7, 7]), ...cellsFor('batch', [3, 9, 8, 9])];
    const result = score(framework, cells);
    const top = result[0];
    if (top === undefined) throw new Error('expected a top-scoring option');
    expect(top.optionId).toBe('cdc');
    const risk = killerRisk(top, framework) ?? 'no killer risk identified';

    const scoreTable = [
      `| option | ${CRITERIA_ORDER.join(' | ')} | total |`,
      `|---|${CRITERIA_ORDER.map(() => '---').join('|')}|---|`,
      ...result.map((option) => {
        const cellsByCriterion = new Map(option.cells.map((c) => [c.criterionId, c.score]));
        const row = CRITERIA_ORDER.map((id) => String(cellsByCriterion.get(id) ?? ''));
        return `| ${option.optionId} | ${row.join(' | ')} | ${option.totalScore.toFixed(2)} |`;
      }),
    ].join('\n');

    const compiled = Handlebars.compile(readFileSync(templatePath, 'utf8'));
    const rendered = compiled({
      seq: '0043',
      title: 'Ingestion approach for the orders analytics pipeline',
      status: 'proposed',
      deciders: ['data-engineer', 'data-architect'],
      date: '2026-09-12',
      author: 'data-engineer',
      reversibility: 'medium',
      blastRadius: ['every downstream analytics dashboard reading orders data'],
      revisitTrigger: 'a new consumer requiring sub-second freshness',
      supersedes: [],
      related: [],
      diagrams: [],
      changelogSummary: 'initial ingestion approach decision',
      context: 'The orders analytics pipeline has its first real downstream consumer.',
      chosenOption: top.optionId,
      criteria: framework.criteria,
      scoreTable,
      killerRisk: risk,
      consequences:
        'Every future orders pipeline change must state which ingestion mode it targets.',
      alternativesConsidered: undefined,
    });

    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYamlDoc(input) as object },
    });
    const validation = adrSchema.safeParse(parsed.data);
    if (!validation.success) {
      throw new Error(`rendered ADR front matter failed adrSchema: ${validation.error.message}`);
    }
    expect(validation.data.framework).toBe('analytical-pipeline-design');
    expect(validation.data.category).toBe('data');
    expect(rendered).toContain('cdc');
    expect(rendered).toContain('| option |');
  });
});
