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
 * `09` §9.8's own example now splits that `done` list into `verify` (self-verify, `forge story
 * verify`) and `done` (review/merge) — `verify` is optional on the schema so a pre-M14 profile that
 * has not adopted the split still loads; `verifyWarnings` below reports its absence as a `warnings`
 * entry on a successful result, never as a load failure.
 *
 * @see specs/09 §9.8
 * @see PLAN-M8.md P1
 * @see PLAN-M14.md P25
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
    const phases: readonly (readonly ['ready' | 'verify' | 'done', readonly DodCheck[]])[] = [
      ['ready', phase.ready],
      // Absent (pre-M14 profile) contributes no entries to check here — its own absence is a
      // `verifyWarnings` warning below, not a semantic issue.
      ['verify', phase.verify ?? []],
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

/** `09` §9.8's `verify`/`done` split (M14 P1, Q232 decision 13): a profile that has not adopted it yet
 * still loads (the schema's own `verify` field is optional), but this is the "kb lint" warning that
 * names the gap — advisory, since the file it lives in is under the KB root, but never a load failure:
 * a pre-M14 profile is real, loadable data, not a broken one. */
function verifyWarnings(profileFile: DodProfileFile): readonly DodIssue[] {
  const warnings: DodIssue[] = [];
  for (const [profileId, phase] of Object.entries(profileFile.profiles)) {
    if (phase.verify !== undefined) continue;
    warnings.push({
      path: `profiles.${profileId}`,
      message:
        `"${profileId}" has no "verify" list: 09 §9.8 splits the old single "done" list into ` +
        `"verify" (what forge story verify runs at self-verify) and "done" (what runs at commit and ` +
        `in the merge queue). Add a "verify" list.`,
    });
  }
  return warnings;
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

  const warnings = withSourceContext(verifyWarnings(profileFile), sourcePath);
  return { success: true, profileFile, warnings };
}

export async function readDodProfile(
  paths: ProjectPaths,
  relative: string,
): Promise<DodParseResult> {
  const absolute = paths.resolveWithin(relative);
  const source = await readTextFile(absolute);
  return loadDodProfile(source, relative);
}
