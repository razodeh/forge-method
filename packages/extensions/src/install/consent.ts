/**
 * `describeRequestedCapabilities`/`promptForConsent` — `19` §19.5 step 3's capability consent screen
 * ("every requested shell pattern, network host, MCP server and tool grant, shown before anything is
 * installed. Nothing is installed on refusal.") and `15` §15.11's identical "capability request
 * screen ... require confirmation" line. Before this file, no such mechanism existed anywhere in this
 * codebase — `packages/cli/src/init/run-init.ts`'s own `--overlay` refusal (`USR-002`) names exactly
 * this gap by name ("no ... capability-request-screen confirmation `03` §3.3 step 10 requires").
 *
 * Two manifest shapes feed this screen, per `15` §15.11 and `19` §19.1 respectively:
 *
 * - An **overlay** (`overlay.yaml`) declares `requestsCapabilities` (an array of single-key entries:
 *   `network`, `exec`, or `mcp-write`) plus `provides.mcp` (the MCP servers it adds — a real, new
 *   external reach a user should see before it lands, even though it is not itself a boolean "grant").
 *   No full `overlay.yaml` schema exists anywhere in this codebase yet (confirmed by direct
 *   inspection of `packages/extensions/src/install/` before writing this file); building one is out
 *   of this piece's scope (`PLAN-M11.md` P3 names only this file as its surface). `overlayCapability
 *   ManifestSchema` below is therefore deliberately partial — it validates only the fields this
 *   screen renders and passes everything else through unvalidated — so a future, complete overlay
 *   parser is free to supersede it without this file needing to change.
 * - A **module** (`module.yaml`) declares no `requestsCapabilities` field at all; its own real
 *   `ceilings` block (M10 P2's `moduleSchema`, `packages/extensions/src/module/schema.ts`) is the
 *   per-role maximum grant a module's agents may hold, and is the module-case equivalent source for
 *   this screen.
 *
 * `promptForConsent`'s own interactive/`--yes`/`--json` shape matches `packages/cli/src/init/
 * run-init.ts` and `packages/cli/src/commands/uninstall.ts`'s own established "refuse without
 * `--yes`" convention for the non-interactive case, but goes further for the interactive default:
 * those two commands have no real terminal prompt at all (an unconditional `USR-002` refusal without
 * `--yes`), where this screen is the first place in the codebase that needs one, since `19` §19.5
 * step 3 is explicitly a yes/no confirmation a human is expected to answer, not merely a flag a CI
 * pipeline must remember to pass.
 *
 * **Refusal writes nothing to disk.** Neither exported function in this file ever touches the
 * filesystem — `describeRequestedCapabilities` only renders, `promptForConsent` only reads/writes
 * terminal I/O — so a caller that gates every install step behind `promptForConsent`'s own returned
 * boolean gets "nothing written on refusal" for free, by construction, not by a discipline the caller
 * must separately remember. What is actually, mechanically proven here (`test/install/consent.test.ts`)
 * is narrower than the full end-to-end install flow: (1) a direct source-inspection test asserts this
 * file itself contains none of Node's filesystem/process-mutation calls, the real fact this claim
 * rests on; (2) a checksum-based test demonstrates the safe consumption pattern a real installer
 * (`PLAN-M11.md` P5, not yet built) is required to follow. A critic round on this piece found an
 * earlier version of (2) implied more than that — it read as proof of the full install flow's own
 * "nothing written on refusal" guarantee, which cannot be tested until P5's real installer exists.
 *
 * @see specs/19 §19.5
 * @see specs/15 §15.11
 * @see PLAN-M11.md P3
 */
import { createInterface } from 'node:readline';

import { z } from 'zod';

import { ForgeError } from '@forge/core';

import type { ModuleDefinition } from '../module/index.ts';

/** The four dimensions `19` §19.5 step 3 / `15` §15.11 both name explicitly: "shell pattern, network
 * host, MCP server, and tool grant." */
export type CapabilityKind = 'shell' | 'network' | 'mcp-server' | 'tool-grant';

export interface CapabilityDescriptionEntry {
  readonly kind: CapabilityKind;
  /** One human-readable line naming exactly what is being requested — never a summary that could
   * fold two distinct requests (e.g. two different exec patterns) into one entry, since the consent
   * screen's own job is to let a human refuse a *specific* request, not an aggregate. */
  readonly text: string;
}

