/**
 * A `VcsError` that reached the CLI boundary, as the remedy-bearing refusal every other command prints.
 *
 * `@forge/vcs` has no `core` edge, so its `VcsError` is not a `ForgeError` and used to fall through the
 * top-level handler as an unknown exception: a Node stack trace for what is a normal, correct refusal
 * (`forge run` on a dirty working tree, `PLAN-M13.md` P12, `Q208` finding 6). The dirty-tree case maps to
 * the registered `VCS-010` (exit 5, names the files); any other `VcsError` keeps its own message and remedy,
 * exit 1. Everything printed is stripped of terminal escapes: file names come from `git` and can hold any
 * byte but `/` and NUL.
 *
 * @see specs/02 §2.6
 * @see specs/20 §20.2
 */
import { ForgeError } from '@forge/core/errors';
import type { VcsError } from '@forge/vcs';

import { sanitizeForTerminal } from '../../generated-header.ts';

/** How many dirty file names a refusal lists before summarising the rest. */
export const MAX_DIRTY_FILES_LISTED = 10;

/** `sanitizeForTerminal` plus what a refusal message must also lose: a bare carriage return (which lets the
 * rest of a file name overwrite "The working tree has ..." on screen) and any newline (which lets a step id or
 * file name forge a second line of output), bidirectional overrides and zero-width
 * characters (which reorder or hide text). Applied to every string a refusal takes from git or the log. */
export function sanitizeRefusalText(text: string): string {
  return (
    sanitizeForTerminal(text)
      .replace(/[\r\n]+/g, ' ')
      .replace(
        // eslint-disable-next-line no-control-regex -- deliberately matching control bytes to strip them
        /[\x0D\u061C\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g,
        '',
      )
      // Tag characters and the variation-selector supplement: invisible, used to smuggle text.
      // eslint-disable-next-line no-misleading-character-class -- matched to be stripped
      .replace(/[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu, '')
  );
}

export interface CliRefusal {
  readonly code: string;
  readonly message: string;
  readonly remedy: string;
  readonly exitCode: number;
}

function dirtyFiles(error: VcsError): readonly string[] | undefined {
  const files = error.details?.['dirtyFiles'];
  return Array.isArray(files) && files.every((file) => typeof file === 'string')
    ? files
    : undefined;
}

export function refusalFromVcsError(error: VcsError): CliRefusal {
  const files = error.code === 'VCS-DIRTY-TREE' ? dirtyFiles(error) : undefined;
  if (files !== undefined) {
    const listed = files.slice(0, MAX_DIRTY_FILES_LISTED).map(sanitizeRefusalText);
    const more = files.length - listed.length;
    const refusal = new ForgeError('VCS-010', {
      count: files.length,
      files: more > 0 ? `${listed.join(', ')}, and ${String(more)} more` : listed.join(', '),
    });
    return {
      code: refusal.code,
      message: refusal.message,
      remedy: refusal.remedy,
      exitCode: refusal.exitCode,
    };
  }
  return {
    code: error.code,
    message: sanitizeRefusalText(error.message),
    remedy: sanitizeRefusalText(error.remedy),
    exitCode: 1,
  };
}

/** Any other error that carries its own `code`, `message` and `remedy` but is not a `ForgeError`, because its
 * package has no `core` edge (`@forge/telemetry`'s `TelemetryError`: a seq gap in the event log, an unwritable
 * log): a refusal with a named remedy, not a stack trace. `undefined` for anything else. */
export function refusalFromCodedError(error: unknown): CliRefusal | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  // A bare property read on an object: every field is type-checked below before use.
  const { code, message, remedy } = error as Record<string, unknown>;
  if (typeof code !== 'string' || typeof message !== 'string' || typeof remedy !== 'string') {
    return undefined;
  }
  return {
    code,
    message: sanitizeRefusalText(message),
    remedy: sanitizeRefusalText(remedy),
    exitCode: 1,
  };
}
