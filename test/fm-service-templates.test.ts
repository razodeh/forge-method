/**
 * `modules/fm-service/templates/{openapi-contract,proto-contract}.md.hbs` (`PLAN-M10.md` P4, `19`
 * §19.1's own "OpenAPI/proto templates" row) -- proves both real templates render against `19` §19.2's
 * own real `TemplateContext` shape and produce front matter that validates against `@forge/schemas`'
 * own real, production `interfaceContractSchema` (not a hand-rolled validator: unlike fm-web's two NEW
 * artifact types, `InterfaceContract` is already a registered `@forge/schemas` type, so the real zod
 * schema is used directly), per `19` §19.2 rule 1 ("templates produce valid artifacts").
 *
 * `undeclaredHelperCalls` below is the identical AST-walk `test/fm-web-templates.test.ts`/
 * `test/output-templates.test.ts` already use (module-private in each, so re-implemented here rather
 * than imported) to confirm these templates use only Handlebars built-ins.
 *
 * Lives at the repository root, not inside any one package's own `test/`, for the identical
 * cross-package-check reason `test/fm-web-templates.test.ts` already documents.
 *
 * @see specs/19 §19.1, §19.2
 * @see PLAN-M10.md P4
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { interfaceContractSchema } from '@forge/schemas/artifacts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fmServiceRoot = path.join(repoRoot, 'modules', 'fm-service');

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
  return readFileSync(path.join(fmServiceRoot, 'templates', fileName), 'utf8');
}

function renderTemplate(fileName: string, context: Record<string, unknown>): string {
  return Handlebars.compile(readTemplateSource(fileName), { strict: true, noEscape: false })(
    context,
  );
}

/** `19` §19.2's own real `TemplateContext` shape. `kb`/`spec` are left as empty accessors: neither
 * template calls them. `artifact.created` is a bare date (`YYYY-MM-DD`), NOT the full ISO-8601
 * instant `now` carries -- see both templates' own doc comments for why: InterfaceContract's own
 * `baseFrontMatterShape` types `created`/`updated` as `z.string().date()`, and this fixture's own
 * `artifact.created` stands in for whatever a real caller resolves that field to for this concrete
 * artifact type, already in the shape its schema expects. */