export interface CapabilityDescription {
  readonly id: string;
  readonly name: string;
  /** Every requested capability, one entry per concrete request (never deduplicated across different
   * literal values — two different exec patterns are two entries). `pushUnique` folds two entries
   * with the identical rendered `text` to one — for the module (`ceilings`) case, `text` names its
   * own role (e.g. `Run shell commands matching "git *" (role "reviewer")`), so the same pattern
   * granted to two *different* roles is deliberately **not** folded: each role's own grant is its
   * own request, worth its own line, even when the literal pattern happens to match. A critic round
   * on this piece found an earlier version of this comment claimed cross-role folding that the
   * implementation never did — corrected here to describe the actual, and more conservative,
   * behaviour: identical text folds, different text (role included) does not. */
  readonly entries: readonly CapabilityDescriptionEntry[];
  /** The full, ready-to-print terminal rendering: a header naming the bundle, then one bullet per
   * entry. `promptForConsent` prints this verbatim; a caller wanting the structured `entries` instead
   * (e.g. for `--json`) has them directly, without re-parsing this string. */
  readonly text: string;
}

export type CapabilityManifestInput =
  | {
      /** A parsed (but not necessarily yet schema-validated) `overlay.yaml` document — validated
       * against `overlayCapabilityManifestSchema` here, since no earlier parse step in this codebase
       * does so yet. */
      readonly kind: 'overlay';
      readonly document: unknown;
    }
  | {
      /** An already-validated `module.yaml` (`parseModule`'s own return type) — no further
       * validation needed here, since `moduleSchema` already enforces `ceilings`' shape. */
      readonly kind: 'module';
      readonly module: ModuleDefinition;
    };

/** `15` §15.11's own worked example, one key per entry:
 * ```yaml
 * requestsCapabilities:
 *   - network: [ "artifactory.internal" ]
 *   - exec: [ "./gradlew *" ]
 *   - mcp-write: false
 * ```
 * `.strict()` on every branch so an entry combining two keys (not the spec's own documented shape,
 * and ambiguous to render — which capability "wins" the entry's single line?) is refused at parse
 * time with a named reason, rather than one of the two keys silently winning on whichever `in` check
 * happens to run first. */
const overlayCapabilityEntrySchema = z.union([
  z.object({ network: z.array(z.string().min(1)) }).strict(),
  z.object({ exec: z.array(z.string().min(1)) }).strict(),
  z.object({ 'mcp-write': z.boolean() }).strict(),
]);

/** The consent-relevant subset of `overlay.yaml` — see this file's own top-of-file doc comment for
 * why this is deliberately partial rather than a full `overlay.yaml` schema. `.passthrough()` (not
 * `.strict()`) at the top level: a real `overlay.yaml` also carries `version`/`forgeVersion`/
 * `requiresModules`/`provides.{agents,skills,checks,presets}`/etc., none of which this screen needs
 * to render and none of which should cause a real, valid overlay to be refused here. */
const overlayCapabilityManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    provides: z
      .object({ mcp: z.array(z.string().min(1)).optional() })
      .partial()
      .optional(),
    requestsCapabilities: z.array(overlayCapabilityEntrySchema).default([]),
  })
  .passthrough();

export type OverlayCapabilityManifest = z.infer<typeof overlayCapabilityManifestSchema>;

