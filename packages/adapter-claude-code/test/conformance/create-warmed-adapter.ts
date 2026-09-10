/**
 * `createWarmedAdapter` — shared between `sdk.conformance.test.ts` and `cli.conformance.test.ts`
 * (only `transport` differs between the two calls).
 *
 * `runAdapterConformanceSuite`'s own `beforeAll` calls `adapter.capabilities()` exactly once, right
 * after its factory returns, and caches that one snapshot for the whole suite's run — but
 * `ClaudeCodeAdapter`'s own `capabilities()` (P4) only reports `sessionResume`/`partialText` as `true`
 * once a real `session.started` event has actually been observed. Without a warm-up, the cached
 * snapshot would permanently read the pre-session, conservative values, silently and permanently
 * skipping C9 (resume) even during a real, live run that would otherwise have exercised it fully.
 * Running one real, cheap session here first — fully drained via `handle.result()` before this
 * function returns — makes the suite's own cached capabilities reflect what this environment's real,
 * installed CLI/SDK actually confirmed, exactly as `capabilities()`'s own pre/post-session design
 * intends. A warm-up failure here is never swallowed: it propagates out of `createAdapter()` and fails
 * `beforeAll` loudly, which is correct — if even a trivial "say hello" session cannot complete, every
 * other check in this suite would fail for the same underlying reason anyway.
 *
 * This is a plain, non-`.test.ts` helper under a nested package `test/` directory, not the repo-root
 * `test/` directory or a `*.test.ts`/`*.spec.ts` file (`eslint.config.js`'s own R10 exemption glob is
 * `'test/**\/*.ts'`, which only matches a *root-level* `test/` directory) — so R10 governs it exactly
 * like production code. Every ambient fact (`process.env`, the wall clock) is therefore taken as an
 * explicit parameter from this function's own caller (`sdk.conformance.test.ts`/
 * `cli.conformance.test.ts`, both real `.test.ts` files the same glob *does* exempt), never read
 * directly here — the identical discipline `src/auth.ts`'s own `probeAuthAvailability` already
 * applies to `env` for the same structural reason.
 *
 * @see specs/07 §7.6
 * @see PLAN-M7.md P9
 */
import { ClaudeCodeAdapter } from '../../src/adapter.ts';
import { claudeCodeAdapterConfigSchema } from '../../src/config.ts';
import { createConformanceScratchDir } from './fixture-options.ts';

/** `bare: true` (api-key mode) needs `ANTHROPIC_API_KEY` in the adapter's own ambient `env` — the real,
 * confirmed mechanism `--bare` mode reads auth from at all (P1). `bare: false` (subscription mode)
 * relies on the real, ambient OAuth/keychain session `claude auth status` already confirmed exists,
 * which needs `HOME` *and* `USER` but never `ANTHROPIC_API_KEY` — deliberately excluded even if present
 * in `processEnv`, so subscription-mode runs genuinely exercise that code path rather than incidentally
 * also carrying an API key. `USER` was added after a real, live `FORGE_LIVE=1` run (M7's own deferred
 * live-run checkpoint, actually executed post-M8) reproduced a genuine bug directly: `probeAuthAvailability`
 * itself runs `claude auth status` against the *full* ambient `process.env` and correctly reports
 * `subscription: true`, but the real session spawn — built from this function's own, narrower env —
 * failed outright with `"Not logged in · Please run /login"` on this real development machine, a
 * probe/spawn inconsistency, not a `claude auth status` false positive: `env -i PATH=... HOME=...
 * claude auth status` itself reports `loggedIn: false` on this machine, and adding back `USER` alone
 * (bisected directly against every other plausible candidate — `LOGNAME`/`TMPDIR`/`SHELL`/`LANG`/
 * `XDG_CONFIG_HOME`/`XDG_DATA_HOME`, none of which restored it) is what restores `loggedIn: true`. Not
 * a secret, so safe to include unconditionally in both modes rather than gating it behind `!bare`.
 * Neither branch ever includes `CONFORMANCE_SECRET_ENV_VAR` (`fixture-options.ts`) — C13's own real
 * ambient-leak vector stays out of the adapter's own env entirely, in every mode. A pure function of
 * its own `processEnv` parameter, never reads `process.env` itself — its caller (a real `.test.ts`
 * file) does that and passes the result in. */
export function realAmbientEnv(
  processEnv: Readonly<Record<string, string | undefined>>,
  bare: boolean,
): Readonly<Record<string, string>> {
  const env: Record<string, string> = {};
  if (processEnv['PATH'] !== undefined) env['PATH'] = processEnv['PATH'];
  if (processEnv['HOME'] !== undefined) env['HOME'] = processEnv['HOME'];
  if (processEnv['USER'] !== undefined) env['USER'] = processEnv['USER'];
  if (bare && processEnv['ANTHROPIC_API_KEY'] !== undefined) {
    env['ANTHROPIC_API_KEY'] = processEnv['ANTHROPIC_API_KEY'];
  }
  return env;
}

export async function createWarmedAdapter(
  transport: 'cli' | 'sdk',
  bare: boolean,
  env: Readonly<Record<string, string>>,
  now: () => number,
  scratchBaseDir: string,
): Promise<ClaudeCodeAdapter> {
  const config = claudeCodeAdapterConfigSchema.parse({ transport, bare });
  const adapter = new ClaudeCodeAdapter({ config, env, now });
  const cwd = await createConformanceScratchDir(scratchBaseDir);
  const handle = await adapter.startSession({
    runId: 'conformance-warmup-run',
    stepId: 'conformance-warmup-step',
    cwd,
    systemPrompt: { mode: 'append', text: '' },
    prompt: 'Say hello in one short sentence.',
    model: 'claude-sonnet-5',
    tools: { read: true, write: true, exec: false, network: 'none' },
    permissionMode: 'auto',
    limits: {},
    env: {},
    abortSignal: new AbortController().signal,
  });
  await handle.result();
  return adapter;
}
