/**
 * The output contract check (`PLAN-M13.md` P7): what block [1] of every agent prompt promises ("output that
 * fails validation is rejected", `05` §5.5) made true. After an `agent` step's session ends ok, each entry
 * of the step's declared `outputs` must exist at its `18` §18.7 registry location among the files the
 * session produced, and validate against its artifact schema; otherwise the step fails with a typed
 * `validation`-class failure (`source: 'output'`, `RUN-083`/`RUN-084`) instead of being reported as
 * succeeded. Before this, a 177-second real session that wrote nothing was recorded `StepSucceeded`
 * (`SPEC-QUESTIONS.md` Q208, finding 4).
 *
 * **Which tree.** The check runs in `runLaneLifecycle` after the session, the commit and claim enforcement
 * (`06` §6.4, §6.7; both run only when the adapter reports changed files, so an agent that commits its own
 * work leaves enforcement skipped, as for every step), against the lane branch's *committed* state (`git diff <base> HEAD`, content read from
 * the object database): that, and nothing else, is what a later `merge` step carries into the integration
 * branch. A file that exists only in the worktree, or that claim enforcement reverted, is not a produced
 * output, and the failure message says which of those happened.
 *
 * **"Produced by this session"** is the lane branch's diff against its base sha: a matching file that
 * already existed and was not touched does not satisfy the contract (else a step that wrote nothing would
 * pass on the strength of an earlier step's work). For a register file (`collection: true`, one file
 * holding many entries) the unit is the *entry*: an entry counts if its id is new or its content differs
 * from the base version.
 *
 * **Locating a file.** `18` §18.7's path templates, rooted at the project's configured `paths` (`specs`,
 * `kb`, `sessions`, `reports`), become globs: `{id}` matches `<PREFIX>-*`, every other placeholder `*`, so
 * a template whose id nobody can know in advance is matched over the lane diff, never skipped. The file
 * paths come from git's own diff listing and are only ever matched against that glob and read through
 * `git show`; no path an agent supplies is opened on disk.
 *
 * **Validation** reuses the validators `forge spec validate` and `forge kb lint` run: `validateArtifact`
 * (`@forge/core/artifacts`, `18` §18.6's two phases) for single-document types, and the register-file
 * schemas `parseKbTree` uses (`@forge/schemas`) for the register types. Where no register schema exists
 * (HandoffRecord, Waiver: `SPEC-QUESTIONS.md` Q23) each entry is checked against the entry schema.
 *
 * **Cardinality** (`one`, the default, or `many`): both require at least one produced file, and every
 * produced file is validated; a `one` output that finds several matching files (a step that also updated
 * an older artifact) is not an error.
 *
 * **Subtype** narrows: a SessionRecord's `sessionType` must be the subtype's canonical form (the workflow
 * DSL's `retrospective` is the `retro` session type, `16` §16.2); for every other type at least one
 * produced file (or produced register entry) must carry the subtype as a hyphenated word in its `step` value or a
 * `delivered` item (the two conventions the shipped briefs use, since the entry has no `subtype` key; five
 * briefs record a `step` that does not contain the subtype word and so fail this rule, `SPEC-QUESTIONS.md`
 * Q209).
 *
 * @see specs/05 §5.5
 * @see specs/06 §6.8
 * @see specs/18 §18.6, §18.7
 * @see PLAN-M13.md P7
 * @see SPEC-QUESTIONS.md Q208
 */
import { posix } from 'node:path';

import { ArtifactDocument, parseFrontMatterYaml, validateArtifact } from '@forge/core/artifacts';
import { ForgeError } from '@forge/core/errors';
import {
  assumptionsFileSchema,
  baseFrontMatterShape,
  definitionForType,
  artifactTypeById,
  diagramSchema,
  environmentsFileSchema,
  handoffRecordSchema,
  interfaceContractSchema,
  openQuestionsFileSchema,
  risksFileSchema,
  waiverSchema,
  type ArtifactTypeDefinition,
  type ArtifactTypeId,
} from '@forge/schemas';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { escape as escapeGlob, minimatch } from 'minimatch';
import type { z } from 'zod';