function formatZodIssues(
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
): string {
  return issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/** Appends `entry` only if an entry with the identical `kind`/`text` is not already present — the
 * "repeated verbatim across roles/entries is folded to one" rule `CapabilityDescription.entries`'
 * own doc comment declares. Order-preserving (first occurrence wins its position). */
function pushUnique(
  entries: CapabilityDescriptionEntry[],
  entry: CapabilityDescriptionEntry,
): void {
  if (entries.some((existing) => existing.kind === entry.kind && existing.text === entry.text)) {
    return;
  }
  entries.push(entry);
}

function overlayEntries(manifest: OverlayCapabilityManifest): CapabilityDescriptionEntry[] {
  const entries: CapabilityDescriptionEntry[] = [];
  for (const serverId of manifest.provides?.mcp ?? []) {
    pushUnique(entries, { kind: 'mcp-server', text: `Add MCP server "${serverId}"` });
  }
  for (const capability of manifest.requestsCapabilities) {
    if ('network' in capability) {
      for (const host of capability.network) {
        pushUnique(entries, { kind: 'network', text: `Reach network host "${host}"` });
      }
    } else if ('exec' in capability) {
      for (const pattern of capability.exec) {
        pushUnique(entries, { kind: 'shell', text: `Run shell commands matching "${pattern}"` });
      }
    } else if (capability['mcp-write']) {
      // A declared `mcp-write: false` is an explicit *non*-request, not merely an unset default —
      // `19` §19.5's own "every requested ... shown" wording is about what is being asked for, and
      // showing a denial as if it were a request would fabricate a capability nobody asked for.
      pushUnique(entries, { kind: 'tool-grant', text: 'Write via MCP tool calls (mcp-write)' });
    }
  }
  return entries;
}

function moduleEntries(module: ModuleDefinition): CapabilityDescriptionEntry[] {
  const entries: CapabilityDescriptionEntry[] = [];
  for (const [role, grant] of Object.entries(module.ceilings)) {
    for (const pattern of grant.exec ?? []) {
      pushUnique(entries, {
        kind: 'shell',
        text: `Run shell commands matching "${pattern}" (role "${role}")`,
      });
    }
    if (grant.network !== undefined && grant.network !== 'none') {
      // An `allowlist` level with no `allowlistHosts` at all is a real, if unusual, shape the schema
      // permits — rendering it identically to an allowlist that actually names hosts would read as
      // "this role can reach an allowlist of hosts" when none are declared, a misleading half-truth
      // a critic round on this piece flagged. Called out explicitly instead.
      const hosts = grant.allowlistHosts ?? [];
      const suffix =
        grant.network === 'allowlist' && hosts.length === 0 ? ' (no hosts declared)' : '';
      pushUnique(entries, {
        kind: 'network',
        text: `Network access level "${grant.network}" (role "${role}")${suffix}`,
      });
    }
    for (const host of grant.allowlistHosts ?? []) {
      pushUnique(entries, {
        kind: 'network',
        text: `Reach network host "${host}" (role "${role}")`,
      });
    }
    if (grant.write === true) {
      pushUnique(entries, { kind: 'tool-grant', text: `Write files (role "${role}")` });
    }
    if (grant.deploy === true) {
      pushUnique(entries, { kind: 'tool-grant', text: `Deploy (role "${role}")` });
    }
  }
  return entries;
}

function renderDescriptionText(
  id: string,
  name: string,
  entries: readonly CapabilityDescriptionEntry[],
): string {
  const header = `${name} (${id}) requests the following capabilities:`;
  if (entries.length === 0) {
    return `${header}\n  (none declared.)`;
  }
  return [header, ...entries.map((entry) => `  - ${entry.text}`)].join('\n');
}

/**
 * Renders every capability `input`'s manifest requests into a complete, human-readable description —
 * `19` §19.5 step 3's own "every requested ... shown before anything is installed" line, made real.
 *
 * Every requested shell pattern, network host, MCP server, and tool grant appears as its own entry;
 * nothing the manifest requests is omitted, and nothing it does not request is fabricated (an unset
 * or `false` grant produces no entry).
 *
 * @throws {ForgeError} `CFG-036` when `input.kind === 'overlay'` and `input.document` does not match
 * even this file's own deliberately partial capability-relevant schema.
 */
export function describeRequestedCapabilities(
  input: CapabilityManifestInput,
): CapabilityDescription {
  let id: string;
  let name: string;
  let entries: CapabilityDescriptionEntry[];

  if (input.kind === 'module') {
    id = input.module.id;
    name = input.module.name;
    entries = moduleEntries(input.module);
  } else {
    const result = overlayCapabilityManifestSchema.safeParse(input.document);
    if (!result.success) {
      throw new ForgeError('CFG-036', { detail: formatZodIssues(result.error.issues) });
    }
    id = result.data.id;
    name = result.data.name;
    entries = overlayEntries(result.data);
  }

  return { id, name, entries, text: renderDescriptionText(id, name, entries) };
}

export interface ConsentPromptOptions {
  /** `03` §3.1's own "every interactive flow MUST have a --yes-able non-interactive equivalent" rule
   * — bypasses the interactive prompt below and grants consent, but **only** when the caller passed
   * this explicitly as `true`; `undefined`/`false` both fall through to the real interactive prompt
   * (or the `json` non-interactive-refusal path), never to a silent grant. */
  readonly yes?: boolean;
  /** A non-interactive path for CI: makes `output` a structured, machine-readable JSON line
   * (`{ description, granted }`) instead of human-facing prose, on **both** the grant and refusal
   * paths — a critic round on this piece found the first draft only did this on the refusal path,
   * silently switching back to a free-form prose line ("Auto-accepted (--yes was passed).") whenever
   * `yes` was also `true`, breaking exactly the "pipe this into `jq`" contract the doc comment itself
   * promised. Without `yes: true`, this path still refuses (returns `false`) rather than blocking on
   * a `y/n` answer a script cannot meaningfully give — a real terminal prompt is not a contract a CI
   * runner can satisfy, and guessing "yes" on its behalf would be exactly the silent default `19`
   * §19.5's own "nothing is installed on refusal" line forbids. Pass `yes: true` alongside this to
   * actually grant consent non-interactively while still getting JSON output. */
  readonly json?: boolean;
  /** Defaults to `process.stdin`/`process.stdout`. Overridable so a real interactive prompt can be
   * driven and observed by a test without a real TTY. */
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

/** Matches "y" or "yes", case-insensitively, surrounding whitespace ignored — anything else
 * (including a bare empty-string Enter press, `19` §19.5's own implied "default to refuse" posture
 * for a screen whose entire purpose is stopping accidental installs) is a refusal. */
const AFFIRMATIVE_ANSWER = /^\s*y(es)?\s*$/i;

/**
 * Shows `description` (from `describeRequestedCapabilities`'s own `.text`) and asks for confirmation
 * before an overlay/module install proceeds — `19` §19.5 step 3 / `15` §15.11's own "require
 * confirmation" line.
 *
 * Resolves `true` only when the caller explicitly passed `options.yes === true`, or a real
 * interactive answer matched {@link AFFIRMATIVE_ANSWER}. Every other path — an explicit "no," an
 * empty answer, the input stream ending before any answer is given (EOF, a non-interactive `stdin`
 * with nothing piped to it and no `--yes` given), or `options.json === true` without `options.yes` —
 * resolves `false`. This function never writes to the filesystem; the caller is solely responsible
 * for treating a `false` result as "install nothing" (see this file's own top-of-file doc comment,
 * and `test/install/consent.test.ts`'s own direct source-inspection test, for what actually backs
 * that guarantee).
 *
 * No cancellation path exists for a hung interactive prompt (no `AbortSignal`/timeout option) — a
 * disclosed, not fixed, gap: no other interactive-shaped code in this codebase establishes that
 * convention either, and a real terminal prompt genuinely has no other correct behaviour than
 * waiting for the human at the other end. A caller wanting a bounded wait must pass `--yes`/`--json`
 * (or a non-interactive `input`) instead of relying on this function to time out on its own.
 */
export async function promptForConsent(
  description: string,
  options: ConsentPromptOptions = {},
): Promise<boolean> {
  const output = options.output ?? process.stdout;

  if (options.yes === true) {
    if (options.json === true) {
      output.write(`${JSON.stringify({ description, granted: true })}\n`);
    } else {
      output.write(`${description}\n\nAuto-accepted (--yes was passed).\n`);
    }
    return true;
  }

  if (options.json === true) {
    output.write(`${JSON.stringify({ description, granted: false })}\n`);
    return false;
  }

  const input = options.input ?? process.stdin;
  const rl = createInterface({ input, output });
  try {
    output.write(`${description}\n\nInstall? [y/N] `);
    // Plain event listeners (not `readline/promises`' own `question()`) so whichever of 'line'/
    // 'close' fires first has its listener removed immediately — `readline/promises`' `question()`
    // leaves its own pending promise permanently unsettled when the interface closes before an
    // answer is given (a real shape: a non-interactive `stdin` with nothing piped to it, no
    // `--yes`/`--json`), which a critic round on this piece flagged as an unbounded-lifetime leak
    // across repeated calls in one process.
    const answer = await new Promise<string>((resolve) => {
      const cleanup = (): void => {
        rl.off('line', onLine);
        rl.off('close', onClose);
        rl.off('error', onError);
      };
      const onLine = (line: string): void => {
        cleanup();
        resolve(line);
      };
      const onClose = (): void => {
        cleanup();
        resolve('');
      };
      // A real `input` stream I/O failure (a broken pipe, `EIO`) — not merely an adversarial input —
      // emits `'error'` on `input` itself; `readline`'s own `Interface` already listens for that and
      // re-emits it on `rl`, so listening on `rl` (not `input` directly) is both sufficient and the
      // one place `readline`'s own forwarding guarantees the event actually arrives. A critic round
      // on this piece found no handler at all here, which meant this shape either hung the same way
      // `'close'` used to, or — since Node treats an unhandled `'error'` event as fatal — crashed the
      // process outright. Fails closed (refuses) instead of either.
      const onError = (): void => {
        cleanup();
        resolve('');
      };
      rl.once('line', onLine);
      rl.once('close', onClose);
      rl.once('error', onError);
    });
    return AFFIRMATIVE_ANSWER.test(answer);
  } finally {
    rl.close();
  }
}
