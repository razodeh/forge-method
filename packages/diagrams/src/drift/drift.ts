/**
 * `checkDrift` — `08` §8.11.6: "diagrams that can be derived MUST be derived," checked by actually
 * re-deriving one and comparing.
 *
 * @see specs/08 §8.11.6
 * @see PLAN-M3.md P4
 */
import { ForgeError } from '@forge/core';
import type { Diagram } from '@forge/schemas';

import { GENERATOR_NAMES, GENERATORS, type GeneratorName } from '../generate/index.ts';
import type { DriftResult } from './types.ts';

function isGeneratorName(value: string): value is GeneratorName {
  // `GENERATOR_NAMES` is typed as `readonly GeneratorName[]` for callers who already have a real
  // `GeneratorName`; `.includes` needs to accept an arbitrary `string` to check one it doesn't yet
  // know is a member, so the array itself is widened here, not the value being tested.
  return (GENERATOR_NAMES as readonly string[]).includes(value);
}

/** A single normalised line ending everywhere — the same normalisation `checkTransclusion`
 * (`transclusion.ts`) applies to its own comparison, and for the same reason: a `.mmd` file checked
 * out with CRLF (the ordinary Windows default) must be judged on its real content, not its line-
 * ending convention, or every such file would report false drift. */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n|\r/g, '\n');
}

/**
 * Regenerates `diagram` via its own registered generator and compares against `actualSource`.
 *
 * `generatorInput` is whatever that generator's own input type documents (P3) — this package cannot
 * fetch it itself (no project-tree access; `diagrams ← core, schemas` only), so the caller, wherever
 * it holds the diagram's current real input, supplies it.
 *
 * @throws {ForgeError} `KB-003` if `diagram.generator` is missing or is not one of `GENERATOR_NAMES`.
 */
export function checkDrift(
  diagram: Diagram,
  actualSource: string,
  generatorInput: unknown,
): DriftResult {
  const generator = diagram.generator;
  if (generator === undefined || !isGeneratorName(generator)) {
    throw new ForgeError('KB-003', {
      diagramId: diagram.id,
      generator: generator ?? '(none)',
    });
  }

  const expected = GENERATORS[generator](generatorInput).source;
  // Line-ending- and trailing-whitespace-normalised, not a bare `!==`: every renderer in
  // `@forge/diagrams/generate` produces a string with no trailing newline and LF-only line endings,
  // while a real `.mmd` file read off disk almost always has a trailing newline (the ordinary POSIX
  // text-file convention) and may be checked out with CRLF (the ordinary Windows default) — an
  // unnormalised comparison would report every genuinely-synced diagram as drifted on either
  // difference alone, with no real content change at all.
  return {
    diagramId: diagram.id,
    hasDrift: expected !== normalizeLineEndings(actualSource).trimEnd(),
    expected,
    actual: actualSource,
  };
}