import type { StepNode } from '../plan/index.ts';
import type {
  DocRoots,
  ExecuteStepContext,
  LaneHandle,
  StepFailureInfo,
  VcsFacade,
} from './types.ts';

/** The configured root a `18` §18.7 template's first segment names (`specs`, `kb`, `sessions`, `reports`). */
function sectionRoot(segment: string, roots: DocRoots): string | undefined {
  switch (segment) {
    case 'specs':
      return roots.specs;
    case 'kb':
      return roots.kb;
    case 'sessions':
      return roots.sessions;
    case 'reports':
      return roots.reports;
    default:
      return undefined;
  }
}

/** A configured root as a plain repo-relative POSIX prefix: `./docs/specs/` becomes `docs/specs` and `.`
 * becomes empty. Paths from git's listing never start with `./`, so an unnormalised root would match
 * nothing and fail every output of the project. */
function normalizeRoot(root: string): string {
  const normalized = posix.normalize(root.replace(/\\/g, '/')).replace(/\/+$/, '');
  return normalized === '.' ? '' : normalized;
}

/** How a glob is matched: `!`/`#` prefixes in a configured root are literal, never negation or a comment. */
const MATCH_OPTIONS = { dot: true, nonegate: true, nocomment: true } as const;

/**
 * `18` §18.7's path template for `type`, as a glob under the project's configured roots. The first segment
 * (`specs`, `kb`, `sessions`, `reports`) is replaced by that root; a template that opens with a placeholder
 * (`Diagram`'s `{section}/views/...`) lives in the knowledge body. Roots are escaped, so a root with glob
 * characters matches literally instead of widening the match.
 */
export function outputGlob(type: ArtifactTypeId, roots: DocRoots): string {
  const definition = definitionForType(type);
  const [first = '', ...rest] = definition.pathTemplate.split('/');
  const named = sectionRoot(first, roots);
  const root = normalizeRoot(named ?? roots.kb);
  const tail = (named === undefined ? [first, ...rest] : rest)
    .join('/')
    .replace('{id}-{slug}', `${definition.idPrefix}-*`)
    .replace('{id}', `${definition.idPrefix}-*`)
    .replace(/\{\w+\}/g, '*');
  return root === '' ? tail : `${escapeGlob(root, { magicalBraces: true })}/${tail}`;
}

/**
 * Whether any of `globs` (an agent's `parallel_safety.file_ownership`, say) covers a path an output of
 * `type` could be written to: the registry glob read with each `*` as a concrete `x`. A definition-level
 * question, asked by the repository's known-gap inventory (`test/output-contract-known-gaps.test.ts`); the
 * check itself never consults an agent's ownership.
 */
export function outputPathCoveredBy(
  type: ArtifactTypeId,
  roots: DocRoots,
  globs: readonly string[],
): boolean {
  const sample = outputGlob(type, roots).replace(/\\/g, '').replace(/\*/g, 'x');
  return globs.some((glob) => minimatch(sample, glob, MATCH_OPTIONS));
}

/** The DSL's `subtype` spelled as the artifact's own field value, where the two differ. */
const SUBTYPE_ALIASES: Readonly<Partial<Record<ArtifactTypeId, Readonly<Record<string, string>>>>> =
  {
    SessionRecord: { retrospective: 'retro' },
  };

/** Register types whose file-level schema `@forge/schemas` defines (the ones `parseKbTree` validates). */
const REGISTER_SCHEMAS: Readonly<
  Partial<Record<ArtifactTypeId, { readonly schema: z.ZodTypeAny; readonly key: string }>>
> = {
  Risk: { schema: risksFileSchema, key: 'risks' },
  Assumption: { schema: assumptionsFileSchema, key: 'assumptions' },
  OpenQuestion: { schema: openQuestionsFileSchema, key: 'open_questions' },
  Environment: { schema: environmentsFileSchema, key: 'environments' },
};