function fixtureContext(
  inputs: Record<string, unknown>,
  artifactCreated = '2026-09-12',
): Record<string, unknown> {
  return {
    project: {
      name: 'Acme Orders Platform',
      slug: 'acme-orders',
      description: 'A real backend service.',
      level: 'L2',
      mode: 'guided',
      repoUrl: 'https://github.com/acme/orders',
    },
    artifact: {
      id: 'INT-001',
      type: 'InterfaceContract',
      created: artifactCreated,
      author: 'integration-architect',
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
    // A real ISO-8601 instant -- present in the fixture (both templates accept it structurally) but
    // deliberately UNUSED by either template's own created/updated fields, unlike fm-web's two new
    // types; see each template's own doc comment.
    now: '2026-09-12T05:32:22.557Z',
    forge: { version: '1.0.0' },
  };
}

describe('modules/fm-service/templates/*.md.hbs — only Handlebars built-in helpers', () => {
  it.each(['openapi-contract.md.hbs', 'proto-contract.md.hbs'])(
    '%s uses no undeclared helper',
    (file) => {
      const ast = Handlebars.parse(readTemplateSource(file));
      expect(undeclaredHelperCalls(ast)).toEqual([]);
    },
  );
});

describe('openapi-contract.md.hbs renders against a real TemplateContext and validates', () => {
  it('a real, populated OpenAPI fixture produces valid front matter and a real, parseable OpenAPI document', () => {
    const context = fixtureContext({
      apiName: 'Orders API',
      apiVersion: '1.0.0',
      operations: [
        { path: '/orders', method: 'get', operationId: 'listOrders', summary: 'List orders' },
        { path: '/orders/{id}', method: 'get', operationId: 'getOrder', summary: 'Get one order' },
      ],
    });
    const rendered = renderTemplate('openapi-contract.md.hbs', context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });

    const validation = interfaceContractSchema.safeParse(parsed.data);
    if (!validation.success) {
      throw new Error(`front matter failed interfaceContractSchema: ${validation.error.message}`);
    }
    expect(validation.data.created).toBe('2026-09-12');

    const openApiBlock = /```yaml\n([\s\S]*?)\n```/.exec(parsed.content)?.[1];
    expect(openApiBlock).toBeDefined();
    const openApiDoc = parseYaml(openApiBlock ?? '') as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(openApiDoc.openapi).toBe('3.1.0');
    expect(Object.keys(openApiDoc.paths)).toEqual(['/orders', '/orders/{id}']);
  });

  it('an empty operations fixture -- {{#each}}/{{else}} renders a real, parseable empty "paths: {}", not null', () => {
    const context = fixtureContext({ apiName: 'Orders API', apiVersion: '1.0.0', operations: [] });
    const rendered = renderTemplate('openapi-contract.md.hbs', context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });
    expect(interfaceContractSchema.safeParse(parsed.data).success).toBe(true);

    const openApiBlock = /```yaml\n([\s\S]*?)\n```/.exec(parsed.content)?.[1];
    const openApiDoc = parseYaml(openApiBlock ?? '') as { paths: unknown };
    expect(openApiDoc.paths).toEqual({});
  });

  it('a full ISO-8601 instant in artifact.created (the wrong field shape for this schema) is genuinely rejected -- proves the base .date() check actually discriminates, not merely present', () => {
    const context = fixtureContext(
      { apiName: 'Orders API', apiVersion: '1.0.0', operations: [] },
      '2026-09-12T05:32:22.557Z',
    );
    const rendered = renderTemplate('openapi-contract.md.hbs', context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });
    const validation = interfaceContractSchema.safeParse(parsed.data);
    expect(validation.success).toBe(false);
  });
});

describe('proto-contract.md.hbs renders against a real TemplateContext and validates', () => {
  it('a real, populated proto fixture produces valid front matter and a real, well-formed proto3 service definition', () => {
    const context = fixtureContext({
      serviceName: 'OrdersService',
      packageName: 'acme.orders.v1',
      rpcs: [
        { name: 'GetOrder', request: 'GetOrderRequest', response: 'GetOrderResponse' },
        { name: 'ListOrders', request: 'ListOrdersRequest', response: 'ListOrdersResponse' },
      ],
    });
    const rendered = renderTemplate('proto-contract.md.hbs', context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });

    const validation = interfaceContractSchema.safeParse(parsed.data);
    if (!validation.success) {
      throw new Error(`front matter failed interfaceContractSchema: ${validation.error.message}`);
    }

    const protoBlock = /```proto\n([\s\S]*?)\n```/.exec(parsed.content)?.[1];
    expect(protoBlock).toBeDefined();
    const proto = protoBlock ?? '';
    expect(proto).toContain('syntax = "proto3";');
    expect(proto).toContain('package acme.orders.v1;');
    expect(proto).toMatch(/service OrdersService \{[\s\S]*\}/);
    expect(proto).toContain('rpc GetOrder(GetOrderRequest) returns (GetOrderResponse);');
    expect(proto).toContain('rpc ListOrders(ListOrdersRequest) returns (ListOrdersResponse);');
  });

  it('an empty rpcs fixture still produces a syntactically well-formed, empty service block', () => {
    const context = fixtureContext({
      serviceName: 'EmptyService',
      packageName: 'acme.empty.v1',
      rpcs: [],
    });
    const rendered = renderTemplate('proto-contract.md.hbs', context);
    const parsed = matter(rendered, {
      engines: { yaml: (input: string) => parseYaml(input) as object },
    });
    expect(interfaceContractSchema.safeParse(parsed.data).success).toBe(true);
    const protoBlock = /```proto\n([\s\S]*?)\n```/.exec(parsed.content)?.[1] ?? '';
    expect(protoBlock).toMatch(/service EmptyService \{\s*\}/);
  });
});
