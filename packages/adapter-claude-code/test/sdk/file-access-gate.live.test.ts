/**
 * A genuinely LIVE, real-API-key-backed confirmation that `SessionRequest.vetFileAccess`
 * (`SPEC-QUESTIONS.md` Q347) actually closes the real, already-exploited gap through FORGE's OWN real
 * invocation path -- `ClaudeCodeAdapter.startSession` -> `buildSdkOptions` -> the real, installed
 * `@anthropic-ai/claude-agent-sdk`'s own `query()` -- not only the fake-adapter-level/unit-level proofs
 * elsewhere in this suite (`build-options.test.ts`'s own hook-wiring tests, `confined-command.test.ts`'s
 * own `createLiveFileAccessGate` tests, `agent.test.ts`'s and `adopt-agent.test.ts`'s own
 * capture-and-call-directly tests). Two lessons this same milestone already learned twice
 * (`SPEC-QUESTIONS.md` Q345, Q346) apply directly here: a fix that looks correct against a fake adapter
 * or a type's own doc comment can still be wrong against a REAL, live SDK call -- this file is that
 * round-trip proof.
 *
 * Gated by `planLiveRuns` (`live-gate.ts`), the SAME mechanism `sdk.conformance.test.ts` already uses:
 * with no `FORGE_LIVE=1`, or no real credential available, every test below reports skipped, with the
 * real reason in its own name, and no live adapter is ever constructed.
 *
 * **One tool call per session, never several in the same turn.** An early draft asked one session to
 * attempt an in-lane AND an out-of-lane operation in the same turn; a real, live run against `haiku`
 * found the model sometimes stops generating after the FIRST denial rather than continuing to the
 * second attempt the prompt asked for (confirmed directly, not assumed -- the standalone experiment
 * this piece's own build ran before writing any FORGE-side code hit the identical thing). Splitting
 * each attempt into its own session removes that confound entirely: this file is proving the GATE, not
 * a cheap model's own multi-step instruction-following.
 *
 * **Ground truth two ways, not one.** Every "denied" assertion below checks BOTH the real filesystem
 * (a mutation that should not exist, or should be unchanged) AND the real `tool.call`/`tool.result`
 * event pair this session's own `handle.events` stream actually emitted -- proving the model genuinely
 * ATTEMPTED the out-of-lane operation and was genuinely refused, not merely that it never tried at all
 * (which would make the filesystem check vacuously true for the wrong reason).
 *
 * Deliberately a SMALL, test-local `vetFileAccess` closure (a plain "does this absolute path start with
 * the lane root" check) rather than importing `@forge/engine`'s own `createLiveFileAccessGate` --
 * `@forge/adapter-claude-code` does not depend on `@forge/engine` at all (confirmed:
 * `package.json`'s own dependency list), and this file's one job is proving the real SDK WIRING (does a
 * `vetFileAccess` callback genuinely get consulted, and does a real denial genuinely reach the model as
 * an observable `tool_result`), not re-proving `createLiveFileAccessGate`'s own containment logic a
 * second time (`confined-command.test.ts` already does that, exhaustively, for free).
 *
 * @see SPEC-QUESTIONS.md Q347
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { AdapterEvent, ExecCommandVerdict, SessionRequest } from '@forge/adapter-kit';

import { ClaudeCodeAdapter } from '../../src/adapter.ts';
import { probeAuthAvailability } from '../../src/auth.ts';
import { claudeCodeAdapterConfigSchema } from '../../src/config.ts';
import { realAmbientEnv } from '../conformance/create-warmed-adapter.ts';
import { planLiveRuns } from '../conformance/live-gate.ts';

const liveEnv = process.env;
const auth = await probeAuthAvailability(liveEnv);
const runs = planLiveRuns(liveEnv, auth);

const scratchDirs: string[] = [];
afterAll(async () => {
  await Promise.allSettled(scratchDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratchDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-q347-live-${prefix}-`));
  scratchDirs.push(dir);
  return dir;
}

/** The identical "absolute path must stay inside this root" check `createLiveFileAccessGate` makes,
 * minus its own symlink-realpath sophistication -- not needed here: this test's own `laneDir` and
 * `outsideDir` are two real, sibling, non-symlinked tmp dirs, and this file's one job is proving the
 * real SDK wiring, not re-proving containment logic `confined-command.test.ts` already covers. */
function testVetFileAccess(
  laneDir: string,
): (toolName: 'Read' | 'Edit' | 'Write', filePath: string) => Promise<ExecCommandVerdict> {
  return (toolName, filePath) => {
    const resolved = path.resolve(filePath);
    const allowed = resolved === laneDir || resolved.startsWith(laneDir + path.sep);
    return Promise.resolve(
      allowed
        ? { allowed: true }
        : {
            allowed: false,
            reason: `refused: ${toolName} path "${filePath}" resolves outside this session's own lane (${laneDir}).`,
          },
    );
  };
}

