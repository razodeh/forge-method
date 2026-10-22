/**
 * `staticCapabilities`/`confirmedCapabilities` — `07` §7.2's own `AdapterCapabilities` shape, made
 * concrete for Claude Code.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q116
 * @see PLAN-M7.md P4
 * @see PLAN-M17.md P11
 */
import type { AdapterCapabilities } from '@forge/adapter-kit';

/**
 * `permissionModes` reports the *currently selected transport's* own real, native mode names (`07`
 * §7.2: "adapter-native mode names") -- callers pass this in, since one adapter instance can use
 * either transport depending on config (P4's own transport-selection policy), and the two real
 * vocabularies genuinely differ (`SPEC-QUESTIONS.md` Q115).
 *
 * Every field except `sessionResume`/`partialText`/`structuredOutput` is fixed by this adapter's own
 * construction, not by which real CLI/SDK version a given end-user's machine happens to have installed
 * -- this code either builds the `--allowedTools`/`Options.allowedTools` mapping or it does not,
 * regardless of the remote environment, so there is no meaningful "unconfirmed" state for those to
 * occupy. The three that *do* stay gated behind `confirmedCapabilities` -- `partialText`/
 * `sessionResume` genuinely for the real, remote CLI/SDK version's own actual behaviour (`07` §7.3:
 * "Feature-detect via the `capabilities` array in the `system/init` event... rather than comparing
 * version strings"), and `structuredOutput` (M17 P11) for a stricter reason spelled out on
 * `confirmedCapabilities`'s own doc comment below -- default conservatively `false` here. This
 * milestone's own confirmed, live testing found `partialText`/`sessionResume` both true on *this*
 * environment's real, installed version, but a different end-user's older/different install is a real
 * unknown until this adapter has actually observed one real `session.started` event (the mapped
 * `system/init` line) against it -- `confirmedCapabilities` is called as soon as that one event
 * arrives, not only once a whole session finishes.
 *
 * Not, in fact, a per-flag read of the real `capabilities` array's own contents: the one real value
 * this milestone ever captured live (`test/cli/parse-event.test.ts`'s own fixture: exactly
 * `['interrupt_receipt_v1']`) names no element corresponding to `partialText`/`sessionResume` at all,
 * so there is nothing in that array this function could honestly key per-flag detection off -- "a real
 * session from this install has actually started" is the most this piece can truthfully claim as its
 * own trigger, not "this install's own array says it supports X." `07` §7.3's own "feature-detect via
 * the capabilities array" framing is, to that extent, not fully borne out by what the real array
 * actually contains; recorded in `SPEC-QUESTIONS.md` Q116 rather than silently claiming a
 * finer-grained detection this milestone's own evidence does not support.
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
    // `specs/22` M17 P7, critic round 5: the identical transport asymmetry as `turnLimitEnforcement`
    // above, for the identical reason -- fixed by this adapter's own construction (`build-options.ts`'s
    // own `buildCanUseTool` only ever reaches the sdk transport's real `Options.canUseTool`; the cli
    // transport has no equivalent hook at all, `build-args.ts`'s own doc comment), never a
    // remote-environment unknown.
    execCommandGating: transport === 'sdk',
    // `SPEC-QUESTIONS.md` Q347, fix-round critics: the identical transport asymmetry as
    // `execCommandGating` immediately above, for the identical reason -- `build-options.ts`'s own
    // `buildFileAccessHook` only ever reaches the sdk transport's real `Options.hooks.PreToolUse`; the
    // cli transport has no documented hooks equivalent either (that function's own doc comment).
    // Fixed by this adapter's own construction, never a remote-environment unknown.
    fileAccessGating: transport === 'sdk',
  };
}

/**
 * Called once this adapter has actually observed a real `session.started` event for real (i.e. at
 * least one real session against the current environment's own real CLI/SDK install has genuinely
 * begun) -- flips `partialText`/`sessionResume`/`structuredOutput` to their real,
 * now-confirmed-for-this-environment `true` values.
 *
 * `structuredOutput` (M17 P11) joined this gate rather than `staticCapabilities`'s own
 * always-true-by-construction group, on a stricter reading of `07` §7.3's own words than "the mapping
 * code is now correct" alone satisfies: "`AdapterCapabilities.structuredOutput` is reported `true`
 * once this path is proven to round-trip a real schema-validated response, not hard-coded... regardless
 * of what the session actually did." `parse-event.ts`/`map-message.ts` now genuinely read
 * `structured_output` into a real `structured` event on both transports, and `session-result.ts`
 * genuinely carries it through to `SessionResult.structured` -- a real, previously-disclosed gap
 * (`SPEC-QUESTIONS.md` Q116) that is now closed in the code -- but C8 (`07` §7.6, the conformance
 * test that actually drives a real schema-validated round trip) has never run against a real
 * `ClaudeCodeAdapter`: it is gated on this exact flag already being `true` to run at all, and every
 * proof in this package's own test suite is against fixture data, never a live call. Reporting `true`
 * unconditionally, before any session has even started, would be exactly the "false capability claim
 * is worse than an honest gap" mistake `SPEC-QUESTIONS.md` Q116 already once corrected -- gating it the
 * identical way `partialText`/`sessionResume` already are is the smallest change that stops short of
 * that, reusing an existing, already-spec-compliant mechanism rather than inventing a new one. This is
 * still not the same strength of proof `07` §7.3 literally asks for (observing *a* session start is not
 * observing *a schema-validated one succeed*), and does not by itself make C8 pass for real -- recorded
 * as a residual, disclosed gap for the live run to actually close. Every other field is unchanged here,
 * since nothing about observing one real session changes what this adapter's own code does or does not
 * implement for them.
 */
export function confirmedCapabilities(
  permissionModes: readonly string[],
  transport: 'cli' | 'sdk',
): AdapterCapabilities {
  return {
    ...staticCapabilities(permissionModes, transport),
    partialText: true,
    sessionResume: true,
    structuredOutput: true,
  };
}
