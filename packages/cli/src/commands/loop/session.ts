/**
 * `forge session <type> --question "…" […]` / `forge session list|show <id>|resume <id>|export <id>`
 * — `03` §3.2.6, `16` §16.6. Real dispatch to `@forge/engine/interaction`'s own `runSessionStep`
 * (`PLAN-M10.md` P10, extended by P11/P12), the same real, working session-driving mechanism a
 * `kind: 'session'` workflow step already uses — this file is the interactive, standalone caller
 * `HumanSessionInput`'s own doc comment (`@forge/engine/interaction/session.ts`) already names as
 * "the real, intended caller" for a later piece, and `runSessionStep`'s own `resumeFrom` parameter
 * (added by this piece) exists specifically for `sessionResume` below.
 *
 * `runSessionStep` takes a real, compiled `StepNode` — it has no standalone entry point of its own,
 * matching `forge panel`/`forge review`'s own identical situation (`ad-hoc-step.ts`'s own doc comment).
 * This file follows the exact same, already-established pattern: a hand-built `StepNode` (never routed
 * through `parseWorkflow`/`compileRunPlan`, since a `forge session` invocation runs outside any
 * workflow) plus `buildRunEngineContext` (`../run/context.ts`), the identical real facade constructors
 * `forge run`/`forge panel` already assemble a real `ExecuteStepContext` from.
 *
 * **The `SessionType` union bug this piece fixes.** This file's own prior version hand-copied `16`
 * §16.2's ten-row table into an eight-member union, missing `discovery-interview`/`story-refinement` —
 * both real, schema-valid, `runSessionStep`-dispatchable session types (`SESSION_TYPE_DEFAULTS`,
 * `@forge/engine/interaction/session.ts`) that were simply unreachable from this CLI's own surface.
 * `SessionType` is now `SessionRecord['sessionType']` itself — the real, closed ten-value union,
 * impossible to drift from the schema a second time — and `SESSION_TYPES` (`@forge/schemas`, exported
 * by this piece) is the one real runtime source of truth for validating a caller-supplied string
 * against it, rather than a second hand-copied array.
 *
 * **`--technique`/`--roles`.** `--roles` is real and wired all the way through: `runSessionStep`'s own
 * new `participantRoles` parameter (added by this piece) overrides `SESSION_TYPE_DEFAULTS`' own
 * per-type roster when supplied. `--technique` is accepted but has no real DIVERGE-technique-selection
 * wiring anywhere in `runSessionStep` to attach to (`SessionPhaseMachine.diverge`'s own `techniqueId`
 * input is never populated by that function for any caller) — a disclosed, honest gap, not a silent
 * no-op: the requested technique id(s) are folded into the framed question's own text instead, so a
 * real dispatched participant at least sees the request, even though nothing here can force the
 * facilitator to actually run that specific technique's own method. See `SPEC-QUESTIONS.md`.
 *
 * @see specs/03 §3.2.6
 * @see specs/16 §16.5
 * @see specs/16 §16.6
 * @see PLAN-M10.md P13
 */
import { ForgeError, SYSTEM_CLOCK, type Clock } from '@forge/core';
import {
  listDirSorted,
  pathExists,
  readTextFile,
  writeFileAtomic,
  type ProjectPaths,
} from '@forge/core/fs';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import {
  loadSessionState,
  runSessionStep,
  SESSIONS_DIR,
  type SessionStepResult,
} from '@forge/engine/interaction';
import type { StepNode, StepNodeLimits, StepNodeRetryPolicy } from '@forge/engine/plan';
import type { ForgeConfig } from '@forge/schemas/config';
import { SESSION_TYPES, sessionRecordSchema, type SessionRecord } from '@forge/schemas';
import { renderArtifactPath } from '@forge/schemas/registry';
import * as YAML from 'yaml';

import { buildRunEngineContext } from '../run/context.ts';

