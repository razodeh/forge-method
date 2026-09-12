/**
 * `modules/fm-service/frameworks/api-versioning.framework.yaml` (`PLAN-M10.md` P4, `19` §19.1's own
 * "API versioning framework" row) -- `19` §19.3's own Framework-authoring row, literally: "run against
 * a fixture KB, assert an ADR with a score table is produced." Proves it end to end through 11 §11.0's
 * own real execution contract ("run rules → eliminate → score remaining against criteria with evidence
 * per cell → produce a ranked recommendation with the top option's own killer risk stated ... write an
 * ADR"), using this codebase's own already-real primitives at every step (`@forge/methods`' own
 * `loadFramework`/`applyRules`/`score`/`killerRisk` -- there is no single "run a framework end-to-end"
 * orchestrator anywhere in this codebase yet, confirmed directly against `packages/methods/src/score/
 * score.ts`'s and `rules.ts`'s own doc comments, so this test assembles the same real pieces
 * `packages/methods/test/score/score.test.ts` already exercises for `repo-strategy`, applied here to
 * `api-versioning`'s own real, shipped content) then rendering the framework's own real
 * `output_template` with real Handlebars and validating the result against `@forge/schemas`' own real,
 * production `adrSchema` -- not a hand-rolled validator, since ADR (unlike fm-web's two new artifact
 * types) is already a registered @forge/schemas type.
 *
 * Lives at the repository root, not inside `packages/methods/test/`, for the identical cross-package
 * reason `test/frameworks.test.ts` already documents: this needs both `@forge/methods` and
 * `@forge/schemas`, plus direct filesystem access to `modules/fm-service/`.
 *
 * @see specs/11 §11.0
 * @see specs/19 §19.1, §19.3
 * @see PLAN-M10.md P4
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frameworkPath = path.join(
  repoRoot,
  'modules',
  'fm-service',
  'frameworks',
  'api-versioning.framework.yaml',
);
const templatePath = path.join(
  repoRoot,
  'modules',
  'fm-service',
  'templates',
  'adr-api-versioning.md.hbs',
);

function loadApiVersioning() {
  const result = loadFramework(readFileSync(frameworkPath, 'utf8'), frameworkPath);
  if (!result.success) throw new Error(`failed to load: ${JSON.stringify(result.issues, null, 2)}`);
  return result.framework;
}

const CRITERIA_ORDER = [
  'consumer-migration-cost',
  'backward-compatibility-clarity',
  'operational-simplicity',
  'cache-and-tooling-friendliness',
  'discoverability',
] as const;

function cellsFor(optionId: string, scores: readonly number[]): EvidenceCell[] {
  return CRITERIA_ORDER.map((criterionId, index) => ({
    optionId,
    criterionId,
    score: scores[index] ?? 0,
    evidence: `${optionId}/${criterionId} evidence (fixture KB)`,
  }));
}

describe('api-versioning.framework.yaml (11 §11.0)', () => {
  it('loads cleanly, criteria weights sum to 1.0, owner_agent is a real 05 §5.2 role', () => {
    const framework = loadApiVersioning();
    expect(framework.id).toBe('api-versioning');
    expect(framework.owner_agent).toBe('integration-architect');
    const total = (framework.criteria ?? []).reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBeCloseTo(1.0, 6);
  });

  it('a fixture KB fact (consumer_control: false) eliminates no-versioning-single-evolving-contract via the real rule', () => {
    const framework = loadApiVersioning();
    const { eliminated } = applyRules(framework, { consumer_control: false });
    expect(eliminated.get('no-versioning-single-evolving-contract')).toBe('!consumer_control');
  });

  it('a fixture KB fact (consumer_control: true) eliminates nothing', () => {
    const framework = loadApiVersioning();
    const { eliminated } = applyRules(framework, { consumer_control: true });
    expect(eliminated.size).toBe(0);
  });

  it('scores every surviving option against real fixture evidence cells; ranked order matches a hand-computed weighted sum', () => {
    const framework = loadApiVersioning();
    const cells = [
      ...cellsFor('uri-path-versioning', [7, 9, 6, 9, 8]),
      ...cellsFor('header-versioning', [5, 7, 5, 6, 3]),
      ...cellsFor('content-negotiation-versioning', [4, 8, 4, 5, 2]),
    ];

    const result = score(framework, cells);

    // Hand-computed: 0.30*7 + 0.25*9 + 0.20*6 + 0.15*9 + 0.10*8 = 7.7
    expect(result[0]?.optionId).toBe('uri-path-versioning');
    expect(result[0]?.totalScore).toBeCloseTo(7.7, 10);
  });

  it('produces a real, non-empty killer risk for the top-scoring option', () => {
    const framework = loadApiVersioning();
    const cells = [
      ...cellsFor('uri-path-versioning', [7, 9, 6, 9, 3]),
      ...cellsFor('header-versioning', [5, 7, 5, 6, 6]),
    ];
    const result = score(framework, cells);
    const top = result[0];
    if (top === undefined) throw new Error('expected a top-scoring option');
    const risk = killerRisk(top, framework);
    expect(risk).toBeDefined();
    expect(risk).toContain('discoverability');
  });

  it("its own output_template renders through real Handlebars into front matter that validates against @forge/schemas' own real, production adrSchema, with a real score table (11 §11.0's own 'Frameworks MUST show the score table in the ADR')", () => {
    const framework = loadApiVersioning();
    const cells = [
      ...cellsFor('uri-path-versioning', [7, 9, 6, 9, 8]),
      ...cellsFor('header-versioning', [5, 7, 5, 6, 3]),
    ];
    const result = score(framework, cells);
    const top = result[0];
    if (top === undefined) throw new Error('expected a top-scoring option');
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
      seq: '0042',
      title: 'API versioning strategy for the orders API',
      status: 'proposed',
      deciders: ['integration-architect', 'architect'],
      date: '2026-09-12',
      author: 'integration-architect',
      reversibility: 'medium',
      blastRadius: ['every external orders-api consumer'],
      revisitTrigger: 'a new major consumer with an incompatible client library',
      supersedes: [],
      related: [],
      diagrams: [],
      changelogSummary: 'initial API versioning decision',
      context:
        'The orders API has its first external consumer; a versioning strategy is now required.',
      chosenOption: top.optionId,
      criteria: framework.criteria,
      scoreTable,
      killerRisk: risk,
      consequences: 'Every future orders-api change must state which version(s) it targets.',
      alternativesConsidered: undefined,
    });

    // gray-matter's own default YAML engine (js-yaml) auto-detects ISO-shaped date scalars as real
    // `Date` objects, not strings -- adrSchema's own `date`/`created`/`updated` fields are typed as
    // strings (`z.string().date()`), matching the "yaml" package's own YAML 1.2 core schema (no
    // implicit timestamp typing), the same custom engine test/fm-web-templates.test.ts's own
    // `renderTemplate` fixture already uses for the identical reason.
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYamlDoc(input) as object },
    });
    const validation = adrSchema.safeParse(parsed.data);
    if (!validation.success) {
      throw new Error(`rendered ADR front matter failed adrSchema: ${validation.error.message}`);
    }
    expect(validation.data.framework).toBe('api-versioning');
    expect(validation.data.category).toBe('architecture');
    expect(rendered).toContain('uri-path-versioning');
    expect(rendered).toContain('| option |');
  });
});
