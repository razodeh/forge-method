/**
 * `validateSkill` — `15` §15.4.5's `forge skill validate` checklist: "schema, size, dead references,
 * script grants, secret scan."
 *
 * @see specs/15 §15.4.5
 * @see specs/15 §15.10 (I9)
 * @see PLAN-M2.md P4
 * @see SPEC-QUESTIONS.md Q33
 */
import { isExecutable, pathExists, type AbsolutePath } from '@forge/core';
import path from 'node:path';

import { INJECTION_PATTERNS, SECRET_PATTERNS } from './patterns.ts';
import { skillFrontMatterSchema } from './schema.ts';
import type {
  ParsedSkill,
  SkillValidationFinding,
  SkillValidationOutcome,
  ValidateSkillOptions,
} from './types.ts';

function child(dir: AbsolutePath, relative: string): AbsolutePath {
  return path.join(dir, relative) as AbsolutePath;
}

/**
 * A rough, documented approximation (~4 characters per token), not a real tokenizer: no spec page
 * names one, and matching whichever model actually renders a skill's body is an adapter-layer concern
 * this package has no visibility into. Good enough to compare against `budget_tokens`/the hard cap,
 * which are themselves approximate budgets, not exact allocations.
 */
function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Every `references/<path>` mention in `body`, in encounter order — a plain substring scan, not a
 * markdown-link parse. `15` §15.4.2's own worked example points at a reference from prose, not a
 * markdown link: `` (see `references/error-handling.md` for the full catalogue) `` — a regex
 * requiring `(references/…)` link syntax specifically misses that exact, spec-given phrasing (the
 * text between `(` and `references/` breaks it) while also being no less prone to matching a stale
 * mention. Scanning for the bare path text everywhere, then stripping trailing punctuation a real
 * file name would never end in, both fixes the miss and still catches a renamed-away file's old name
 * lingering in body text, since a mention of a nonexistent path is exactly what "dead reference" means.
 */
function referenceLinksInBody(body: string): readonly string[] {
  const matches = body.matchAll(/references\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/g);
  return (
    [...matches]
      .map((match) => match[1])
      .filter((target): target is string => target !== undefined)
      // The extraction charset above (`A-Za-z0-9_.-`) already excludes every delimiter a markdown
      // link, backtick span, or sentence could end on except `.` itself — a trailing sentence period
      // is the one case that charset cannot tell apart from a real `.md`/`.sh` extension's own dot.
      .map((target) => target.replace(/\.+$/, ''))
  );
}

function checkDeadReferences(skill: ParsedSkill): SkillValidationFinding[] {
  const findings: SkillValidationFinding[] = [];
  const linked = new Set(referenceLinksInBody(skill.body));
  const existing = new Set(skill.referenceFiles);

  for (const target of linked) {
    if (!existing.has(target)) {
      findings.push({
        severity: 'error',
        code: 'dead-reference',
        message: `The body links "references/${target}", which does not exist.`,
      });
    }
  }
  for (const file of skill.referenceFiles) {
    if (!linked.has(file)) {
      findings.push({
        severity: 'error',
        code: 'orphaned-reference-file',
        message: `"references/${file}" exists but is never linked from the body.`,
      });
    }
  }
  return findings;
}

async function checkScripts(
  skill: ParsedSkill,
  scripts: readonly { readonly id: string; readonly run: string }[],
): Promise<SkillValidationFinding[]> {
  const findings: SkillValidationFinding[] = [];
  for (const script of scripts) {
    const target = child(skill.dir, script.run);
    if (!(await pathExists(target))) {
      findings.push({
        severity: 'error',
        code: 'script-missing',
        message: `Script "${script.id}" names "${script.run}", which does not exist.`,
      });
      continue;
    }
    if (!(await isExecutable(target))) {
      findings.push({
        severity: 'error',
        code: 'script-not-executable',
        message: `Script "${script.id}" ("${script.run}") exists but is not executable.`,
      });
    }
  }
  return findings;
}

function checkPatterns(
  body: string,
  patterns: readonly RegExp[],
  code: 'injection' | 'secret',
  describe: (match: string) => string,
): SkillValidationFinding[] {
  const findings: SkillValidationFinding[] = [];
  for (const pattern of patterns) {
    const match = pattern.exec(body);
    if (match !== null) {
      findings.push({ severity: 'error', code, message: describe(match[0]) });
    }
  }
  return findings;
}

/**
 * Validates `skill`, never throwing — the same "boundary input produces a typed outcome, not an
 * exception" precedent `@forge/schemas` established (`SPEC-QUESTIONS.md` Q3).
 *
 * Front-matter schema validity gates only the checks that need a typed front matter to run at all
 * (budget/hard-cap, scripts): a `SKILL.md` with a broken schema still gets its dead-reference,
 * injection, and secret checks, since those read the body and directory listing directly.
 */
export async function validateSkill(
  skill: ParsedSkill,
  options: ValidateSkillOptions,
): Promise<SkillValidationOutcome> {
  const findings: SkillValidationFinding[] = [];

  const schemaResult = skillFrontMatterSchema.safeParse(skill.frontMatter);
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      findings.push({
        severity: 'error',
        code: 'schema',
        message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      });
    }
  }

  findings.push(...checkDeadReferences(skill));
  findings.push(
    ...checkPatterns(
      skill.body,
      INJECTION_PATTERNS,
      'injection',
      (match) =>
        `The body contains instruction-shaped content targeting the operating contract: "${match}".`,
    ),
  );
  findings.push(
    ...checkPatterns(
      skill.body,
      SECRET_PATTERNS,
      'secret',
      (match) => `The body contains a secret-shaped literal: "${match.slice(0, 12)}…".`,
    ),
  );

  if (schemaResult.success) {
    const frontMatter = schemaResult.data;
    const tokenCount = approximateTokenCount(skill.body);
    if (tokenCount > options.hardCapTokens) {
      findings.push({
        severity: 'error',
        code: 'over-hard-cap',
        message: `The body is approximately ${String(tokenCount)} tokens, over the hard cap of ${String(options.hardCapTokens)}.`,
      });
    } else if (tokenCount > frontMatter.budget_tokens) {
      findings.push({
        severity: 'warning',
        code: 'over-budget',
        message: `The body is approximately ${String(tokenCount)} tokens, over its own budget_tokens of ${String(frontMatter.budget_tokens)}.`,
      });
    }
    findings.push(...(await checkScripts(skill, frontMatter.scripts ?? [])));
  }

  return { valid: !findings.some((finding) => finding.severity === 'error'), findings };
}