/** The real, closed ten-member `16` §16.2 union, read directly from `SessionRecord` itself rather than
 * hand-copied a second time — see this file's own top-of-file doc comment for the real bug this fixes. */
export type SessionType = SessionRecord['sessionType'];

export function isSessionType(value: string): value is SessionType {
  return (SESSION_TYPES as readonly string[]).includes(value);
}

export interface SessionCommandDeps {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
  readonly adapter: PlatformAdapter;
  readonly checksRoot: string;
}

/** `docs/forge/sessions/` — re-exported under this file's own name for parity with every other
 * `*_ROOT` constant this package's commands already carry (`AGENTS_ROOT`, `CHECKS_ROOT`, ...), backed
 * by `@forge/engine/interaction`'s own real, single source of truth (`SESSIONS_DIR`) rather than a
 * second hand-typed literal. */
export const SESSIONS_ROOT = SESSIONS_DIR;

const SESSION_STEP_LIMITS: StepNodeLimits = {
  maxTurns: 40,
  wallClockMs: 20 * 60 * 1000,
  maxCostUsd: 3,
};
const SESSION_STEP_RETRY: StepNodeRetryPolicy = { maxAttempts: 1, backoffMs: [0, 0], retryOn: [] };

/** A hand-built, ad-hoc `kind: 'session'` `StepNode` — the identical "never routed through
 * `parseWorkflow`/`compileRunPlan`" pattern `buildAdHocStepNode` (`ad-hoc-step.ts`) already establishes
 * for `forge panel`/`forge review`'s own `kind: 'agent'` case, extended here for the one additional
 * kind-scoped field (`sessionType`) a session step carries that an agent step does not. */
function buildAdHocSessionStepNode(id: string, sessionType: SessionType, brief: string): StepNode {
  return {
    id,
    kind: 'session',
    sessionType,
    brief,
    inputs: [],
    outputs: [],
    dependsOn: [],
    produces: [],
    consumes: [],
    retry: SESSION_STEP_RETRY,
    limits: SESSION_STEP_LIMITS,
    idempotencyKey: id,
    onFailure: 'block',
  };
}

/** `16` §16.6's own worked commands, read directly: every type-specific flag (`--target`/`--scope`/
 * `--stage`/`--defect`) names the one real flag that type's own row needs to state `16` §16.3 step 1's
 * one-sentence question — `--question` is always accepted too and, when given, wins outright (a real
 * caller who wants to phrase the question their own way, for any type, may always do so). */
export interface StartSessionOptions {
  readonly question?: string | undefined;
  /** `design-review --target <id>`. */
  readonly target?: string | undefined;
  /** `premortem --scope <id>`. */
  readonly scope?: string | undefined;
  /** `retro --stage <id>`. */
  readonly stage?: string | undefined;
  /** `war-room --defect <id>`. */
  readonly defect?: string | undefined;
  /** `tradeoff --options a,b,c`. */
  readonly options?: readonly string[] | undefined;
  /** See this file's own top-of-file doc comment for the real, disclosed limit on what this actually
   * wires through. */
  readonly technique?: readonly string[] | undefined;
  /** Overrides `SESSION_TYPE_DEFAULTS`' own per-type participant roster — real, wired all the way
   * through `runSessionStep`'s own new `participantRoles` parameter. */
  readonly roles?: readonly string[] | undefined;
  readonly clock?: Clock | undefined;
}

/** A `Record`, not a `switch`, over every real `SessionType` -- `@typescript-eslint/switch-
 * exhaustiveness-check` flags a `switch` with a `default` clause as non-exhaustive per case (this
 * repo's own configured, options-less default), and a `Record` gets the identical "every real type
 * covered, a typo'd key is a compile error" guarantee from `SessionType` itself being its index type. */
const REQUIRED_FLAG_BY_TYPE: Readonly<Record<SessionType, string>> = {
  brainstorm: '--question',
  'design-review': '--target',
  tradeoff: '--question',
  premortem: '--scope',
  retro: '--stage',
  'war-room': '--defect',
  estimation: '--question',
  standup: '--question',
  'discovery-interview': '--question',
  'story-refinement': '--question',
};

