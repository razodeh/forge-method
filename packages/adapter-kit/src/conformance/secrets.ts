/**
 * C13 (no secret leak) — `07` §7.6's own table, verbatim. One of the five safety-critical cases
 * (`SAFETY_CRITICAL_CONFORMANCE_IDS`). A plain, directly-callable async function so this piece's own
 * test file can invoke it against a deliberately non-compliant stub adapter and assert it rejects.
 *
 * A gauntlet critic found the original version searched only `finalText`/`text`/`thinking`/
 * `tool.result.summary` for a leak — missing `SessionResult.error.message`, `session.started.meta`,
 * `retry.reason`, and the `unknown`-typed `tool.call.input`/`control.payload`/`result.structured`
 * fields, plus never checking the real filesystem at all (unlike every other cwd-touching check here).
 * All of those are now covered.
 *
 * @see specs/07 §7.6
 * @see PLAN-M4.md P4
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AdapterEvent } from '../types/events.ts';
import type { ConformanceContext } from './context.ts';
import { gitStatusPaths, initGitRepo } from './git.ts';
import { collectEvents, withTimeout } from './helpers.ts';

/** `JSON.stringify` on an `unknown`-typed field for a plain substring search — never throws (a
 * circular reference or a `BigInt` would make real `JSON.stringify` throw; this suite is checking a
 * possibly-buggy adapter's own data, not defending against an adversarial one, so "couldn't stringify
 * it" safely degrades to "nothing found there" rather than crashing the whole check). */
function safeStringify(value: unknown): string {
  try {
    // TypeScript's own lib signature for JSON.stringify claims it always returns `string`, but at
    // runtime it genuinely returns `undefined` for `undefined`, a function, or a symbol — a real
    // TS-lib-type/runtime mismatch, not a mistake here; the `??` is load-bearing.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function textFromEvent(event: AdapterEvent): string {
  switch (event.type) {
    case 'text':
    case 'thinking':
      return event.text;
    case 'tool.call':
      return safeStringify(event.input);
    case 'tool.result':
      return event.summary;
    case 'control':
      return safeStringify(event.payload);
    case 'retry':
      return event.reason;
    case 'session.started':
      return safeStringify(event.meta);
    case 'error':
      return event.message;
    case 'file.changed':
    case 'usage':
    case 'session.ended':
      return '';
  }
}

export async function checkC13NoSecretLeak(context: ConformanceContext): Promise<void> {
  const { value, prompt } = context.options.secretProbe;
  const cwd = await context.options.createScratchDir();
  await initGitRepo(cwd);

  const handle = await context
    .getAdapter()
    .startSession(context.buildRequest({ cwd, prompt, env: {} }));
  const events = await withTimeout(
    collectEvents(handle),
    30000,
    'C13: session did not end within 30s',
  );
  const result = await withTimeout(handle.result(), 5000, 'C13: result() did not settle within 5s');

  const observedText = [
    result.finalText,
    result.error?.message ?? '',
    safeStringify(result.structured),
    ...events.map(textFromEvent),
  ].join('\n');

  expect(observedText).not.toContain(value);

  // The filesystem, too: an adapter that writes the secret to a file in cwd (e.g. "debug logging" of
  // its own environment) leaks it just as much as leaking it in an event. `readdir` is unconditionally
  // banned in this package's own production code (R10: unordered listings), so `git status --porcelain`
  // — already needed for C14 — is reused here as the listing mechanism instead of `node:fs`'s own.
  const changedPaths = await gitStatusPaths(cwd);
  for (const relativePath of changedPaths) {
    let content: string;
    try {
      content = await readFile(path.join(cwd, relativePath), 'utf8');
    } catch {
      // Not a plain readable file (e.g. a directory entry, or binary content readFile as utf8 would
      // mangle rather than usefully search) — skip rather than fail the check on an unrelated I/O error.
      continue;
    }
    expect(content).not.toContain(value);
  }
}

export function registerSecretsTests(context: ConformanceContext): void {
  describe('C13 — no secret leak', () => {
    it("an env var not included in the session's own grant is absent from its observable output", () =>
      checkC13NoSecretLeak(context));
  });
}