/** Register types with only an entry schema and no specified file wrapper (`SPEC-QUESTIONS.md` Q23). */
const ENTRY_ONLY_SCHEMAS: Readonly<Partial<Record<ArtifactTypeId, z.ZodTypeAny>>> = {
  HandoffRecord: handoffRecordSchema,
  Waiver: waiverSchema,
};

/** The UTF-8 BOM, spelled by code point rather than as a literal (invisible) source character. */
const BOM = String.fromCharCode(0xfeff);

const BASE_KEYS: readonly string[] = Object.keys(baseFrontMatterShape.shape);

export interface OutputCheckInput {
  readonly node: Pick<StepNode, 'id' | 'agent' | 'outputs'>;
  readonly vcs: Pick<VcsFacade, 'changedFiles' | 'readAtRevision'>;
  readonly lane: LaneHandle;
  /** The sha the lane branched from: what "produced by this session" is measured against. */
  readonly baseSha: string;
  readonly docRoots: DocRoots;
  /** Paths claim enforcement reverted after the session: named in the failure when one of them was the
   * missing output. */
  readonly claimReverted: readonly string[];
  /** The agent's own grant forbids writing files: the cause to name when an output is missing. */
  readonly writeForbidden: boolean;
}

interface Problem {
  readonly kind: 'missing' | 'invalid' | 'subtype';
  readonly text: string;
}

interface ValidFile {
  readonly path: string;
  /** The text a subtype is searched in: the whole file, or for a register only the entries produced. */
  readonly producedText: string;
  readonly sessionType: unknown;
}

const MAX_LISTED_FILES = 5;
/** Bounds on the failure message, which is also written to the event log: a step that produced hundreds of
 * invalid files must not produce a megabyte-long failure. */
const MAX_PROBLEMS = 5;
const MAX_PROBLEM_CHARS = 700;

/** Agent-controlled text (file names, entry ids, YAML error excerpts) reaches the terminal and the event
 * log through the message: control characters (escape sequences, newlines) are replaced. */
// eslint-disable-next-line no-control-regex -- the point is to match control characters
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

function clip(text: string): string {
  const clean = text.replace(CONTROL_CHARS, ' ');
  return clean.length > MAX_PROBLEM_CHARS
    ? `${clean.slice(0, MAX_PROBLEM_CHARS)}... (truncated)`
    : clean;
}

