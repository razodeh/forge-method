/**
 * `loadDodProfile`/`readDodProfile` — parses and semantically validates one DoD-profile document,
 * never throwing on ordinary malformed input. Mirrors `@forge/methods/schema`'s own `loadFramework`/
 * `readFramework` shape exactly (same discriminated result, same "YAML error, schema error, and
 * semantic error all become entries in the same `issues` list" behaviour).
 *
 * `{ check: id }` entries are deliberately **not** validated against a closed set of known ids here.
 * `09` §9.8's own full worked example (`dod-profiles.yaml`'s `backend-default.done` list) names nine
 * check ids (`build:typecheck`, `spec:ac-coverage`, `security:secrets-scan`, …) that are themselves
 * other gates' own deterministic checks — an open-ended space no one package could enumerate, let
 * alone this one. Only plain-string entries get a real semantic check here (they must parse as a
 * `@forge/methods/expr` condition); a `{ check: id }` entry is validated structurally only (a real,
 * non-empty string — already enforced by `dodCheckSchema` itself). Resolving what a given `check: id`
 * actually means is `evaluate.ts`'s own caller-supplied `resolveCheck` function's job, not this
 * module's.
 *
 * @see specs/09 §9.8
 * @see PLAN-M8.md P1
 */
import { readTextFile, type ProjectPaths } from '@forge/core';
import { parse as parseYaml } from 'yaml';

import { parseExpression } from '../expr.ts';
import { dodProfileFileSchema } from './schema.ts';
import type { DodCheck, DodIssue, DodParseResult, DodProfileFile } from './types.ts';

function withSourceContext(issues: readonly DodIssue[], sourcePath: string): readonly DodIssue[] {
  return issues.map((issue) => ({ ...issue, path: `${sourcePath}: ${issue.path}` }));
}

function checkIssue(check: DodCheck, path: string): DodIssue | undefined {
  if (typeof check !== 'string') return undefined;
  if (parseExpression(check) !== undefined) return undefined;
  return { path, message: `"${check}" does not parse as a condition.` };
}

function semanticIssues(profileFile: DodProfileFile): readonly DodIssue[] {
  const issues: DodIssue[] = [];
  for (const [profileId, phase] of Object.entries(profileFile.profiles)) {
    const phases: readonly (readonly ['ready' | 'done', readonly DodCheck[]])[] = [
      ['ready', phase.ready],
      ['done', phase.done],
    ];
    for (const [phaseName, checks] of phases) {
      checks.forEach((check, index) => {
        const issue = checkIssue(check, `profiles.${profileId}.${phaseName}.${String(index)}`);
        if (issue !== undefined) issues.push(issue);
      });
    }
  }
  return issues;
}

/** Never throws: a YAML syntax error, a zod schema violation, and every `semanticIssues` finding all
 * become entries in the same returned `issues` list — the identical contract `loadFramework` already
 * establishes. */
export function loadDodProfile(source: string, sourcePath: string): DodParseResult {
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

  const result = dodProfileFileSchema.safeParse(parsedYaml);
  if (!result.success) {
    return {
      success: false,
      issues: withSourceContext(
        result.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
        sourcePath,
      ),
    };
  }

  const profileFile = result.data;
  const issues = semanticIssues(profileFile);
  if (issues.length > 0) return { success: false, issues: withSourceContext(issues, sourcePath) };

  return { success: true, profileFile };
}

export async function readDodProfile(
  paths: ProjectPaths,
  relative: string,
): Promise<DodParseResult> {
  const absolute = paths.resolveWithin(relative);
  const source = await readTextFile(absolute);
  return loadDodProfile(source, relative);
}
