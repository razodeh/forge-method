/**
 * Fixture builders for `scripts/bench.mjs`'s five `21` §21.5 benchmarks.
 *
 * Every fixture here is deterministic in what it *measures* (a fixed entry/entity/artifact count,
 * fixed ids, no randomness) even though the real wall-clock time later spent measuring it will vary
 * run to run in a shared sandbox — see `bench-ratchet.mjs`'s own doc comment for why that is an
 * accepted, disclosed property of wall-clock benchmarking rather than something these fixtures try to
 * paper over.
 *
 * `buildSyntheticKbTree` follows the identical "clone a real template entry N times with distinct
 * ids" technique `packages/kb/test/pack/build-context-pack.test.ts`'s own informational, non-gating
 * 500-entry benchmark already established — reused here, not reinvented, per `PLAN-M12.md` P5's own
 * Surface text.
 *
 * @see specs/21 §21.5
 * @see packages/kb/test/pack/build-context-pack.test.ts
 * @see PLAN-M12.md P5
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A real `.forge/state/` project directory with one run's event log holding exactly `artifactCount`
 * `ArtifactCreated` events (plus one leading `RunStarted`) — the real, on-disk shape `@forge/telemetry
 * readEvents`/`@forge/engine/resume reconstructRunState` (the same replay machinery `forge status`
 * itself runs on) actually reads, not a synthetic in-memory stand-in. Deliberately hand-written
 * ndjson lines, not `@forge/telemetry appendEvent`: `appendEvent` fsyncs every line individually
 * (real, deliberate per-event durability cost `18` §18.10 requires at run time), which would make
 * fixture construction itself the dominant cost of the "first frame" benchmark rather than the real
 * `forge status` read path this benchmark exists to measure.
 *
 * `projectRoot` is a caller-supplied, already-created empty directory rather than something this
 * function allocates itself (e.g. via `node:os tmpdir()`): `QUALITY-BAR.md` R10 confines host-fact
 * reads (a temp directory's real location varies by machine) to a real composition root, and this
 * module is decision/fixture-shape logic, not that root — `scripts/bench.mjs` (the one file in this
 * pairing R10 exempts, for the identical "this is the real entry point" reason `bin.ts`'s own narrow
 * carve-out already documents) allocates the real scratch directory and passes it in.
 *
 * @param {string} projectRoot an existing, empty directory
 * @param {number} artifactCount
 * @returns {{ projectRoot: string, runId: string }}
 */
export function buildEventLogFixture(projectRoot, artifactCount) {
  const runId = 'bench-run';
  const runDir = path.join(projectRoot, '.forge', 'state', 'runs', runId);
  mkdirSync(runDir, { recursive: true });

  const lines = [];
  let seq = 1;
  // `Date.UTC(...)` + `new Date(<number>)`, not the multi-argument `new Date(2026, 0, 1, ...)` form:
  // that form interprets its arguments as *local* time before `.toISOString()` converts to UTC, so
  // the identical `seq` produced a different byte sequence under a different `TZ` — a real round-1
  // critic finding, and a genuine determinism bug this file's own doc comment already claims not to
  // have. `Date.UTC` takes the same arguments but interprets them as UTC directly, and passing its
  // return value (a timestamp number) to `new Date()` is not the zero-argument "ambient now" form R10
  // bans.
  const ts = () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, seq)).toISOString();
  lines.push(JSON.stringify({ v: 1, seq, ts: ts(), runId, type: 'RunStarted', payload: {} }));
  for (let index = 0; index < artifactCount; index += 1) {
    seq += 1;
    lines.push(
      JSON.stringify({
        v: 1,
        seq,
        ts: ts(),
        runId,
        type: 'ArtifactCreated',
        payload: { path: `artifacts/synthetic-${String(index).padStart(4, '0')}.md` },
      }),
    );
  }
  writeFileSync(path.join(runDir, 'events.ndjson'), `${lines.join('\n')}\n`);
  writeFileSync(
    path.join(projectRoot, '.forge', 'state', 'last-run.json'),
    JSON.stringify({ runId }),
  );

  return { projectRoot, runId };
}

/**
 * Clones `template` (a real `kb-entry`-kind `KbParsedEntry` from an already-parsed real `KbTree`)
 * `count` times with distinct, deterministic ids/paths/titles, and returns a new `KbTree` whose
 * `entries` is the real fixture's own entries plus the synthetic ones — the exact technique
 * `build-context-pack.test.ts`'s own 500-entry benchmark already uses.
 *
 * @param {import('../../packages/kb/src/schema/tree.ts').KbTree} tree
 * @param {number} count
 * @param {string} idPrefix
 * @returns {import('../../packages/kb/src/schema/tree.ts').KbTree}
 */
export function buildSyntheticKbTree(tree, count, idPrefix) {
  const template = tree.entries.find((entry) => entry.kind === 'kb-entry');
  if (template === undefined) {
    throw new Error('bench: fixtures/greenfield-service has no kb-entry to clone from.');
  }

  const synthetic = [];
  for (let index = 0; index < count; index += 1) {
    synthetic.push({
      ...template,
      path: `synthetic/${idPrefix}-${String(index).padStart(4, '0')}.md`,
      value: {
        ...template.value,
        id: `KB-${idPrefix.toUpperCase()}-${String(index).padStart(4, '0')}`,
        title: `Synthetic ${idPrefix} entry ${String(index)}`,
      },
    });
  }

  return { entries: [...tree.entries, ...synthetic], errors: tree.errors };
}

const DOCUMENT_KINDS = ['agents', 'workflows', 'frameworks', 'templates', 'checks', 'skills'];
const LAYERS = ['L0', 'L1', 'L2', 'L3', 'L4'];

/**
 * A real `CompileSources` (`@forge/extensions/compile`) with `entityCount` entities per document
 * kind, each carrying one real contribution at every one of `15` §15.2's five layers — a genuine
 * "full layer resolution" fixture, not a single-layer stand-in, matching `21` §21.5's own literal
 * "5-layer fixture" row.
 *
 * @param {number} entityCount per document kind
 * @returns {import('../../packages/extensions/src/compile/types.ts').CompileSources}
 */
export function buildCompileSources(entityCount) {
  /** @type {Record<string, Record<string, { layer: string, source: string, document: unknown }[]>>} */
  const sources = {};
  for (const kind of DOCUMENT_KINDS) {
    /** @type {Record<string, { layer: string, source: string, document: unknown }[]>} */
    const entities = {};
    for (let index = 0; index < entityCount; index += 1) {
      const id = `${kind}-${String(index).padStart(4, '0')}`;
      entities[id] = LAYERS.map((layer) => ({
        layer,
        source: layer === 'L0' ? 'built-in' : layer === 'L1' ? 'module:bench' : 'project',
        document: { title: id, [`from_${layer}`]: true, mandate: `${layer}-${id}` },
      }));
    }
    sources[kind] = entities;
  }
  // `sources` is built generically (a plain `Record<string, ...>`) rather than typed as the real
  // `CompileSources` throughout the loop above — TypeScript cannot see that every one of
  // `DOCUMENT_KINDS`' six real entries was actually assigned, only that *some* string keys were. The
  // loop above is this function's own proof that all six are present; asserted here rather than
  // re-typed loop-by-loop, which would cost real clarity for a fixture builder this short.
  return /** @type {import('../../packages/extensions/src/compile/types.ts').CompileSources} */ (
    /** @type {unknown} */ (sources)
  );
}
