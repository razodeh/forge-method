/**
 * `PlatformAdapter` — `07` §7.2's own normative interface, verbatim, folded with `15` §15.6's two
 * provisioning hooks. `id`/`displayName` stay opaque strings, never a closed enum naming a real
 * platform — `07` §7.1's own boundary rule ("nothing above `@forge/adapter-kit` may reference Claude
 * Code, MCP... or any model name") applies inside this package too, not only above it.
 *
 * @see specs/07 §7.1
 * @see specs/07 §7.2
 * @see specs/15 §15.6
 * @see PLAN-M4.md P1
 */
import type { AdapterCapabilities } from './capabilities.ts';
import type { AssetContext, InstalledAsset } from './assets.ts';
import type { ModelInfo, PreflightContext, PreflightResult } from './preflight.ts';
import type {
  GrantedMcpServer,
  McpProvisioning,
  ResolvedSkill,
  SessionContext,
  SkillProvisioning,
} from './provisioning.ts';
import type { ResumeRequest, SessionHandle, SessionRequest } from './session.ts';
import type { StructuredRequest } from './structured.ts';
import type { TierModelMap } from './tiers.ts';

export interface PlatformAdapter {
  /** `'claude-code' | ...` in practice — typed as an opaque string here, not a closed enum, so no
   * platform-specific literal is baked into this package's own public surface. */
  readonly id: string;
  readonly displayName: string;

  /** Static + probed capabilities. Called by doctor and by the scheduler. */
  capabilities(): Promise<AdapterCapabilities>;

  /** Verify the platform is installed, authenticated and usable. */
  preflight(ctx: PreflightContext): Promise<PreflightResult>;

  /** Models this platform can currently use, for tier mapping validation. */
  listModels(): Promise<readonly ModelInfo[]>;

  /**
   * Optional: which of this platform's own models should serve each FORGE budget tier (`05` §5.8) on a
   * fresh project. `forge init` writes the result into `models.tiers.<tier>.<adapter id>` — the one
   * place a platform's model names may be produced, since `@forge/schemas` cannot name them. Every id
   * returned MUST also appear in `listModels()`: init drops any that does not, and never writes an id
   * the adapter did not itself vouch for. An adapter that cannot name a model for a tier omits the
   * method or that tier; the tier then stays unmapped and `forge doctor` reports it. Synchronous and
   * side-effect free: a static table, not a probe.
   */
  defaultTierModels?(): TierModelMap;

  /** Start a session. Returns a handle; the stream is consumed by the caller. */
  startSession(req: SessionRequest): Promise<SessionHandle>;

  /** Resume a previously started session if supported. */
  resumeSession(sessionId: string, req: ResumeRequest): Promise<SessionHandle>;

  /** Optional: write platform-native assets (agent files, commands) into the host project. */
  installAssets?(ctx: AssetContext): Promise<readonly InstalledAsset[]>;

  /** Optional: one-shot structured completion for cheap utility tasks. */
  structured?<T>(req: StructuredRequest<T>): Promise<T>;

  /** Materialise the step's resolved skills into the session, scoped to the lane. See `15` §15.6. */
  provisionSkills?(
    skills: readonly ResolvedSkill[],
    ctx: SessionContext,
  ): Promise<SkillProvisioning>;

  /** Configure only the MCP servers/tools granted to this step's role. See `15` §15.6. */
  provisionMcp?(
    servers: readonly GrantedMcpServer[],
    ctx: SessionContext,
  ): Promise<McpProvisioning>;
}