function requiredFlagFor(type: SessionType): string {
  return REQUIRED_FLAG_BY_TYPE[type];
}

/** Derives `16` §16.3 step 1's own one-sentence FRAME question from whichever type-specific flag `16`
 * §16.6's own worked commands show for `type` — `--question` always wins outright when supplied
 * (a real, generic override every type accepts), otherwise the type's own named flag.
 *
 * @throws {ForgeError} `USR-002` when neither `--question` nor the type's own required flag is given —
 * an ordinary, real authoring mistake (a bare `forge session design-review` with no `--target`), the
 * identical "malformed/missing flag value" meaning `forge panel`'s own `USR-002` use already
 * establishes for this codebase's real precedent (`panel.ts`), not `parseGlobalFlags`' narrower literal
 * scope alone.
 */
/** Appends a parenthetical note to `text` without producing a second `16` §16.3 step 1 "sentence" —
 * `isStatableInOneSentence` (`@forge/sessions`) rejects any real internal `.`/`?`/`!`, so a naive
 * `${text} ${note}.` (two sentences) would refuse FRAME outright for the exact real inputs this file's
 * own `--options`/`--technique` flags produce. Strips `text`'s own trailing terminator first, then
 * appends the note with none of its own — the combined string carries at most one terminator overall
 * (whichever `note` itself supplies, normally none), satisfying the real, mechanical one-sentence check
 * rather than merely looking like one sentence. */
function appendParenthetical(text: string, note: string): string {
  const withoutTerminator = text.trim().replace(/[.?!]+$/, '');
  return `${withoutTerminator} (${note})`;
}

/** One real, type-specific fallback question builder per `16` §16.2 type, keyed the identical
 * `Record<SessionType, ...>` way `REQUIRED_FLAG_BY_TYPE` above is, for the same exhaustiveness reason.
 * `undefined` means "this type has no type-specific flag of its own — `--question` is the only way to
 * frame it" (`brainstorm`/`tradeoff`/`estimation`/`standup`/`discovery-interview`/`story-refinement`,
 * per `16` §16.6's own worked commands), or "the type-specific flag itself was not actually given." */
const BRIEF_BUILDER_BY_TYPE: Readonly<
  Record<SessionType, (options: StartSessionOptions) => string | undefined>
> = {
  brainstorm: () => undefined,
  'design-review': (options) =>
    options.target === undefined || options.target === ''
      ? undefined
      : `Evaluate the design in ${options.target} against requirements and risks`,
  tradeoff: () => undefined,
  premortem: (options) =>
    options.scope === undefined || options.scope === ''
      ? undefined
      : `Assume ${options.scope} has failed six months from now and explain why, with what would ` +
        'have mitigated it',
  retro: (options) =>
    options.stage === undefined || options.stage === ''
      ? undefined
      : `Reflect on ${options.stage} and state what should change going forward`,
  'war-room': (options) =>
    options.defect === undefined || options.defect === ''
      ? undefined
      : `Coordinate a response to ${options.defect}, a live blocking failure`,
  estimation: () => undefined,
  standup: () => undefined,
  'discovery-interview': () => undefined,
  'story-refinement': () => undefined,
};

function resolveBrief(type: SessionType, options: StartSessionOptions): string {
  const question = options.question?.trim();
  if (question !== undefined && question !== '') {
    if (type === 'tradeoff' && options.options !== undefined && options.options.length > 0) {
      return appendParenthetical(
        question,
        `options under consideration: ${options.options.join(', ')}`,
      );
    }
    return question;
  }
  const derived = BRIEF_BUILDER_BY_TYPE[type](options);
  if (derived !== undefined) return derived;
  throw new ForgeError('USR-002', { flag: requiredFlagFor(type), value: '' });
}

