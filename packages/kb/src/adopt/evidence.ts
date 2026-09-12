/**
 * `EvidenceIndex` — the one thing `cartography.ts`/`inference.ts` both need to enforce `17` §17.2 phase
 * 3's own rule literally: "every claim cites evidence from phases 1-2 or from a file it read." Built
 * once from P15's own real `Survey`/`Inventory` output (`PLAN-M10.md` P15, committed), it is the closed
 * universe of paths and facts a CARTOGRAPHY/INFERENCE claim's own evidence may cite — a citation naming
 * anything outside it is, by construction, not evidence phases 1-2 actually produced, which is exactly
 * the fabrication `17` §17.1's own "core risk is confident fabrication" framing names.
 *
 * Deliberately pure and dispatch-agnostic: this file imports nothing from `@forge/engine` (nor could
 * it — `kb`'s own row in `tools/eslint-plugin-forge-boundaries/src/graph.mjs` has no `engine` edge, see
 * `SPEC-QUESTIONS.md`'s P16 entry for the full layering resolution). The LLM-dispatch orchestration that
 * produces a `RawCartographyClaim`/`RawInferenceClaim` in the first place lives in
 * `@forge/engine/adopt`, which calls back into this pure evidence-checking logic — the reverse of a `kb
 * -> engine` edge, matching `PLAN-M10.md` P10's own `sessions`/`engine` precedent exactly.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P16
 * @see PLAN-M10.md P15
 */
import type { Inventory } from './inventory.ts';
import type { Survey } from './survey.ts';

/**
 * One cited piece of evidence for a CARTOGRAPHY/INFERENCE claim — `17` §17.2 phase 3's own "path, line
 * range" wording (`path`) plus a second form (`fact`) for a claim whose evidence is a specific,
 * already-extracted P15 fact with no single natural file path of its own (a dependency cycle, an
 * external dependency, a churn hotspot spanning many commits).
 */
export type EvidenceRef =
  | { readonly kind: 'path'; readonly path: string; readonly line?: number }
  | { readonly kind: 'fact'; readonly description: string };

export interface EvidenceIndex {
  /** Every path/module name P15's own SURVEY or INVENTORY output actually named. */
  readonly paths: ReadonlySet<string>;
  /** Every canonical fact string `buildEvidenceIndex` derived from a P15 signal — see its own doc
   * comment for the exact, deterministic string shape each signal kind produces. */
  readonly facts: ReadonlySet<string>;
}

/** Every real `path` field on every SURVEY/INVENTORY signal is a non-optional `string` (confirmed
 * directly against `survey.ts`/`inventory.ts`'s own types) -- this takes exactly that, not a wider
 * `string | undefined`, so there is no unreachable defensive branch here for a case no real signal can
 * ever produce. */
function addPath(paths: Set<string>, path: string): void {
  paths.add(path);
}

/**
 * Builds the closed evidence universe from one SURVEY and one INVENTORY result. Every signal that
 * carries a `path` field contributes it to `paths`; every signal is additionally rendered into one
 * canonical `facts` string so a claim can cite the fact itself (`kind: 'fact'`), not only the file it
 * came from — a dependency cycle or a cross-file churn pattern has no single path of its own to cite.
 */
export function buildEvidenceIndex(survey: Survey, inventory: Inventory): EvidenceIndex {
  const paths = new Set<string>();
  const facts = new Set<string>();

  for (const manifest of survey.manifests) addPath(paths, manifest.path);
  for (const entryPoint of survey.entryPoints) {
    addPath(paths, entryPoint.path);
    facts.add(`entry-point:${entryPoint.kind}:${entryPoint.value}@${entryPoint.path}`);
  }
  for (const unit of survey.deployableUnits) {
    addPath(paths, unit.path);
    facts.add(`deployable-unit:${unit.kind}:${unit.name}@${unit.path}`);
  }
  for (const datastore of survey.datastores) {
    addPath(paths, datastore.path);
    facts.add(`datastore:${datastore.kind}@${datastore.path}`);
  }
  for (const dir of survey.testSetup.testDirs) addPath(paths, dir);
  for (const ci of survey.ci) {
    addPath(paths, ci.path);
    facts.add(`ci:${ci.system}@${ci.path}`);
  }
  for (const doc of survey.existingDocs) addPath(paths, doc.path);
  for (const hotspot of survey.gitProfile.churnHotspots) {
    addPath(paths, hotspot.path);
    facts.add(`churn-hotspot:${hotspot.path}(${String(hotspot.commitCount)})`);
  }
  for (const pair of survey.gitProfile.filesChangedTogether) {
    addPath(paths, pair.paths[0]);
    addPath(paths, pair.paths[1]);
    facts.add(`files-changed-together:${pair.paths[0]}+${pair.paths[1]}(${String(pair.count)})`);
  }

  for (const node of inventory.dependencyGraph.nodes) addPath(paths, node.module);
  for (const cycle of inventory.dependencyGraph.cycles) {
    facts.add(`dependency-cycle:${cycle.join('->')}`);
  }
  for (const signal of inventory.publicApiSurface) {
    addPath(paths, signal.path);
    facts.add(`public-api:${signal.kind}:${signal.name}@${signal.path}`);
  }
  for (const signal of inventory.dataSurface) {
    addPath(paths, signal.path);
    facts.add(`data-surface:${signal.kind}:${signal.name ?? ''}@${signal.path}`);
  }
  for (const signal of inventory.configSurface) {
    addPath(paths, signal.path);
    facts.add(`config-surface:${signal.kind}:${signal.name}@${signal.path}:${String(signal.line)}`);
  }
  for (const dependency of inventory.externalDependencies) {
    facts.add(`external-dependency:${dependency.name}@${dependency.version ?? ''}`);
  }

  return { paths, facts };
}

/** Whether `ref` names something `index` actually contains — the one real check every claim's own
 * evidence list is run through before it may be accepted (`validateClaimEvidence` in `cartography.ts`,
 * `validateInferenceEvidence` in `inference.ts`). `line` is not itself checked against the file's real
 * line count: P15's own `Survey`/`Inventory` carry no per-file line-count table for most kinds, so this
 * cannot yet distinguish "a real path, wrong line" from "a real path, right line" without re-reading the
 * target file from disk in a phase this module deliberately keeps pure and I/O-free. A real `path`
 * citation is already a substantially stronger anti-fabrication bar than accepting a bare line number on
 * faith, and closing the remaining gap is additive work a later piece can do without changing this
 * function's own signature.
 */
export function isKnownEvidence(ref: EvidenceRef, index: EvidenceIndex): boolean {
  if (ref.kind === 'path') return index.paths.has(ref.path);
  return index.facts.has(ref.description);
}
