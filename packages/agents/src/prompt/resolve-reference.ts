/**
 * Brief and prompt content resolution — `PLAN-M13.md` P1's "a reference resolves to real text, and a
 * missing one is a real error" mandate.
 *
 * A workflow/gate step's `brief:` field and an agent's `prompt.system`/`prompt.briefs.*` fields are
 * project-relative *paths* (`briefs/write-vision.md`, `prompts/domain-modeler.system.md`), never the
 * prose block [4] of `05` §5.3 needs (`@forge/agents/context`'s `packForStep` forwards
 * `StepContext.brief` straight through as `briefText`). These functions turn one into the other, and
 * are the single definition of "a real, resolvable reference" that both validators
 * (`forge workflow validate --all`, `forge agent validate --all`) and the loader share, so a
 * validator can never call a reference fine that the loader would then refuse.
 *
 * Resolution is against the *project's* materialized `.forge/briefs/` / `.forge/prompts/`, never
 * `@forge/templates`' own package copy, so a local edit to an already-generated file (`03` §3.3: the
 * `forge:generated` hash-drift/conflict mechanism every other regenerable content kind already gets
 * via `writeGeneratedDir`) is what a real compilation sees. That drift-detected in-place edit is the
 * only "override" mechanism that exists for regenerable content today; `15` §15.2's separate
 * `overrides/prompts/<agent>.<brief>.md` overlay shape belongs to `forge compile`, whose own
 * source-gathering is a disclosed, unbuilt gap (`SPEC-QUESTIONS.md` Q197).
 *
 * A reference is untrusted content-authored input (a project's own file, an installed module, a
 * hostile overlay). It is therefore accepted only in the exact shape `briefs/<name>.md` or
 * `prompts/<name>.md` — one directory level, `.md` — and then resolved through
 * `ProjectPaths.resolveWithin` (traversal, symlink escape, `.forge/state/` deny list). Anything else
 * (`../.env`, `config.local.yaml`, `agents/x.yaml`, `briefs/../x.md`, Windows-shaped paths) is refused
 * with `CFG-053` before any read, so this loader can never turn an arbitrary project file into prompt
 * text.
 *
 * @see specs/05 §5.3
 * @see specs/03 §3.3
 * @see PLAN-M13.md P1
 */
import {
  ForgeError,
  listDirEntriesSorted,
  pathExists,
  readTextFile,
  type ProjectPaths,
} from '@forge/core';

/**
 * The two content kinds materialized under `.forge/`.
 *
 * @see specs/22 M13
 */
export type ContentReferenceKind = 'briefs' | 'prompts';

const REFERENCE_PATTERN = /^(briefs|prompts)\/([^/\\]+)\.md$/;

/**
 * Whether `ref` is exactly `briefs/<name>.md` or `prompts/<name>.md` (`<name>` a single, non-empty
 * path segment without separators or NUL). The one shape predicate the loader and both validators
 * share; it says nothing about whether the file exists.
 *
 * @see specs/05 §5.3
 */
export function isWellFormedContentReference(ref: string): boolean {
  return REFERENCE_PATTERN.test(ref) && !ref.includes('\0');
}

/**
 * Matches the header line `forge:generated` stamping (`packages/cli/src/init/generated-header.ts`)
 * writes on every regenerable file, in its two placements: line 0 (an HTML comment for plain markdown)
 * or line 1 (a YAML `#` comment inside a front-matter block). Duplicated rather than imported: `agents`
 * has no edge to `cli`, and the header format is a fixed, spec-given string (`03` §3.3).
 */
const GENERATED_HEADER_LINE =
  /^(?:# |<!-- )forge:generated v=\S+ hash=\S+ — edits will be overwritten; use overrides\/(?: -->)?\r?$/;

/** Removes the machine-facing `forge:generated` header line, leaving the authored text untouched. */
function stripGeneratedHeader(raw: string): string {
  // A leading UTF-8 BOM (some Windows editors add one on save) would otherwise hide the header line.
  const content = raw.replace(/^\uFEFF/, '');
  const lines = content.split('\n');
  for (let index = 0; index < 2 && index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== undefined && GENERATED_HEADER_LINE.test(line)) {
      return [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n');
    }
  }
  return content;
}

/**
 * Reads `ref`'s real text from `paths`' materialized `.forge/` tree, with the `forge:generated`
 * header removed: the model must receive the authored brief, not FORGE's own regeneration bookkeeping.
 *
 * @throws {ForgeError} `CFG-053` when `ref` is not a well-formed `briefs/<name>.md`/
 * `prompts/<name>.md` reference; `CFG-003` when it escapes the project (a symlink); `CFG-004` for a
 * denied location; `RUN-079` when no such file exists or its text is blank; `RUN-034` when it exists but cannot be read
 * (a directory, permissions). By the time a dispatch calls this, the validators should already have
 * reported `unknown-brief`/`unknown-prompt` for it.
 *
 * @see specs/05 §5.3
 */
export async function resolveContentReference(paths: ProjectPaths, ref: string): Promise<string> {
  if (!isWellFormedContentReference(ref)) {
    throw new ForgeError('CFG-053', { reference: ref });
  }
  const resolved = paths.resolveWithin(`.forge/${ref}`);
  if (!(await pathExists(resolved))) throw new ForgeError('RUN-079', { reference: ref });
  const text = stripGeneratedHeader(await readTextFile(resolved));
  // Blank content is "no content" here exactly as in `listResolvableContentReferences`, so the
  // validators and the loader cannot disagree: a whitespace-only brief must not reach a model.
  if (text.trim() === '') throw new ForgeError('RUN-079', { reference: ref });
  return text;
}

/**
 * Every reference of `kind` that genuinely resolves right now: a regular `.md` entry directly under
 * `.forge/<kind>/` whose text (header excluded) is non-empty and that `resolveContentReference`
 * accepts. Returned as the exact `<kind>/<name>.md` strings workflows and agents use, so a validator
 * is a plain set-membership test. `M13` acceptance requires "real, non-empty content": an empty file,
 * a directory named `x.md`, a `.txt`, or a symlink escaping the project does not count. A missing or
 * non-directory `.forge/<kind>` yields the empty set rather than throwing, so validation reports
 * findings instead of crashing.
 *
 * @see specs/22 M13
 */
export async function listResolvableContentReferences(
  paths: ProjectPaths,
  kind: ContentReferenceKind,
): Promise<ReadonlySet<string>> {
  const resolvable = new Set<string>();
  let names: readonly string[];
  try {
    const dir = paths.resolveWithin(`.forge/${kind}`);
    if (!(await pathExists(dir))) return resolvable;
    names = (await listDirEntriesSorted(dir))
      .filter((entry) => !entry.isDirectory && entry.name.endsWith('.md'))
      .map((entry) => entry.name);
  } catch {
    return resolvable;
  }
  for (const name of names) {
    const ref = `${kind}/${name}`;
    try {
      await resolveContentReference(paths, ref);
      resolvable.add(ref);
    } catch {
      // Unreadable, escaping or malformed: not a real, resolvable reference, so it is simply absent.
    }
  }
  return resolvable;
}