/** `forge session <type> --question "…" […]` — `16` §16.6. Runs one real, standalone session end to
 * end via `runSessionStep` and returns its real outcome plus (when the session reached RECORD) the
 * real, already-persisted `SessionRecord`. */
export async function startSession(
  deps: SessionCommandDeps,
  type: SessionType,
  options: StartSessionOptions = {},
): Promise<SessionStepResult> {
  if (!isSessionType(type)) {
    throw new ForgeError('RUN-068', { stepId: 'forge-session', sessionType: type });
  }
  let brief = resolveBrief(type, options);
  if (options.technique !== undefined && options.technique.length > 0) {
    brief = appendParenthetical(
      brief,
      `requested technique(s): ${options.technique.join(', ')} — informational only, this run's own ` +
        'facilitator has no real, forced technique-selection mechanism yet',
    );
  }

  const clock = options.clock ?? SYSTEM_CLOCK;
  const runId = `session-${type}-${clock.now().replace(/[^0-9]/g, '')}`;
  const ctx = await buildRunEngineContext({
    paths: deps.paths,
    projectRoot: deps.projectRoot,
    config: deps.config,
    runId,
    adapter: deps.adapter,
    checksRoot: deps.checksRoot,
    clock,
  });
  const node = buildAdHocSessionStepNode(runId, type, brief);
  const roles = options.roles !== undefined && options.roles.length > 0 ? options.roles : undefined;
  return runSessionStep(node, ctx, undefined, roles);
}

/** One real, persisted session file under `docs/forge/sessions/` — `entry` is that file's own bare
 * name (never `.state/...`, filtered out below), used by `sessionShow`/`sessionResume`/`sessionExport`
 * to re-locate the exact file `sessionList` already found once. */
async function listSessionFiles(paths: ProjectPaths): Promise<readonly string[]> {
  const dir = paths.resolveWithin(SESSIONS_ROOT);
  if (!(await pathExists(dir))) return [];
  const entries = await listDirSorted(dir);
  return entries.filter((entry) => entry.endsWith('.md'));
}

/** `id`-exact (`${id}.md`, `runSessionStep`'s own real, no-slug working-file name) or `id`-prefixed
 * (`${id}-slug.md`, `sessionExport`'s own real, canonical-named copy) — either is a real file for the
 * same session id. The exact `${id}.md` working file always wins when both exist -- a fresh critic
 * round found an earlier draft picked whichever of the two `Array.prototype.find` happened to see
 * first, which `listSessionFiles`' own real, sorted directory listing (plain code-unit order, `'-'`
 * 0x2D sorting before `'.'` 0x2E) made the *export* copy win silently and unconditionally for any
 * exported session, serving a real, potentially-stale snapshot instead of the live working file with
 * no indication to the caller. This function now checks the exact name first, deterministically,
 * regardless of directory listing order.
 *
 * @throws {ForgeError} `RUN-070` when no real file for `id` exists under `docs/forge/sessions/`.
 */
async function findSessionFile(deps: SessionCommandDeps, id: string): Promise<string> {
  const files = await listSessionFiles(deps.paths);
  const exact = files.find((entry) => entry === `${id}.md`);
  const match = exact ?? files.find((entry) => entry.startsWith(`${id}-`));
  if (match === undefined) {
    throw new ForgeError('RUN-070', { id });
  }
  return `${SESSIONS_ROOT}/${match}`;
}

const FRONT_MATTER_PATTERN = /^---\n([\s\S]*?)\n---\n/;

/** Splits `text` (this module's own `---\n<yaml>---\n\n<body>` shape, `persistSessionRecord`'s own
 * real write format, `@forge/engine/interaction/session.ts`) into a real, schema-validated
 * `SessionRecord` plus the raw body text — never a bare `YAML.parse`/`as SessionRecord` cast, since a
 * hand-edited or corrupted file must be caught here, not silently trusted.
 *
 * @throws {ForgeError} `RUN-073` when `text` has no real front-matter block, or its front matter does
 * not parse against `sessionRecordSchema` — real data corruption or a hand-edit, distinct from
 * `findSessionFile`'s own `RUN-070` ("no file at all for this id").
 */
