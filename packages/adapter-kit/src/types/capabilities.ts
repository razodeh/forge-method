/**
 * `AdapterCapabilities` — `07` §7.2's own static+probed capability shape, verbatim, folded with `15`
 * §15.6's two additions (`skills`, `toolProxy`) into the one interface the spec pack itself treats as
 * a single evolving type, not two.
 *
 * @see specs/07 §7.2
 * @see specs/15 §15.6
 * @see PLAN-M4.md P1
 */
export interface AdapterCapabilities {
  readonly streaming: boolean;
  readonly partialText: boolean;
  readonly sessionResume: boolean;
  readonly interject: boolean;
  readonly structuredOutput: boolean;
  readonly toolAllowlist: boolean;
  readonly permissionModes: readonly string[];
  readonly subagents: boolean;
  readonly mcp: boolean;
  readonly costReporting: 'none' | 'per-session' | 'per-turn';
  readonly tokenReporting: boolean;
  readonly maxConcurrentSessions: number;
  readonly cwdIsolation: boolean;
  readonly systemPromptControl: 'none' | 'append' | 'replace';
  readonly fileEditing: boolean;
  readonly bash: boolean;
  readonly network: 'none' | 'allowlist' | 'full';
  readonly bareMode: boolean;
  /** `15` §15.6: platform-level progressive-disclosure support for skills. */
  readonly skills: 'native' | 'inline' | 'none';
  /** `15` §15.6: the adapter can expose FORGE-brokered tools into the session in place of native MCP. */
  readonly toolProxy: boolean;
}
