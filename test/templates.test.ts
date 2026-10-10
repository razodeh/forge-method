/**
 * `@forge/templates`'s 27 artifact stub templates (21 original + `ReviewReport`, added post-v1.0, +
 * `MutationEvidence`/`EvidenceBundle`/`Exemption`/`Disclosure`, post-v1.0 M15, + `ParityEvidence`,
 * post-v1.0 M16 P5), per `PLAN-M1.md` P11.
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
  disclosureSchema,
  environmentSchema,
  epicSchema,
  evidenceBundleSchema,
  exemptionSchema,
  gateReportSchema,
  handoffRecordSchema,
  interfaceContractSchema,
  mutationEvidenceSchema,
  nfrSchema,
  openQuestionSchema,
  parityEvidenceSchema,
  rcaSchema,
  reviewReportSchema,
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
  Exemption: exemptionSchema,
  Disclosure: disclosureSchema,
  SessionRecord: sessionRecordSchema,
  RCA: rcaSchema,
  Defect: defectSchema,
  Environment: environmentSchema,
  Runbook: runbookSchema,
  GateReport: gateReportSchema,
  HandoffRecord: handoffRecordSchema,
  ReviewReport: reviewReportSchema,
  MutationEvidence: mutationEvidenceSchema,
  EvidenceBundle: evidenceBundleSchema,
  ParityEvidence: parityEvidenceSchema,
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

/**
 * The `##`-level headings in `content`, in order. `###`+ subsections are deliberately excluded, and
 * so is a `## `-prefixed line inside a ` ``` ` fenced code block — a template quoting another
 * artifact's structure as an example is not itself declaring a section.
 */
function topLevelHeadings(content: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of content.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && line.startsWith('## ')) headings.push(line.slice('## '.length).trim());
  }
  return headings;
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
 * of these static stubs (24 now, 21 at M1) use `{{...}}` syntax (`SPEC-QUESTIONS.md` Q28) — populate
 * this the same milestone something actually registers a helper with Handlebars.
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
  // A hash argument's value can itself be a SubExpression calling another helper
  // (`{{helper key=(otherHelper x)}}`) — without this, that inner call is invisible to every
  // caller of this function, since it lives under `hash.pairs[].value`, not `params` or `body`.
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

  it('names an undeclared helper nested inside a hash argument', () => {
    // `{{helper key=(subHelper x)}}` — `subHelper` lives under `hash.pairs[].value`, not `params`
    // or `body`; a walk that skips `hash` entirely (the bug this test guards against) would report
    // only `helper` and miss `subHelper` completely.
    expect(undeclaredHelperCalls('{{helper key=(subHelper x)}}').sort()).toEqual([
      'helper',
      'subHelper',
    ]);
  });
});

describe('topLevelHeadings (the ## extraction itself)', () => {
  it('does not count a ## line inside a fenced code block as a heading', () => {
    const content = ['## Real Heading', '', '```', '## Not a heading', '```', ''].join('\n');
    expect(topLevelHeadings(content)).toEqual(['Real Heading']);
  });

  it('resumes recognising headings once the fence closes', () => {
    const content = ['```', '## Not a heading', '```', '## Real Heading'].join('\n');
    expect(topLevelHeadings(content)).toEqual(['Real Heading']);
  });
});

