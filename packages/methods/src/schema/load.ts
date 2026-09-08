/**
 * `loadFramework`/`readFramework` — parses and semantically validates one framework document, never
 * throwing on ordinary malformed input.
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M1
 */
import { readTextFile, type ProjectPaths } from '@forge/core';
import { parse as parseYaml } from 'yaml';

import { parseExpression } from '../expr.ts';
import { frameworkSchema } from './schema.ts';
import type { FrameworkDefinition, FrameworkIssue, FrameworkParseResult } from './types.ts';

const WEIGHT_SUM_TOLERANCE = 1e-6;

function zodIssuesToFrameworkIssues(
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
): readonly FrameworkIssue[] {
  return issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** `11` §11.0's own worked-example semantics beyond what a zod shape check alone can express:
 * criteria weights summing to 1.0, every `rules[].if` actually parsing, and each `scoring` mode's own
 * structural expectation. Returns issues rather than throwing, folded into `loadFramework`'s own single
 * discriminated result alongside any schema-shape issues. */
function semanticIssues(framework: FrameworkDefinition): readonly FrameworkIssue[] {
  const issues: FrameworkIssue[] = [];

  if (framework.criteria !== undefined && framework.criteria.length > 0) {
    const total = framework.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
    if (Math.abs(total - 1) > WEIGHT_SUM_TOLERANCE) {
      issues.push({
        path: 'criteria',
        message: `criteria weights sum to ${String(total)}, not 1.0 (±${String(WEIGHT_SUM_TOLERANCE)}).`,
      });
    }
  }

  const optionIds = new Set(framework.options.map((option) => option.id));

  for (const [index, rule] of (framework.rules ?? []).entries()) {
    if (parseExpression(rule.if) === undefined) {
      issues.push({
        path: `rules.${String(index)}.if`,
        message: `"${rule.if}" does not parse as a condition.`,
      });
    }

    for (const eliminatedId of rule.then.eliminate ?? []) {
      if (!optionIds.has(eliminatedId)) {
        issues.push({
          path: `rules.${String(index)}.then.eliminate`,
          message: `"${eliminatedId}" is not a declared option id.`,
        });
      }
    }

    if (rule.then.prefer !== undefined && !optionIds.has(rule.then.prefer)) {
      issues.push({
        path: `rules.${String(index)}.then.prefer`,
        message: `"${rule.then.prefer}" is not a declared option id.`,
      });
    }
  }

  // A `scoring: rubric` framework with real `rules[].then.eliminate`/`.prefer` entries was, at first,
  // assumed to be a contradiction ("rubric" reads as "no elimination phase") and rejected here -- but
  // `11` §11.0's own worked `repo-strategy` example is exactly that: `scoring: rubric` *with* two real
  // eliminate/prefer rules. Re-reading `11` §11.0's own execution contract ("run rules → eliminate →
  // score remaining... ") makes the real relationship clear: `rules` (an elimination pre-pass) is
  // orthogonal to `scoring` (how the *surviving* options are compared) -- every scoring mode can carry
  // an elimination pre-pass, "rubric" only says survivors are ranked by weighted criteria, not that no
  // elimination happened first. No speculative "scoring mode requires/forbids X" check survives this
  // piece for that reason: the one real worked example already disproved the first guess, and nothing
  // else in `11` gives a second data point to justify inventing another one before real content (T3/T4)
  // exists to check any real pattern against.

  return issues;
}

/** Prefixes every issue's own message with `sourcePath` — the one piece of context a caller loading
 * many framework files at once (T3/T4's own bulk validation) needs to tell *which file* a given issue
 * came from, since `FrameworkIssue.path` itself only ever names a field path *within* one document. */
function withSourceContext(
  issues: readonly FrameworkIssue[],
  sourcePath: string,
): readonly FrameworkIssue[] {
  return issues.map((issue) => ({ ...issue, message: `${sourcePath}: ${issue.message}` }));
}

/** Never throws: a YAML syntax error, a zod schema violation, and every `semanticIssues` finding all
 * become entries in the same returned `issues` list. */
export function loadFramework(source: string, sourcePath: string): FrameworkParseResult {
  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(source);
  } catch (cause) {
    return {
      success: false,
      issues: withSourceContext(
        [{ path: '(root)', message: cause instanceof Error ? cause.message : String(cause) }],
        sourcePath,
      ),
    };
  }

  const result = frameworkSchema.safeParse(parsedYaml);
  if (!result.success) {
    return {
      success: false,
      issues: withSourceContext(zodIssuesToFrameworkIssues(result.error.issues), sourcePath),
    };
  }

  const framework = result.data;
  const issues = semanticIssues(framework);
  if (issues.length > 0) return { success: false, issues: withSourceContext(issues, sourcePath) };

  return { success: true, framework };
}

export async function readFramework(
  paths: ProjectPaths,
  relative: string,
): Promise<FrameworkParseResult> {
  const absolute = paths.resolveWithin(relative);
  const source = await readTextFile(absolute);
  return loadFramework(source, relative);
}
