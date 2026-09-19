/**
 * Content-quality invariants for the planning-path briefs (`PLANNING_BRIEFS`, `PLAN-M13.md` P2a).
 *
 * `content-index.test.ts` proves each entry is a real, non-empty file; this proves the files are
 * *briefs*, not stubs. Block [4] of `05` §5.3 is compiled verbatim (no template rendering runs over
 * it — `compilePrompt` copies `step.brief` straight into the prompt), so any `{{...}}` in a brief
 * would reach the model as literal text and any leading front matter would too (`SPEC-QUESTIONS.md`
 * Q197). The step <-> brief mapping, each step's declared output types and each declared input are
 * all derived here from the real, shipped workflow definitions, never hard-coded, so a workflow edit
 * that renames an output or adds an input fails this test until the brief catches up.
 *
 * @see specs/05 §5.3
 * @see PLAN-M13.md P2a
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { componentSchema, KB_SECTIONS } from '@forge/kb/schema';
import {
  adrSchema,
  assumptionSchema,
  capabilitySchema,
  diagramSchema,
  environmentSchema,
  epicSchema,
  handoffRecordSchema,
  nfrSchema,
  openQuestionSchema,
  riskSchema,
  storySchema,
  visionSchema,
} from '@forge/schemas';
import { BRIEF_INDEX, WORKFLOW_INDEX } from '@forge/templates';

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'templates',
);

const PLANNING_KEYS = [
  'propose-level',
  'seed-glossary',
  'frame-problem',
  'define-success-metrics',
  'write-vision',
  'write-prd',
  'write-ux-spec',
  'select-architecture-style',
  'model-data',
  'select-tech-stack',
  'threat-model',
  'decide-repo-strategy',
  'scaffold-project',
  'scaffold-ci',
  'decompose-stages',
  'review-stage-plan',
  'write-epics',
  'write-stories',
  'write-test-plan',
] as const;

/** Wording that marks unfinished content; the brief renderer has no mechanism that could fill it in. */
const UNFINISHED_MARKERS = /\b(?:TODO|FIXME|TBD|XXX|lorem|ipsum)\b|placeholder|fill in|\?\?\?/i;

interface DeclaredOutput {
  readonly type: string;
  readonly subtype?: string;
}
interface StepFacts {
  readonly workflow: string;
  readonly stepId: string;
  readonly outputs: readonly DeclaredOutput[];
  readonly inputs: readonly string[];
}

function collectAgentSteps(node: unknown, workflow: string, into: Map<string, StepFacts[]>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectAgentSteps(item, workflow, into);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  const brief = record['brief'];
  if (typeof brief === 'string' && /^briefs\/[^/]+\.md$/.test(brief)) {
    const key = brief.slice('briefs/'.length, -'.md'.length);
    const outputs = Array.isArray(record['outputs'])
      ? (record['outputs'] as readonly Record<string, unknown>[]).flatMap((out) =>
          typeof out['type'] === 'string'
            ? [
                typeof out['subtype'] === 'string'
                  ? { type: out['type'], subtype: out['subtype'] }
                  : { type: out['type'] },
              ]
            : [],
        )
      : [];
    const inputs = Array.isArray(record['inputs'])
      ? (record['inputs'] as readonly unknown[]).filter(
          (input): input is string => typeof input === 'string',
        )
      : [];
    const facts: StepFacts = {
      workflow,
      stepId: typeof record['id'] === 'string' ? record['id'] : '(unidentified)',
      outputs,
      inputs,
    };
    into.set(key, [...(into.get(key) ?? []), facts]);
  }
  for (const value of Object.values(record)) collectAgentSteps(value, workflow, into);
}

function loadStepFacts(): ReadonlyMap<string, readonly StepFacts[]> {
  const byBrief = new Map<string, StepFacts[]>();
  for (const [workflow, relPath] of Object.entries(WORKFLOW_INDEX)) {
    const parsed: unknown = YAML.parse(readFileSync(path.join(templatesRoot, relPath), 'utf8'));
    collectAgentSteps(parsed, workflow, byBrief);
  }
  return byBrief;
}

const stepFacts = loadStepFacts();

function briefText(key: string): string {
  const relPath = BRIEF_INDEX[key];
  if (relPath === undefined) throw new Error(`no BRIEF_INDEX entry for "${key}"`);
  return readFileSync(path.join(templatesRoot, relPath), 'utf8');
}