function parseSessionRecordText(
  text: string,
  id: string,
): { readonly record: SessionRecord; readonly body: string } {
  const match = FRONT_MATTER_PATTERN.exec(text);
  if (match?.[1] === undefined) {
    throw new ForgeError('RUN-073', { id });
  }
  let front: unknown;
  try {
    front = YAML.parse(match[1]);
  } catch {
    throw new ForgeError('RUN-073', { id });
  }
  const parsed = sessionRecordSchema.safeParse(front);
  if (!parsed.success) {
    throw new ForgeError('RUN-073', { id });
  }
  return { record: parsed.data, body: text.slice(match[0].length) };
}

export interface SessionSummary {
  readonly id: string;
  readonly sessionType: SessionType;
  readonly title: string;
  readonly status: SessionRecord['status'];
  readonly path: string;
}

/** `forge session list` — `16` §16.6. Every real, persisted session record this project currently has,
 * sorted by id. A file that fails to parse (hand-edited, corrupted, or predates this piece's own
 * front-matter shape) is skipped rather than aborting the whole listing — the identical "a real,
 * partial answer beats a total failure over one bad file" choice `adrList`'s own underlying
 * `parseKbTree` already makes for the KB tree generally. */
export async function sessionList(deps: SessionCommandDeps): Promise<readonly SessionSummary[]> {
  const files = await listSessionFiles(deps.paths);
  const summaries: SessionSummary[] = [];
  for (const file of files) {
    const relativePath = `${SESSIONS_ROOT}/${file}`;
    let text: string;
    try {
      text = await readTextFile(deps.paths.resolveWithin(relativePath));
    } catch {
      continue;
    }
    let parsed: { readonly record: SessionRecord; readonly body: string };
    try {
      parsed = parseSessionRecordText(text, file.replace(/\.md$/, ''));
    } catch {
      continue;
    }
    summaries.push({
      id: parsed.record.id,
      sessionType: parsed.record.sessionType,
      title: parsed.record.title,
      status: parsed.record.status,
      path: relativePath,
    });
  }
  // Plain code-unit-order comparison, never `localeCompare` (`QUALITY-BAR.md` R10): collation order
  // varies by host locale, and `SESSION-###` ids sort identically either way for the real, fixed
  // three-digit-zero-padded id shape this schema enforces.
  return summaries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface SessionDocument {
  readonly record: SessionRecord;
  readonly body: string;
  readonly path: string;
}

/** `forge session show <id>` — `16` §16.6. The real, persisted `SessionRecord` front matter plus its
 * real rendered body (`## Frame`/`## Diverge`/.../`## Actions`, `16` §16.5's own worked shape). */
export async function sessionShow(deps: SessionCommandDeps, id: string): Promise<SessionDocument> {
  const relativePath = await findSessionFile(deps, id);
  const text = await readTextFile(deps.paths.resolveWithin(relativePath));
  const { record, body } = parseSessionRecordText(text, id);
  return { record, body, path: relativePath };
}

export interface ResumeSessionOptions {
  readonly clock?: Clock | undefined;
}

/**
 * `forge session resume <id>` — `16` §16.6. Reuses the prior, real `SessionState` sidecar
 * (`loadSessionState`, `@forge/engine/interaction`) so `runSessionStep` re-enters at `DIVERGE` or
 * `CONVERGE` — whichever this session's own real accumulated ideas/clusters make correct
 * (`runSessionStep`'s own `resumeFrom` doc comment has the full rule) — never at `FRAME` again: the
 * already-framed `record.question` is carried forward untouched, not re-asked.
 *
 * A real, disclosed gap, not fixed here: the original truncated record's own `status` is left exactly
 * as `truncated` forever — this function does not mark it `superseded` or link it to the new record
 * `runSessionStep` produces, and nothing stops the identical `id` from being resumed more than once
 * (sequentially or, since each call allocates its own new session id, even concurrently), each producing
 * an independent forked continuation with no trace connecting it back. `16` neither names a
 * `resumedFrom`-shaped field nor a single-resume rule, and adding one is a real `SessionRecord` schema
 * change outside this piece's own surface. See `SPEC-QUESTIONS.md`.
 *
 * @throws {ForgeError} `RUN-071` when the record's own `status` is not `truncated` — `16` §16.6's own
 * "resume" verb has no real meaning for a session that already reached a genuine `complete`/
 * `inconclusive` end.
 * @throws {ForgeError} `RUN-074` when no real, structurally-plausible `SessionState` sidecar survives
 * for `id` (a session record predating this piece, a hand-authored fixture with no sidecar of its own,
 * or a corrupted one `loadSessionState`'s own structural check rejects).
 * @throws {ForgeError} `RUN-072` (from `runSessionStep` itself) when the prior state already has a real
 * decision recorded — `16` §16.8's own "a real cost overrun caused only by the DECIDE-phase dispatch
 * itself" truncation shape, which already ran DECIDE for real and has nothing left to resume.
 */
export async function sessionResume(
  deps: SessionCommandDeps,
  id: string,
  options: ResumeSessionOptions = {},
): Promise<SessionStepResult> {
  const { record } = await sessionShow(deps, id);
  if (record.status !== 'truncated') {
    throw new ForgeError('RUN-071', { id, status: record.status });
  }
  const priorState = await loadSessionState({ projectRoot: deps.projectRoot }, record.id);
  if (priorState === undefined) {
    throw new ForgeError('RUN-074', { id });
  }

  const clock = options.clock ?? SYSTEM_CLOCK;
  const runId = `session-resume-${record.id}-${clock.now().replace(/[^0-9]/g, '')}`;
  const ctx = await buildRunEngineContext({
    paths: deps.paths,
    projectRoot: deps.projectRoot,
    config: deps.config,
    runId,
    adapter: deps.adapter,
    checksRoot: deps.checksRoot,
    clock,
  });
  const node = buildAdHocSessionStepNode(runId, record.sessionType, record.question);
  return runSessionStep(node, ctx, undefined, undefined, priorState);
}

function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'session'
  );
}