interface AttemptOutcome {
  readonly ok: boolean;
  readonly finalText: string;
  readonly events: readonly AdapterEvent[];
}

async function runOneAttempt(
  adapter: ClaudeCodeAdapter,
  request: Omit<SessionRequest, 'runId' | 'stepId' | 'abortSignal' | 'limits'>,
): Promise<AttemptOutcome> {
  const handle = await adapter.startSession({
    runId: 'q347-live-run',
    stepId: `q347-live-${Math.random().toString(36).slice(2)}`,
    limits: { maxTurns: 10 },
    abortSignal: new AbortController().signal,
    ...request,
  });
  const events: AdapterEvent[] = [];
  for await (const event of handle.events) events.push(event);
  const result = await handle.result();
  return { ok: result.ok, finalText: result.finalText, events };
}

/**
 * Collects named pass/fail checks and reports every one of them together, rather than stopping (and
 * hiding every check after it) at the first failing `expect`.
 *
 * **Why this exists.** A gauntlet critic reproduced one of this file's own in-lane assertions
 * (`finalText` containing the expected in-lane content) failing reproducibly under "subscription login
 * (non-bare)" auth mode -- twice, in two separate runs. That assertion used to run as a plain `expect`
 * BEFORE this file's own out-of-lane/denial assertions in the same test body, so when it failed, every
 * assertion after it (the denial path this file actually exists to prove) never even ran -- the
 * critic's own run genuinely could not tell whether the out-of-lane denial still held or not, which is
 * a real gap in the "live-confirmed in both auth modes" claim regardless of why the in-lane assertion
 * itself failed (most likely: `bare: false` loads the real, ambient `settingSources` -- this
 * developer's own global `~/.claude/CLAUDE.md` memory and user settings among them, confirmed by
 * `build-options.ts`'s own `...(config.bare ? { settingSources: [] } : {})` -- so a non-bare live run
 * is subject to unrelated, real ambient context a bare run never sees, which can perturb a cheap
 * model's own final-text phrasing in a way no fix to the GATE itself would address).
 *
 * Every attempt below now runs to completion, in full, before any check is made at all -- a failure on
 * one check can never prevent another from being checked and reported, in particular the out-of-lane
 * denial checks this file's own job is to prove.
 */
function runChecks(checks: readonly (readonly [string, boolean])[]): void {
  const failures = checks.filter(([, ok]) => !ok).map(([description]) => description);
  expect(failures, failures.length === 0 ? '' : `failed checks:\n${failures.join('\n')}`).toEqual(
    [],
  );
}

/** Finds the real `tool.result` for the one `tool.call` this attempt's own prompt asked for (matched
 * by tool name -- each attempt in this file only ever makes one call of the relevant kind). `undefined`
 * when no such call was ever made at all (the model never attempted it) -- callers distinguish that
 * from "attempted and denied" explicitly, rather than treating both as the same outcome. */
function findToolResult(
  events: readonly AdapterEvent[],
  toolName: string,
): { readonly ok: boolean; readonly summary: string } | undefined {
  const call = events.find((event) => event.type === 'tool.call' && event.name === toolName);
  if (call?.type !== 'tool.call') return undefined;
  const result = events.find((event) => event.type === 'tool.result' && event.id === call.id);
  return result?.type === 'tool.result' ? { ok: result.ok, summary: result.summary } : undefined;
}

/** `readFile`, but as ground truth for `runChecks` above rather than a throwing `expect`: `undefined`
 * when the path does not exist (or cannot be read) at all, its real content otherwise. */
async function readFileOrUndefined(target: string): Promise<string | undefined> {
  try {
    return await readFile(target, 'utf8');
  } catch {
    return undefined;
  }
}

