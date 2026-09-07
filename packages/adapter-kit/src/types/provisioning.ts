/**
 * `ResolvedSkill`/`SessionContext`/`SkillProvisioning`/`GrantedMcpServer`/`McpProvisioning` — `15`
 * §15.6's own two provisioning hooks (`provisionSkills`, `provisionMcp` on `PlatformAdapter`) reference
 * all five by name with no field-level shape given anywhere in the spec pack. Designed here from
 * §15.6's own provisioning-strategy table and the two conformance tests (C15/C16) it adds. See
 * `SPEC-QUESTIONS.md` Q58 points 7–11.
 *
 * @see specs/15 §15.6
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P1
 */

/** The two pieces `15` §15.6's provisioning table names directly ("front-matter summaries"; "bodies...
 * up to budget"), plus `appliesTo` — needed to pick which bodies fit a step's own file claim under the
 * `skills: none` degradation strategy in that same table (Q58 point 7). */
export interface ResolvedSkill {
  readonly id: string;
  readonly summary: string;
  readonly body: string;
  readonly appliesTo: readonly string[];
}

/** The identity a skill/MCP provisioning call needs to scope its own materialised files "to the lane
 * worktree" (`15` §15.6) — mirrors the three fields `SessionRequest` already carries for the identical
 * purpose (Q58 point 8). */
export interface SessionContext {
  readonly runId: string;
  readonly stepId: string;
  readonly cwd: string;
}

/** Reports which of `15` §15.6's three named strategies was actually used and which skills it
 * covered — the two facts C15 (skill scoping) needs to assert against (Q58 point 9). */
export interface SkillProvisioning {
  readonly strategy: 'native' | 'inline' | 'bodies-injected';
  readonly provisionedSkillIds: readonly string[];
}

/**
 * A `transport`-discriminated shape mirroring `@forge/extensions/mcp`'s own `McpServer` (`id`,
 * `transport`, connection fields) plus `grantedTools` — deliberately *not* imported from
 * `@forge/extensions`: `02` §2.2's own graph gives `adapter-kit ← schemas, telemetry` only, no
 * `extensions` edge, so this is a structurally-similar, independently-defined type a future engine
 * piece converts into, not shares (Q58 point 10).
 */
export type GrantedMcpServer =
  | {
      readonly id: string;
      readonly transport: 'stdio';
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
      readonly grantedTools: readonly string[] | '*';
    }
  | {
      readonly id: string;
      readonly transport: 'http' | 'sse';
      readonly url: string;
      readonly grantedTools: readonly string[] | '*';
    };

/** The one fact C16 (MCP grant fidelity) needs: which granted servers actually loaded, so a caller can
 * compare against what it asked for (Q58 point 11). */
export interface McpProvisioning {
  readonly loadedServerIds: readonly string[];
}
