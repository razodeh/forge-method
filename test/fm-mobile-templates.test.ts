/**
 * `modules/fm-mobile/templates/offline-first-pattern.md.hbs` (`PLAN-M10.md` P6, `19` §19.1's own
 * "offline-first patterns" row) -- proves the real template renders against `19` §19.2's own real
 * `TemplateContext` shape and produces front matter that validates against `@forge/schemas`' own real,
 * production `adrSchema` (not a hand-rolled validator: `ADR` is already a registered `@forge/schemas`
 * type, so the real zod schema is used directly), per `19` §19.2 rule 1 ("templates produce valid
 * artifacts") -- and additionally, unlike `test/fm-service-templates.test.ts` (whose own
 * `InterfaceContract` type has no `requiredSections`), proves every one of `ADR`'s own six real
 * `requiredSections` (`Context`, `Options considered`, `Decision`, `Diagram`, `Consequences`, `Reversal
 * plan`) is actually present via `@forge/core`'s own real, production `validateArtifact`.
 *
 * `undeclaredHelperCalls` below is the identical AST-walk `test/fm-service-templates.test.ts`/
 * `test/fm-web-templates.test.ts` already use (module-private in each, so re-implemented here rather
 * than imported) to confirm this template uses only Handlebars built-ins.
 *
 * Lives at the repository root, not inside any one package's own `test/`, for the identical
 * cross-package-check reason `test/fm-service-templates.test.ts` already documents.
 *
 * @see specs/19 §19.1, §19.2
 * @see PLAN-M10.md P6
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { adrSchema } from '@forge/schemas/artifacts';
import { ArtifactDocument, validateArtifact } from '@forge/core/artifacts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fmMobileRoot = path.join(repoRoot, 'modules', 'fm-mobile');

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

const TEMPLATE_FILE = 'offline-first-pattern.md.hbs';

function readTemplateSource(): string {
  return readFileSync(path.join(fmMobileRoot, 'templates', TEMPLATE_FILE), 'utf8');
}

function renderTemplate(context: Record<string, unknown>): string {
  return Handlebars.compile(readTemplateSource(), { strict: true, noEscape: false })(context);
}

/** `19` §19.2's own real `TemplateContext` shape. `kb`/`spec` are left as empty accessors: the
 * template calls neither. `artifact.created` is a bare date (`YYYY-MM-DD`), NOT the full ISO-8601
 * instant `now` carries -- see the template's own doc comment for why: `adrSchema`'s own
 * `baseFrontMatterShape` types `created`/`updated`/`date` as `z.string().date()`. */
function fixtureContext(
  inputs: Record<string, unknown>,
  artifactCreated = '2026-09-12',
): Record<string, unknown> {
  return {
    project: {
      name: 'Acme Field Ops',
      slug: 'acme-field-ops',
      description: 'A real mobile app.',
      level: 'L2',
      mode: 'guided',
      repoUrl: 'https://github.com/acme/field-ops',
    },
    artifact: {
      id: 'ADR-0101',
      type: 'ADR',
      created: artifactCreated,
      author: 'mobile',
    },
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
    // A real ISO-8601 instant -- present in the fixture (the template accepts it structurally) but
    // deliberately UNUSED by the template's own created/updated/date fields; see the template's own
    // doc comment.
    now: '2026-09-12T05:32:22.557Z',
    forge: { version: '1.0.0' },
  };
}

const FULL_INPUTS = {
  title: 'Offline-first sync strategy for field visit records',
  status: 'accepted',
  deciders: ['mobile', 'architect'],
  reversibility: 'medium',
  blastRadius: ['mobile-app', 'sync-service'],
  revisitTrigger: 'A field team reports unresolved sync conflicts in production for two weeks.',
  supersedes: [],
  related: ['ADR-0042'],
  diagrams: [],
  changelogSummary: 'Initial offline-first sync strategy decision.',
  context: 'Field visits are recorded with no network connectivity for hours at a time.',
  optionsConsidered:
    'Last-write-wins; CRDT-based merge; queue-and-replay with manual conflict review.',
  chosenPattern: 'queue-and-replay with manual conflict review for conflicting field visit edits',
  diagram: null,
  consequences:
    'Conflicting edits surface as a real, reviewable queue rather than silently dropping data.',
  reversalPlan: 'Revert to last-write-wins by disabling the conflict queue feature flag.',
};

describe('modules/fm-mobile/templates/offline-first-pattern.md.hbs — only Handlebars built-in helpers', () => {
  it('uses no undeclared helper', () => {
    const ast = Handlebars.parse(readTemplateSource());
    expect(undeclaredHelperCalls(ast)).toEqual([]);
  });
});

describe('offline-first-pattern.md.hbs renders against a real TemplateContext and validates', () => {
  it('a real, populated fixture produces valid front matter against the real, production adrSchema', () => {
    const context = fixtureContext(FULL_INPUTS);
    const rendered = renderTemplate(context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });

    const validation = adrSchema.safeParse(parsed.data);
    if (!validation.success) {
      throw new Error(`front matter failed adrSchema: ${validation.error.message}`);
    }
    expect(validation.data.created).toBe('2026-09-12');
    expect(validation.data.framework).toBe('none');
    expect(validation.data.category).toBe('architecture');
  });

  it("every one of ADR's own six real requiredSections is present, via the real, production validateArtifact", () => {
    const context = fixtureContext(FULL_INPUTS);
    const rendered = renderTemplate(context);
    const doc = ArtifactDocument.parse(rendered, 'docs/forge/kb/architecture/mobile/ADR-0101.md');
    const outcome = validateArtifact(doc);
    if (!outcome.valid) {
      throw new Error(
        `validateArtifact failed: ${outcome.errors.map((e) => e.message).join('; ')}`,
      );
    }
  });

  it('empty array-fixture fields -- {{#each}}/{{else}} renders real, parseable empty arrays, not null', () => {
    const context = fixtureContext({
      ...FULL_INPUTS,
      deciders: [],
      blastRadius: [],
      related: [],
      diagrams: [],
    });
    const rendered = renderTemplate(context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });
    const validation = adrSchema.safeParse(parsed.data);
    if (!validation.success) {
      throw new Error(`front matter failed adrSchema: ${validation.error.message}`);
    }
    expect(validation.data.deciders).toEqual([]);
    expect(validation.data.blast_radius).toEqual([]);
    expect(validation.data.related).toEqual([]);
    expect(validation.data.diagrams).toEqual([]);
  });

  it('a full ISO-8601 instant in artifact.created (the wrong field shape for this schema) is genuinely rejected -- proves the base .date() check actually discriminates, not merely present', () => {
    const context = fixtureContext(FULL_INPUTS, '2026-09-12T05:32:22.557Z');
    const rendered = renderTemplate(context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });
    const validation = adrSchema.safeParse(parsed.data);
    expect(validation.success).toBe(false);
  });

  it('missing "optionsConsidered"/"diagram" inputs still render a valid artifact via the {{#if}} fallback text', () => {
    const context = fixtureContext({
      ...FULL_INPUTS,
      optionsConsidered: undefined,
      diagram: undefined,
    });
    const rendered = renderTemplate(context);
    expect(rendered).toContain('No competing options were recorded for this decision.');
    expect(rendered).toContain('No diagram was recorded for this decision.');
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });
    expect(adrSchema.safeParse(parsed.data).success).toBe(true);
  });
});
