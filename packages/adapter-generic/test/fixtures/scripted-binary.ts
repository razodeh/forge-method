#!/usr/bin/env node --experimental-strip-types
/**
 * The scripted external binary fixture `07` §7.5/§7.6's own conformance suite needs and no existing
 * precedent covers (`@forge/testkit`'s `FakePlatformAdapter` is in-process, never a spawned process).
 * A real, standalone process — run via `node --experimental-strip-types` (this repository's own
 * no-build-step convention; see `packages/engine/test/e2e/fixtures/run-engine-child.ts` and
 * `packages/adapter-claude-code/test/conformance/fixtures/mcp-server.ts` for the identical pattern) —
 * that stands in for the real external CLI tool a `07` §7.5 `adapter.yaml` names as `binary`.
 *
 * Invocation shape mirrors a real `07` §7.5 target binary as closely as this fixture can, plus exactly
 * one fixture-only control flag:
 *
 *   scripted-binary.ts --forge-fixture-table <path-to-json> [--version]
 *                       [--prompt-file <path>] [--cwd <path>] [--model <id>] [...any other flag]
 *
 * `--forge-fixture-table <path>` names a JSON file holding a `ScriptedBinaryTable` (see
 * `scripted-binary-protocol.ts`) — the one flag no real `invoke.args` template would ever produce,
 * spelled with a `forge-fixture-` prefix precisely so it can never collide with a real adapter's own
 * templated arguments. Every other flag here is exactly what `07` §7.5's own worked-example
 * `invoke.args` would produce for a real tool, so a real `GenericAdapter` under test genuinely
 * exercises its own real argument templating, not a fixture-shaped stand-in for it.
 *
 * `--version` (matching `07` §7.5's own `versionCommand: ["--version"]`) short-circuits everything
 * else: prints `v{table.version ?? DEFAULT_VERSION}` and exits 0, regardless of any other flag —
 * `PlatformAdapter` preflight (`@forge/adapter-claude-code`'s own `preflight.ts` precedent) always
 * probes this before ever starting a session.
 *
 * Every other invocation resolves a prompt (from `--prompt-file`, or from stdin if that flag is
 * absent — `07` §7.5's own `invoke.stdin: none | prompt` choice), matches it against the table via
 * `matchScriptedEntry`, and emits the matched `ScriptedBinaryResponse` as real, line-delimited events
 * on stdout in `07` §7.5's own worked-example NDJSON source vocabulary (`message`/`tool_call`), plus
 * two disclosed extensions (`usage`/`result`) for capabilities the worked example's own sample
 * `adapter.yaml` does not exercise. See `scripted-binary-protocol.ts` for the full field-by-field
 * contract, including the three real failure-injection modes (`errorInfo`/non-zero `exitCode`,
 * `hang`, `malformedLine`) `07` §7.6's own C5/C6/C11 need.
 *
 * @see specs/07 §7.5
 * @see specs/07 §7.6
 * @see PLAN-M11.md P8
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_VERSION,
  matchScriptedEntry,
  type ScriptedBinaryResponse,
  type ScriptedBinaryTable,
  type ScriptedFileWrite,
} from './scripted-binary-protocol.ts';

interface ParsedArgv {
  readonly raw: readonly string[];
  readonly version: boolean;
  readonly tablePath: string | undefined;
  readonly promptFile: string | undefined;
  readonly cwd: string | undefined;
  readonly model: string | undefined;
}

function parseArgv(argv: readonly string[]): ParsedArgv {
  let tablePath: string | undefined;
  let promptFile: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  let version = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version') {
      version = true;
    } else if (arg === '--forge-fixture-table') {
      i += 1;
      tablePath = argv[i];
    } else if (arg === '--prompt-file') {
      i += 1;
      promptFile = argv[i];
    } else if (arg === '--cwd') {
      i += 1;
      cwd = argv[i];
    } else if (arg === '--model') {
      i += 1;
      model = argv[i];
    }
  }
  return { raw: argv, version, tablePath, promptFile, cwd, model };
}

function readTable(tablePath: string | undefined): ScriptedBinaryTable {
  if (tablePath === undefined) return { entries: [] };
  const contents = readFileSync(tablePath, 'utf8');
  // Trusted-input cast, not an unchecked one: this file is a test fixture whose one caller is this
  // package's own test suite (never a hostile or independently-authored input), matching the
  // identical `JSON.parse(...) as {...}` precedent `test/workspace-floor.test.ts` already uses for
  // its own trusted `package.json` reads. A real production adapter reading a real `adapter.yaml`
  // (a later piece, P7) parses that file with real schema validation instead.
  return JSON.parse(contents) as ScriptedBinaryTable;
}

/** Reads stdin to completion as UTF-8 text, or resolves to `''` immediately if stdin is a TTY (no
 * piped input at all — the `invoke.stdin: none` case, where no prompt is expected). */
