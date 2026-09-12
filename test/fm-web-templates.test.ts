/**
 * `modules/fm-web/templates/*.md.hbs` (`PLAN-M10.md` P3, `19` §19.1's own "UX-heavy templates" row) --
 * proves both real templates render against `19` §19.2's own real `TemplateContext` shape and produce
 * front matter that validates against this module's own two new artifact-type JSON Schemas
 * (`modules/fm-web/schemas/*.schema.json`), per `19` §19.2 rule 1 ("templates produce valid artifacts:
 * front matter matching the type's schema").
 *
 * Lives at the repository root, not inside any one package's own `test/`, for the identical
 * cross-package-check reason `test/output-templates.test.ts`/`test/templates.test.ts` already
 * document: this needs `handlebars`/`gray-matter`/`yaml` (root devDependencies) plus direct filesystem
 * access to `modules/fm-web/`, a bare workspace directory with no package of its own.
 *
 * `undeclaredHelperCalls` below is the identical AST-walk `test/output-templates.test.ts` already
 * uses (module-private there, so re-implemented here rather than imported) to confirm these templates
 * use only Handlebars built-ins -- no custom helper (`{{id}}`, `{{slug}}`, `{{required}}`, ...) is
 * registered anywhere in this repository yet.
 *
 * `validateAgainstSchema` is a small, real, hand-rolled validator over the *subset* of JSON Schema
 * these two schema files actually use (`type`, `required`, `properties.{type,pattern,enum,const,
 * minLength,minItems,items}`, `additionalProperties: false`) -- not a general-purpose JSON Schema
 * engine. No JSON Schema validator (ajv or otherwise) is a dependency anywhere in this repository
 * (`@forge/schemas` only ever *emits* JSON Schema via `zod-to-json-schema`, never validates against
 * one), so this follows the same "write the minimal real check yourself" precedent
 * `test/output-templates.test.ts`'s own hand-rolled Handlebars AST walker and `evaluate.ts`'s own
 * hand-rolled expression evaluator already establish, rather than adding a new dependency for two
 * schema files.
 *
 * @see specs/19 §19.1, §19.2
 * @see PLAN-M10.md P3
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fmWebRoot = path.join(repoRoot, 'modules', 'fm-web');

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

interface JsonSchemaLike {
  readonly type?: string;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly properties?: Readonly<
    Record<string, JsonSchemaLike & { readonly items?: JsonSchemaLike }>
  >;
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly pattern?: string;
  readonly minLength?: number;
  readonly minItems?: number;
}

/** Validates `data` against the real subset of JSON Schema `schema` uses. Returns every violation
 * found (empty = valid) rather than throwing on the first one, matching this whole codebase's own
 * "collect every issue, don't stop at the first" convention (e.g. zod's own `safeParse`). */
function validateAgainstSchema(schema: JsonSchemaLike, data: unknown, at = '(root)'): string[] {
  const issues: string[] = [];
  if (schema.type === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return [`${at}: expected object`];
    }
    const obj = data as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) issues.push(`${at}: missing required field "${key}"`);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) issues.push(`${at}: unexpected field "${key}"`);
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (!(key in obj)) continue;
      issues.push(...validateAgainstSchema(propSchema, obj[key], `${at}.${key}`));
    }
    return issues;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(data)) return [`${at}: expected array`];
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      issues.push(
        `${at}: expected at least ${String(schema.minItems)} item(s), got ${String(data.length)}`,
      );
    }
    const items = (schema as { items?: JsonSchemaLike }).items;
    if (items !== undefined) {
      data.forEach((item, i) =>
        issues.push(...validateAgainstSchema(items, item, `${at}[${String(i)}]`)),
      );
    }
    return issues;
  }
  if (schema.const !== undefined && data !== schema.const) {
    issues.push(
      `${at}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`,
    );
  }
  if (schema.enum !== undefined && !schema.enum.includes(data)) {
    issues.push(
      `${at}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(data)}`,
    );
  }
  if (schema.type === 'string') {
    if (typeof data !== 'string') issues.push(`${at}: expected string`);
    else {
      if (schema.minLength !== undefined && data.length < schema.minLength) {
        issues.push(`${at}: shorter than minLength ${String(schema.minLength)}`);
      }
      if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(data)) {
        issues.push(`${at}: does not match pattern ${schema.pattern}`);
      }
    }
  }
  if (schema.type === 'integer' && (typeof data !== 'number' || !Number.isInteger(data))) {
    issues.push(`${at}: expected integer`);
  }
  return issues;
}

function readSchema(fileName: string): JsonSchemaLike {
  return JSON.parse(
    readFileSync(path.join(fmWebRoot, 'schemas', fileName), 'utf8'),
  ) as JsonSchemaLike;
}

function renderTemplate(fileName: string, context: Record<string, unknown>): string {
  const source = readFileSync(path.join(fmWebRoot, 'templates', fileName), 'utf8');
  return Handlebars.compile(source, { strict: true, noEscape: false })(context);
}

function readTemplateSource(fileName: string): string {
  return readFileSync(path.join(fmWebRoot, 'templates', fileName), 'utf8');
}

/** `19` §19.2's own real `TemplateContext` shape. `kb`/`spec` are left as empty accessors: neither
 * template calls them (see each .hbs file's own doc comment for why), so a fixture proving the
 * *shape* is accepted without a template ever dereferencing it is enough. */
