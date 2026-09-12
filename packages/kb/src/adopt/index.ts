/**
 * `@forge/kb/adopt` — `17` §17.2 phases 1 (SURVEY) and 2 (INVENTORY): deterministic, read-only
 * analysis of a target repository FORGE is adopting.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P15
 */
export type {
  CiSignal,
  DatastoreSignal,
  DeployableUnitSignal,
  DocSignal,
  EntryPointSignal,
  GitProfileFacts,
  HealthSignals,
  LanguageStat,
  ManifestSignal,
  ScopedAdoptionProposal,
  SizeGateResult,
  SizeProfile,
  SizeThresholds,
  Survey,
  SurveyResult,
  TestSetupSignal,
  Toolchain,
} from './survey.ts';
export { DEFAULT_IGNORED_DIR_NAMES, DEFAULT_SIZE_THRESHOLDS, runSurvey } from './survey.ts';

export type {
  ConfigSurfaceKind,
  ConfigSurfaceSignal,
  DataSurfaceKind,
  DataSurfaceSignal,
  DependencyGraph,
  DependencyGraphNode,
  ExternalDependency,
  Inventory,
  PublicApiSurfaceKind,
  PublicApiSurfaceSignal,
} from './inventory.ts';
export { runInventory } from './inventory.ts';

export { SURVEY_REPORT_RELATIVE_PATH, writeSurveyReport } from './report.ts';

export type { WalkedFile } from './walk.ts';
export { walkRepository } from './walk.ts';
