/**
 * `@forge/templates`'s 21 artifact stub templates, per `PLAN-M1.md` P11.
 *
 * Lives at the repository root, not inside `packages/templates/test/` or `packages/schemas/test/`:
 * this is the one check in the whole piece that needs both `@forge/schemas` (the real per-type zod
 * schemas and registry) and `@forge/templates` (`TEMPLATE_INDEX`), and `02` §2.2 gives both packages
 * zero `@forge/*` dependencies — neither can import the other, in `src/` or in `test/` (the boundary
 * ESLint rules apply to `packages/**` with no test exemption). The repository root is not covered by
 * that glob, the same reason `test/workspace-floor.test.ts` and `test/lint-rules.test.ts` already
 * live here rather than inside any one package. See `SPEC-QUESTIONS.md` Q28.
 *
 * @see specs/18 §18.6
 * @see specs/18 §18.7
 * @see PLAN-M1.md P11
 * @see SPEC-QUESTIONS.md Q28
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import Handlebars from 'handlebars';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  adrSchema,
  ARTIFACT_TYPES,
  assumptionSchema,
  capabilitySchema,
  dataModelSchema,
  defectSchema,
  diagramSchema,
  environmentSchema,
  epicSchema,
  gateReportSchema,
  handoffRecordSchema,
  interfaceContractSchema,
  nfrSchema,
  openQuestionSchema,
  rcaSchema,
  riskSchema,
  runbookSchema,
  sessionRecordSchema,
  storySchema,
  taskSchema,
  visionSchema,
  waiverSchema,
  type ArtifactTypeId,
} from '@forge/schemas';
import { TEMPLATE_INDEX, type TemplateArtifactTypeId } from '@forge/templates';
import type { z } from 'zod';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesPackageRoot = path.join(repoRoot, 'packages', 'templates');

/** One schema per registry type — a private map, exactly `@forge/schemas/json-schema/emit.ts`'s. */
const SCHEMA_BY_TYPE: Record<ArtifactTypeId, z.ZodTypeAny> = {
  Vision: visionSchema,
  Capability: capabilitySchema,
  NFR: nfrSchema,
  Epic: epicSchema,
  Story: storySchema,
  Task: taskSchema,
  ADR: adrSchema,
  InterfaceContract: interfaceContractSchema,
  DataModel: dataModelSchema,
  Diagram: diagramSchema,
  Risk: riskSchema,
  Assumption: assumptionSchema,
  OpenQuestion: openQuestionSchema,
  Waiver: waiverSchema,
  SessionRecord: sessionRecordSchema,
  RCA: rcaSchema,
  Defect: defectSchema,
  Environment: environmentSchema,
  Runbook: runbookSchema,
  GateReport: gateReportSchema,
  HandoffRecord: handoffRecordSchema,
};

function readTemplate(type: TemplateArtifactTypeId): {
  data: unknown;
  content: string;
  raw: string;
} {
  const filePath = path.join(templatesPackageRoot, TEMPLATE_INDEX[type]);
  const raw = readFileSync(filePath, 'utf8');
  const parsed = matter(raw, { engines: { yaml: (input: string) => parseYaml(input) as object } });
  return { data: parsed.data, content: parsed.content, raw };
}

/** The `##`-level headings in `content`, in order. `###`+ subsections are deliberately excluded. */
function topLevelHeadings(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice('## '.length).trim());
}

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

/**
 * Custom Handlebars helpers this repository has declared, per `02`'s tech-stack pin and `19` §19.2's
 * `TemplateContext`. Empty at M1: no piece before the M2 engine renders a template at all, and none
 * of these 21 static stubs use `{{...}}` syntax (`SPEC-QUESTIONS.md` Q28) — populate this the same
 * milestone something actually registers a helper with Handlebars.
 */
const DECLARED_HELPERS: ReadonlySet<string> = new Set();

/** Every `{{...}}`-shaped substring in `text`, verbatim (including the braces). */
function findHandlebarsExpressions(text: string): string[] {
  return text.match(/\{\{[^}]*\}\}/g) ?? [];
}

