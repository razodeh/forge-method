/**
 * The model-tier map `forge init` writes into `.forge/config.yaml` (`models.tiers.<tier>.<adapter id>`),
 * derived from the *selected* adapter — `PLAN-M13.md` P5b, `SPEC-QUESTIONS.md` Q204.
 *
 * Why this lives here and not in `@forge/schemas`: `DEFAULT_CONFIG.models.tiers` cannot name a platform's
 * models (`no-platform-concept`), so it ships empty, and since M13 P5 an unmapped tier is a hard
 * `RUN-078` on every agent step. The only code that may know which model serves which tier is the
 * adapter, so init asks it (`PlatformAdapter.defaultTierModels`) and writes the answer down once.
 *
 * The one rule this file exists to enforce: **never write a model id the adapter did not itself vouch
 * for.** A tier is mapped only when the adapter both names a model for it *and* lists that model in
 * `listModels()`. Anything else — no `defaultTierModels`, it throws, `listModels()` fails or is empty, an
 * id it does not list — leaves the tier unmapped, with a stated reason, so the caller can say so instead
 * of letting the first agent step discover it.
 *
 * @see specs/05 §5.8
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q204
 */
import {
  pathExists,
  readTextFile,
  renderCause,
  writeFileAtomic,
  type ProjectPaths,
} from '@forge/core';
import { MODEL_TIER_NAMES, type ModelTierName, type TierModelMap } from '@forge/adapter-kit/types';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import type { ForgeConfig } from '@forge/schemas/config';
import * as YAML from 'yaml';

import { sanitizeForTerminal } from '../generated-header.ts';

/** What became of one adapter's tier map — surfaced in `InitResult` so the CLI (and `--json`
 * consumers) can say plainly which tiers are usable and which are not. */
export interface TierMapReport {
  readonly adapterId: string;
  /** Tiers that now have a model recorded for this adapter, by this run (fresh init) or already there
   * (re-init: a value the user or an earlier init wrote, never replaced). */
  readonly mapped: TierModelMap;
  /** Tiers with no usable model recorded for this adapter. Non-empty means agent steps using that tier
   * fail `RUN-078` until `models.tiers.<tier>.<adapterId>` is set. */
  readonly unmapped: readonly ModelTierName[];
  /** Why `unmapped` is non-empty (absent when it is empty). */
  readonly note?: string;
}

/** What the adapter itself offers, before anything is written. */
export interface TierDerivation {
  readonly offered: TierModelMap;
  readonly unmapped: readonly ModelTierName[];
  readonly note: string | undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isUsableId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.trim() === value;
}

/**
 * Asks `adapter` for its default tier map and keeps only the entries it can back up with its own
 * `listModels()`. Never throws: every failure of the adapter degrades to "all tiers unmapped, and here is
 * why", because a flaky or model-less adapter must not stop a project from being initialised.
 */
export async function deriveTierMap(adapter: PlatformAdapter): Promise<TierDerivation> {
  const all = (note: string): TierDerivation => ({
    offered: {},
    unmapped: [...MODEL_TIER_NAMES],
    note,
  });

  if (adapter.defaultTierModels === undefined) {
    return all(`adapter "${adapter.id}" does not declare a default model for any tier`);
  }

  let declared: unknown;
  try {
    declared = adapter.defaultTierModels();
  } catch (cause) {
    return all(
      `adapter "${adapter.id}" failed to report its default tier models: ${String(renderCause(cause))}`,
    );
  }

  // An adapter is external code; its return value is checked, not trusted to match the type.
  if (!isRecord(declared)) {
    return all(`adapter "${adapter.id}" reported a default tier map that is not an object`);
  }

  let listed: ReadonlySet<string>;
  try {
    listed = new Set((await adapter.listModels()).map((model) => model.id));
  } catch (cause) {
    return all(`adapter "${adapter.id}" could not list its models: ${String(renderCause(cause))}`);
  }
  if (listed.size === 0) {
    return all(`adapter "${adapter.id}" reports no models, so no tier can be checked against one`);
  }

  const offered: Partial<Record<ModelTierName, string>> = {};
  const unmapped: ModelTierName[] = [];
  const problems: string[] = [];
  try {
    for (const tier of MODEL_TIER_NAMES) {
      // `Object.hasOwn`: an adapter is external code and its map is not trusted to be a plain object.
      const id: unknown = Object.hasOwn(declared, tier) ? declared[tier] : undefined;
      if (id === undefined) {
        unmapped.push(tier);
        problems.push(`no default for "${tier}"`);
      } else if (!isUsableId(id) || !listed.has(id)) {
        unmapped.push(tier);
        problems.push(`its default for "${tier}" is not a model it lists`);
      } else {
        offered[tier] = id;
      }
    }
  } catch (cause) {
    // A getter or proxy on the adapter's map that throws: same outcome as any other adapter failure.
    return all(
      `adapter "${adapter.id}" failed while reporting its default tier models: ${String(renderCause(cause))}`,
    );
  }
  return {
    offered,
    unmapped,
    note: problems.length === 0 ? undefined : `adapter "${adapter.id}": ${problems.join('; ')}`,
  };
}

