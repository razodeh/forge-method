/**
 * `@forge/templates`'s 43 ADR output templates (`templates/adr-<id>.md.hbs`), per `PLAN-M6.md` T5's
 * own Checks section: "every `output_template` a T3/T4 framework references resolves to a real file
 * here."
 *
 * Lives at the repository root for the identical cross-package-check reason `test/frameworks.test.ts`
 * already documents: this is the one check that needs both `@forge/methods/schema` (to read each
 * framework's own `output_template` field) and `@forge/templates` (the shipped `.hbs` files
 * themselves), and `02` §2.2 gives `@forge/templates` zero `@forge/*` dependencies.
 *
 * `output_template`'s own real shipped path (`templates/adr-<id>.md.hbs`, not `PLAN-M6.md` T5's own
 * `templates/output/<name>.md.hbs` paraphrase) and the Handlebars-template contract these files follow
 * (built-in helpers only, triple-stash for every text placeholder) are both recorded in full in
 * `SPEC-QUESTIONS.md` Q93.
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md T5
 * @see SPEC-QUESTIONS.md Q93
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { loadFramework } from '@forge/methods/schema';
import { adrSchema } from '@forge/schemas';
import { FRAMEWORK_INDEX, type FrameworkId } from '@forge/templates';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesPackageRoot = path.join(repoRoot, 'packages', 'templates');

function readFrameworkSource(id: FrameworkId): string {
  return readFileSync(path.join(templatesPackageRoot, FRAMEWORK_INDEX[id]), 'utf8');
}

const ALL_FRAMEWORK_IDS = Object.keys(FRAMEWORK_INDEX) as FrameworkId[];

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

/** No custom helper is registered anywhere in this repository yet (`test/templates.test.ts`'s own
 * `DECLARED_HELPERS` is empty) -- these output templates use only Handlebars built-ins, the identical
 * convention, checked the identical way: walk the parsed AST, collect every helper *call* (a block, or
 * a mustache/sub-expression with params or a hash — a bare `{{title}}` is a plain path lookup, not a
 * call), and confirm each one is a built-in. */
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

