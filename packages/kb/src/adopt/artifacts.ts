/**
 * `appendRiskEntry`/`appendOpenQuestionEntry` — the real `RISK-###`/`OQ-###` artifact-creation paths
 * `PLAN-M10.md` P19's GAP ANALYSIS and human-confirmation flow both need, reusing the identical
 * read-modify-write-against-`risksFileSchema`/`openQuestionsFileSchema` discipline
 * `@forge/engine/interaction/session.ts`'s own `writeRiskBack` already established for the identical
 * "one shared collection file, no per-target-path isolation" write shape (`16` §16.5's own worked "Add
 * RISK: quick path bypasses tax validation -- RISK-007" example). Recomposed here rather than imported
 * from `@forge/engine`, for the same reason `reconstruction.ts` already recomposes `writeAdrBack`'s own
 * primitives instead of importing it: `@forge/kb` has no boundary-graph edge to `@forge/engine`
 * (`tools/eslint-plugin-forge-boundaries/src/graph.mjs`'s own `kb: ['core', 'schemas', 'diagrams']`).
 *
 * Every write for a given collection file (`kb/risks.md`, `kb/open-questions.md`) is serialised through
 * a per-project, per-path FIFO queue — the identical concurrency defect
 * `writeRiskBack`'s own doc comment names for exactly this shape (two concurrent writers reading the
 * same pre-write snapshot and each independently appending, the second silently discarding the first's
 * entry) applies here without a queue.
 *
 * **Disclosed residual risk** (a fresh critic round, `SPEC-QUESTIONS.md`): idempotency here is
 * necessarily *text*-based — `riskSchema`/`openQuestionSchema` are both `.strict()` with no field
 * this piece could use to carry a caller-side identity key that survives a round-trip through the
 * file — so two **genuinely different** findings whose rendered `statement`/`question` text happens
 * to be byte-identical are treated as the same entry and only the first is ever written. Both real
 * call sites (`gap-analysis.ts`'s `writeGapArtifacts`, `confirmation.ts`'s `runConfirmationFlow`)
 * mitigate this by embedding each finding/claim's own evidence into the stored text before calling
 * these functions — evidence (file paths, line numbers) is realistically always distinct even when
 * two findings share boilerplate wording — but this does not make a collision structurally
 * impossible, only realistically unlikely. A future piece with a genuine need for guaranteed
 * uniqueness would need a schema change to carry a stable id these functions do not have to invent.
 *
 * @see specs/17 §17.2 phase 7
 * @see specs/17 §17.3
 * @see PLAN-M10.md P19
 */
import type { Clock } from '@forge/core';
import {
  pathExists,
  readTextFile,
  writeFileAtomic,
  type AbsolutePath,
  type ProjectPaths,
} from '@forge/core/fs';
import {
  definitionForType,
  openQuestionsFileSchema,
  risksFileSchema,
  type OpenQuestionsFile,
  type RisksFile,
} from '@forge/schemas';
import * as YAML from 'yaml';

const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  queues.set(
    key,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

async function readFrontMatter(target: AbsolutePath): Promise<Record<string, unknown> | undefined> {
  if (!(await pathExists(target))) return undefined;
  const text = await readTextFile(target);
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match?.[1] === undefined) return undefined;
  const parsed: unknown = YAML.parse(match[1]);
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)
    : undefined;
}