/** `tiers` with `offered` recorded under `adapterId`, every other tier/adapter entry untouched. */
export function withTierMap(
  tiers: ForgeConfig['models']['tiers'],
  adapterId: string,
  offered: TierModelMap,
): ForgeConfig['models']['tiers'] {
  const next = { ...tiers };
  for (const tier of MODEL_TIER_NAMES) {
    const id = offered[tier];
    if (id !== undefined) next[tier] = { ...tiers[tier], [adapterId]: id };
  }
  return next;
}

/** Fresh-init flow: the report for one adapter whose `offered` map is about to be written verbatim. */
export function reportFresh(adapterId: string, derivation: TierDerivation): TierMapReport {
  return {
    adapterId,
    mapped: derivation.offered,
    unmapped: derivation.unmapped,
    ...(derivation.note === undefined ? {} : { note: derivation.note }),
  };
}

// --- re-init: fill what is missing, never touch what is there --------------------------------------

/** What a re-init did about `.forge/config.yaml`'s tier map. `notes` is for the things that stopped it
 * from checking at all (unreadable config, a recorded adapter it was not given): nothing is ever skipped
 * silently, because a silent skip is a tier that stays unmapped without anyone being told. */
export interface BackfillOutcome {
  readonly reports: readonly TierMapReport[];
  readonly notes: readonly string[];
}

/** An entry FORGE may fill: absent, `null` (`stub:` with no value) or blank. `resolveStepModel` already
 * treats a blank as unmapped, so filling one loses nothing a person chose. Any other value — a real id,
 * or something of an unexpected type — is theirs and is never replaced. */
function isFillable(node: unknown): boolean {
  if (node === undefined) return true;
  // An anchored scalar may be aliased from another tier: filling it would change that tier too.
  if (!YAML.isScalar(node) || node.anchor !== undefined) return false;
  return node.value === null || (typeof node.value === 'string' && node.value.trim() === '');
}

/** Makes `path` writable in `doc`, or reports that it cannot be, *without changing anything when it
 * cannot*. Every existing node on the way must be a plain map: an anchored map or an alias is refused,
 * because writing into one would silently change every place that shares it (a tier aliasing another
 * tier would start pointing at that tier's model). A null scalar (`frugal:` left empty) carries no data
 * and is replaced by an empty map — the YAML library refuses to write through one. Missing nodes need no
 * preparation (`setIn` creates them). */
function makePathWritable(doc: YAML.Document, path: readonly string[]): boolean {
  const nullPrefixes: (readonly string[])[] = [];
  for (let depth = 1; depth < path.length; depth += 1) {
    const prefix = path.slice(0, depth);
    const node = doc.getIn(prefix, true);
    if (node === undefined) break;
    if (YAML.isScalar(node) && node.value === null) {
      nullPrefixes.push(prefix);
      break;
    }
    if (!YAML.isMap(node) || node.anchor !== undefined) return false;
  }
  for (const prefix of nullPrefixes) doc.setIn(prefix, doc.createNode({}));
  return true;
}

