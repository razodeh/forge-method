/**
 * Content-quality invariants for the operate/adopt/migrate/retro/replan workflow briefs and the ten gate
 * advisory critique briefs -- `PLAN-M13.md` P2c's batch of `BRIEF_INDEX`.
 *
 * `content-index.test.ts` proves each entry is a real, non-empty file. This proves the files are *the
 * right content*, derived from the shipped workflows and gates rather than re-typed: a workflow brief
 * must name the artifact types its step declares as outputs (the thing the downstream gate checks), and
 * a critique brief must name the gate it serves, every deterministic check that gate already runs (so
 * the reviewer does not duplicate them), every evidence artifact it covers, and the severity/verdict
 * vocabulary the critic's output is asked for. Block [4] of a compiled prompt is the brief verbatim
 * (`compile-prompt.ts` performs no template rendering), so any `{{...}}` would reach the model as
 * literal text and is refused outright.
 *
 * @see specs/22 M13
 * @see specs/05 §5.3
 * @see PLAN-M13.md P2c
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { BRIEF_INDEX, GATE_INDEX, WORKFLOW_INDEX } from '@forge/templates';

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'templates',
);

const WORKFLOW_BRIEF_KEYS = [
  'reverse-derive-specs',
  'adoption-gap-analysis',
  'plan-migration',
  'migration-expand',
  'migration-contract',
  'instrument-observability',
  'define-slos',
  'write-runbooks',
  'propose-change',
  'change-impact-analysis',
  'run-retro',
] as const;

const GATE_BRIEF_KEYS = [
  'critique-delivery-readiness',
  'critique-architecture',
  'critique-project-foundation',
  'critique-integration',
  'critique-operational-readiness',
  'critique-problem-framing',
  'critique-product-definition',
  'critique-stage-plan',
  'critique-stabilization',
  'critique-verification',
] as const;

const MY_KEYS: readonly string[] = [...WORKFLOW_BRIEF_KEYS, ...GATE_BRIEF_KEYS];

function readBrief(key: string): string {
  const rel = BRIEF_INDEX[key];
  if (rel === undefined) throw new Error(`BRIEF_INDEX has no entry for ${key}`);
  return readFileSync(path.join(templatesRoot, rel), 'utf8');
}

/** Prose is hard-wrapped; collapse whitespace so a phrase split across two lines still matches. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** The text of the `### <heading>...` section (up to the next `### `), or '' when absent. */
function section(text: string, headingPrefix: string): string {
  const match = new RegExp(
    `^### ${headingPrefix}[^\\n]*\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`,
    'm',
  ).exec(text);
  return match?.[1] ?? '';
}

const schemasRoot = path.resolve(templatesRoot, '..', 'schemas', 'json');
const SCHEMA_FILE: Readonly<Record<string, string>> = {
  ADR: 'adr.schema.json',
  HandoffRecord: 'handoff-record.schema.json',
  SessionRecord: 'session-record.schema.json',
  NFR: 'nfr.schema.json',
  Runbook: 'runbook.schema.json',
};
/** Front matter every strict artifact type requires. Nothing stamps it onto agent-written output today
 * (block [5] renders only schema, path and cardinality), so a brief that produces such an artifact
 * must name it. */
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
  'changelog',
]);

function requiredKeys(type: string): readonly string[] {
  const file = SCHEMA_FILE[type];
  if (file === undefined) return [];
  const schema = JSON.parse(readFileSync(path.join(schemasRoot, file), 'utf8')) as {
    required: string[];
  };
  return schema.required.filter((key) => !BASE_KEYS.has(key));
}

function readShipped(rel: string): unknown {
  return YAML.parse(readFileSync(path.join(templatesRoot, rel), 'utf8'));
}

interface StepFacts {
  readonly workflow: string;
  readonly stepId: string;
  readonly agent: string | undefined;
  readonly outputs: readonly { readonly type: string; readonly subtype?: string }[];
}

