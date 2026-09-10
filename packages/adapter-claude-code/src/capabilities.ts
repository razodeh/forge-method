/**
 * `staticCapabilities`/`confirmedCapabilities` — `07` §7.2's own `AdapterCapabilities` shape, made
 * concrete for Claude Code.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q116
 * @see PLAN-M7.md P4
 */
import type { AdapterCapabilities } from '@forge/adapter-kit';

/**
 * `permissionModes` reports the *currently selected transport's* own real, native mode names (`07`
 * §7.2: "adapter-native mode names") -- callers pass this in, since one adapter instance can use
 * either transport depending on config (P4's own transport-selection policy), and the two real
 * vocabularies genuinely differ (`SPEC-QUESTIONS.md` Q115).
 *
 * Every field except `sessionResume`/`partialText` is fixed by this adapter's own construction, not
 * by which real CLI/SDK version a given end-user's machine happens to have installed -- this code
 * either builds the `--allowedTools`/`Options.allowedTools` mapping or it does not, regardless of the
 * remote environment, so there is no meaningful "unconfirmed" state for those to occupy. The two that
 * *do* depend on the real, remote CLI/SDK version's own actual behaviour (`07` §7.3: "Feature-detect
 * via the `capabilities` array in the `system/init` event... rather than comparing version strings")
 * default conservatively `false` here -- this milestone's own confirmed, live testing found both true
 * on *this* environment's real, installed version, but a different end-user's older/different install
 * is a real unknown until this adapter has actually observed one real `session.started` event (the
 * mapped `system/init` line) against it -- `confirmedCapabilities` is called as soon as that one event
 * arrives, not only once a whole session finishes. `structuredOutput` is a *third*, genuinely
 * different case -- see `confirmedCapabilities`'s own doc comment below.
 *
 * Not, in fact, a per-flag read of the real `capabilities` array's own contents: the one real value
 * this milestone ever captured live (`test/cli/parse-event.test.ts`'s own fixture: exactly
 * `['interrupt_receipt_v1']`) names no element corresponding to `partialText`/`sessionResume`/
 * `structuredOutput` at all, so there is nothing in that array this function could honestly key
 * per-flag detection off -- "a real session from this install has actually started" is the most this
 * piece can truthfully claim as its own trigger, not "this install's own array says it supports X."
 * `07` §7.3's own "feature-detect via the capabilities array" framing is, to that extent, not fully
 * borne out by what the real array actually contains; recorded in `SPEC-QUESTIONS.md` Q116 rather than
 * silently claiming a finer-grained detection this milestone's own evidence does not support.
 */
export function staticCapabilities(
  permissionModes: readonly string[],
  transport: 'cli' | 'sdk',
): AdapterCapabilities {
  return {
    streaming: true,
    partialText: false,
    sessionResume: false,
    interject: false,
    structuredOutput: false,
    toolAllowlist: true,
    permissionModes: [...permissionModes],
    subagents: true,
    mcp: true,
    costReporting: 'per-turn',
    tokenReporting: true,
    maxConcurrentSessions: 0,
    cwdIsolation: true,
    // A single `'none' | 'append' | 'replace'` value, but this adapter genuinely supports *both*
    // `append` and `replace` (confirmed: `build-args.ts`/`build-options.ts`, P2/P3) -- the real type
    // has no way to say "both." `'append'` is reported, matching this adapter's own more commonly-
    // used default `SessionRequest.systemPrompt.mode`; a real fidelity gap, not silently resolved.
    systemPromptControl: 'append',
    fileEditing: true,
    bash: true,
    network: 'full',
    bareMode: true,
    skills: 'native',
    toolProxy: false,
    // Fixed by this adapter's own construction, exactly like every other non-version-dependent field
    // above -- the real, installed cli's own missing `--max-turns` flag (confirmed against `--help`,
    // `SPEC-QUESTIONS.md` Q114) is not a remote-environment unknown that could vary by install; the sdk
    // transport's own `Options.maxTurns` genuinely enforces it, live-confirmed in the same record.
    turnLimitEnforcement: transport === 'sdk',
  };
}

/**
 * Called once this adapter has actually observed a real `session.started` event for real (i.e. at
 * least one real session against the current environment's own real CLI/SDK install has genuinely
 * begun) -- flips `partialText`/`sessionResume` (the two version-dependent fields this adapter can
 * genuinely back up) to their real, now-confirmed-for-this-environment `true` values.
 *
 * `structuredOutput` deliberately stays `false` even here, unlike the other two -- a fresh critic
 * round found this adapter does not actually deliver it end to end on *either* transport, on *any*
 * environment, regardless of what a real `session.started` event confirms: neither `parse-event.ts`
 * (CLI) nor `map-message.ts` (SDK) reads the real `result` message's own `structured_output`
 * field (confirmed against `sdk.d.ts`'s own `SDKResultSuccess.structured_output?: unknown`) into
 * `SessionResult.structured` at all, and `session-result.ts`'s own `accumulateSessionResult` has no
 * input channel that could carry it even if they did. This is not an environment-dependent unknown
 * the way `partialText`/`sessionResume` are -- it is a real, currently-missing implementation this
 * adapter's own code would need to add regardless of which install it runs against, so `true` here
 * would misreport a capability nothing backs up, the exact thing this function's own sibling
 * `staticCapabilities` doc comment says every field here must never do. Recorded as a real, open gap
 * in `SPEC-QUESTIONS.md` Q116 for a future piece to close, rather than silently claimed working.
 * Every other field is unchanged, since nothing about observing one real session changes what this
 * adapter's own code does or does not implement.
 */
export function confirmedCapabilities(
  permissionModes: readonly string[],
  transport: 'cli' | 'sdk',
): AdapterCapabilities {
  return {
    ...staticCapabilities(permissionModes, transport),
    partialText: true,
    sessionResume: true,
  };
}