function readString(doc: YAML.Document, path: readonly string[]): string | undefined {
  const value: unknown = doc.getIn(path);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The value a real run would read for `tiers.<tier>.<adapterId>`: through aliases, exactly as
 * `configSchema` sees the parsed file. */
function effectiveModel(
  effective: unknown,
  tier: ModelTierName,
  adapterId: string,
): string | undefined {
  if (!isRecord(effective)) return undefined;
  const models = effective['models'];
  const tiers = isRecord(models) ? models['tiers'] : undefined;
  const entry = isRecord(tiers) && Object.hasOwn(tiers, tier) ? tiers[tier] : undefined;
  const value = isRecord(entry) && Object.hasOwn(entry, adapterId) ? entry[adapterId] : undefined;
  // The same test `resolveStepModel` applies: any non-blank string is a model as far as a run is
  // concerned (even a padded one), so the report must not warn of a RUN-078 that will not happen.
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Re-`init` on an existing project: for `platform.primary`/`platform.fallback` as recorded in
 * `.forge/config.yaml`, fills `models.tiers.<tier>.<adapter id>` **only where it is absent, null or
 * blank**. A real value — hand-edited, or an id the adapter does not list — is never replaced: a user's
 * edit outranks the adapter's default. Edited through the YAML document model so comments and key order
 * survive (the rest of the file is re-serialized: line folding, indentation and blank lines are
 * normalised, so a hand-formatted config shows that churn in a diff — values are unchanged); the file is written, atomically, only when something was filled.
 *
 * Two phases, so a person's edit made *while* this runs is not lost: the adapter is consulted first
 * (`listModels()` can take arbitrarily long), and only then is the file read again and the fills applied to
 * that fresh text, with no await between that read and the write except the write itself. A change landing
 * in that last instant can still be lost — there is no lock to take, and `writeFileAtomic` gives crash
 * safety, not compare-and-swap — but the window is a read-to-rename gap, not the length of an adapter probe.
 *
 * The reports describe the state *after* the merge, read the way a run reads the file (aliases resolved).
 * Anything that stops the check outright is returned as a note, never swallowed and never thrown:
 * `forge doctor`'s `config-validity` owns a malformed config, but the person running `init` should still
 * be told their tier map was not looked at.
 */
export async function backfillTierMap(
  target: ProjectPaths,
  candidates: readonly PlatformAdapter[],
): Promise<BackfillOutcome> {
  const configPath = target.resolveWithin('.forge/config.yaml');
  const skipped = (why: string): BackfillOutcome => ({
    reports: [],
    notes: [`.forge/config.yaml ${why}, so its model tiers were not checked`],
  });

  if (!(await pathExists(configPath))) return { reports: [], notes: [] };

  /** Reads and parses the config; a failure is the reason string to report. */
  const load = async (): Promise<{ doc: YAML.Document; text: string } | string> => {
    let text: string;
    try {
      text = await readTextFile(configPath);
    } catch (cause) {
      return `could not be read (${String(renderCause(cause))})`;
    }
    const doc = YAML.parseDocument(text);
    const firstError = doc.errors[0];
    if (firstError !== undefined) return `is not valid YAML (${firstError.message})`;
    if (!YAML.isMap(doc.contents)) return 'is not a YAML mapping';
    return { doc, text };
  };
  const recordedIds = (doc: YAML.Document): readonly string[] => {
    const recorded = [
      readString(doc, ['platform', 'primary']),
      readString(doc, ['platform', 'fallback']),
    ];
    return recorded.filter(
      (id, index): id is string => id !== undefined && recorded.indexOf(id) === index,
    );
  };
  const pathFor = (tier: ModelTierName, adapterId: string): readonly string[] => [
    'models',
    'tiers',
    tier,
    adapterId,
  ];

  // Phase 1: read once, decide which adapters have something to fill, and ask them (the slow part).
  const first = await load();
  if (typeof first === 'string') return skipped(first);
  const ids = recordedIds(first.doc);
  if (ids.length === 0) return skipped('records no platform.primary');

  const notes: string[] = [];
  const derivations = new Map<string, TierDerivation | undefined>();
  const adapters = new Map<string, PlatformAdapter>();
  for (const adapterId of ids) {
    const adapter = candidates.find((candidate) => candidate.id === adapterId);
    if (adapter === undefined) {
      notes.push(
        `platform "${adapterId}" is recorded in .forge/config.yaml but no adapter with that id is ` +
          'available here, so its model tiers were not checked',
      );
      continue;
    }
    adapters.set(adapterId, adapter);
    const anythingMissing = MODEL_TIER_NAMES.some((tier) =>
      isFillable(first.doc.getIn(pathFor(tier, adapterId), true)),
    );
    // Ask the adapter only when there is something to fill: a complete map needs no adapter call.
    derivations.set(adapterId, anythingMissing ? await deriveTierMap(adapter) : undefined);
  }

  // Phase 2: re-read (a person may have edited meanwhile) and apply to that fresh text.
  const second = await load();
  if (typeof second === 'string') return skipped(second);
  const { doc, text } = second;

  const reports: TierMapReport[] = [];
  let changed = false;
  for (const adapterId of ids) {
    const adapter = adapters.get(adapterId);
    if (adapter === undefined) continue;
    const derivation = derivations.get(adapterId);

    const reasons: string[] = [];
    for (const tier of MODEL_TIER_NAMES) {
      const offered = derivation?.offered[tier];
      if (offered === undefined || !isFillable(doc.getIn(pathFor(tier, adapterId), true))) continue;
      if (makePathWritable(doc, pathFor(tier, adapterId))) {
        doc.setIn(pathFor(tier, adapterId), offered);
        changed = true;
      } else {
        reasons.push(
          `models.tiers.${tier} is shared (an alias or anchor) or not a mapping, so it was left alone`,
        );
      }
    }
    if (derivation?.note !== undefined) reasons.push(derivation.note);

    let effective: unknown;
    try {
      effective = doc.toJS();
    } catch (cause) {
      // e.g. an alias bomb: the YAML library refuses to expand it.
      return skipped(`could not be evaluated (${String(renderCause(cause))})`);
    }
    const mapped: Partial<Record<ModelTierName, string>> = {};
    const unmapped: ModelTierName[] = [];
    for (const tier of MODEL_TIER_NAMES) {
      const model = effectiveModel(effective, tier, adapterId);
      if (model === undefined) unmapped.push(tier);
      else mapped[tier] = model;
    }
    if (unmapped.length > 0 && reasons.length === 0) {
      reasons.push(`models.tiers has a value for "${adapterId}" that is not a usable model id`);
    }
    reports.push({
      adapterId,
      mapped,
      unmapped,
      ...(unmapped.length === 0 ? {} : { note: reasons.join('; ') }),
    });
  }

  if (changed) {
    // Keep the file's own line endings: the serializer always emits LF.
    const serialized = doc.toString();
    try {
      await writeFileAtomic(
        configPath,
        text.includes('\r\n') ? serialized.replace(/\r?\n/g, '\r\n') : serialized,
      );
    } catch (cause) {
      return {
        reports: [],
        notes: [
          ...notes,
          `.forge/config.yaml could not be written (${String(renderCause(cause))}), so its model tiers were not filled`,
        ],
      };
    }
  }
  return { reports, notes };
}

/** Adapter- or config-supplied text bound for a one-line-per-record report: control characters stripped
 * and every line break collapsed, so it cannot forge a second record. (`sanitizeForTerminal` alone keeps
 * `\n`/`\r`/`\t`.) */
export function sanitizeOneLine(text: string): string {
  return (
    sanitizeForTerminal(text)
      // Line/paragraph separators and the bidi controls that reorder what a terminal displays.
      .replace(/[\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/[\r\n\t]+/g, ' ')
  );
}

/**
 * The human-readable warning lines for tiers that are still unmapped (`forge init` prints these; the
 * `--json` result carries the same data structurally). The adapter's id and its reason are adapter-
 * supplied text, so control characters — including newlines, which could forge a second `forge init:`
 * line — are stripped before they reach a terminal.
 */
export function formatUnmappedTierWarnings(reports: readonly TierMapReport[]): readonly string[] {
  return reports
    .filter((report) => report.unmapped.length > 0)
    .map((report) => {
      const id = sanitizeOneLine(report.adapterId);
      return (
        `forge init: warning: model tier(s) ${report.unmapped.join(', ')} are not mapped for "${id}" ` +
        `(${sanitizeOneLine(report.note ?? 'no entry in models.tiers')}). Agent steps on them fail RUN-078 until ` +
        `you set models.tiers.<tier>.${id} in .forge/config.yaml; \`forge doctor\` reports this.`
      );
    });
}
