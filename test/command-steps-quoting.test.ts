/**
 * Quoting substituted values must not change the text of any SHIPPED command step (`PLAN-M13.md` P28,
 * `SPEC-QUESTIONS.md` Q222): every `run:` string of every shipped workflow (templates and modules), rendered with a
 * plain token for each placeholder, is identical with and without shell quoting, and none of them puts a placeholder
 * where the scanner refuses one (`CFG-015`). The strings are read from the real workflow files, not copied.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveTemplate, shellQuoteValue, type ExpressionContext } from '@forge/engine/expr';
import { parseWorkflow } from '@forge/engine/workflow';
import { WORKFLOW_INDEX } from '@forge/templates';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');
const modulesDir = path.join(repoRoot, 'modules');

function collectRuns(node: unknown, into: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRuns(item, into);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  if (record['kind'] === 'command' && typeof record['run'] === 'string') into.push(record['run']);
  for (const value of Object.values(record)) collectRuns(value, into);
}

function shippedRuns(): readonly string[] {
  const runs: string[] = [];
  const add = (source: string): void => {
    const parsed = parseWorkflow(source);
    if (!parsed.success) throw new Error('a shipped workflow does not parse');
    collectRuns(parsed.workflow, runs);
  };
  for (const relative of Object.values(WORKFLOW_INDEX)) {
    add(readFileSync(path.join(templatesRoot, relative), 'utf8'));
  }
  for (const moduleName of readdirSync(modulesDir)) {
    const dir = path.join(modulesDir, moduleName, 'workflows');
    let files: string[];
    try {
      files = readdirSync(dir).filter((file) => file.endsWith('.workflow.yaml'));
    } catch {
      continue;
    }
    for (const file of files) add(readFileSync(path.join(dir, file), 'utf8'));
  }
  return runs;
}

/** A context giving every `{{a.b}}` in `run` the plain token `tok-a-b`. */
function plainContext(run: string): ExpressionContext {
  const root: Record<string, unknown> = {};
  for (const match of run.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    const expression = match[1] ?? '';
    if (!/^[A-Za-z_][\w.]*$/.test(expression)) throw new Error(`not a plain path: ${expression}`);
    const segments = expression.split('.');
    let cursor = root;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) cursor[segment] = `tok-${segments.join('-')}`;
      else {
        const next = cursor[segment];
        const child: Record<string, unknown> =
          typeof next === 'object' && next !== null ? (next as Record<string, unknown>) : {};
        cursor[segment] = child;
        cursor = child;
      }
    });
  }
  return root;
}

describe('shipped command steps under shell quoting', () => {
  const runs = shippedRuns();

  it('there are shipped command steps to check (a green run cannot mean it found none)', () => {
    expect(runs.length).toBeGreaterThan(15);
    expect(runs.some((run) => run.includes('{{'))).toBe(true);
  });

  it.each(runs.map((run) => [run] as const))(
    '%s renders identically with and without quoting',
    (run) => {
      const context = plainContext(run);
      expect(resolveTemplate(run, context, { escapeValue: shellQuoteValue })).toBe(
        resolveTemplate(run, context),
      );
    },
  );
});
