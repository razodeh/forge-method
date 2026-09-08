/**
 * `@forge/agents/context` — `05` §5.4's real context pack for a step: `@forge/kb/pack`'s own
 * already-proven layers, plus skill-body inclusion, the `FORGE_REQUEST_CONTEXT:` expansion protocol,
 * and external-content taint marking.
 *
 * @see specs/05 §5.4
 * @see PLAN-M6.md A4
 */
export { packForStep, type PackForStepOptions, type StepContext } from './pack-for-step.ts';
export { resolveContextRequest } from './resolve-context-request.ts';
export {
  markExternalContent,
  type ExternalContentSource,
  type MarkedExternalContent,
} from './mark-external-content.ts';
export type { AgentContextPack, SkillPackEntry } from './types.ts';