function describeOutput(output: StepNode['outputs'][number]): string {
  const parts = [
    output.subtype === undefined ? undefined : `subtype ${output.subtype}`,
    output.cardinality === 'many' ? 'many' : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? output.type : `${output.type} (${parts.join(', ')})`;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function issueText(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/** Key-order-independent serialisation, so re-ordering an entry's keys is not a change. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`)
      .join(',')}}`;
  }
  // Front matter parsed from YAML holds only JSON-representable scalars here.
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The register entries a front matter holds: the array under `key`, or (no wrapper schema) every array of
 * mappings at the top level plus the front matter itself when it is one entry. `changelog` is metadata. */
function registerEntries(frontMatter: Record<string, unknown>, key: string | undefined): unknown[] {
  if (key !== undefined) {
    const list = frontMatter[key];
    return Array.isArray(list) ? list : [];
  }
  // A front matter that is itself one entry (the `HandoffRecord` template's "copy this block" form): its
  // own array fields (`assumptions`, ...) are entry data, not further entries.
  if (typeof frontMatter['id'] === 'string') return [frontMatter];
  const entries: unknown[] = [];
  for (const [name, value] of Object.entries(frontMatter)) {
    if (name === 'changelog' || !Array.isArray(value)) continue;
    entries.push(...value.filter(isRecord));
  }
  return entries;
}

const SUBTYPE_ITEM = /^\s*subtype\s*[:=]\s*(.+)$/i;

/** Where a register entry records its subtype: its `step` value, or a `delivered` item written
 * `subtype: <name>` (the two conventions the shipped briefs use, since a HandoffRecord entry has no `subtype`
 * key). Nothing else in an entry (`from`, constraint prose, other `delivered` prose) can satisfy a subtype. */
function subtypeText(entries: readonly unknown[]): string {
  return entries
    .flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const delivered: unknown[] = Array.isArray(entry['delivered']) ? entry['delivered'] : [];
      const marked = delivered.flatMap((item) =>
        typeof item === 'string' ? [SUBTYPE_ITEM.exec(item)?.[1]] : [],
      );
      return [entry['step'], ...marked].filter((part) => typeof part === 'string');
    })
    .join('\n');
}

function entryId(entry: unknown): string | undefined {
  return isRecord(entry) && typeof entry['id'] === 'string' ? entry['id'] : undefined;
}

/** `ArtifactDocument.parse` has already established the front matter is a YAML mapping (`CFG-007`
 * otherwise), which is what makes this cast sound. */
function frontMatterOf(doc: ArtifactDocument): Record<string, unknown> {
  return doc.frontMatter as Record<string, unknown>;
}

function documentProblems(
  definition: ArtifactTypeDefinition,
  path: string,
  text: string,
): { readonly problems: readonly string[]; readonly sessionType?: unknown } {
  let doc: ArtifactDocument;
  try {
    doc = ArtifactDocument.parse(text, path);
  } catch (cause) {
    return { problems: [errorText(cause)] };
  }
  const frontMatter = frontMatterOf(doc);
  if (frontMatter['type'] !== definition.id) {
    return {
      problems: [
        `its front matter type is ${JSON.stringify(frontMatter['type'])}, not "${definition.id}"`,
      ],
    };
  }
  const outcome = validateArtifact(doc);
  return outcome.valid
    ? { problems: [], sessionType: frontMatter['sessionType'] }
    : { problems: outcome.errors.map((error) => error.message) };
}

function interfaceContractProblems(path: string, text: string): readonly string[] {
  if (text.startsWith(BOM) ? text.slice(BOM.length).startsWith('---') : text.startsWith('---')) {
    // Front matter form, unless the `---` is only YAML's document-start marker of a plain contract file
    // (no closing `---` line): that is parsed as plain YAML below.
    try {
      ArtifactDocument.parse(text, path);
      return documentProblems(definitionForType('InterfaceContract'), path, text).problems;
    } catch (cause) {
      if (!(cause instanceof ForgeError) || cause.code !== 'CFG-006') {
        return [errorText(cause)];
      }
    }
  }
  let data: Record<string, unknown>;
  try {
    data = parseFrontMatterYaml(text, path);
  } catch (cause) {
    return [errorText(cause)];
  }
  // A contract file is the machine-readable contract (OpenAPI, JSON Schema, ...) with the artifact's front
  // matter keys at its top level (`freeze-contracts` brief): only those keys are the artifact's own.
  const own = Object.fromEntries(Object.entries(data).filter(([key]) => BASE_KEYS.includes(key)));
  const result = interfaceContractSchema.safeParse(own);
  return result.success ? [] : [issueText(result.error)];
}

/** Validates one produced file of `definition`'s type; `base` is its content at the base revision. */
async function validateFile(
  definition: ArtifactTypeDefinition,
  path: string,
  text: string,
  readBase: () => Promise<string | undefined>,
  readSidecar: () => Promise<string | undefined>,
): Promise<{ readonly problems: readonly string[]; readonly valid?: ValidFile }> {
  const type = definition.id;
  const register = REGISTER_SCHEMAS[type];
  const entrySchema = ENTRY_ONLY_SCHEMAS[type];

  if (register !== undefined || entrySchema !== undefined) {
    let frontMatter: Record<string, unknown>;
    try {
      frontMatter = frontMatterOf(ArtifactDocument.parse(text, path));
    } catch (cause) {
      return { problems: [errorText(cause)] };
    }
    if (register !== undefined) {
      const parsed = register.schema.safeParse(frontMatter);
      if (!parsed.success) return { problems: [issueText(parsed.error)] };
    } else if (entrySchema !== undefined) {
      if ('type' in frontMatter && frontMatter['type'] !== type) {
        return {
          problems: [
            `its front matter type is ${JSON.stringify(frontMatter['type'])}, not "${type}"`,
          ],
        };
      }
      const found = registerEntries(frontMatter, undefined);
      if (found.length === 0) {
        return {
          problems: [`it holds no ${type} entry (a mapping with an "id") in its front matter`],
        };
      }
      const bad = found.flatMap((entry, index) => {
        const parsed = entrySchema.safeParse(entry);
        return parsed.success
          ? []
          : [`entry ${entryId(entry) ?? `#${String(index + 1)}`}: ${issueText(parsed.error)}`];
      });
      if (bad.length > 0) return { problems: bad };
    }
    const entries = registerEntries(frontMatter, register?.key);
    const baseText = await readBase();
    const before = new Map<string, string>();
    if (baseText !== undefined) {
      try {
        const baseFrontMatter = frontMatterOf(ArtifactDocument.parse(baseText, path));
        for (const entry of registerEntries(baseFrontMatter, register?.key)) {
          const id = entryId(entry);
          if (id !== undefined) before.set(id, canonical(entry));
        }
      } catch {
        // An unparseable base version contributes no entries, so every entry now present counts as produced.
      }
    }
    const produced = entries.filter(
      (entry) => before.get(entryId(entry) ?? '') !== canonical(entry),
    );
    if (produced.length === 0) {
      return {
        problems: [
          `the session changed the file but added or modified no ${type} entry (entries identical to the base version do not count)`,
        ],
      };
    }
    return {
      problems: [],
      valid: { path, producedText: subtypeText(produced), sessionType: undefined },
    };
  }

  if (type === 'InterfaceContract') {
    const problems = interfaceContractProblems(path, text);
    return problems.length > 0
      ? { problems }
      : { problems: [], valid: { path, producedText: text, sessionType: undefined } };
  }

  if (type === 'Diagram') {
    if (text.trim() === '') return { problems: ['the diagram source is empty'] };
    const sidecar = await readSidecar();
    if (sidecar === undefined) {
      return {
        problems: [
          `it has no sidecar ${path}.yaml (added or changed by the session) describing the diagram (08 §8.11)`,
        ],
      };
    }
    try {
      const result = diagramSchema.safeParse(parseFrontMatterYaml(sidecar, `${path}.yaml`));
      if (!result.success)
        return { problems: [`sidecar ${path}.yaml: ${issueText(result.error)}`] };
    } catch (cause) {
      return { problems: [`sidecar ${path}.yaml: ${errorText(cause)}`] };
    }
    return { problems: [], valid: { path, producedText: text, sessionType: undefined } };
  }

  const checked = documentProblems(definition, path, text);
  return checked.problems.length > 0
    ? { problems: checked.problems }
    : { problems: [], valid: { path, producedText: text, sessionType: checked.sessionType } };
}

/** The artifact's own field value for a DSL subtype (`retrospective` -> `retro`); own keys only. */
function canonicalSubtype(type: ArtifactTypeId, subtype: string): string {
  const aliases = SUBTYPE_ALIASES[type];
  return aliases !== undefined && Object.hasOwn(aliases, subtype)
    ? (aliases[subtype] ?? subtype)
    : subtype;
}

/** Trims leading and trailing dashes in linear time (a `replace(/^-+|-+$/g, '')` backtracks quadratically
 * on a long run of dashes in the middle of agent-controlled text). */
function trimDashes(segment: string): string {
  let start = 0;
  let end = segment.length;
  while (start < end && segment.charAt(start) === '-') start += 1;
  while (end > start && segment.charAt(end - 1) === '-') end -= 1;
  return segment.slice(start, end);
}

/** Whether `text` names `subtype` as a hyphenated word: some segment (split on whitespace, arrows and
 * punctuation) is the subtype, or ends in `-<subtype>` (a step named `write-test-plan` for subtype
 * `test-plan`). A longer hyphenated word that merely contains it (`not-a-test-plan-at-all`) is a different
 * segment and does not count; free prose that spells the word on its own still would, which is why a
 * register entry is only searched in its `step` and its `subtype:` items (`subtypeText`). */
function carriesSubtype(text: string, subtype: string): boolean {
  const wanted = subtype.toLowerCase();
  return text
    .toLowerCase()
    .split(/[\s\u2192>,;:()[\]{}"']+/)
    .map(trimDashes)
    .some((segment) => segment === wanted || segment.endsWith(`-${wanted}`));
}

function subtypeSatisfied(
  type: ArtifactTypeId,
  subtype: string,
  files: readonly ValidFile[],
): boolean {
  if (type === 'SessionRecord') {
    const wanted = canonicalSubtype(type, subtype);
    return files.some((file) => file.sessionType === wanted);
  }
  return files.some((file) => carriesSubtype(file.producedText, subtype));
}

function listFiles(files: readonly string[]): string {
  const shown = files.slice(0, MAX_LISTED_FILES).join(', ');
  return files.length > MAX_LISTED_FILES
    ? `${shown}, and ${String(files.length - MAX_LISTED_FILES)} more`
    : shown;
}

async function checkOne(
  output: StepNode['outputs'][number],
  input: OutputCheckInput,
  files: { readonly committed: readonly string[]; readonly uncommitted: readonly string[] },
): Promise<readonly Problem[]> {
  const label = describeOutput(output);
  const definition = artifactTypeById(output.type);
  if (definition === undefined) {
    return [
      {
        kind: 'invalid',
        text: `${label}: "${output.type}" is not a registered artifact type (18 §18.7), so no file can satisfy it`,
      },
    ];
  }
  const glob = outputGlob(definition.id, input.docRoots);
  const matches = (file: string): boolean => minimatch(file, glob, MATCH_OPTIONS);
  const { lane, baseSha, vcs } = input;

  const present: { readonly path: string; readonly text: string }[] = [];
  const unreadable: string[] = [];
  for (const path of files.committed.filter(matches)) {
    const text = await vcs.readAtRevision(lane, 'HEAD', path);
    if (text !== undefined) present.push({ path, text });
    else unreadable.push(path);
  }

  if (present.length === 0) {
    const notes: string[] = [];
    if (unreadable.length > 0) {
      notes.push(
        `${listFiles(unreadable)} appear in the lane's diff but hold no regular file at its head (deleted, a symlink, or over the size limit)`,
      );
    }
    const stranded = files.uncommitted.filter(matches);
    if (stranded.length > 0) {
      notes.push(
        `${listFiles(stranded)} exist only in the lane worktree and were not committed to the lane branch, so they would never merge`,
      );
    }
    const reverted = input.claimReverted.filter(matches);
    if (reverted.length > 0) {
      notes.push(
        `the session wrote ${listFiles(reverted)} but claim enforcement reverted it: the step's \`produces\` claim does not cover that path, so add the path to \`produces\``,
      );
    }
    notes.push(
      files.committed.length === 0
        ? 'the session committed no file'
        : `the files the session did commit are: ${listFiles(files.committed)}`,
    );
    return [
      {
        kind: 'missing',
        text: `${label}: no file matching ${glob} was added or changed by the session (${notes.join('; ')})`,
      },
    ];
  }

  const problems: Problem[] = [];
  const valid: ValidFile[] = [];
  for (const file of present) {
    const result = await validateFile(
      definition,
      file.path,
      file.text,
      () => vcs.readAtRevision(lane, baseSha, file.path),
      () =>
        files.committed.includes(`${file.path}.yaml`)
          ? vcs.readAtRevision(lane, 'HEAD', `${file.path}.yaml`)
          : Promise.resolve(undefined),
    );
    if (result.valid !== undefined) valid.push(result.valid);
    else {
      problems.push({
        kind: 'invalid',
        text: `${label}: ${file.path} failed validation: ${result.problems.join('; ')}`,
      });
    }
  }
  if (problems.length > 0) return problems;

  if (output.subtype !== undefined && !subtypeSatisfied(definition.id, output.subtype, valid)) {
    const how =
      definition.id === 'SessionRecord'
        ? `no produced file has sessionType "${canonicalSubtype('SessionRecord', output.subtype)}"`
        : `none of ${listFiles(valid.map((file) => file.path))} carries "${output.subtype}" (a register entry must carry it in its \`step\` or a \`delivered\` item; a document anywhere in its text)`;
    return [
      {
        kind: 'subtype',
        text: `${label}: no produced ${definition.id} identifies itself as subtype "${output.subtype}": ${how}`,
      },
    ];
  }
  return [];
}

/**
 * Checks every declared output of `input.node` against the lane; `undefined` means the contract holds (or
 * nothing is declared). Failure is a `StepFailureInfo` with `source: 'output'`, `RUN-083` (or `RUN-084`
 * when an output is missing and the agent's own grant forbids writing), whose message names the step,
 * every unmet output, the expected glob and the check that failed, followed by the remedy.
 */
export async function checkDeclaredOutputs(
  input: OutputCheckInput,
): Promise<StepFailureInfo | undefined> {
  if (input.node.outputs.length === 0) return undefined;
  const files = await input.vcs.changedFiles(input.lane, input.baseSha);
  const problems: Problem[] = [];
  for (const output of input.node.outputs) {
    problems.push(...(await checkOne(output, input, files)));
  }
  if (problems.length === 0) return undefined;

  const shown = problems.slice(0, MAX_PROBLEMS).map((problem) => clip(problem.text));
  const detail = [
    ...shown,
    ...(problems.length > MAX_PROBLEMS
      ? [`and ${String(problems.length - MAX_PROBLEMS)} more problem(s)`]
      : []),
  ].join('; ');
  const grantIsCause =
    input.writeForbidden && problems.some((problem) => problem.kind === 'missing');
  const error =
    grantIsCause && input.node.agent !== undefined
      ? new ForgeError('RUN-084', {
          stepId: input.node.id,
          agentId: String(input.node.agent),
          detail,
        })
      : new ForgeError('RUN-083', { stepId: input.node.id, detail });
  return {
    source: 'output',
    code: error.code,
    message: `${error.message} -- Remedy: ${error.remedy}`,
    cause: error,
  };
}

/** Whether the step's agent is barred from writing files by its own definition (`tools.write: false`). That
 * is the grant the session ran with: `resolveStepToolGrant` never lets a `security.toolCeilingEscalations`
 * entry change `tools.write` (escalations only widen the ceiling an overlay may request), so none is
 * consulted. Unknown (the agent cannot be loaded) reads as not barred: the session already ran with it, so
 * a load failure here is not evidence about its grant. */
async function agentCannotWrite(node: StepNode, ctx: ExecuteStepContext): Promise<boolean> {
  if (node.agent === undefined) return false;
  try {
    const agent = await ctx.assembly.loadAgent(String(node.agent));
    return !agent.tools.write;
  } catch {
    return false;
  }
}

/**
 * `runLaneLifecycle`'s hook: the check for an `agent` step that declared outputs, against `lane` after
 * commit and claim enforcement. `claimReverted` is what enforcement reverted. Steps of every other kind
 * pass through (`command` steps produce files through shell commands, `session` steps through
 * `SessionRecord` assembly; neither is an agent session with a declared output contract).
 */
export async function verifyDeclaredOutputs(
  node: StepNode,
  ctx: ExecuteStepContext,
  lane: LaneHandle,
  baseSha: string,
  claimReverted: readonly string[],
): Promise<StepFailureInfo | undefined> {
  if (node.kind !== 'agent' || node.outputs.length === 0) return undefined;
  return checkDeclaredOutputs({
    node,
    vcs: ctx.vcs,
    lane,
    baseSha,
    docRoots: ctx.docRoots ?? DEFAULT_CONFIG.paths,
    claimReverted,
    writeForbidden: await agentCannotWrite(node, ctx),
  });
}
