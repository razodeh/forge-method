/**
 * `validateArtifact` — `18` §18.6's two-phase validation.
 *
 * @see specs/18 §18.6
 * @see PLAN-M1.md P12
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ArtifactDocument } from '../../src/artifacts/document.ts';
import {
  DEFAULT_ARTIFACT_REGISTRY,
  validateArtifact,
  type ArtifactSchemaRegistry,
} from '../../src/artifacts/validate.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const templatesDir = path.join(repoRoot, 'packages', 'templates', 'templates', 'artifacts');

/**
 * The 16 `@forge/templates` stubs that extend `baseFrontMatterShape` (carry their own `type` field) —
 * `validateArtifact` selects a schema by reading `frontMatter.type`, which the 6 flat
 * "collection-entry" types (Risk, Assumption, OpenQuestion, Waiver, Environment, HandoffRecord) do
 * not have at all: those are one register entry, not a whole document, per `SPEC-QUESTIONS.md` Q28 —
 * out of scope for this function, which validates a standalone artifact file.
 */
const DOCUMENT_TYPE_FILES = [
  'ADR.md',
  'Capability.md',
  'DataModel.md',
  'Defect.md',
  'Diagram.md',
  'Epic.md',
  'GateReport.md',
  'InterfaceContract.md',
  'NFR.md',
  'RCA.md',
  'ReviewReport.md',
  'Runbook.md',
  'SessionRecord.md',
  'Story.md',
  'Task.md',
  'Vision.md',
];

describe('validateArtifact — every @forge/templates document-shaped stub', () => {
  it('found all 16 document-shaped stubs this describe block expects', () => {
    const allFiles = readdirSync(templatesDir).filter((name) => name.endsWith('.md'));
    const collectionFiles = allFiles.filter((name) => !DOCUMENT_TYPE_FILES.includes(name));
    expect(collectionFiles).toHaveLength(6);
    expect(DOCUMENT_TYPE_FILES).toHaveLength(16);
  });

  it.each(DOCUMENT_TYPE_FILES)('%s validates as-is', (fileName) => {
    const filePath = path.join(templatesDir, fileName);
    const doc = ArtifactDocument.parse(readFileSync(filePath, 'utf8'), filePath);
    const outcome = validateArtifact(doc);
    expect(outcome.valid, outcome.valid ? '' : JSON.stringify(outcome.errors)).toBe(true);
  });
});

describe('validateArtifact — phase 1 (front matter against schema)', () => {
  const registry: ArtifactSchemaRegistry = {
    ...DEFAULT_ARTIFACT_REGISTRY,
    Story: {
      schema: z.object({ type: z.literal('Story'), title: z.string().min(1) }).strict(),
      requiredSections: [],
    },
  };

  it("fails when the front matter does not satisfy its type's schema", () => {
    const doc = ArtifactDocument.parse('---\ntype: Story\n---\nbody\n', 'x.md');
    const outcome = validateArtifact(doc, registry);
    expect(outcome.valid).toBe(false);
    if (outcome.valid) return;
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]?.code).toBe('CFG-008');
    expect(outcome.errors[0]?.message).toContain('title');
  });

  it('fails with CFG-008 when "type" is missing entirely', () => {
    const doc = ArtifactDocument.parse('---\nid: X\n---\nbody\n', 'x.md');
    const outcome = validateArtifact(doc, registry);
    expect(outcome.valid).toBe(false);
    if (outcome.valid) return;
    expect(outcome.errors[0]?.code).toBe('CFG-008');
  });

  it('fails with CFG-008 when "type" is not a registered artifact type', () => {
    const doc = ArtifactDocument.parse('---\ntype: NotARealType\n---\nbody\n', 'x.md');
    const outcome = validateArtifact(doc, registry);
    expect(outcome.valid).toBe(false);
    if (outcome.valid) return;
    expect(outcome.errors[0]?.code).toBe('CFG-008');
    expect(outcome.errors[0]?.message).toContain('NotARealType');
  });

  it('passes when the front matter satisfies its schema', () => {
    const doc = ArtifactDocument.parse('---\ntype: Story\ntitle: A story\n---\nbody\n', 'x.md');
    expect(validateArtifact(doc, registry)).toEqual({ valid: true });
  });

  it('names "(root)" for a schema issue with no field path', () => {
    const rootRefineRegistry: ArtifactSchemaRegistry = {
      ...registry,
      Story: {
        schema: z.object({ type: z.literal('Story') }).superRefine((_data, ctx) => {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'whole-document rule violated' });
        }),
        requiredSections: [],
      },
    };
    const doc = ArtifactDocument.parse('---\ntype: Story\n---\nbody\n', 'x.md');
    const outcome = validateArtifact(doc, rootRefineRegistry);
    expect(outcome.valid).toBe(false);
    if (outcome.valid) return;
    expect(outcome.errors[0]?.message).toContain('(root): whole-document rule violated');
  });
});