function fixtureContext(
  inputs: Record<string, unknown>,
  artifact: { readonly id: string; readonly type: string } = {
    id: 'CS-001',
    type: 'ComponentSpec',
  },
): Record<string, unknown> {
  return {
    project: {
      name: 'Acme Storefront',
      slug: 'acme-storefront',
      description: 'A real e-commerce storefront.',
      level: 'L2',
      mode: 'guided',
      repoUrl: 'https://github.com/acme/storefront',
    },
    artifact: { ...artifact, created: '2026-09-12T05:32:22.557Z', author: 'frontend' },
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
    // A real ISO-8601 instant, matching @forge/core's own real Clock.now() shape
    // (packages/core/src/clock.ts) -- NOT a bare date. A critic round found the previous fixture used
    // a bare date here, which both templates' own `created: {{{now}}}`/`updated: {{{now}}}` would
    // then render as a valid-looking bare date -- masking the fact that a real caller's `now` (a full
    // instant) renders a value the schemas' own then-`format: "date"` field rejected outright. The two
    // schema files now declare created/updated as date-time (with a real `pattern`, since
    // validateAgainstSchema below does not implement the `format` keyword) for exactly this reason.
    now: '2026-09-12T05:32:22.557Z',
    forge: { version: '1.0.0' },
  };
}

describe('modules/fm-web/templates/*.md.hbs — only Handlebars built-in helpers', () => {
  it.each(['component-spec.md.hbs', 'ux-review-record.md.hbs'])(
    '%s uses no undeclared helper',
    (file) => {
      const ast = Handlebars.parse(readTemplateSource(file));
      expect(undeclaredHelperCalls(ast)).toEqual([]);
    },
  );
});

describe('component-spec.md.hbs renders against a real TemplateContext and validates', () => {
  const schema = readSchema('component-spec.schema.json');

  it('non-empty props/states/accessibility_notes fixture', () => {
    const context = fixtureContext({
      componentName: 'PriceTag',
      props: ['amount', 'currency', 'onSale'],
      states: ['default', 'onSale', 'loading'],
      accessibilityNotes: [
        'Announce a sale-price change via a polite aria-live region.',
        'Maintain at least 4.5:1 contrast for the struck-through original price.',
      ],
    });
    const rendered = renderTemplate('component-spec.md.hbs', context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });
    const issues = validateAgainstSchema(schema, parsed.data);
    expect(issues).toEqual([]);
    expect(parsed.data['component_name']).toBe('PriceTag');
    expect(parsed.data['props']).toEqual(['amount', 'currency', 'onSale']);
    expect(parsed.content).toContain('## Props');
  });

  it('empty props/states/accessibility_notes fixture -- {{#each}}/{{else}} renders "[]", not null', () => {
    const context = fixtureContext({
      componentName: 'Divider',
      props: [],
      states: [],
      accessibilityNotes: [],
    });
    const rendered = renderTemplate('component-spec.md.hbs', context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });
    expect(parsed.data['props']).toEqual([]);
    expect(parsed.data['states']).toEqual([]);
    expect(parsed.data['accessibility_notes']).toEqual([]);
    const issues = validateAgainstSchema(schema, parsed.data);
    expect(issues).toEqual([]);
  });

  it('validateAgainstSchema genuinely rejects a bare-date created/updated -- proves the date-time pattern actually discriminates, not merely present', () => {
    const context = fixtureContext({
      componentName: 'Divider',
      props: [],
      states: [],
      accessibilityNotes: [],
    });
    context['now'] = '2026-09-12'; // a bare date, not the real ISO-8601 instant TemplateContext.now is
    const rendered = renderTemplate('component-spec.md.hbs', context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });
    const issues = validateAgainstSchema(schema, parsed.data);
    expect(issues).toContain(
      '(root).created: does not match pattern ^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$',
    );
  });
});

describe('ux-review-record.md.hbs renders against a real TemplateContext and validates', () => {
  const schema = readSchema('ux-review-record.schema.json');

  it('a real, populated review fixture', () => {
    const context = fixtureContext(
      {
        subject: 'Checkout flow -- mobile',
        severity: 'major',
        findings: [
          'Primary CTA contrast is 2.8:1 on the light background, below WCAG AA 4.5:1.',
          'The error banner has no aria-live region, so screen readers never announce it.',
        ],
        recommendation:
          'Raise the CTA contrast to at least 4.5:1 and wrap the error banner in an aria-live="assertive" region before the next release.',
      },
      { id: 'UXR-001', type: 'UXReviewRecord' },
    );
    const rendered = renderTemplate('ux-review-record.md.hbs', context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });
    const issues = validateAgainstSchema(schema, parsed.data);
    expect(issues).toEqual([]);
    expect(parsed.data['severity']).toBe('major');
    expect(parsed.data['findings']).toHaveLength(2);
    expect(parsed.content).toContain('## Recommendation');
  });

  it('a single-finding fixture still satisfies findings.minItems=1', () => {
    const context = fixtureContext(
      {
        subject: 'Empty cart state',
        severity: 'minor',
        findings: ['The empty-cart illustration has no alt text.'],
        recommendation: 'Add a descriptive alt attribute to the illustration.',
      },
      { id: 'UXR-002', type: 'UXReviewRecord' },
    );
    const rendered = renderTemplate('ux-review-record.md.hbs', context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });
    const issues = validateAgainstSchema(schema, parsed.data);
    expect(issues).toEqual([]);
  });
});