if (runs.length === 0) {
  describe('SessionRequest.vetFileAccess (SPEC-QUESTIONS.md Q347) -- live SDK-transport confirmation', () => {
    it.skip('no FORGE_LIVE=1, or no real credential available -- skipped, never a fake run', () => {
      // Intentionally empty: see this file's own top doc comment.
    });
  });
} else {
  for (const run of runs) {
    describe(`SessionRequest.vetFileAccess (SPEC-QUESTIONS.md Q347) -- live SDK-transport confirmation (${run.reason})`, () => {
      it("an in-lane Write genuinely succeeds (real file, real content, on the real filesystem), and a genuinely out-of-lane Write (an absolute path completely outside the session's own lane -- the exact shape Q347 found live) is genuinely ATTEMPTED and genuinely denied", async () => {
        const laneDir = await scratchDir('lane');
        const outsideDir = await scratchDir('outside');
        const config = claudeCodeAdapterConfigSchema.parse({ transport: 'sdk', bare: run.bare });
        const adapter = new ClaudeCodeAdapter({
          config,
          env: realAmbientEnv(liveEnv, run.bare),
          now: () => Date.now(),
        });
        const baseRequest = {
          cwd: laneDir,
          systemPrompt: { mode: 'append' as const, text: '' },
          model: 'haiku',
          tools: { read: true, write: true, exec: false, network: 'none' } as const,
          permissionMode: 'deny-unlisted' as const,
          env: {},
          vetFileAccess: testVetFileAccess(laneDir),
        };

        // Both attempts run to completion, in full, before any check is made at all (`runChecks`'s own
        // doc comment has the full reasoning) -- the out-of-lane attempt below, and every check of it,
        // always runs regardless of whether the in-lane checks pass.
        const inLaneTarget = path.join(laneDir, 'write_inbounds.txt');
        const inLane = await runOneAttempt(adapter, {
          ...baseRequest,
          prompt: `Use the Write tool exactly once to create a new file at ${inLaneTarget} with content exactly: INBOUNDS_OK.`,
        });
        const inLaneContent = await readFileOrUndefined(inLaneTarget);

        const outOfLaneTarget = path.join(outsideDir, 'write_outbounds.txt');
        const outOfLane = await runOneAttempt(adapter, {
          ...baseRequest,
          prompt: `Use the Write tool exactly once to create a new file at ${outOfLaneTarget} with content exactly: OUTBOUNDS_SHOULD_BE_DENIED. Report SUCCESS or the exact denial text.`,
        });
        // The model genuinely ATTEMPTED it (a real tool.call for Write exists)...
        const toolResult = findToolResult(outOfLane.events, 'Write');
        const outOfLaneContent = await readFileOrUndefined(outOfLaneTarget);

        runChecks([
          ['in-lane attempt completed ok', inLane.ok],
          [
            'in-lane file was created with the real content',
            inLaneContent?.includes('INBOUNDS_OK') === true,
          ],
          ['out-of-lane attempt completed ok', outOfLane.ok],
          [
            'out-of-lane Write was genuinely attempted (a real tool.call exists)',
            toolResult !== undefined,
          ],
          // ...and was genuinely DENIED (the real tool.result is a failure, not a silent pass-through).
          ['out-of-lane Write was genuinely denied', toolResult?.ok === false],
          // Ground truth: the out-of-lane file was NEVER created on the real host filesystem -- the
          // exact thing that did NOT hold before this fix.
          [
            'out-of-lane file was never created on the real filesystem',
            outOfLaneContent === undefined,
          ],
        ]);
      }, 60_000);

      it('an in-lane Edit genuinely succeeds, and a genuinely out-of-lane Edit is genuinely ATTEMPTED and genuinely denied -- ground truth on the real filesystem plus the real tool.call/tool.result pair', async () => {
        const laneDir = await scratchDir('lane');
        const outsideDir = await scratchDir('outside');
        await writeFile(path.join(laneDir, 'existing.txt'), 'ORIGINAL');
        await writeFile(path.join(outsideDir, 'existing.txt'), 'ORIGINAL_OUTSIDE');
        const config = claudeCodeAdapterConfigSchema.parse({ transport: 'sdk', bare: run.bare });
        const adapter = new ClaudeCodeAdapter({
          config,
          env: realAmbientEnv(liveEnv, run.bare),
          now: () => Date.now(),
        });
        const baseRequest = {
          cwd: laneDir,
          systemPrompt: { mode: 'append' as const, text: '' },
          model: 'haiku',
          tools: { read: true, write: true, exec: false, network: 'none' } as const,
          permissionMode: 'deny-unlisted' as const,
          env: {},
          vetFileAccess: testVetFileAccess(laneDir),
        };

        // Both attempts run to completion, in full, before any check is made at all (`runChecks`'s own
        // doc comment) -- the out-of-lane attempt and every check of it always runs.
        const inLaneTarget = path.join(laneDir, 'existing.txt');
        const inLane = await runOneAttempt(adapter, {
          ...baseRequest,
          prompt: `Use the Edit tool exactly once on ${inLaneTarget} to replace the string ORIGINAL with EDITED_INLANE.`,
        });
        const inLaneContent = await readFileOrUndefined(inLaneTarget);

        const outOfLaneTarget = path.join(outsideDir, 'existing.txt');
        const outOfLane = await runOneAttempt(adapter, {
          ...baseRequest,
          prompt: `Call the Edit tool DIRECTLY as your very first action, with no Read call first (you already know its content is ORIGINAL_OUTSIDE), on ${outOfLaneTarget} to replace the string ORIGINAL_OUTSIDE with EDITED_OUTSIDE_SHOULD_BE_DENIED. If the Edit tool itself refuses to run without a prior Read, use the Read tool first, then Edit. Report SUCCESS or the exact denial text.`,
        });
        // Either the Edit call itself was attempted and denied, or (the real SDK's own Edit tool
        // contract, confirmed directly while building this fix: Edit requires a prior Read in the
        // same conversation) the mandatory prior Read was attempted and denied, which itself proves
        // the identical gate fires for Read too and transitively protects Edit. Either shape counts.
        const editResult = findToolResult(outOfLane.events, 'Edit');
        const readResult = findToolResult(outOfLane.events, 'Read');
        const outOfLaneContent = await readFileOrUndefined(outOfLaneTarget);

        runChecks([
          ['in-lane attempt completed ok', inLane.ok],
          ['in-lane file was genuinely edited', inLaneContent === 'EDITED_INLANE'],
          ['out-of-lane attempt completed ok', outOfLane.ok],
          [
            'out-of-lane Edit or its mandatory prior Read was genuinely attempted',
            editResult !== undefined || readResult !== undefined,
          ],
          ['out-of-lane Edit was genuinely denied (or never attempted)', !editResult?.ok],
          [
            "out-of-lane Edit's mandatory prior Read was genuinely denied (or never attempted)",
            !readResult?.ok,
          ],
          // Ground truth: the out-of-lane file was NEVER mutated -- still its original content.
          [
            'out-of-lane file was never mutated on the real filesystem',
            outOfLaneContent === 'ORIGINAL_OUTSIDE',
          ],
        ]);
      }, 60_000);

      it("an in-lane Read genuinely succeeds, and a genuinely out-of-lane Read is genuinely ATTEMPTED and genuinely denied -- the model never learns the out-of-lane file's own real content", async () => {
        const laneDir = await scratchDir('lane');
        const outsideDir = await scratchDir('outside');
        await writeFile(path.join(laneDir, 'ok.txt'), 'IN_LANE_CONTENT');
        await writeFile(path.join(outsideDir, 'secret.txt'), 'SECRET_OUTSIDE_CONTENT');
        const config = claudeCodeAdapterConfigSchema.parse({ transport: 'sdk', bare: run.bare });
        const adapter = new ClaudeCodeAdapter({
          config,
          env: realAmbientEnv(liveEnv, run.bare),
          now: () => Date.now(),
        });
        const baseRequest = {
          cwd: laneDir,
          systemPrompt: { mode: 'append' as const, text: '' },
          model: 'haiku',
          tools: { read: true, write: false, exec: false, network: 'none' } as const,
          permissionMode: 'deny-unlisted' as const,
          env: {},
          vetFileAccess: testVetFileAccess(laneDir),
        };

        // Both attempts run to completion, in full, before any check is made at all (`runChecks`'s own
        // doc comment has the full reasoning, including the exact reproducible in-lane `finalText`
        // failure under non-bare auth mode this restructuring exists to stop from hiding the
        // out-of-lane denial checks below).
        const inLaneTarget = path.join(laneDir, 'ok.txt');
        const inLane = await runOneAttempt(adapter, {
          ...baseRequest,
          prompt: `Use the Read tool exactly once to read ${inLaneTarget} and report its exact content.`,
        });

        const outOfLaneTarget = path.join(outsideDir, 'secret.txt');
        const outOfLane = await runOneAttempt(adapter, {
          ...baseRequest,
          prompt: `Use the Read tool exactly once to read ${outOfLaneTarget} and report either its exact content or the exact denial text.`,
        });
        const toolResult = findToolResult(outOfLane.events, 'Read');

        runChecks([
          ['in-lane attempt completed ok', inLane.ok],
          [
            'in-lane finalText contains the real in-lane content',
            inLane.finalText.includes('IN_LANE_CONTENT'),
          ],
          ['out-of-lane attempt completed ok', outOfLane.ok],
          [
            'out-of-lane Read was genuinely attempted (a real tool.call exists)',
            toolResult !== undefined,
          ],
          ['out-of-lane Read was genuinely denied', toolResult?.ok === false],
          // The real secret content never reaches the model's own final text -- a real, observable
          // denial stood in its place, not a silent pass-through of the out-of-lane file's content.
          [
            "the out-of-lane file's real content never reached the model's own final text",
            !outOfLane.finalText.includes('SECRET_OUTSIDE_CONTENT'),
          ],
        ]);
      }, 60_000);
    });
  }
}
