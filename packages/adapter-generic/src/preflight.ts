/**
 * `runGenericPreflight` — `07` §7.2's own `preflight(ctx): Promise<PreflightResult>`, made real for the
 * declarative binding: `07` §7.3's own normative mandate ("MUST run `<binary> --version`, parse it, and
 * compare against a `minimumVersion` constant") applied generically, against `07` §7.5's own
 * `versionCommand`/`versionRegex`/`minimumVersion` config fields instead of a hardcoded CLI.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
import { execa } from 'execa';

import type { PreflightContext, PreflightIssue, PreflightResult } from '@forge/adapter-kit';

import type { AdapterYamlConfig } from './config/schema.ts';

export interface GenericBinaryRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Injectable, defaulting to the real `execa` spawn — this package's own established "inject the real
 * dependency, default to the real implementation" convention, matching
 * `@forge/adapter-claude-code`'s own `ClaudeCliRunner`. Never throws: a missing binary or any other
 * spawn failure resolves to a real, honest `exitCode: -1` result. */
export type GenericBinaryRunner = (
  binary: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  cwd: string,
) => Promise<GenericBinaryRunResult>;

export const realGenericBinaryRunner: GenericBinaryRunner = async (binary, args, env, cwd) => {
  try {
    const result = await execa(binary, [...args], { env, extendEnv: false, reject: false, cwd });
    return { exitCode: result.exitCode ?? -1, stdout: result.stdout, stderr: result.stderr };
  } catch {
    return { exitCode: -1, stdout: '', stderr: '' };
  }
};

export interface BinaryVersionProbe {
  readonly ok: boolean;
  /** Present whenever a version string was successfully extracted, even one below the minimum. */
  readonly version?: string;
}

function parseVersionParts(version: string): readonly [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) return undefined;
  const [, major, minor, patch] = match;
  return [Number(major), Number(minor), Number(patch)];
}

function compareVersions(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

/**
 * Runs `config.versionCommand` (default `['--version']`) against `config.binary`, extracts a version
 * via `config.versionRegex` (its own first capture group, or the whole match if it has none — the
 * worked example's own `"v?(\\d+\\.\\d+\\.\\d+)"` has exactly one), and compares against
 * `config.minimumVersion`. Never throws: a missing binary, a non-zero exit, an unparseable
 * `versionRegex` itself, or output that regex does not match all resolve to `{ ok: false }`.
 *
 * Matched against `stdout` *and* `stderr` combined (round-1 critic finding): many real CLIs print
 * `--version` output to stderr, not stdout — reading only `stdout` (this file's own original version)
 * misreported a correctly-installed, on-`PATH` binary as `ADP-GENERIC-BINARY-NOT-FOUND`, a false-
 * negative preflight failure for a real, working install. Both streams are searched (stdout first, so a
 * tool that oddly writes to both is not ambiguous) rather than guessing which one a given bound tool
 * uses.
 */
export async function probeBinaryVersion(
  config: AdapterYamlConfig,
  env: Readonly<Record<string, string>>,
  cwd: string,
  runner: GenericBinaryRunner = realGenericBinaryRunner,
): Promise<BinaryVersionProbe> {
  const args = config.versionCommand ?? ['--version'];
  const result = await runner(config.binary, args, env, cwd);
  if (result.exitCode !== 0) return { ok: false };

  let regex: RegExp;
  try {
    regex = new RegExp(config.versionRegex);
  } catch {
    return { ok: false };
  }
  const match = regex.exec(result.stdout) ?? regex.exec(result.stderr);
  if (match === null) return { ok: false };
  const version = match[1] ?? match[0];

  const parsedActual = parseVersionParts(version);
  const parsedMinimum = parseVersionParts(config.minimumVersion);
  if (parsedActual === undefined || parsedMinimum === undefined) return { ok: false, version };
  return { ok: compareVersions(parsedActual, parsedMinimum) >= 0, version };
}

export async function runGenericPreflight(
  ctx: PreflightContext,
  config: AdapterYamlConfig,
  runner?: GenericBinaryRunner,
): Promise<PreflightResult> {
  const probe = await probeBinaryVersion(config, ctx.env, ctx.projectRoot, runner);
  const issues: PreflightIssue[] = [];

  if (!probe.ok) {
    issues.push(
      probe.version === undefined
        ? {
            code: 'ADP-GENERIC-BINARY-NOT-FOUND',
            message: `The ${config.binary} binary is not reachable on PATH.`,
            remedy: `Install ${config.displayName} and ensure ${config.binary} is on PATH.`,
          }
        : {
            code: 'ADP-GENERIC-BINARY-OUTDATED',
            message: `The installed ${config.binary} is version ${probe.version}, below the required ${config.minimumVersion}.`,
            remedy: `Upgrade ${config.binary} to at least ${config.minimumVersion}.`,
          },
    );
  }

  return {
    ok: issues.length === 0,
    ...(probe.version === undefined ? {} : { version: probe.version }),
    issues,
  };
}