/**
 * The next free id for `type` inside *this collection file's own array* — deliberately **not**
 * `IdAllocator.allocate(type)`. `@forge/core/ids/scan.ts`'s own module doc comment states directly
 * ("`SPEC-QUESTIONS.md` Q29 for why this does not also parse a `collection: true` type's shared
 * register file for more than one entry") that `IdAllocator`'s real project-wide scan only ever reads
 * a document's own top-level `id` field — and a collection file's own top-level front matter has none
 * at all (`collectionFileBase = baseFrontMatterShape.omit({ id: true })`, `@forge/schemas/artifacts/
 * collection-file.ts`), by design, since it names many ids, not one. A fresh critic round found this
 * the hard way: two calls to `IdAllocator.allocate('Risk')` against a project whose *only* Risk ids
 * live inside `kb/risks.md`'s own `risks` array both returned `RISK-001`, since the allocator's scan
 * never sees inside that array at all — silently colliding two genuinely distinct risks onto one id,
 * confirmed with a real repro before this fix (the identical, previously-undetected shape
 * `@forge/engine/interaction/session.ts`'s own `writeRiskBack` also has, out of this piece's scope to
 * fix there). This scans `rows`' own already-in-memory `id` fields directly instead — the one place
 * that already has the real, current array — and never touches `IdAllocator` for `Risk`/
 * `OpenQuestion` ids at all.
 */
function nextCollectionId(
  rows: readonly unknown[],
  idField: 'id',
  type: 'Risk' | 'OpenQuestion',
): string {
  const definition = definitionForType(type);
  const pattern = new RegExp(
    `^${definition.idPrefix}-(\\d{${String(definition.idWidth)}})(-\\d+)?$`,
  );
  let max = 0;
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const id = (row as Record<string, unknown>)[idField];
    if (typeof id !== 'string') continue;
    const match = pattern.exec(id);
    if (match?.[1] === undefined) continue;
    max = Math.max(max, Number(match[1]));
  }
  return `${definition.idPrefix}-${String(max + 1).padStart(definition.idWidth, '0')}`;
}

export const RISKS_RELATIVE_PATH = 'kb/risks.md';
export const OPEN_QUESTIONS_RELATIVE_PATH = 'kb/open-questions.md';

interface EntryDeps {
  readonly paths: ProjectPaths;
  readonly clock: Clock;
  readonly kbRoot: string;
}

/** Appends one new `RISK-###` to `kb/risks.md`'s register, creating it if absent. Returns the newly
 * allocated id. */
export async function appendRiskEntry(
  deps: EntryDeps,
  owner: string,
  entry: {
    readonly statement: string;
    readonly likelihood: string;
    readonly impact: string;
    readonly mitigation: string;
  },
): Promise<string> {
  const relativePath = `${deps.kbRoot}/${RISKS_RELATIVE_PATH.replace(/^kb\//, '')}`;
  return enqueue(`risk:${deps.paths.resolveWithin('.')}`, async () => {
    const target = deps.paths.resolveWithin(relativePath);
    const existing = await readFrontMatter(target);
    const priorRisks: readonly unknown[] = Array.isArray(existing?.['risks'])
      ? existing['risks']
      : [];

    // Idempotent by `statement`: a caller re-running GAP ANALYSIS against the same finding set
    // (e.g. `forge adopt --incremental`, or a plain retry after a crash) must not append a fresh
    // duplicate risk every time — the identical "deterministic identity, never re-derive" discipline
    // `reconstruction.ts`'s own `writeKbEntryIdempotent` already establishes for KB entries.
    const duplicate = priorRisks.find(
      (row): row is { readonly id: string } =>
        typeof row === 'object' &&
        row !== null &&
        'statement' in row &&
        // Sound: `row` is freshly parsed from arbitrary on-disk YAML (`readFrontMatter`), so nothing
        // upstream has narrowed its shape yet — these two casts only assert "read this property if it
        // exists," never that it has the right type; the `typeof ... === 'string'` checks below (and,
        // for the row as a whole, `risksFileSchema.safeParse` before it is ever trusted for a write)
        // are what actually verify it.
        (row as { statement?: unknown }).statement === entry.statement &&
        typeof (row as { id?: unknown }).id === 'string',
    );
    if (duplicate !== undefined) return duplicate.id;

    const id = nextCollectionId(priorRisks, 'id', 'Risk');
    const today = deps.clock.now().slice(0, 10);
    const priorChangelog: readonly unknown[] = Array.isArray(existing?.['changelog'])
      ? existing['changelog']
      : [];
    const priorRevision = typeof existing?.['revision'] === 'number' ? existing['revision'] : 0;
    const candidate = {
      type: 'Risk' as const,
      schemaVersion: 1,
      title: 'Risk register',
      status: 'active',
      // Sound only in that a non-string value here becomes `undefined ?? today` = `today` (never a
      // wrong-typed field reaching `risksFileSchema`) -- `existing` is unvalidated on-disk YAML, so
      // this cast is a hint for the `??` fallback, not a claim the field is actually a string;
      // `risksFileSchema.safeParse` below is what actually enforces the real type.
      created: (existing?.['created'] as string | undefined) ?? today,
      updated: today,
      revision: priorRevision + 1,
      author: owner,
      changelog: [
        ...priorChangelog,
        { revision: priorRevision + 1, date: today, by: owner, summary: `Adopted gap: ${id}.` },
      ],
      risks: [...priorRisks, { id, owner, ...entry }],
    };
    const parsed = risksFileSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new RangeError(
        `risksFileSchema rejected a gap-analysis write: ${parsed.error.message}`,
      );
    }
    await writeFileAtomic(target, `---\n${YAML.stringify(parsed.data satisfies RisksFile)}---\n`);
    return id;
  });
}

