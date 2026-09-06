/**
 * `validateDiagrams` — the one entry point `SPEC-QUESTIONS.md` Q43 names: everything
 * `@forge/diagrams` can check about a set of diagrams, composed into one finding list.
 *
 * @see SPEC-QUESTIONS.md Q43
 * @see PLAN-M3.md P4
 */
import { ForgeError } from '@forge/core';

import type { DiagramFinding } from '../lint/index.ts';
import { lintDiagram } from '../lint/index.ts';
import { parseDiagram } from '../parse/index.ts';
import { applyAutofix } from './autofix.ts';
import { checkDrift } from './drift.ts';
import { checkTransclusion, parseTransclusionMarkers } from './transclusion.ts';
import type { DiagramToValidate, ValidateDiagramsOptions } from './types.ts';

export interface ValidateDiagramsResult {
  readonly findings: readonly DiagramFinding[];
  /** One entry per `diagrams` element that raised rather than returned findings — a `parseDiagram`
   * (`KB-001`) or `checkDrift` (`KB-003`) failure. Every real value here is a `ForgeError`; the field
   * is typed `unknown` because a `catch` clause is never statically narrower than that. Collected
   * rather than propagated, so one bad diagram in a batch never discards every other diagram's
   * findings — the exact batch-linting shape this entry point exists for. */
  readonly errors: readonly { readonly diagramId: string; readonly error: unknown }[];
}

async function checkOneDiagram(
  entry: DiagramToValidate,
  options: ValidateDiagramsOptions,
): Promise<readonly DiagramFinding[]> {
  const findings: DiagramFinding[] = [];
  const parsed = await parseDiagram(entry.actualSource);
  // Built with conditional spreads, not a plain object literal: `exactOptionalPropertyTypes`
  // distinguishes "the field is absent" from "the field is present and `undefined`," and
  // `LintDiagramOptions`' own fields document the former, not the latter.
  findings.push(
    ...lintDiagram(entry.diagram, parsed, {
      ...(entry.knownIds !== undefined ? { knownIds: entry.knownIds } : {}),
      ...(options.complexity !== undefined ? { complexity: options.complexity } : {}),
      ...(options.requireCaptions !== undefined
        ? { requireCaptions: options.requireCaptions }
        : {}),
      ...(entry.now !== undefined ? { now: entry.now } : {}),
    }),
  );

  if (entry.diagram.generated && entry.generatorInput !== undefined) {
    const drift = checkDrift(entry.diagram, entry.actualSource, entry.generatorInput);
    if (drift.hasDrift) {
      findings.push({
        checkId: 'diagram:drift',
        severity: options.driftPolicy === 'warn' ? 'warn' : 'error',
        message: `Diagram ${drift.diagramId} has drifted from its generator's own real output.`,
      });
      if (options.driftPolicy === 'autofix' && entry.target !== undefined) {
        await applyAutofix(entry.target, drift.expected);
      }
    }
  }

  return findings;
}

/** `08` §8.11.4's own transclusion pass — resolves each marker's `src` against `diagrams`' own
 * `diagram.source`/`actualSource` pairs, so no second source-lookup mechanism is needed. A `src` with
 * no matching entry is skipped, not failed: the marker may reference a diagram outside this batch. */
function checkTransclusions(
  diagrams: readonly DiagramToValidate[],
  markdownDocuments: readonly string[],
): readonly DiagramFinding[] {
  const sourceBySrc = new Map(diagrams.map((entry) => [entry.diagram.source, entry.actualSource]));
  const findings: DiagramFinding[] = [];

  for (const markdown of markdownDocuments) {
    for (const block of parseTransclusionMarkers(markdown)) {
      const sourceContent = sourceBySrc.get(block.src);
      if (sourceContent === undefined) continue;
      if (checkTransclusion(block, sourceContent)) continue;
      // `08` §8.11.4's own spec-given code, transcribed verbatim via a never-thrown ForgeError (the
      // same "construct it only to read `.message`" pattern `@forge/extensions/invariants` already
      // established) — the rendered message can never drift from the code's own registered template.
      const mismatch = new ForgeError('KB-031', { diagramId: block.diagramId, src: block.src });
      findings.push({
        checkId: 'diagram:transclusion',
        severity: 'error',
        message: mismatch.message,
      });
    }
  }

  return findings;
}

/**
 * Parses and lints every entry (P1, P2), checks drift for a `generated: true` entry whose caller also
 * supplied `generatorInput` (P4) — skipped, not failed, when `generatorInput` is absent, the same
 * shape `LintDiagramOptions.knownIds` already uses for a missing resolver — and, when
 * `options.markdownDocuments` is supplied, checks every transclusion marker found in them against
 * `diagrams`' own committed sources. Drift under `driftPolicy: 'autofix'` is written to disk only
 * when the entry also supplies `target`.
 *
 * One entry's own `parseDiagram`/`checkDrift` failure is caught and reported in `errors`, not
 * propagated — every other entry's findings are still computed and returned.
 */
export async function validateDiagrams(
  diagrams: readonly DiagramToValidate[],
  options: ValidateDiagramsOptions,
): Promise<ValidateDiagramsResult> {
  const findings: DiagramFinding[] = [];
  const errors: { diagramId: string; error: unknown }[] = [];

  for (const entry of diagrams) {
    try {
      findings.push(...(await checkOneDiagram(entry, options)));
    } catch (error) {
      errors.push({ diagramId: entry.diagram.id, error });
    }
  }

  findings.push(...checkTransclusions(diagrams, options.markdownDocuments ?? []));

  return { findings, errors };
}
