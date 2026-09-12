/**
 * `modules/fm-data/templates/warehouse-model.md.hbs` and `templates/pipeline-diagram.md.hbs`
 * (`PLAN-M10.md` P5, `19` §19.1's own "warehouse modelling templates"/"pipeline diagrams" rows) --
 * proves both real templates render against `19` §19.2's own real `TemplateContext` shape and produce
 * front matter that validates against the ALREADY-REGISTERED `@forge/schemas` types they reuse
 * (`DataModel`, `Diagram`), per `19` §19.2 rule 1 ("templates produce valid artifacts"). The Diagram
 * template's own `source`/`depicts`/`generator` fields are proven end to end from a real
 * `@forge/diagrams` generator run, not hand-typed, per `modules/fm-data/module.yaml`'s own header
 * comment ("pipeline diagram generation reuses packages/diagrams' own already-real generators").
 *
 * `undeclaredHelperCalls` below is the identical AST-walk `test/fm-web-templates.test.ts`/
 * `test/output-templates.test.ts` already use (module-private in each, so re-implemented here too) to
 * confirm these templates use only Handlebars built-ins.
 *
 * Lives at the repository root, not inside any one package's own `test/`, for the identical
 * cross-package-check reason `test/fm-web-templates.test.ts` already documents.
 *
 * @see specs/19 §19.1, §19.2
 * @see PLAN-M10.md P5
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { pipelineToFlow } from '@forge/diagrams/generate';
import { dataModelSchema, diagramSchema } from '@forge/schemas/artifacts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fmDataRoot = path.join(repoRoot, 'modules', 'fm-data');

const HANDLEBARS_BUILTIN_HELPERS = new Set([
  'if',
  'unless',
  'each',
  'with',
  'lookup',
  'log',
  'helperMissing',
  'blockHelperMissing',
]);

function collectHelperCallNames(node: unknown, names: Set<string>): void {
  if (node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  const type = record['type'];
  const hash = record['hash'];
  if (type === 'BlockStatement' || type === 'MustacheStatement' || type === 'SubExpression') {
    const params = record['params'];
    const isCall =
      type === 'BlockStatement' ||
      (Array.isArray(params) && params.length > 0) ||
      hash !== undefined;
    const pathNode = record['path'] as { original?: unknown } | undefined;
    if (isCall && typeof pathNode?.original === 'string') names.add(pathNode.original);
    if (Array.isArray(params)) for (const param of params) collectHelperCallNames(param, names);
  }
  if (hash !== null && typeof hash === 'object') {
    const pairs = (hash as Record<string, unknown>)['pairs'];
    if (Array.isArray(pairs)) {
      for (const pair of pairs) {
        if (pair !== null && typeof pair === 'object') {
          collectHelperCallNames((pair as Record<string, unknown>)['value'], names);
        }
      }
    }
  }
  for (const key of ['body', 'program', 'inverse']) {
    const child = record[key];
    if (Array.isArray(child)) for (const item of child) collectHelperCallNames(item, names);
    else if (child !== undefined) collectHelperCallNames(child, names);
  }
}

function undeclaredHelperCalls(ast: unknown): string[] {
  const names = new Set<string>();
  collectHelperCallNames(ast, names);
  return [...names].filter((name) => !HANDLEBARS_BUILTIN_HELPERS.has(name));
}

function readTemplateSource(fileName: string): string {
  return readFileSync(path.join(fmDataRoot, 'templates', fileName), 'utf8');
}

function renderTemplate(fileName: string, context: Record<string, unknown>): string {
  return Handlebars.compile(readTemplateSource(fileName), { strict: true, noEscape: false })(
    context,
  );
}

function parseFrontMatter(rendered: string): Record<string, unknown> {
  return matter(rendered, { engines: { yaml: (input: string) => parseYaml(input) as object } })
    .data;
}

/** The real caller-side computation `pipeline-diagram.md.hbs`'s own doc comment documents: a fence
 * one backtick longer than the longest run of consecutive backticks anywhere in `text` (minimum
 * three, the ordinary CommonMark default) -- the standard "fenced code block" escaping rule, proven
 * against a real hostile fixture below (a stage name containing four literal backticks). */
