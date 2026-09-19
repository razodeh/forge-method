/**
 * Content-quality invariants for the build/verify/deliver-path briefs -- `PLAN-M13.md` P2b.
 *
 * `content-index.test.ts` proves each index entry names a real file; it says nothing about whether the
 * file is a brief. This suite does, for this batch's 22 keys: non-empty, no unfinished-work markers, no
 * front matter (`SPEC-QUESTIONS.md` Q197 item 10: it would reach the model verbatim), no Handlebars (the
 * compiler forwards a brief's text as block [4] unrendered), no two briefs identical, and each brief
 * names every artifact type -- and subtype -- its step declares as an output. The step-to-brief mapping
 * and the declared outputs are read from the real shipped workflows (`@forge/templates`' own
 * `templates/workflows/` plus every `modules/<m>/workflows/`), never hard-coded here, so changing a
 * workflow's `outputs` without updating the brief fails this test.
 *
 * @see specs/05 §5.3
 * @see specs/22 M13
 * @see PLAN-M13.md P2b
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { BRIEF_INDEX } from '@forge/templates';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');

/** This batch's own assignment (`PLAN-M13.md` P2b); the index must contain exactly these and more. */
const BATCH_KEYS = [
  'freeze-contracts',
  'write-failing-tests',
  'implement-story',
  'rca',
  'stage-retro',
  'plan-story',
  'refactor-story',
  'document-story',
  'reproduce-defect',
  'fix-defect',
  'verify-nfrs',
  'design-cicd-pipeline',
  'design-deployment-strategy',
  'run-rca-framework',
  'state-refactor-invariants',
  'refactor',
  'security-hardening-pass',
  'performance-hardening-pass',
  'prepare-release-build',
  'prepare-store-submission',
  'draft-contract',
  'write-contract-tests',
] as const;

interface DeclaredOutput {
  readonly type: string;
  readonly subtype: string | undefined;
}

/** Every workflow file the product ships: the templates package's own, and each module's. */
function workflowFiles(): readonly string[] {
  const dirs = [path.join(templatesRoot, 'templates', 'workflows')];
  const modulesDir = path.join(repoRoot, 'modules');
  for (const entry of readdirSync(modulesDir)) {
    dirs.push(path.join(modulesDir, entry, 'workflows'));
  }
  return dirs
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => name.endsWith('.workflow.yaml'))
        .sort()
        .map((name) => path.join(dir, name)),
    );
}

/** brief key -> the outputs declared by every step that names it (a brief may serve several steps). */
function declaredOutputsByBrief(): Map<string, DeclaredOutput[]> {
  const result = new Map<string, DeclaredOutput[]>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    const brief = record['brief'];
    if (typeof brief === 'string') {
      const match = /^briefs\/([^/]+)\.md$/.exec(brief);
      if (match?.[1] !== undefined) {
        const key = match[1];
        const list = result.get(key) ?? [];
        const outputs = record['outputs'];
        if (Array.isArray(outputs)) {
          for (const out of outputs) {
            if (typeof out !== 'object' || out === null) continue;
            const o = out as Record<string, unknown>;
            if (typeof o['type'] !== 'string') continue;
            list.push({
              type: o['type'],
              subtype: typeof o['subtype'] === 'string' ? o['subtype'] : undefined,
            });
          }
        }
        result.set(key, list);
      }
    }
    Object.values(record).forEach(visit);
  };
  for (const file of workflowFiles()) visit(parse(readFileSync(file, 'utf8')));
  return result;
}

const outputsByBrief = declaredOutputsByBrief();

function briefText(key: string): string {
  const rel = BRIEF_INDEX[key];
  if (rel === undefined) throw new Error(`BRIEF_INDEX has no entry for ${key}`);
  return readFileSync(path.join(templatesRoot, rel), 'utf8');
}

describe('build-path briefs (P2b)', () => {
  it('registers every assigned key', () => {
    for (const key of BATCH_KEYS) expect(BRIEF_INDEX[key], key).toBe(`templates/briefs/${key}.md`);
  });

  it('is referenced by at least one real workflow step, so no brief is orphaned', () => {
    for (const key of BATCH_KEYS) expect(outputsByBrief.has(key), key).toBe(true);
  });

  describe.each(BATCH_KEYS)('%s', (key) => {
    const text = briefText(key);

    it('is a substantive markdown brief, not a stub', () => {
      const lines = text.trim().split('\n');
      expect(text.startsWith('# '), 'starts with a title heading').toBe(true);
      expect(lines.length).toBeGreaterThanOrEqual(25);
      expect(lines.length).toBeLessThanOrEqual(90);
    });

    it('starts with no front matter and contains no template expressions', () => {
      expect(text.trimStart().startsWith('---')).toBe(false);
      expect(text).not.toMatch(/\{\{|\}\}/);
    });

    it('contains no unfinished-work or placeholder markers', () => {
      expect(text).not.toMatch(/\b(TODO|FIXME|TBD|XXX)\b/);
      expect(text).not.toMatch(/lorem ipsum|placeholder|fill (this )?in\b|<insert|\[insert/i);
    });

    it('names every artifact type (and subtype) its step declares as an output', () => {
      for (const declared of outputsByBrief.get(key) ?? []) {
        expect(text, `${key} must mention ${declared.type}`).toContain(declared.type);
        if (declared.subtype !== undefined) {
          expect(text, `${key} must mention subtype ${declared.subtype}`).toContain(
            declared.subtype,
          );
        }
      }
    });
  });

  it('has no two identical briefs, and no two that share an opening paragraph', () => {
    const bodies = BATCH_KEYS.map((key) => briefText(key));
    expect(new Set(bodies).size).toBe(bodies.length);
    const openings = bodies.map((body) => body.split('\n\n')[1] ?? '');
    expect(new Set(openings).size).toBe(openings.length);
  });
});