/**
 * Recursively collects the name of every Handlebars *call* (a block, or a mustache/sub-expression
 * with params or a hash) in a parsed AST node — a bare `{{title}}` is a plain path lookup and needs
 * no declaration, but `{{title}}`'s block or call forms (`{{#title}}...{{/title}}`, `{{title x}}`)
 * always invoke a helper by that name.
 */
function collectHelperCallNames(node: unknown, names: Set<string>): void {
  if (node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  const type = record['type'];
  if (type === 'BlockStatement' || type === 'MustacheStatement' || type === 'SubExpression') {
    const params = record['params'];
    const isCall =
      type === 'BlockStatement' ||
      (Array.isArray(params) && params.length > 0) ||
      record['hash'] !== undefined;
    const pathNode = record['path'] as { original?: unknown } | undefined;
    if (isCall && typeof pathNode?.original === 'string') names.add(pathNode.original);
    if (Array.isArray(params)) for (const param of params) collectHelperCallNames(param, names);
  }
  for (const key of ['body', 'program', 'inverse']) {
    const child = record[key];
    if (Array.isArray(child)) for (const item of child) collectHelperCallNames(item, names);
    else if (child !== undefined) collectHelperCallNames(child, names);
  }
}

/** Every helper name `expression` calls that is neither a Handlebars built-in nor declared. */
function undeclaredHelperCalls(expression: string): string[] {
  const names = new Set<string>();
  collectHelperCallNames(Handlebars.parse(expression), names);
  return [...names].filter(
    (name) => !HANDLEBARS_BUILTIN_HELPERS.has(name) && !DECLARED_HELPERS.has(name),
  );
}

describe('undeclaredHelperCalls (the Handlebars check itself)', () => {
  it('finds nothing in a plain path expression — no call, nothing to declare', () => {
    expect(undeclaredHelperCalls('{{title}}')).toEqual([]);
  });

  it('finds nothing when only a Handlebars built-in helper is used', () => {
    expect(undeclaredHelperCalls('{{#if x}}y{{/if}}')).toEqual([]);
    expect(undeclaredHelperCalls('{{#each items}}{{this}}{{/each}}')).toEqual([]);
  });

  it('names an undeclared custom helper called with an argument', () => {
    expect(undeclaredHelperCalls('{{customHelper x}}')).toEqual(['customHelper']);
  });

  it('names an undeclared custom block helper', () => {
    expect(undeclaredHelperCalls('{{#customBlock}}y{{/customBlock}}')).toEqual(['customBlock']);
  });
});

describe('TEMPLATE_INDEX', () => {
  it('has exactly the same 21 type ids as the real ARTIFACT_TYPES registry, in both directions', () => {
    const fromTemplates = new Set(Object.keys(TEMPLATE_INDEX));
    const fromRegistry = new Set(ARTIFACT_TYPES.map((type) => type.id));
    expect(fromTemplates).toEqual(fromRegistry);
  });
});

describe.each(ARTIFACT_TYPES.map((type) => [type.id, type] as const))(
  '%s template',
  (id, definition) => {
    it('exists and its front matter validates against the real schema', () => {
      const { data } = readTemplate(id);
      const result = SCHEMA_BY_TYPE[id].safeParse(data);
      expect(
        result.success,
        result.success ? '' : JSON.stringify(result.error.issues, null, 2),
      ).toBe(true);
    });

    it("has exactly the type's requiredSections as its top-level ## headings, in order", () => {
      const { content } = readTemplate(id);
      expect(topLevelHeadings(content)).toEqual(definition.requiredSections);
    });

    it('contains no TODO/FIXME and no Handlebars expression outside the declared helper set', () => {
      const { raw } = readTemplate(id);
      expect(raw).not.toContain('TODO');
      expect(raw).not.toContain('FIXME');
      for (const expression of findHandlebarsExpressions(raw)) {
        expect(undeclaredHelperCalls(expression), expression).toEqual([]);
      }
    });
  },
);