/** Appends one new `OQ-###` to `kb/open-questions.md`'s register, creating it if absent. Returns the
 * newly allocated id. */
export async function appendOpenQuestionEntry(
  deps: EntryDeps,
  owner: string,
  question: string,
): Promise<string> {
  const relativePath = `${deps.kbRoot}/${OPEN_QUESTIONS_RELATIVE_PATH.replace(/^kb\//, '')}`;
  return enqueue(`oq:${deps.paths.resolveWithin('.')}`, async () => {
    const target = deps.paths.resolveWithin(relativePath);
    const existing = await readFrontMatter(target);
    const priorQuestions: readonly unknown[] = Array.isArray(existing?.['open_questions'])
      ? existing['open_questions']
      : [];

    // Idempotent by `question` text — see `appendRiskEntry`'s own identical doc comment.
    const duplicate = priorQuestions.find(
      (row): row is { readonly id: string } =>
        typeof row === 'object' &&
        row !== null &&
        'question' in row &&
        // Sound for the identical reason `appendRiskEntry`'s own matching cast is: a read-only probe
        // of unvalidated on-disk YAML, verified by the `typeof` check immediately after and by
        // `openQuestionsFileSchema.safeParse` before any write.
        (row as { question?: unknown }).question === question &&
        typeof (row as { id?: unknown }).id === 'string',
    );
    if (duplicate !== undefined) return duplicate.id;

    const id = nextCollectionId(priorQuestions, 'id', 'OpenQuestion');
    const today = deps.clock.now().slice(0, 10);
    const priorChangelog: readonly unknown[] = Array.isArray(existing?.['changelog'])
      ? existing['changelog']
      : [];
    const priorRevision = typeof existing?.['revision'] === 'number' ? existing['revision'] : 0;
    const candidate = {
      type: 'OpenQuestion' as const,
      schemaVersion: 1,
      title: 'Open questions',
      status: 'active',
      // Sound only in the same limited sense `appendRiskEntry`'s own identical cast is -- see its
      // doc comment.
      created: (existing?.['created'] as string | undefined) ?? today,
      updated: today,
      revision: priorRevision + 1,
      author: owner,
      changelog: [
        ...priorChangelog,
        {
          revision: priorRevision + 1,
          date: today,
          by: owner,
          summary: `Adopted open question: ${id}.`,
        },
      ],
      open_questions: [...priorQuestions, { id, question, status: 'open' as const }],
    };
    const parsed = openQuestionsFileSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new RangeError(
        `openQuestionsFileSchema rejected a gap-analysis/confirmation write: ${parsed.error.message}`,
      );
    }
    await writeFileAtomic(
      target,
      `---\n${YAML.stringify(parsed.data satisfies OpenQuestionsFile)}---\n`,
    );
    return id;
  });
}