/** Every agent step in every shipped workflow that names `briefs/<key>.md`, at any nesting depth. */
function stepsUsingBrief(key: string): readonly StepFacts[] {
  const found: StepFacts[] = [];
  const visit = (node: unknown, workflow: string): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, workflow);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    if (record['brief'] === `briefs/${key}.md`) {
      const outputs = (Array.isArray(record['outputs']) ? record['outputs'] : []) as {
        type: string;
        subtype?: string;
      }[];
      found.push({
        workflow,
        stepId: typeof record['id'] === 'string' ? record['id'] : '(unidentified)',
        agent: typeof record['agent'] === 'string' ? record['agent'] : undefined,
        outputs,
      });
    }
    for (const value of Object.values(record)) visit(value, workflow);
  };
  for (const [id, rel] of Object.entries(WORKFLOW_INDEX)) visit(readShipped(rel), id);
  return found;
}

/** step id -> agent (undefined for a non-agent step) for every top-level step of a shipped workflow. */
function workflowSteps(workflow: string): ReadonlyMap<string, string | undefined> {
  const rel = (WORKFLOW_INDEX as Readonly<Record<string, string>>)[workflow];
  if (rel === undefined) throw new Error(`no shipped workflow ${workflow}`);
  const doc = readShipped(rel) as { steps: { id: string; kind: string; agent?: string }[] };
  return new Map(
    doc.steps.map((step) => [step.id, step.kind === 'agent' ? step.agent : undefined]),
  );
}

interface GateFacts {
  readonly gateId: string;
  readonly checkIds: readonly string[];
  readonly evidence: readonly string[];
  readonly advisoryId: string;
}

function gateUsingBrief(key: string): GateFacts | undefined {
  for (const rel of Object.values(GATE_INDEX)) {
    const gate = readShipped(rel) as {
      id: string;
      checks: {
        deterministic: { id: string }[];
        advisory: { id: string; brief: string }[];
      };
      evidence: { artifact: string }[];
    };
    const advisory = gate.checks.advisory.find((check) => check.brief === `briefs/${key}.md`);
    if (advisory === undefined) continue;
    return {
      gateId: gate.id,
      checkIds: gate.checks.deterministic.map((check) => check.id),
      evidence: gate.evidence.map((entry) => entry.artifact.replace(/\(.*\)$/, '')),
      advisoryId: advisory.id,
    };
  }
  return undefined;
}