describe('T5: the 43 ADR output templates', () => {
  it.each(ALL_FRAMEWORK_IDS)(
    "%s's own output_template resolves to a real, existing .hbs file",
    (id) => {
      const result = loadFramework(readFrameworkSource(id), FRAMEWORK_INDEX[id]);
      if (!result.success) throw new Error(`${id} failed to load`);
      const templatePath = path.join(templatesPackageRoot, result.framework.output_template);
      expect(() => readFileSync(templatePath, 'utf8')).not.toThrow();
    },
  );

  it.each(ALL_FRAMEWORK_IDS)(
    "%s's own output template is valid Handlebars using only built-in helpers",
    (id) => {
      const result = loadFramework(readFrameworkSource(id), FRAMEWORK_INDEX[id]);
      if (!result.success) throw new Error(`${id} failed to load`);
      const source = readFileSync(
        path.join(templatesPackageRoot, result.framework.output_template),
        'utf8',
      );
      const ast = Handlebars.parse(source);
      expect(undeclaredHelperCalls(ast)).toEqual([]);
    },
  );

  it.each(ALL_FRAMEWORK_IDS)(
    "%s's own output template hardcodes the same category and framework id as the framework file itself",
    (id) => {
      const result = loadFramework(readFrameworkSource(id), FRAMEWORK_INDEX[id]);
      if (!result.success) throw new Error(`${id} failed to load`);
      const rawFramework = parseYaml(readFrameworkSource(id)) as {
        produces: { adr_category: string };
      };
      const templateSource = readFileSync(
        path.join(templatesPackageRoot, result.framework.output_template),
        'utf8',
      );
      expect(templateSource).toContain(`category: ${rawFramework.produces.adr_category}`);
      expect(templateSource).toContain(`framework: ${id}`);
    },
  );

  // A critic round found that neither the AST-parse check above nor the substring checks catch a
  // template whose *rendered* front matter is not actually valid YAML, or whose rendered front
  // matter does not satisfy the real `adrSchema` -- `Handlebars.parse` only validates template
  // *syntax* (unaffected by, say, two YAML keys accidentally landing on the same rendered line), and
  // a substring check cannot see the surrounding line structure at all. This is the check that would
  // have caught it: actually compile and render each template against representative data, then parse
  // the result as YAML and validate it against the real schema. Two fixtures per template, not one --
  // non-empty arrays/criteria (build-stage-shaped) and empty arrays/no criteria (scaffold-generation-
  // shaped) -- since Handlebars' own `{{#each}}` renders differently (and, before this round's fix,
  // failed differently) for an empty array than a populated one.
  function fixtureContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      seq: '0001',
      title: 'A representative decision title',
      status: 'accepted',
      deciders: ['architect', 'platform'],
      date: '2026-01-15',
      author: 'architect',
      reversibility: 'medium',
      blastRadius: ['delivery/build.md'],
      revisitTrigger: 'the team doubles in size',
      supersedes: ['ADR-0000'],
      related: ['ADR-0002'],
      diagrams: ['DIA-0001'],
      changelogSummary: 'Initial decision.',
      context: 'A representative context paragraph describing the problem.',
      chosenOption: 'the-chosen-option',
      criteria: [{ id: 'fit', weight: 1 }],
      scoreTable: '| Option | fit |\n|---|---|\n| the-chosen-option | 5 |',
      killerRisk: 'A representative killer risk.',
      consequences: 'A representative consequences paragraph.',
      alternativesConsidered: 'A representative alternatives paragraph.',
      ...overrides,
    };
  }

  const NON_EMPTY_FIXTURE = fixtureContext();
  const EMPTY_FIXTURE = fixtureContext({
    deciders: [],
    blastRadius: [],
    supersedes: [],
    related: [],
    diagrams: [],
    criteria: undefined,
    alternativesConsidered: undefined,
  });

  describe.each([
    ['non-empty arrays and real criteria', NON_EMPTY_FIXTURE],
    ['empty arrays and no criteria (a procedural framework)', EMPTY_FIXTURE],
  ])('rendered against a fixture with %s', (_label, fixture) => {
    it.each(ALL_FRAMEWORK_IDS)(
      '%s renders to front matter that parses as YAML and validates against the real adrSchema',
      (id) => {
        const result = loadFramework(readFrameworkSource(id), FRAMEWORK_INDEX[id]);
        if (!result.success) throw new Error(`${id} failed to load`);
        const source = readFileSync(
          path.join(templatesPackageRoot, result.framework.output_template),
          'utf8',
        );
        const rendered = Handlebars.compile(source)(fixture);
        const frontMatterMatch = /^---\n([\s\S]*?)\n---/.exec(rendered);
        expect(
          frontMatterMatch,
          'rendered output has no --- delimited front matter',
        ).not.toBeNull();
        const frontMatterText = frontMatterMatch?.[1] ?? '';
        let parsed: unknown;
        expect(() => {
          parsed = parseYaml(frontMatterText);
        }, `front matter did not parse as YAML:\n${frontMatterText}`).not.toThrow();
        const schemaResult = adrSchema.safeParse(parsed);
        const issues = schemaResult.success ? null : schemaResult.error.issues;
        expect(schemaResult.success, JSON.stringify(issues, null, 2)).toBe(true);
      },
    );
  });

  it('no two frameworks share the same output_template path (43 distinct templates for 43 frameworks)', () => {
    const paths = new Set<string>();
    for (const id of ALL_FRAMEWORK_IDS) {
      const result = loadFramework(readFrameworkSource(id), FRAMEWORK_INDEX[id]);
      if (!result.success) throw new Error(`${id} failed to load`);
      paths.add(result.framework.output_template);
    }
    expect(paths.size).toBe(ALL_FRAMEWORK_IDS.length);
  });
});
