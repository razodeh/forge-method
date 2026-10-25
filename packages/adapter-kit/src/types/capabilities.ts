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
  /** Whether a real `SessionRequest.limits.maxTurns` cutoff is actually enforced -- `session.ended` will
   * genuinely report `reason: 'limit'` (never merely `'complete'`) once the cap is hit, rather than the
   * session running unbounded to natural completion regardless of the requested cap. A real, live-
   * verified capability asymmetry (`SPEC-QUESTIONS.md` Q114, Q132): `@forge/adapter-claude-code`'s own
   * cli transport genuinely cannot enforce this at all on the real, installed CLI (no `--max-turns` flag
   * exists), while its sdk transport does, via the real SDK's own native `Options.maxTurns`. Mirrors the
   * same "a real, disclosed capability gap, not silently claimed" discipline this interface's own
   * `structuredOutput`/`sessionResume` fields already establish. */
  readonly turnLimitEnforcement: boolean;
  /** Whether a real, per-call gate on live, in-turn Bash-type tool use is actually active for this
   * adapter in its CURRENT configuration — `SessionRequest.vetExecCommand`, when a caller sets it, is
   * genuinely consulted before a live command executes, never merely accepted and silently ignored.
   * A real, disclosed capability asymmetry (`specs/22` M17 P7, critic round 5), mirroring
   * `turnLimitEnforcement`'s own "transport-asymmetric, honestly reported" discipline:
   * `@forge/adapter-claude-code`'s own CLI transport has no equivalent to Claude Code's SDK
   * `canUseTool` hook at all (`build-args.ts`'s own doc comment); its SDK transport does, confirmed
   * directly against the real, installed `.d.ts`. `forge test adopt --agent` refuses outright
   * (`RUN-162`) rather than run when this is `false`: a live-exec safety guarantee with no real gate
   * behind it is not a guarantee, and a silent, best-effort fallback could be missed the way a mere
   * warning can be. */
  readonly execCommandGating: boolean;
  /** Whether a real, per-call gate on live, in-turn `Read`/`Edit`/`Write` tool use is actually active
   * for this adapter in its CURRENT configuration — `SessionRequest.vetFileAccess`, when a caller sets
   * one, is genuinely consulted before a live file-tool call executes, never merely accepted and
   * silently ignored. The file-access sibling of `execCommandGating` immediately above, added for the
   * identical reason (`SPEC-QUESTIONS.md` Q347, two independent gauntlet critics reviewing the fix for
   * it): SDK transport is not merely a config choice for `@forge/adapter-claude-code` — it is the
   * automatic fallback whenever the real, installed `@anthropic-ai/claude-agent-sdk` module fails to
   * import (`adapter.ts`'s own transport-selection logic). If that fallback ever triggers, an ordinary
   * `kind: agent` step's own `SessionRequest.vetFileAccess` (`createLiveFileAccessGate`, wired into
   * every such step by `steps.ts`/`dispatch-agent-step.ts`/`conflict-resolver.ts`) would be silently
   * accepted and never actually consulted — the exact "a safety guarantee with no real gate behind it
   * is not a guarantee" failure `execCommandGating`'s own doc comment already names, now possible on
   * the Read/Edit/Write side too. `forge test adopt --agent`'s own `RUN-162` upfront refusal (this
   * capability's own doc comment names where it is consumed) now requires this flag `true` as well,
   * not only `execCommandGating`. */
  readonly fileAccessGating: boolean;
  /** Whether a real, per-call gate on live, in-turn `WebFetch`/`WebSearch` tool use is actually active
   * for this adapter in its CURRENT configuration — `SessionRequest.vetNetworkAccess`, when a caller
   * sets one, is genuinely consulted before a live network-tool call executes, never merely accepted
   * and silently ignored. The network sibling of `fileAccessGating` immediately above, added for the
   * identical reason (`SPEC-QUESTIONS.md` Q350, found while fixing `Q347`): `@forge/adapter-claude-code`'s
   * SDK transport is not merely a config choice — it is the automatic fallback whenever the real,
   * installed `@anthropic-ai/claude-agent-sdk` module fails to import (`adapter.ts`'s own transport-
   * selection logic). If that fallback ever triggers, an ordinary `kind: agent` step's own
   * `SessionRequest.vetNetworkAccess` would be silently accepted and never actually consulted — the
   * exact "a safety guarantee with no real gate behind it is not a guarantee" failure
   * `execCommandGating`/`fileAccessGating`'s own doc comments already name, now for `WebFetch`/
   * `WebSearch`. No shipped role grants `network: 'full'` today (`SPEC-QUESTIONS.md` Q350's own
   * disclosure), so this flag has no live production consumer yet — added for the identical "build the
   * honest capability flag alongside the gate it describes, before a real caller needs it" discipline
   * `fileAccessGating` already established, not because `forge test adopt --agent`'s own `RUN-162`
   * currently requires it (it does, mirroring `execCommandGating`/`fileAccessGating`, since that
   * command's own grant could in principle include `network: 'full'` even though none does today). */
  readonly networkAccessGating: boolean;
}
