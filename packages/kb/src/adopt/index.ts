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

export type { EvidenceIndex, EvidenceRef } from './evidence.ts';
export { buildEvidenceIndex, isKnownEvidence } from './evidence.ts';

export type {
  CartographyClaimKind,
  CartographyFinding,
  CartographyResult,
  RawCartographyClaim,
  RejectedCartographyClaim,
  SharedWriteTableFinding,
} from './cartography.ts';
export { assembleCartography, validateClaimEvidence } from './cartography.ts';

export type {
  AdherenceRatio,
  InferenceClaimKind,
  InferenceFinding,
  InferenceResult,
  RawInferenceClaim,
  RejectedInferenceClaim,
} from './inference.ts';
export {
  assembleInference,
  clampInferenceConfidence,
  validateInferenceEvidence,
} from './inference.ts';

export type {
  RawVerificationCheck,
  VerificationCheckKind,
  VerificationFinding,
  VerificationGap,
  VerificationOutcome,
  VerificationPromotion,
  VerificationResult,
  VerificationSubject,
} from './verification.ts';
export {
  assembleVerification,
  classifyCartographyCheckKind,
  verifyCartographyFinding,
  verifyConventionFinding,
} from './verification.ts';
