genuinely uncertain, security-adjacent production change got independent, evidence-based scrutiny
BEFORE landing, not after.

**Gauntlet.** No change lands from this entry. The 4 files this entry touched and then reverted are
confirmed byte-identical to their pre-entry state.

## Q395 — Two real, verified causes behind the Windows `floor` defect `Q393`/`Q394` disclosed:
`fetch-npm.test.ts`'s own 100%-reproducing flake, and most of the parity-engine's own disclosed
`Q294`/`Q295` win32 refusal never being accounted for by its own tests — fixed, after this entry's
own first attempt at the first cause was itself caught wrong by a critic round (owner: "Can we get
this done so we can start the live test", 2026-11-02)

**What this closes.** Pulling the full, untruncated real CI log for the latest `next` push
(`gh api .../actions/jobs/<id>/logs`, not `gh run view --log`, which silently truncates a large
job's own output — confirmed directly, costing real time before this was noticed) gave, for the
first time this arc, actual per-test error text instead of only file-level pass/fail counts. Two
distinct, fully-diagnosed, independently-verified causes fell out of that real text:

**Cause 1 — `fetch-npm.test.ts`'s own `npm pack` never actually reached its own fixture registry,
on every platform, every run, 100% of the time.** The real CI error was never a flaky external
registry: `npm error code FETCH_ERROR ... request to https://registry.npmjs.org/... Network access
is denied in unit and integration tests (specs/21 §21.1)`. The project's own `.npmrc`-based fixture-
registry override was being silently ignored. Root cause, confirmed directly (not inferred):
`pnpm run <any-script>` — which is how this whole suite always actually runs, via `scripts/
run-tests.mjs` — injects `npm_config_registry` (and other `npm_config_*` vars) into the script's own
process environment, mirroring pnpm's own resolved config (`pnpm run zzz-env-dump` with a throwaway
diagnostic script, added and immediately removed, printed `npm_config_registry=https://
registry.npmjs.org/` with no such setting anywhere in this repo). npm's own real config precedence
(confirmed against npm 11.1.0's own `@npmcli/config` source: `default < builtin < global < user <
project < env < cli`) puts env vars above project `.npmrc`, so `fetchNpmOverlay`'s `execa('npm',
['pack', ...])` call always inherited and obeyed the wrong registry, which the network guard then
correctly refused — burning ~280s per run on retry backoff against a blocked real network call, a
real, previously-uncounted contributor to the floor/seed capacity cluster's own timeouts (`Q389`-
`Q393`).

**This entry's own first fix for Cause 1 was itself wrong, caught by a dispatched critic round
before it shipped — the identical pattern `Q394` already established for this same investigation,
now repeating successfully.** The first attempt filtered `npm_config_*` out of the `env` object
passed to `execa`, by simply omitting those keys. An independent, direct probe against this repo's
real, installed `execa@9.6.1` (and, separately, a dispatched critic reproducing the same thing
through the real `pnpm run` entrypoint) found this is a no-op: `execa`'s own default
`extendEnv: true` computes `{...process.env, ...envOption}`, so a key the passed object never
mentions at all still flows straight through from `execa`'s own fresh, internal `process.env` read —
an *omitted* key and a key that was *never filtered* are indistinguishable to that merge. This is
the exact "omission is not removal under `extendEnv: true`" gap `packages/cli/src/commands/run/
launcher-shim.ts`'s own `commandEnvFor` doc comment already documents and fixes for `FORGE_RUN_ID`
(confirmed there against this same real `execa@9.6.1`) — the first fix did not apply that same
lesson to itself. A sanity-check revert (flip `extendEnv` back to `true`, nothing else changed)
reproduced the original 3-failure, ~280s-duration behavior exactly, confirming the mechanism rather
than assuming it.

**The same critic round also found the first fix's production SCOPE was wrong, independent of the
mechanism bug.** Stripping every `npm_config_*` variable inside `fetchNpmOverlay` itself — once
actually working — would have silently discarded legitimate, intentional env-supplied npm config
for every real `forge module add npm:...`/`forge overlay add npm:...` invocation, not only this
test: a real CI setup (`actions/setup-node`'s own `registry-url`/`NPM_CONFIG_USERCONFIG` pattern,
common for private registries) configures npm via exactly these env vars on purpose, and this
module's own pre-existing top-of-file doc comment already documents that "credential/auth-token
handling this module has no business touching" — the first fix's production-side filtering directly
contradicted that already-stated contract.

**The corrected fix.** `fetchNpmOverlay` filters nothing. `options.env` (the real, complete parent
environment — `realEnvSnapshot()`'s own return shape in production, threaded through from
`dispatch/shared.ts`'s existing, 29-call-site-precedented boundary read, required rather than read
from `process.env` inside this module per `QUALITY-BAR.md` R10) is passed to `execa` with
`extendEnv: false`, which is a behavior no-op for every real production caller (a complete snapshot
passed with `extendEnv: false` is indistinguishable from today's implicit full inheritance) while
finally satisfying R10 for real. The `npm_config_*` stripping that actually fixes the flaky test
moved to where it belongs and can do no production harm: a `hermeticNpmEnv()` helper inside
`fetch-npm.test.ts` itself, used by all 5 of that file's own `fetchNpmOverlay` calls.

**Cause 2 — most of the parity-engine's own tests never accounted for its own, already-disclosed
`Q294`/`Q295` win32 refusal.** `observeParityDeclaration` (`packages/cli/src/commands/parity/
observe.ts:584`) already, deliberately, throws a typed `ENV-007` refusal on real `win32` — the
parity engine's POSIX single-quote command defense has no proven `cmd.exe`-safe equivalent yet, by
design, not a bug. But `observe.test.ts`/`check-command.test.ts`/`capture-command.test.ts`/
`observe-http.test.ts` never accounted for that refusal in most of their own describe blocks: they
called into the real observation path expecting success, which is impossible on win32, so they
failed outright in real Windows CI (113 individual assertion failures of this exact, confirmed
shape across these four files alone — the single largest attributable slice of the Windows
`floor`'s own 109/752 failing-file count). Closed by adding the identical runtime `ctx.skip()` guard
`packages/engine/test/security/s12-orphan-free-crash.test.ts` already established for this exact
shape (register unconditionally, skip at runtime — never the static `.skipIf` form, which would
silently vanish an entire file from `vitest list --json` the same way that file's own doc comment
already discloses), scoped per-`describe` so the platform-independent validation/refusal tests
already in those same files keep running unconditionally everywhere, confirmed by re-running each
file locally afterward at its exact original pass count (zero behavior change on non-Windows).

**A handful of individually POSIX-only tests, confirmed the same way against real CI output, closed
alongside Cause 2 though unrelated to `Q294`/`Q295`:** `tree-snapshot.test.ts`'s `chmod`-permission/
real-FIFO/`ENOTDIR` tests (Windows has no POSIX permission-bit or FIFO model, and reports `ENOENT`
rather than `ENOTDIR` for a path through a non-directory component — confirmed directly from the
real CI diff: the promise resolved with the path correctly read as "absent" instead of rejecting,
which is the Windows-CORRECT outcome, not a bug); `overlay.test.ts`'s/`reference-node-modules.
test.ts`'s mode-`0644`/read-only-worktree `chmod` tests (same reason: Windows `chmod` only toggles
the read-only attribute); `candidate-isolation.test.ts`'s real-SIGINT/exit-130 test (no faithful
win32 signal-and-exit-code equivalent); and `render-test-command-template.test.ts`'s
`shellDecodesToOneArgument` helper, which hardcoded a real `/bin/sh` — confirmed, via the real
Windows CI stack traces, to be the exact and ONLY source of every `spawnSync /bin/sh ENOENT` failure
in the run (7 occurrences, all 4 call sites in this one file). One of those 4 call sites sits inside
an `it.each` block; converting it to `it.for` was necessary, not cosmetic — confirmed directly
against `@vitest/runner@4.1.11`'s own real runtime source (`chunk-artifact.js`) that only `it.for`'s
own handler receives a real `TestContext` (`ctx`, needed for `ctx.skip()`); `it.each`'s own wrapper
calls its handler with zero arguments of its own, discarding whatever context `test()` would
otherwise have supplied — confirmed by type-checking `EachFunctionReturn`'s own signature
(`(...args: T) => Awaitable<void>`, no context parameter at all) before relying on it, not assumed.

**What this does NOT close — still real, still open, bigger than either cause above.** The Windows
`floor`'s own 109/752-failing-file count was never going to be fully explained by two causes; this
entry closes the two it could diagnose and verify without a real Windows machine. Several more
distinct clusters remain, confirmed from the same real CI log but deliberately NOT attempted here,
because closing them would require exactly the kind of Windows-hardware-dependent verification
`Q394`'s own correction already flagged as this session's real limit: `structured-layer.test.ts`
and `packages/engine/test/plan/command-quoting.test.ts` (POSIX single-quote command text —
`echo '<json>'`-shaped and deliberately hostile shell-injection probes alike — run through
`resolvePosixShell`'s own win32 path, whatever Git-Bash/MSYS2 actually does with it); the launcher-
shim PATH/`forge.cmd` resolution gap `command-env.test.ts`/`bin-run-failures.test.ts` surface ("the
launcher directory never appeared"); a SECOND, distinct recurrence of the `D:\D:\` doubled-drive-
letter shape (`ParityEvidence.md`/`EvidenceBundle.md` template-path resolution, not the `pnpm test`
shell-invocation mechanism `Q393` already fixed one instance of); and a long tail of cascading
assertion mismatches inside `gate-commands.test.ts`/`binding.test.ts`/`lane-integration.test.ts` and
many more files not individually triaged this round. `posix-shell.ts`'s own pre-existing doc
comment already discloses the real reason none of this is attempted further here: "needs a real
Windows + Git-for-Windows rig to actually close, not further reasoning from here" — unchanged by
this entry, and still true.

**Gauntlet.** `pnpm typecheck` (21/21 packages) and lint clean throughout. Every touched test file
re-run locally at its exact original pass count: `observe.test.ts` 43/43, `check-command.test.ts`
46/46, `capture-command.test.ts` 35/35, `observe-http.test.ts` 15/15, `tree-snapshot.test.ts` 21/21,
`overlay.test.ts` 19/19, `reference-node-modules.test.ts` 11/11, `candidate-isolation.test.ts`
12/12, `render-test-command-template.test.ts` 19/19. `fetch-npm.test.ts` itself: 3 failed → 24/24,
verified under a deliberately simulated `pnpm`-polluted environment (`npm_config_registry=...`) and
through the real `pnpm run` entrypoint, not merely in an unpolluted local shell that would have
passed either way. `module.test.ts`/`overlay.test.ts`/`module-install-fence-real-paths.test.ts`
(61/61) re-run to confirm the `env`-threading plumbing and `extendEnv: false` change make no
difference to any real production call path. One critic round (opus, isolated worktree, confirmed
non-stale) dispatched specifically for the production-behavior change, which caught both the
`extendEnv` no-op and the production-scope regression risk before either shipped.