function computeFence(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/** `19` §19.2's own real `TemplateContext` shape, matching `test/fm-web-templates.test.ts`'s own
 * established fixture. `created`/`updated` for `DataModel`/`Diagram` are bare dates
 * (`@forge/schemas`' own `baseFrontMatterShape` declares both as `z.string().date()`, unlike
 * fm-web's own two schemas, which deliberately declare `date-time` for fields those schemas invent) --
 * `now` below is therefore a bare date, not a full ISO-8601 instant. */
function fixtureContext(
  inputs: Record<string, unknown>,
  artifact: { readonly id: string; readonly type: string },
): Record<string, unknown> {
  return {
    project: {
      name: 'Acme Analytics',
      slug: 'acme-analytics',
      description: 'A real analytics platform.',
      level: 'L2',
      mode: 'guided',
      repoUrl: 'https://github.com/acme/analytics',
    },
    artifact: { ...artifact, created: '2026-09-12', author: 'data-engineer' },
    kb: {},
    spec: {},
    inputs,
    style: {
      id: 'default',
      language: 'en',
      tone: 'plain',
      person: 'third',
      banned_phrases: [],
      artifact_conventions: {
        headings: 'sentence case',
        dates: 'ISO-8601',
        code_fences: 'fenced with a language tag',
        diagrams: 'mermaid',
      },
      commit_style: 'conventional',
      doc_length: {},
    },
    now: '2026-09-12',
    forge: { version: '1.0.0' },
    ...inputs,
  };
}

describe('modules/fm-data/templates/*.md.hbs — only Handlebars built-in helpers', () => {
  it.each(['warehouse-model.md.hbs', 'pipeline-diagram.md.hbs'])(
    '%s uses no undeclared helper',
    (file) => {
      const ast = Handlebars.parse(readTemplateSource(file));
      expect(undeclaredHelperCalls(ast)).toEqual([]);
    },
  );
});

describe('warehouse-model.md.hbs renders against a real TemplateContext and validates against the already-registered DataModel schema', () => {
  it('a real, populated dimensional-model fixture', () => {
    const context = fixtureContext(
      {
        title: 'Orders subject area warehouse model',
        status: 'proposed',
        changelogSummary: 'initial warehouse model',
        subjectArea: 'Orders',
        grain: 'One row per order line item.',
        facts: [
          {
            name: 'fct_order_lines',
            measures: 'quantity, unit_price, discount',
            grain: 'order line',
          },
        ],
        dimensions: [
          { name: 'dim_customer', scdType: 'SCD2', attributes: 'name, tier, region' },
          { name: 'dim_product', scdType: 'SCD1', attributes: 'sku, category' },
        ],
        partitioning: 'Partitioned by order_date (daily).',
        freshnessTarget: 'Curated layer refreshed within 15 minutes of source commit.',
        lineage: 'postgres.orders -> landing.orders -> staging.orders -> fct_order_lines.',
      },
      { id: 'DM-001', type: 'DataModel' },
    );
    const rendered = renderTemplate('warehouse-model.md.hbs', context);
    const data = parseFrontMatter(rendered);
    const validation = dataModelSchema.safeParse(data);
    if (!validation.success) {
      throw new Error(
        `rendered DataModel front matter failed dataModelSchema: ${validation.error.message}`,
      );
    }
    expect(validation.data.id).toBe('DM-001');
    expect(rendered).toContain('fct_order_lines');
    expect(rendered).toContain('dim_customer');
    expect(rendered).toContain('## Lineage');
  });
});

describe('pipeline-diagram.md.hbs renders a real @forge/diagrams pipelineToFlow generator run and validates against the already-registered Diagram schema', () => {
  it('a real warehouse ingestion pipeline (source -> landing -> staging -> curated -> serving)', () => {
    const generated = pipelineToFlow({
      stages: [
        { name: 'source-systems', dependsOn: [] },
        { name: 'landing', dependsOn: ['source-systems'] },
        { name: 'staging', dependsOn: ['landing'] },
        { name: 'curated', dependsOn: ['staging'] },
        { name: 'serving', dependsOn: ['curated'] },
      ],
    });

    expect(generated.kind).toBe('flowchart');
    expect(generated.depicts).toEqual([
      'curated',
      'landing',
      'serving',
      'source-systems',
      'staging',
    ]);
    expect(generated.source).toContain('flowchart LR');

    const context = fixtureContext(
      {
        title: 'Orders analytics pipeline stages',
        status: 'proposed',
        changelogSummary: 'initial pipeline diagram',
        kind: generated.kind,
        sourceJson: JSON.stringify(generated.source),
        rawSource: generated.source,
        fence: computeFence(generated.source),
        generator: 'pipeline-to-flow',
        depicts: generated.depicts,
        explains: ['orders analytics ingestion pipeline'],
        caption: 'Orders analytics pipeline stages, from source systems through to serving.',
        altText:
          'A left-to-right flowchart of five pipeline stages from source systems to serving.',
      },
      { id: 'DIAG-001', type: 'Diagram' },
    );
    const rendered = renderTemplate('pipeline-diagram.md.hbs', context);
    const data = parseFrontMatter(rendered);
    const validation = diagramSchema.safeParse(data);
    if (!validation.success) {
      throw new Error(
        `rendered Diagram front matter failed diagramSchema: ${validation.error.message}`,
      );
    }
    expect(validation.data.generated).toBe(true);
    expect(validation.data.generator).toBe('pipeline-to-flow');
    expect(validation.data.depicts).toContain('serving');
    expect(validation.data.source).toContain('source-systems');
    expect(rendered).toContain('```mermaid');
    expect(rendered).toContain('flowchart LR');
  });

  it('a hostile stage name containing four literal backticks does not break the rendered fence -- a critic round found the first draft\'s own hard-coded triple-backtick fence was not safe against this (sanitizeMermaidLabel only ever escapes ", never a backtick)', () => {
    const hostileName = 'landing````injected';
    const generated = pipelineToFlow({
      stages: [
        { name: hostileName, dependsOn: [] },
        { name: 'staging', dependsOn: [hostileName] },
      ],
    });
    // Confirms the attack actually reaches the generator's own output, not just the test fixture.
    expect(generated.source).toContain('````');

    const fence = computeFence(generated.source);
    // Five backticks: one longer than the longest (four-backtick) run in generated.source.
    expect(fence).toBe('`````');

    const context = fixtureContext(
      {
        title: 'Hostile pipeline stages',
        status: 'proposed',
        changelogSummary: 'hostile fixture',
        kind: generated.kind,
        sourceJson: JSON.stringify(generated.source),
        rawSource: generated.source,
        fence,
        generator: 'pipeline-to-flow',
        depicts: generated.depicts,
        explains: ['hostile fixture'],
        caption: 'Hostile pipeline stages fixture.',
        altText: 'A flowchart with a hostile stage name.',
      },
      { id: 'DIAG-002', type: 'Diagram' },
    );
    const rendered = renderTemplate('pipeline-diagram.md.hbs', context);
    const data = parseFrontMatter(rendered);
    const validation = diagramSchema.safeParse(data);
    if (!validation.success) {
      throw new Error(
        `rendered Diagram front matter failed diagramSchema: ${validation.error.message}`,
      );
    }

    // The real proof: the body still has exactly one opening and one closing fence line, each using
    // the real, five-backtick fence -- the hostile four-backtick run inside rawSource never closes it
    // early. A three-backtick fence (the old hard-coded behaviour) would instead close prematurely at
    // the hostile content's own first run of three-or-more backticks.
    const fenceLines = rendered.split('\n').filter((line) => /^`{3,}/.test(line));
    expect(fenceLines).toEqual(['`````mermaid', '`````']);
  });
});