async function readStdinPrompt(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** `"<name>=<value>"` for each of `names`, read from THIS process's own real, inherited environment --
 * never `process.env` in this file's own source (`R10`; this file is a fixture, not the test harness
 * itself, so the ordinary ambient-read ban applies to it exactly like production code). A real
 * grandchild `node -e` process, spawned with no `env` override, inherits this process's own real
 * environment by default (`child_process`'s ordinary behaviour) and reports it back over its own
 * stdout; the string script text below is data to that grandchild, not a JS token this file's own AST
 * exposes. `PLAN-M14.md` P4's own env-passthrough conformance check needs this: proving
 * `SessionRequest.env` reaches a real, separately-spawned OS process (this one), not merely an
 * in-process object a mocked spawn call captured. */
function envEchoLines(names: readonly string[]): string[] {
  const script =
    `${JSON.stringify(names)}.forEach((n) => ` +
    `process.stdout.write(n + '=' + (process.env[n] || '') + '\\n'));`;
  const output = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  return output.split('\n').filter((line) => line !== '');
}

/** Resolves `relativePath` against `cwd`, or `undefined` if it would land outside `cwd` — by `..`
 * traversal, by itself naming an absolute path, or by `cwd` itself being absent/non-absolute. Mirrors
 * `@forge/testkit`'s own `resolveInsideCwd` (`fake-adapter.ts`) exactly, for the identical reason: a
 * scripted `relativePath` is caller-supplied table data this fixture must not blindly trust, and `07`
 * §7.6 C2's own cwd-isolation guarantee is exactly the property a fixture with no containment check
 * could never let a later conformance test exercise the negative side of. Refusing outright when
 * `cwd` is missing (rather than defaulting to `.`, i.e. this fixture's own real launching directory)
 * is the fix for a real gap a fresh critic round found in an earlier draft: a table author who forgot
 * `--cwd` — or a later `GenericAdapter` conformance test that omitted it by mistake — must never
 * silently write into wherever this process happened to be started from; that is the exact hazard
 * this containment check exists to close, not a case it can afford to fall through on. */
function resolveInsideCwd(cwd: string | undefined, relativePath: string): string | undefined {
  if (cwd === undefined || !path.isAbsolute(cwd)) return undefined;
  if (path.isAbsolute(relativePath)) return undefined;
  const resolved = path.resolve(cwd, relativePath);
  const relative = path.relative(cwd, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return resolved;
}

/** Returns the real, absolute path written on success, or `undefined` if `file.relativePath` would
 * have escaped `cwd` — refused rather than written, never silently redirected or truncated. */
function writeScriptedFile(cwd: string | undefined, file: ScriptedFileWrite): string | undefined {
  const target = resolveInsideCwd(cwd, file.relativePath);
  if (target === undefined) return undefined;
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, file.content, 'utf8');
  return target;
}

/** Emits every configured event for `response`, in a fixed, documented order, then returns the exit
 * code the caller should use — everything through this function's return is synchronous console
 * output plus real (but fast, local) file writes; only the caller's own post-return delay/hang
 * handling is asynchronous, so the ordering here is not at the mercy of an event-loop interleaving. */
function emitResponse(response: ScriptedBinaryResponse, cwd: string | undefined): number {
  if (response.malformedLine === true) {
    // Deliberately not valid JSON: `07` §7.6's own malformed-output failure-injection need. A raw,
    // human-looking sentence rather than e.g. truncated JSON, so it cannot coincidentally parse.
    writeLine('this line is not valid ndjson on purpose');
  }

  for (const text of response.text ?? []) {
    writeLine(JSON.stringify({ type: 'message', role: 'assistant', content: text }));
  }

  if (response.envEcho !== undefined && response.envEcho.length > 0) {
    for (const line of envEchoLines(response.envEcho)) {
      writeLine(JSON.stringify({ type: 'message', role: 'assistant', content: line }));
    }
  }

  for (const call of response.toolCalls ?? []) {
    writeLine(JSON.stringify({ type: 'tool_call', tool: call.tool, args: call.args ?? {} }));
  }

  for (const file of response.writeFiles ?? []) {
    const written = writeScriptedFile(cwd, file);
    writeLine(
      JSON.stringify({
        type: 'tool_call',
        tool: 'write_file',
        args:
          written !== undefined
            ? { path: file.relativePath }
            : { path: file.relativePath, refused: true, reason: 'resolves outside the invocation cwd' },
      }),
    );
  }

  if (response.outFile !== undefined) {
    // No event channel exists for this one (07 §7.5's own file:{{outFile}} is a plain file read, never
    // a reported event) — an escaping outFile is refused identically (nothing written outside cwd),
    // just silently, matching the channel's own silent-on-success shape.
    writeScriptedFile(cwd, response.outFile);
  }

  if (response.usage !== undefined) {
    writeLine(
      JSON.stringify({
        type: 'usage',
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      }),
    );
  }

  if (response.structured !== undefined) {
    writeLine(JSON.stringify({ type: 'result', structured: response.structured }));
  }

  if (response.errorInfo !== undefined) {
    writeLine(
      JSON.stringify({ type: 'error', code: response.errorInfo.code, message: response.errorInfo.message }),
    );
    return response.exitCode ?? 1;
  }

  if (response.exitCode !== undefined && response.exitCode !== 0) {
    // A non-zero exit with no typed error line: an external tool that merely died, distinct from one
    // that surfaced a proper error (07 §7.6 C11 needs to be able to tell the two apart).
    return response.exitCode;
  }

  if (!(response.omitDone ?? false)) {
    writeLine(JSON.stringify({ type: 'done' }));
  }

  return response.exitCode ?? 0;
}

async function main(): Promise<void> {
  const parsed = parseArgv(process.argv.slice(2));
  const table = readTable(parsed.tablePath);

  if (parsed.version) {
    writeLine(`v${table.version ?? DEFAULT_VERSION}`);
    process.exitCode = 0;
    return;
  }

  const prompt = parsed.promptFile !== undefined ? readFileSync(parsed.promptFile, 'utf8') : await readStdinPrompt();

  const response = matchScriptedEntry(table, {
    argv: parsed.raw,
    prompt,
    model: parsed.model,
    cwd: parsed.cwd,
  });

  if (response.hang === true) {
    // 07 §7.6 C5's own fixture need: everything else is honoured first (a hang can be scripted after
    // some real output), then this process refuses to exit on its own. SIGTERM/SIGINT are explicitly
    // ignored (registering a no-op handler, not merely omitting one, since Node's own default action
    // for both is to exit) — only a SIGKILL from the caller can end it, the realistic "no orphan
    // child processes" proof a cooperative-exit fixture could never provide.
    // omitDone: true, always -- a hang must never send `done` (emitResponse's own default behaviour
    // otherwise would, once past the text/toolCalls/etc. loops below), regardless of what else this
    // response scripted.
    emitResponse({ ...response, omitDone: true }, parsed.cwd);
    process.on('SIGTERM', () => undefined);
    process.on('SIGINT', () => undefined);
    // A bare `await new Promise(() => {})` is not enough to actually hang: with no other active
    // handle, Node's own "unsettled top-level await" idle detection exits the process anyway once its
    // event loop has nothing left to do, entirely independent of the SIGTERM/SIGINT listeners above --
    // confirmed by a fresh critic round's own repro, which found the process exiting cleanly before a
    // signal was ever even sent. A real, ref'd, effectively-infinite interval is a genuine libuv handle
    // that keeps the loop alive, matching what an actual long-running external tool's own real work
    // (a live subprocess, an open socket) would do.
    setInterval(() => undefined, 2_147_483_647);
    await new Promise<never>(() => {
      // Deliberately never settles.
    });
    return;
  }

  const exitCode = emitResponse(response, parsed.cwd);

  if (response.delayMsBeforeExit !== undefined) {
    await new Promise((resolve) => setTimeout(resolve, response.delayMsBeforeExit));
  }

  process.exitCode = exitCode;
}

await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