export interface ExportSessionResult {
  readonly path: string;
}

/**
 * `forge session export <id>` — `16` §16.6. Writes the real, canonical
 * `docs/forge/sessions/SESSION-{id}-{slug}.md` file `16` §16.5 names, from the real, already-persisted
 * record `sessionShow` reads back — `runSessionStep`'s own internal working file
 * (`docs/forge/sessions/{id}.md`, no slug — a real, disclosed simplification,
 * `@forge/engine/interaction/session.ts`'s own doc comment) is left exactly where it is (`forge session
 * resume` still needs to find it there), and this is a real, separate, canonically-named copy, not a
 * rename or a move.
 */
export async function sessionExport(
  deps: SessionCommandDeps,
  id: string,
): Promise<ExportSessionResult> {
  const { record, body } = await sessionShow(deps, id);
  const pathResult = renderArtifactPath('SessionRecord', {
    id: record.id,
    slug: slugify(record.title),
  });
  if (!pathResult.success) {
    // `id`/`slug` are both always non-empty by construction above — `SessionRecord`'s own path
    // template names no other variable, the identical "this would be a bug in this class" shape
    // `@forge/engine/interaction/session.ts`'s own `writeAdrBack` already uses for the same call.
    throw new RangeError(
      `renderArtifactPath('SessionRecord', ...) failed: missing ${pathResult.missingVariable}`,
    );
  }
  const relativePath = `docs/forge/${pathResult.path}`;
  const target = deps.paths.resolveWithin(relativePath);
  const text = `---\n${YAML.stringify(record)}---\n\n${body}`;
  await writeFileAtomic(target, text);
  return { path: relativePath };
}
