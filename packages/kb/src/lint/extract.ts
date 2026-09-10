/**
 * Typed slices out of a `KbTree` — shared by `lintKb` and `verifyKb` so each one's own kind-narrowing
 * (`entry.kind === 'kb-entry'`, ...) lives in exactly one place.
 *
 * @see PLAN-M3.md P10
 */
import type { ADR, Diagram, Runbook } from '@forge/schemas';

import type { ComponentsFile } from '../schema/components-file.ts';
import type { KbEntry } from '../schema/kb-entry.ts';
import type { KbParsedEntry, KbTree } from '../schema/tree.ts';

export function kbEntriesOf(tree: KbTree): readonly KbEntry[] {
  return tree.entries
    .filter(
      (entry): entry is Extract<KbParsedEntry, { kind: 'kb-entry' }> => entry.kind === 'kb-entry',
    )
    .map((entry) => entry.value);
}

export function adrsOf(tree: KbTree): readonly ADR[] {
  return tree.entries
    .filter((entry): entry is Extract<KbParsedEntry, { kind: 'adr' }> => entry.kind === 'adr')
    .map((entry) => entry.value);
}

export function diagramsOf(tree: KbTree): readonly Diagram[] {
  return tree.entries
    .filter(
      (entry): entry is Extract<KbParsedEntry, { kind: 'diagram' }> => entry.kind === 'diagram',
    )
    .map((entry) => entry.value);
}

export function runbooksOf(tree: KbTree): readonly Runbook[] {
  return tree.entries
    .filter(
      (entry): entry is Extract<KbParsedEntry, { kind: 'runbook' }> => entry.kind === 'runbook',
    )
    .map((entry) => entry.value);
}

export function componentsFileOf(tree: KbTree): ComponentsFile | undefined {
  return tree.entries.find(
    (entry): entry is Extract<KbParsedEntry, { kind: 'components-file' }> =>
      entry.kind === 'components-file',
  )?.value;
}
