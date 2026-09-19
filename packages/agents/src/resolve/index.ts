/**
 * `@forge/agents/resolve` — per-step tool grant and model resolution, `PLAN-M13.md` P4.
 *
 * @see specs/05 §5.3
 * @see specs/05 §5.8
 * @see PLAN-M13.md P4
 */
export {
  resolveStepToolGrant,
  roleTagsForAgent,
  type ResolveStepToolGrantInput,
  type ResolveStepToolGrantResult,
  type RoleTags,
} from './tool-grant.ts';
export { resolveStepModel } from './model.ts';