describe('TEMPLATE_INDEX', () => {
  it('has exactly the same type ids as the real ARTIFACT_TYPES registry, in both directions', () => {
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

/**
 * `PLAN-M14.md` P11: the six KB-located types' templates gain `sources: []` (schema and template land
 * together, the Mandate's own words) -- an empty array is a legitimate scaffold, since `sources` is
 * OPTIONAL on all six schemas (the output check, not the schema, requires it be non-empty on a
 * PRODUCED document or entry; a fresh, uncopied scaffold is neither).
 *
 * @see specs/08 §8.6
 * @see PLAN-M14.md P11
 */
/**
 * A brief that asks an agent to fill an `assumptionSchema`-shaped field — `HandoffRecord.assumptions`
 * or the `Assumption` collection entries in `kb/assumptions.md` (`collection-file.ts`'s
 * `assumptionsFileSchema`, the identical schema reused) — must tell it the real shape: a strict
 * object (`id`, `text`, `confidence`, `validate_by`), never a plain string. On `HandoffRecord` this is
 * a real asymmetry trap: every sibling field (`delivered`, `open_questions`,
 * `constraints_for_receiver`, `acceptance_for_receiver`) is a plain array of strings, so a capable
 * agent will reasonably pattern-match `assumptions` to them and fail real output validation
 * (`RUN-083`).
 *
 * This already happened once, live, for `write-test-plan` (M14 P9-3, `GAUNTLET-LOG.md:19114`,
 * `SPEC-QUESTIONS.md` Q278) and was fixed only in a throwaway checkpoint copy, never in the shipped
 * template; `decompose-stages.md` was named there as sharing the identical gap, also never fixed
 * (`GAUNTLET-LOG.md:19124`). M16 P17's own real live run hit it again for a third brief
 * (`state-refactor-invariants.md`). The fix for that found four more HandoffRecord-producing briefs
 * with the same gap (`verify-nfrs.md`, `propose-level.md`, plus `capture-constraints.md` and
 * `review-stage-plan.md`, which never mention `assumptions` at all) and, once in independent review,
 * four briefs producing bare `Assumption` collection entries with the identical gap
 * (`frame-problem.md`, `seed-glossary.md`, `define-success-metrics.md`, `write-prd.md`) — the same
 * validator, the same consequence, just without a plain-string sibling field on the same record to
 * make the trap obvious by contrast.
 */
/**
 * One brief typically mentions a collection-entry type more than once (as an input, in the output
 * shape, again in acceptance criteria) and not every mention repeats the full shape — a later
 * cross-reference reasonably just says "with `validate_by`", trusting the reader already has the
 * shape from wherever it was first stated. So this collects every backtick-quoted mention of
 * `typeName`'s own trailing window (to the next blank line, heading or new bullet) rather than
 * assuming the first or last one is the authoritative one; the tests below ask only that AT LEAST
 * ONE window carries the full shape.
 */
function entryMentionWindows(content: string, typeName: string): string[] {
  const windows: string[] = [];
  const mentionPattern = new RegExp('`' + typeName + 's?`', 'gi');
  for (const match of content.matchAll(mentionPattern)) {
    const rest = content.slice(match.index);
    const end = rest.search(/\n\n|\n#|\n- /);
    windows.push(end === -1 ? rest : rest.slice(0, end));
  }
  return windows;
}

/**
 * True if at least one window states the object shape: the word "object" plus every one of `fields`
 * as its OWN backtick-quoted span (`` `id` ``, not bare `id`) — the backtick anchor matters: an
 * unrelated backtick span elsewhere in the same paragraph that merely CONTAINS one of these words
 * (for example `` `risk: <text> | <owner role>` `` naming a DIFFERENT field's own shape) would
 * otherwise read as a false pass; demonstrated empirically against `change-impact-analysis.md`'s own
 * real text during review.
 */
function someWindowStatesShape(windows: string[], fields: string[]): boolean {
  return windows.some(
    (guidance) =>
      /\bobject\b/i.test(guidance) &&
      fields.every((field) => new RegExp('`' + field + '`').test(guidance)),
  );
}

describe('briefs producing an assumptionSchema-shaped entry state its real object shape (RUN-083, Q278)', () => {
  const BRIEFS_WITH_ASSUMPTIONS = [
    'adoption-gap-analysis.md',
    'change-impact-analysis.md',
    'instrument-observability.md',
    'propose-change.md',
    'plan-story.md',
    'state-refactor-invariants.md',
    'decompose-stages.md',
    'write-test-plan.md',
    'verify-nfrs.md',
    'propose-level.md',
    'frame-problem.md',
    'seed-glossary.md',
    'define-success-metrics.md',
    'write-prd.md',
  ] as const;

  it.each(BRIEFS_WITH_ASSUMPTIONS)(
    '%s says each assumptions entry is an object with id, text, confidence and validate_by',
    (fileName) => {
      const raw = readFileSync(
        path.join(templatesPackageRoot, 'templates', 'briefs', fileName),
        'utf8',
      );
      const windows = entryMentionWindows(raw, 'assumption');
      expect(
        windows.length,
        'no backtick-quoted `Assumption`/`assumptions` mention found',
      ).toBeGreaterThan(0);
      const fullySpecified = someWindowStatesShape(windows, [
        'id',
        'text',
        'confidence',
        'validate_by',
      ]);
      expect(
        fullySpecified,
        `no mention fully specifies the object shape; windows were:\n${windows.join('\n---\n')}`,
      ).toBe(true);
    },
  );
});

/**
 * The identical gap, found by a round-2 critic reviewing the fix above: `riskSchema` and
 * `openQuestionSchema` (`packages/schemas/src/artifacts/{risk,open-question}.ts`) are strict objects
 * reused as `collection: true` entries in `kb/risks.md`/`kb/open-questions.md`
 * (`collection-file.ts`), validated through the identical path as `Assumption`
 * (`packages/engine/src/dispatch/outputs.ts`), and no brief producing either one documented the
 * shape. `write-ux-spec.md` is the sharpest case: it already correctly distinguishes a
 * `HandoffRecord`'s own plain-string `open_questions` from the KB's structured `OpenQuestion` by
 * NAME — the exact confusion `RUN-083` was about — but, before this fix, never stated the KB entry's
 * own shape either.
 */
describe('briefs producing a Risk entry state its real object shape', () => {
  const BRIEFS_WITH_RISK = [
    'frame-problem.md',
    'threat-model.md',
    'review-stage-plan.md',
    'stage-retro.md',
  ] as const;

  it.each(BRIEFS_WITH_RISK)(
    '%s says each Risk entry is an object with id, statement, likelihood, impact, mitigation and owner',
    (fileName) => {
      const raw = readFileSync(
        path.join(templatesPackageRoot, 'templates', 'briefs', fileName),
        'utf8',
      );
      const windows = entryMentionWindows(raw, 'risk');
      expect(windows.length, 'no backtick-quoted `Risk`/`Risks` mention found').toBeGreaterThan(0);
      const fullySpecified = someWindowStatesShape(windows, [
        'id',
        'statement',
        'likelihood',
        'impact',
        'mitigation',
        'owner',
      ]);
      expect(
        fullySpecified,
        `no mention fully specifies the object shape; windows were:\n${windows.join('\n---\n')}`,
      ).toBe(true);
    },
  );
});

describe('briefs producing an OpenQuestion entry state its real object shape', () => {
  const BRIEFS_WITH_OPEN_QUESTION = [
    'frame-problem.md',
    'write-test-plan.md',
    'write-prd.md',
    'security-hardening-pass.md',
    'performance-hardening-pass.md',
    'write-ux-spec.md',
  ] as const;

  it.each(BRIEFS_WITH_OPEN_QUESTION)(
    '%s says each OpenQuestion entry is an object with id, question and status',
    (fileName) => {
      const raw = readFileSync(
        path.join(templatesPackageRoot, 'templates', 'briefs', fileName),
        'utf8',
      );
      const windows = entryMentionWindows(raw, 'openquestion');
      expect(windows.length, 'no backtick-quoted `OpenQuestion` mention found').toBeGreaterThan(0);
      const fullySpecified = someWindowStatesShape(windows, ['id', 'question', 'status']);
      expect(
        fullySpecified,
        `no mention fully specifies the object shape; windows were:\n${windows.join('\n---\n')}`,
      ).toBe(true);
    },
  );
});

/**
 * Two briefs produce a `HandoffRecord` but never ask the agent to populate `assumptions` at all
 * (lower risk than the gap above — nothing prompts a bare-string guess — but the schema's `.strict()`
 * still requires the key, so each was given a one-line "leave it empty" note for completeness,
 * found during review of the fix above).
 */
describe('briefs that never populate assumptions at least say to leave it empty', () => {
  it.each(['capture-constraints.md', 'review-stage-plan.md'] as const)('%s', (fileName) => {
    const raw = readFileSync(
      path.join(templatesPackageRoot, 'templates', 'briefs', fileName),
      'utf8',
    );
    const idx = raw.search(/`assumptions`/);
    expect(idx, 'no backtick-quoted `assumptions` mention found').toBeGreaterThan(-1);
    expect(raw.slice(idx, idx + 80)).toMatch(/\bempty\b/i);
  });
});

/**
 * `rcaSchema` (`packages/schemas/src/artifacts/rca.ts`) has the identical undocumented-object-shape
 * trap in two of its own fields, found during review of the fix above: `hypotheses` is
 * `z.array(hypothesisSchema)` (`{claim, refuted_by, status}`, strict), and `timeline` is
 * `z.array(z.record(z.string(), z.string()))` — an array of small free-form label-to-string maps
 * (`specs/13-frameworks-testing-and-debugging.md:671`'s own worked example:
 * `[{first_seen: '2026-03-09'}, {detected_by: 'e2e AC-014-1'}]`), with no fixed key list at all. Both
 * producing briefs named `timeline` and `hypotheses` as bare words with little or no shape guidance.
 * `status` is doubly dangerous: both briefs' own Method section describes the FALSIFY step as a
 * hypothesis that "survives" or "dies", informal vocabulary an agent could plausibly carry straight
 * into the `status` field itself, which the strict `z.enum(['confirmed', 'refuted'])` would reject.
 */
describe('briefs producing an RCA state timeline and hypotheses as objects, not strings', () => {
  it.each(['rca.md', 'run-rca-framework.md'] as const)('%s', (fileName) => {
    const raw = readFileSync(
      path.join(templatesPackageRoot, 'templates', 'briefs', fileName),
      'utf8',
    );
    expect(raw, 'does not say a timeline entry is an object').toMatch(/timeline[^.]*\bobjects?\b/i);
    expect(raw, "does not name a hypothesis's `claim` field").toMatch(/`claim`/);
    expect(raw, "does not name a hypothesis's `refuted_by` field").toMatch(/`refuted_by`/);
    expect(raw, "does not name a hypothesis's `status` field").toMatch(/`status`/);
    expect(raw, 'does not state the real `status` enum value "confirmed"').toMatch(/`confirmed`/);
    expect(raw, 'does not state the real `status` enum value "refuted"').toMatch(/`refuted`/);
  });
});

describe('the six KB-located templates carry `sources: []` and validate as scaffolds (PLAN-M14.md P11)', () => {
  const KB_LOCATED_TYPES = [
    'ADR',
    'Runbook',
    'Risk',
    'Assumption',
    'OpenQuestion',
    'Environment',
  ] as const;

  it.each(KB_LOCATED_TYPES)('%s template front matter carries sources: []', (id) => {
    const { data } = readTemplate(id);
    expect(data).toMatchObject({ sources: [] });
  });

  it.each(KB_LOCATED_TYPES)(
    '%s template still validates against the real schema with sources: []',
    (id) => {
      const { data } = readTemplate(id);
      const result = SCHEMA_BY_TYPE[id].safeParse(data);
      expect(
        result.success,
        result.success ? '' : JSON.stringify(result.error.issues, null, 2),
      ).toBe(true);
    },
  );
});