describe('ops/adopt/migrate/retro/replan and gate briefs: content quality', () => {
  it('registers exactly the 21 briefs assigned to this batch', () => {
    expect(MY_KEYS).toHaveLength(21);
    for (const key of MY_KEYS) expect(BRIEF_INDEX[key], key).toBe(`templates/briefs/${key}.md`);
  });

  it.each(MY_KEYS)(
    '%s is substantive, tight, headed, and free of placeholders and front matter',
    (key) => {
      const text = readBrief(key);
      const lines = text.split('\n');
      expect(
        lines.length,
        'a brief is roughly 25-80 lines; more needs a reason',
      ).toBeGreaterThanOrEqual(25);
      expect(lines.length).toBeLessThanOrEqual(90);
      // Front matter would pass through to the model verbatim (`SPEC-QUESTIONS.md` Q197 item 10).
      expect(text.trimStart().startsWith('---'), 'must not begin with YAML front matter').toBe(
        false,
      );
      // Block [4] already sits under the compiler's own `## [4] Step brief` heading, so a brief opens with
      // prose and uses `###` sections only (the planning-path convention), never a `#` or `##` heading.
      expect(text, 'must open with prose, not a heading').not.toMatch(/^\s*#/);
      expect(text, 'must not use # or ## headings').not.toMatch(/^#{1,2} /m);
      expect(text).not.toMatch(/\b(?:TODO|FIXME|TBD|XXX)\b/);
      expect(text).not.toMatch(/lorem ipsum|placeholder text|\[insert|<insert|to be written/i);
      expect(text).not.toMatch(/\{\{|\}\}/);
      expect(text.endsWith('\n')).toBe(true);
    },
  );

  it('has no byte-identical duplicate anywhere in BRIEF_INDEX', () => {
    const byHash = new Map<string, string>();
    for (const key of Object.keys(BRIEF_INDEX)) {
      const hash = createHash('sha256').update(readBrief(key)).digest('hex');
      const clash = byHash.get(hash);
      expect(clash, `${key} is byte-identical to ${String(clash)}`).toBeUndefined();
      byHash.set(hash, key);
    }
  });

  describe.each(WORKFLOW_BRIEF_KEYS)('workflow brief %s', (key) => {
    it("is used by exactly one shipped step, and its Produce section names that step's outputs", () => {
      const steps = stepsUsingBrief(key);
      expect(steps, `exactly one shipped step must reference briefs/${key}.md`).toHaveLength(1);
      const text = readBrief(key);
      const produce = section(text, 'Produce');
      expect(produce.length, 'a Produce section is required').toBeGreaterThan(200);
      const step = steps[0];
      if (step === undefined) return;
      if (step.outputs.length === 0) {
        // A step with no declared outputs still has a deliverable; the brief must say what it is.
        expect(
          produce,
          `${key} declares no outputs, so its Produce section must say what it delivers`,
        ).toMatch(/Code and tests/);
      }
      for (const output of step.outputs) {
        expect(
          produce,
          `${key}: Produce must name output type ${output.type} of ${step.workflow}/${step.stepId}`,
        ).toMatch(new RegExp(`\\b${output.type}\\b`));
        if (output.subtype !== undefined) {
          expect(produce, `${key}: Produce must name subtype ${output.subtype}`).toContain(
            output.subtype,
          );
        }
        if (output.type in SCHEMA_FILE && output.type !== 'HandoffRecord') {
          for (const key of BASE_KEYS) {
            expect(
              flat(text),
              `${key}: ${output.type} requires base front matter key ${key}, which the brief must name`,
            ).toContain(`\`${key}\``);
          }
        }
        for (const field of requiredKeys(output.type)) {
          expect(
            flat(text),
            `${key}: ${output.type} requires front matter field ${field}, which the brief must mention`,
          ).toContain(`\`${field}\``);
        }
      }
    });

    it('states what NOT to do and its acceptance criteria', () => {
      const text = readBrief(key);
      expect(section(text, 'Do not').length).toBeGreaterThan(80);
      expect(section(text, 'Acceptance criteria').length).toBeGreaterThan(80);
      expect(section(text, 'Inputs').length).toBeGreaterThan(80);
    });
  });

  it('tells every HandoffRecord-producing brief that the schema has no `subtype` key and how the subtype is recorded', () => {
    for (const key of WORKFLOW_BRIEF_KEYS) {
      const [step] = stepsUsingBrief(key);
      const subtype = step?.outputs.find((output) => output.type === 'HandoffRecord')?.subtype;
      if (subtype === undefined) continue;
      const text = flat(readBrief(key));
      expect(text, key).toContain('There is no `subtype` key');
      expect(text, key).toContain(`\`subtype: ${subtype}\``);
      expect(text, key).toContain('`ASM-`');
    }
  });

  it('names a real `from` agent and real `step:` ids in every HandoffRecord entry it prescribes', () => {
    let checked = 0;
    for (const key of WORKFLOW_BRIEF_KEYS) {
      const [step] = stepsUsingBrief(key);
      if (!step?.outputs.some((output) => output.type === 'HandoffRecord')) continue;
      const text = flat(readBrief(key));
      const steps = workflowSteps(step.workflow);
      expect(text, `${key} must state \`from: ${String(step.agent)}\``).toContain(
        `\`from: ${String(step.agent)}\``,
      );
      const stepLine = /`step:\s*([\w-]+)(?: → ([\w-]+))?`/.exec(text);
      expect(stepLine, `${key} must prescribe a \`step:\` value`).not.toBeNull();
      expect(
        steps.has(stepLine?.[1] ?? ''),
        `${key}: step ${stepLine?.[1] ?? ''} must exist in ${step.workflow}`,
      ).toBe(true);
      const next = stepLine?.[2];
      if (next !== undefined) {
        expect(steps.has(next), `${key}: next step ${next} must exist in ${step.workflow}`).toBe(
          true,
        );
        const nextAgent = steps.get(next);
        const to = /`to: ([\w-]+)`/.exec(text)?.[1];
        if (nextAgent !== undefined)
          expect(to, `${key}: \`to\` must be the next step's agent`).toBe(nextAgent);
      }
      checked += 1;
    }
    expect(checked, 'all four HandoffRecord-producing briefs are checked').toBe(4);
  });

  it('uses only enum values the artifact schemas accept for the values it prescribes', () => {
    const enumOf = (file: string, prop: string): readonly string[] => {
      const schema = JSON.parse(readFileSync(path.join(schemasRoot, file), 'utf8')) as {
        properties: Record<string, { enum?: string[] }>;
      };
      return schema.properties[prop]?.enum ?? [];
    };
    const cases: readonly (readonly [string, string, string, readonly string[]])[] = [
      [
        'define-slos',
        'nfr.schema.json',
        'category',
        ['availability', 'performance', 'operability'],
      ],
      ['plan-migration', 'adr.schema.json', 'category', ['data']],
      ['plan-migration', 'adr.schema.json', 'reversibility', ['hard', 'one-way']],
      ['reverse-derive-specs', 'adr.schema.json', 'status', ['accepted']],
      ['run-retro', 'session-record.schema.json', 'sessionType', ['retro']],
    ];
    for (const [key, file, prop, values] of cases) {
      const allowed = enumOf(file, prop);
      expect(allowed.length, `${file} ${prop} enum`).toBeGreaterThan(0);
      const text = flat(readBrief(key));
      for (const value of values) {
        expect(allowed, `${key}: ${prop}=${value}`).toContain(value);
        expect(
          text.includes(`\`${value}\``) || text.includes(`\`${prop}: ${value}\``),
          `${key} must state ${prop} ${value}`,
        ).toBe(true);
      }
    }
    const nfr = JSON.parse(readFileSync(path.join(schemasRoot, 'nfr.schema.json'), 'utf8')) as {
      properties: { verification: { properties: { kind: { enum: string[] } } } };
    };
    expect(nfr.properties.verification.properties.kind.enum).toContain('monitor');
    expect(flat(readBrief('define-slos'))).toContain('`kind: monitor`');
    const handoff = JSON.parse(
      readFileSync(path.join(schemasRoot, 'handoff-record.schema.json'), 'utf8'),
    ) as {
      properties: { assumptions: { items: { properties: { confidence: { enum: string[] } } } } };
    };
    expect(handoff.properties.assumptions.items.properties.confidence.enum).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('names the six required ADR sections in the two ADR-producing briefs', () => {
    for (const key of ['reverse-derive-specs', 'plan-migration']) {
      const text = flat(readBrief(key));
      for (const heading of [
        'Context',
        'Options considered',
        'Decision',
        'Diagram',
        'Consequences',
        'Reversal plan',
      ]) {
        expect(text, `${key} must name the ${heading} section`).toContain(heading);
      }
    }
  });

  it('keeps the destructive-migration guardrails in the migration briefs', () => {
    const expand = flat(readBrief('migration-expand'));
    expect(expand).toMatch(/Do not drop, rename, retype or narrow/);
    expect(expand).toMatch(/backward compatib/i);
    const contract = flat(readBrief('migration-contract'));
    expect(contract).toMatch(/Verify first, then act/);
    expect(contract).toMatch(/no reader or writer/i);
    expect(contract).toMatch(/stop\. Do not perform the contract change/i);
  });

  it('keeps propose-change and change-impact-analysis from starting implementation', () => {
    for (const key of ['propose-change', 'change-impact-analysis']) {
      const doNot = flat(section(readBrief(key), 'Do not'));
      expect(doNot, key).toMatch(
        /Do not start implementing|Do not modify any artifact, run the re-derive/,
      );
      expect(doNot, key).toMatch(/approve|reject/);
    }
  });

  describe.each(GATE_BRIEF_KEYS)('gate brief %s', (key) => {
    const gate = gateUsingBrief(key);

    it('is referenced by exactly one shipped gate advisory check', () => {
      expect(gate, `no shipped gate references briefs/${key}.md`).toBeDefined();
      const users = Object.values(GATE_INDEX).filter((rel) =>
        readFileSync(path.join(templatesRoot, rel), 'utf8').includes(`briefs/${key}.md`),
      );
      expect(users).toHaveLength(1);
    });

    it('names the gate, every deterministic check the gate already runs, and every evidence artifact', () => {
      if (gate === undefined) return;
      const text = readBrief(key);
      expect(text, 'gate id').toContain(`\`${gate.gateId}\``);
      const mechanical = section(text, 'Already checked');
      expect(
        mechanical.length,
        'an "Already checked mechanically" section is required',
      ).toBeGreaterThan(150);
      for (const checkId of gate.checkIds) {
        expect(mechanical, `deterministic check ${checkId} of ${gate.gateId}`).toContain(
          `\`${checkId}\``,
        );
        // A criterion that names a mechanical check id is probably re-doing it.
        expect(section(text, 'Criteria'), `criteria must not restate ${checkId}`).not.toContain(
          `\`${checkId}\``,
        );
      }
      for (const artifact of gate.evidence) {
        expect(text, `evidence artifact ${artifact}`).toMatch(new RegExp(`\`${artifact}\``));
      }
    });

    it('asks for exactly the verdict shape: per-criterion verdicts, severities, an ObjectionList with test and question', () => {
      const text = readBrief(key);
      for (const token of [
        'ObjectionList',
        '`pass`',
        '`fail`',
        '`not-evidenced`',
        '`n/a`',
        '`blocking`',
        '`major`',
        '`minor`',
        '`severity`',
        '`where`',
        '`claim`',
        '`test`',
        '`question`',
        '`criterion`',
      ]) {
        expect(text, token).toContain(token);
      }
      expect(text).toMatch(/^### Criteria$/m);
      expect(text).toMatch(/^### Evidence and verdicts$/m);
      expect(text).toMatch(/^### Objections$/m);
    });

    it('defines uniquely-numbered criteria that the objection format refers to as a range', () => {
      const text = readBrief(key);
      const ids = [...text.matchAll(/^- \*\*([A-Z]{2}\d+) /gm)].map((match) => match[1] ?? '');
      expect(ids.length).toBeGreaterThanOrEqual(5);
      expect(new Set(ids).size).toBe(ids.length);
      const prefix = ids[0]?.slice(0, 2) ?? '';
      expect(ids.every((id) => id.startsWith(prefix))).toBe(true);
      expect(text).toContain(`(${ids[0] ?? ''}..${ids.at(-1) ?? ''})`);
    });

    it('tells the reviewer it is read-only, must not fix, and must not approve or reject the gate', () => {
      expect(readBrief(key)).toMatch(/^### Boundaries$/m);
      const text = flat(readBrief(key));
      expect(text).toMatch(/read-only/i);
      expect(text).toMatch(/do not (?:edit|deploy|reproduce)/i);
      expect(text).toMatch(/do not approve or reject the gate|not approve or reject the gate/i);
      expect(text).toMatch(
        /data(?:,)? not (?:as )?instructions|not as instructions|do not bind you|as data\./i,
      );
    });
  });
});
