/**
 * `ForgeMcpBackend` — the injected implementation behind every `forge_*` MCP tool `07` §7.3's own
 * "Optional: FORGE MCP server" table names. One method per tool, each returning real, typed data this
 * piece defines the shape of from the tool's own one-line spec purpose.
 *
 * No boundary edge from `@forge/adapter-claude-code` to `@forge/kb`/`@forge/agents` exists (checked
 * directly against `tools/eslint-plugin-forge-boundaries/src/graph.mjs`: `'adapter-claude-code':
 * ['adapter-kit', 'schemas', 'telemetry']` — neither `kb` nor `agents` is listed), so this piece cannot
 * implement any method against a real backend at all; every one is injected, and a later piece
 * (wherever the real edge exists) supplies the real implementation. `server.ts` (this same directory)
 * is what actually calls these methods once wired into a real MCP server.
 *
 * Five of the nine tools have a real, already-established equivalent in `@forge/adapter-kit`'s own
 * `ParsedControlToken` union (the `FORGE_*` token-parsing fallback `07` §7.3 says this MCP path "MUST
 * be preferred" over, not a second, independently-designed mechanism) — their parameter shapes here
 * deliberately match that union's own matching variant field-for-field, so the two routes stay
 * interchangeable in substance, not just in name:
 * - `ask` ↔ `ParsedControlToken` `'FORGE_ASK'` (`question`, `options`)
 * - `assume` ↔ `'FORGE_ASSUME'` (`text`, `confidence`, `impact`) -- **except** `validateBy`: see below.
 * - `handoff` ↔ `'FORGE_HANDOFF'` (`role`, `reason`)
 * - `requestChange` ↔ `'FORGE_REQUEST_CHANGE'` (`target`, `reason`)
 * - `skillLoad` ↔ `'FORGE_LOAD_SKILL'` (`skillId`, named `id` here to match `07` §7.3's own
 *   `forge_skill_load(id)` signature verbatim)
 *
 * `kbSearch`/`kbGet`/`specGet`/`report` have no control-token equivalent at all — a real, honest
 * asymmetry, not an oversight: those four return data an agent consumes programmatically, unlike the
 * escalation-style actions the token parser exists to let a human see even without MCP.
 *
 * `assume`'s own real mismatch, recorded here rather than silently resolved: `ParsedControlToken`'s
 * `'FORGE_ASSUME'` variant carries a fourth, mandatory `validateBy: string` field this method's own
 * signature does not, because `07` §7.3's own tool table and `PLAN-M7.md`'s own P8 surface both name
 * this method's signature as exactly `assume(text, confidence, impact)` -- three parameters, verbatim.
 * Implemented exactly as specified rather than silently widened to four, since the three-parameter
 * shape is this piece's own literal, agreed contract, not a guess this piece is free to redesign; the
 * real structural asymmetry between the two "equivalent" routes is recorded honestly in
 * `SPEC-QUESTIONS.md` Q120 instead.
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q120
 * @see PLAN-M7.md P8
 */

/** Matches `ParsedControlToken`'s own `'FORGE_ASSUME'` variant's `confidence` field exactly
 * (`@forge/adapter-kit/types/control-tokens.ts`) -- no separate named type exists there either; this is
 * the first place in this codebase that vocabulary gets its own name. */
export type AssumeConfidence = 'low' | 'medium' | 'high';

export interface KbSearchHit {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
}

export interface KbEntry {
  readonly id: string;
  readonly content: string;
}

export interface SpecEntry {
  readonly id: string;
  readonly content: string;
}

export interface AskAnswer {
  readonly answer: string;
}

/** The shared, minimal shape for every "fire an escalation/record event" tool (`assume`, `handoff`,
 * `requestChange`, `report`) -- unlike `ask`, none of these need the session to actually read back
 * anything richer than "this was received." A real, later backend implementation returning additional
 * fields (a real id, a real timestamp, ...) still satisfies this interface -- extra properties on a
 * method's own return value are always structurally compatible with a narrower declared return type. */
export interface AcknowledgedResult {
  readonly acknowledged: boolean;
}

export interface SkillBody {
  readonly body: string;
}

export interface ForgeMcpBackend {
  /** `forge_kb_search(query)` -- "Retrieve KB entries by relevance, with IDs." */
  kbSearch(query: string): Promise<readonly KbSearchHit[]>;
  /** `forge_kb_get(id)` -- "Fetch a KB entry or artifact verbatim." `undefined` = no entry with this
   * id exists; a normal, expected outcome for a fetch-by-id tool, not an error. */
  kbGet(id: string): Promise<KbEntry | undefined>;
  /** `forge_spec_get(id)` -- "Fetch a spec artifact." `undefined` = not found, same reasoning as
   * `kbGet`. */
  specGet(id: string): Promise<SpecEntry | undefined>;
  /** `forge_ask(question, options)` -- "Escalate a question to the human through the TUI." Blocks
   * (from the calling session's own point of view) until a real answer comes back. */
  ask(question: string, options: readonly string[]): Promise<AskAnswer>;
  /** `forge_assume(text, confidence, impact)` -- "Record an assumption." See this file's own top-of-
   * file doc comment for the real, deliberate three-parameter-vs-`ParsedControlToken` mismatch. */
  assume(text: string, confidence: AssumeConfidence, impact: string): Promise<AcknowledgedResult>;
  /** `forge_handoff(role, reason)` -- "Request a handoff." `role` is a plain, open string (`specs/05`
   * §5's own role table is project-configurable, not a closed enum -- confirmed: no `AgentRole` enum
   * exists anywhere reachable from this package). */
  handoff(role: string, reason: string): Promise<AcknowledgedResult>;
  /** `forge_request_change(target, reason)` -- "Request a change to a frozen contract." */
  requestChange(target: string, reason: string): Promise<AcknowledgedResult>;
  /** `forge_report(kind, payload)` -- "Emit structured findings (review, RCA, test plan)." `kind` is a
   * plain, open string (confirmed: no closed `ReportKind`/`FindingKind` vocabulary exists anywhere in
   * this codebase; the spec table's "review, RCA, test plan" is a parenthetical example, not an
   * enumerated set) and `payload` is genuinely `unknown` -- no fixed shape exists per kind for this
   * piece to honestly narrow it to. */
  report(kind: string, payload: unknown): Promise<AcknowledgedResult>;
  /** `forge_skill_load(id)` -- "Load a skill body on demand (progressive disclosure fallback)," `15`
   * §15.4.3's own `auto`-activation path. `undefined` = no skill with this id exists, same
   * not-found-is-normal reasoning as `kbGet`/`specGet`. */
  skillLoad(id: string): Promise<SkillBody | undefined>;
}