describe('validateArtifact — phase 2 (body structure against requiredSections)', () => {
  const registry: ArtifactSchemaRegistry = {
    ...DEFAULT_ARTIFACT_REGISTRY,
    ADR: {
      schema: z.object({ type: z.literal('ADR') }).strict(),
      requiredSections: ['Context', 'Decision'],
    },
  };

  it('fails once per missing required section', () => {
    const doc = ArtifactDocument.parse('---\ntype: ADR\n---\nno headings at all\n', 'x.md');
    const outcome = validateArtifact(doc, registry);
    expect(outcome.valid).toBe(false);
    if (outcome.valid) return;
    expect(outcome.errors).toHaveLength(2);
    expect(outcome.errors.map((e) => e.code)).toEqual(['CFG-009', 'CFG-009']);
    expect(outcome.errors[0]?.message).toContain('Context');
    expect(outcome.errors[1]?.message).toContain('Decision');
  });

  it('names only the sections that are actually missing', () => {
    const doc = ArtifactDocument.parse('---\ntype: ADR\n---\n## Context\n\ntext\n', 'x.md');
    const outcome = validateArtifact(doc, registry);
    expect(outcome.valid).toBe(false);
    if (outcome.valid) return;
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]?.message).toContain('Decision');
  });

  it('passes when every required section is present, in any order', () => {
    const doc = ArtifactDocument.parse(
      '---\ntype: ADR\n---\n## Decision\n\ntext\n\n## Context\n\nmore text\n',
      'x.md',
    );
    expect(validateArtifact(doc, registry)).toEqual({ valid: true });
  });

  it('does not count a "## " line inside a fenced code block as a real section', () => {
    // "Context" appears ONLY inside the fence — if the fence were not skipped, this would
    // (wrongly) satisfy the requirement; skipped correctly, it is reported as still missing.
    const body = ['```', '## Context', '```', '', '## Decision', '', 'the real one', ''].join('\n');
    const doc = ArtifactDocument.parse(`---\ntype: ADR\n---\n${body}`, 'x.md');
    const outcome = validateArtifact(doc, registry);
    expect(outcome.valid).toBe(false);
    if (outcome.valid) return;
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]?.message).toContain('Context');
  });

  it('treats an unclosed fence as extending to end-of-file, per real Markdown semantics', () => {
    // "Decision" sits after a fence that never closes — a real Markdown renderer would treat it as
    // part of the code block too, so it is correctly reported missing, not found by accident.
    const body = ['## Context', '', '```', 'some unclosed example', '', '## Decision', ''].join(
      '\n',
    );
    const doc = ArtifactDocument.parse(`---\ntype: ADR\n---\n${body}`, 'x.md');
    const outcome = validateArtifact(doc, registry);
    expect(outcome.valid).toBe(false);
    if (outcome.valid) return;
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]?.message).toContain('Decision');
  });

  it('does not run phase 2 at all when phase 1 already failed', () => {
    const doc = ArtifactDocument.parse('---\ntype: NotReal\n---\nno headings\n', 'x.md');
    const outcome = validateArtifact(doc, registry);
    expect(outcome.valid).toBe(false);
    if (outcome.valid) return;
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]?.code).toBe('CFG-008');
  });
});
