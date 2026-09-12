/**
 * `@forge/cli/commands` — `03` §3.2.1/§3.2.2's lifecycle and discovery commands (`init`/`upgrade`/
 * `doctor` are each their own piece, per `PLAN-M6.md` C1/C2/C6/C7).
 *
 * @see specs/03 §3.2.1
 * @see specs/03 §3.2.2
 */
export {
  adopt,
  adoptIncremental,
  adoptReport,
  baselineDiff,
  baselineShow,
  type AdoptContext,
  type AdoptDepth,
  type AdoptOptions,
  type AdoptReportResult,
  type AdoptRunResult,
  type IncrementalReport,
} from './adopt.ts';
export {
  adrAccept,
  adrList,
  adrNew,
  adrReject,
  adrShow,
  adrSupersede,
  type AdrCommandContext,
} from './adr.ts';
export { decide, type DecideInput, type DecideResult } from './decide.ts';
export {
  diagramDiff,
  diagramGenerate,
  diagramLegend,
  diagramList,
  diagramRender,
  diagramShow,
  diagramSync,
  diagramValidate,
  type DiagramCommandContext,
  type DiagramSyncOutcome,
} from './diagram.ts';
export { discover } from './discover.ts';
export {
  kbDiff,
  kbGraph,
  kbLint,
  kbList,
  kbOpen,
  kbSearch,
  kbShow,
  kbSync,
  type KbCommandContext,
  type KbGraphEdge,
  type KbSearchHit,
} from './kb.ts';
export {
  readArtifactTemplate,
  summarize,
  listSpecArtifacts,
  type KbEntrySummary,
} from './shared.ts';
export {
  specList,
  specMatrix,
  specNew,
  specOrphans,
  specShow,
  specTrace,
  specValidate,
  type SpecCommandContext,
  type SpecMatrix,
  type SpecSummary,
  type SpecTraceResult,
  type SpecValidationResult,
} from './spec.ts';
export { uninstall, type UninstallOptions, type UninstallResult } from './uninstall.ts';
export * from './run/index.ts';
export * from './loop/index.ts';