describe('planning briefs (PLAN-M13 P2a)', () => {
  it('registers every assigned key in BRIEF_INDEX under its own templates/briefs/<key>.md', () => {
    for (const key of PLANNING_KEYS) expect(BRIEF_INDEX[key]).toBe(`templates/briefs/${key}.md`);
  });

  it('every assigned key is referenced by a step in a real, shipped workflow', () => {
    for (const key of PLANNING_KEYS) {
      expect(stepFacts.get(key), `${key} is not referenced by any workflow step`).toBeDefined();
    }
  });

  describe.each(PLANNING_KEYS)('%s', (key) => {
    const text = briefText(key);

    it('is a substantive brief, not a stub', () => {
      expect(text.trim().length).toBeGreaterThan(1500);
      expect(text.split('\n').length).toBeGreaterThanOrEqual(20);
    });

    it('contains no unfinished-content markers', () => {
      expect(text).not.toMatch(UNFINISHED_MARKERS);
    });

    it('does not start with YAML front matter', () => {
      expect(
        text
          .replace(/^\uFEFF/, '')
          .trimStart()
          .startsWith('---'),
      ).toBe(false);
    });

    it('uses no template syntax (block [4] is compiled verbatim)', () => {
      expect(text).not.toMatch(/\{\{|\}\}|\{%|%\}/);
    });

    it('does not use top-level or second-level headings (the compiled prompt owns those)', () => {
      expect(text).not.toMatch(/^#{1,2}\s/m);
    });

    it('states acceptance criteria and what not to do', () => {
      expect(text).toMatch(/^### Acceptance criteria$/m);
      expect(text).toMatch(/^### Do not$/m);
    });

    it("names each of its step's declared output artifact types (and subtypes)", () => {
      for (const step of stepFacts.get(key) ?? []) {
        for (const output of step.outputs) {
          expect(
            text,
            `${key}: step ${step.workflow}/${step.stepId} declares ${output.type}`,
          ).toContain(output.type);
          if (output.subtype !== undefined) expect(text).toContain(output.subtype);
        }
      }
    });

    it("names each of its step's declared inputs", () => {
      for (const step of stepFacts.get(key) ?? []) {
        for (const input of step.inputs) {
          const artifact = /^artifact:([A-Za-z]+)/.exec(input);
          const kb = /^kb:([a-z-]+)\//.exec(input);
          const expected = artifact?.[1] ?? kb?.[1];
          if (expected === undefined) continue;
          expect(text, `${key}: step ${step.stepId} declares input ${input}`).toContain(expected);
        }
      }
    });
  });

  it('no two briefs are identical, and none merely repeats another after normalisation', () => {
    const seen = new Map<string, string>();
    for (const key of PLANNING_KEYS) {
      const normalised = briefText(key).replace(/\s+/g, ' ').trim();
      const clash = seen.get(normalised);
      expect(clash, `${key} duplicates ${clash ?? ''}`).toBeUndefined();
      seen.set(normalised, key);
    }
  });

  it('every brief opens with a task sentence specific to its own step', () => {
    // A generic template with the step name swapped in would open identically; the first sentence
    // of each brief must be unique across the batch.
    const firsts = PLANNING_KEYS.map((key) => briefText(key).split(/(?<=[.:])\s/)[0]);
    expect(new Set(firsts).size).toBe(PLANNING_KEYS.length);
  });

  describe('field names are grounded in the real schemas', () => {
    /** The keys of a (possibly refined) zod object schema. */
    function shapeKeys(schema: unknown): readonly string[] {
      let current = schema as { shape?: Record<string, unknown>; _def?: Record<string, unknown> };
      for (let depth = 0; depth < 5 && current.shape === undefined; depth += 1) {
        const inner = current._def?.['schema'] ?? current._def?.['innerType'];
        if (inner === undefined) break;
        current = inner as typeof current;
      }
      return Object.keys(current.shape ?? {});
    }

    const BASE_KEYS = new Set([
      'id',
      'type',
      'schemaVersion',
      'title',
      'status',
      'created',
      'updated',
      'revision',
      'author',
      'run',
      'changelog',
    ]);

    /** Authoring steps must name every type-specific front-matter field of the artifact they write. */
    const FULLY_SPECIFIED: readonly (readonly [string, string, unknown])[] = [
      ['write-vision', 'Vision', visionSchema],
      ['write-prd', 'Capability', capabilitySchema],
      ['define-success-metrics', 'NFR', nfrSchema],
      ['write-prd', 'NFR', nfrSchema],
      ['write-epics', 'Epic', epicSchema],
      ['write-stories', 'Story', storySchema],
    ];

    it.each(FULLY_SPECIFIED)('%s names every %s field', (key, type, schema) => {
      const text = briefText(key);
      const fields = shapeKeys(schema).filter((name) => !BASE_KEYS.has(name));
      expect(fields.length, `${type} schema keys were not readable`).toBeGreaterThan(3);
      for (const field of fields) {
        expect(text, `${key} never names ${type}.${field} in backticks`).toContain(`\`${field}\``);
      }
    });

    it('select-architecture-style lists exactly the component schema fields', () => {
      const text = briefText('select-architecture-style');
      expect(shapeKeys(componentSchema)).toContain('failureModes');
      for (const field of shapeKeys(componentSchema)) expect(text).toContain(field);
    });

    /** Every backticked name that leads a "- `a`, `b`:" bullet must be a real field of some artifact schema. */
    const KNOWN_FIELDS = new Set(
      [
        visionSchema,
        capabilitySchema,
        nfrSchema,
        epicSchema,
        storySchema,
        adrSchema,
        riskSchema,
        assumptionSchema,
        handoffRecordSchema,
        diagramSchema,
        environmentSchema,
        openQuestionSchema,
        componentSchema,
      ].flatMap((schema) => shapeKeys(schema)),
    );
    /** Bullet lead-ins that are not artifact fields: KB entry, stage-plan and workflow vocabulary. */
    const NON_SCHEMA_LEAD_INS = new Set([
      'applies_to',
      'sources',
      'kind',
      'ref',
      'kb_write',
      'stages',
      'goal',
      'excluded',
      'estimated',
      'deferred_nfrs',
      'depends_on',
      'exit_criteria',
      'nfr_subset',
      'stories',
      'cost_usd',
      'wall_clock',
      'delivered',
      'open_questions',
      'constraints_for_receiver',
      'acceptance_for_receiver',
      'assumptions',
      'statement',
      'baseline',
      'target',
      'instrumentation',
      'category',
      'verification',
      'test',
      'benchmark',
      'monitor',
      'review',
      'audit',
      'from',
      'to',
      'step',
    ]);

    it.each(PLANNING_KEYS)('%s: bullet lead-in names are real fields', (key) => {
      const leadIns = [
        ...briefText(key).matchAll(/^\s*- ((?:`[a-z_]+`(?:, | and | or )?)+):/gm),
      ].flatMap((match) =>
        [...(match[1] ?? '').matchAll(/`([a-z_]+)`/g)].map((name) => name[1] ?? ''),
      );
      for (const name of leadIns) {
        expect(
          KNOWN_FIELDS.has(name) || NON_SCHEMA_LEAD_INS.has(name),
          `${key}: "${name}" is not a field of any artifact schema`,
        ).toBe(true);
      }
    });
  });

  describe('cross-brief consistency', () => {
    const allText = PLANNING_KEYS.map((key) => [key, briefText(key)] as const);

    it('every KB path a brief names sits under a real KB section (the KB tree parses everything else as an entry)', () => {
      const sections = new Set<string>([...KB_SECTIONS, 'decisions']);
      const pattern =
        /`((?:product|constraints|architecture|domain|data|delivery|ops|engineering|design|security|decisions)\/[A-Za-z0-9_.*<>/-]+)`/g;
      for (const [key, text] of allText) {
        for (const match of text.matchAll(pattern)) {
          const first = (match[1] ?? '').split('/')[0] ?? '';
          expect(
            sections.has(first),
            `${key} names "${match[1] ?? ''}" under a non-KB section`,
          ).toBe(true);
        }
      }
    });

    it('every test-layer command a brief references is one scaffold-project defines', () => {
      const scaffold = briefText('scaffold-project');
      for (const [key, text] of allText) {
        for (const match of text.matchAll(/`(test:[a-z]+)`/g)) {
          expect(scaffold, `${key} references ${match[1] ?? ''}`).toContain(match[1] ?? '');
        }
      }
    });

    it('every agent step in a workflow that takes a stageId input tells the agent how to obtain it', () => {
      for (const [workflow, relPath] of Object.entries(WORKFLOW_INDEX)) {
        const parsed = YAML.parse(readFileSync(path.join(templatesRoot, relPath), 'utf8')) as {
          inputs?: readonly { name?: string }[];
        };
        if (!parsed.inputs?.some((input) => input.name === 'stageId')) continue;
        for (const [key, steps] of stepFacts) {
          if (!PLANNING_KEYS.includes(key as (typeof PLANNING_KEYS)[number])) continue;
          if (!steps.some((step) => step.workflow === workflow)) continue;
          const text = briefText(key);
          expect(text, `${key} runs in ${workflow}, which takes stageId`).toContain('stageId');
          expect(text).toMatch(/ask the human/);
        }
      }
    });
  });
});
