/**
 * `GenericAdapter` — `07` §7.5's own declarative CLI adapter: a real `PlatformAdapter` implementation
 * driven entirely by a parsed `adapter.yaml` (`config/parse.ts`), no adapter-specific code per external
 * tool. Ties together capability reporting (`capabilities.ts`), preflight (`preflight.ts`), and the real
 * session lifecycle (`session-stream.ts`/`session-handle.ts`).
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AdapterCapabilities,
  ModelInfo,
  PlatformAdapter,
  PreflightContext,
  PreflightResult,
  ResumeRequest,
  SessionHandle,
  SessionRequest,
} from '@forge/adapter-kit';

import { genericCapabilities } from './capabilities.ts';
import type { AdapterYamlConfig } from './config/schema.ts';
import { runGenericPreflight, type GenericBinaryRunner } from './preflight.ts';
import { makeSessionHandle } from './session-handle.ts';
import { runGenericSession } from './session-stream.ts';

export interface GenericAdapterOptions {
  readonly config: AdapterYamlConfig;
  /** A real ambient-environment snapshot (e.g. `PATH`) the *caller* has decided is safe to expose —
   * never read from `process.env` inside this class itself (R10). Merged with `config.invoke.env`
   * then `req.env`, in that order, before the child process ever spawns; `req.env` wins on an
   * overlapping key, mirroring `@forge/adapter-claude-code`'s own identical merge precedence. */
  readonly env: Readonly<Record<string, string>>;
  /** Injected, never read ambiently (R10) — this package has no `@forge/core` edge to hold a real
   * clock of its own. */
  readonly now: () => number;
  /** A real, existing, writable directory this adapter creates per-session scratch subdirectories
   * under, for `invoke.stdin: none`'s own `{{promptFile}}` and `result.finalTextFrom: file:{{outFile}}`
   * -- never `os.tmpdir()` directly (R10: host facts come from the config layer, the identical
   * discipline `@forge/vcs`'s own `fetchGitOverlay` `workDir` parameter already establishes). */
  readonly scratchDir: string;
  readonly binaryRunner?: GenericBinaryRunner;
}

export class GenericAdapter implements PlatformAdapter {
  readonly id: string;
  readonly displayName: string;

  private readonly config: AdapterYamlConfig;
  private readonly env: Readonly<Record<string, string>>;
  private readonly now: () => number;
  private readonly scratchDir: string;
  private readonly binaryRunner: GenericBinaryRunner | undefined;
  private sessionCounter = 0;

  constructor(options: GenericAdapterOptions) {
    this.id = options.config.id;
    this.displayName = options.config.displayName;
    this.config = options.config;
    this.env = options.env;
    this.now = options.now;
    this.scratchDir = options.scratchDir;
    this.binaryRunner = options.binaryRunner;
  }

  capabilities(): Promise<AdapterCapabilities> {
    return Promise.resolve(genericCapabilities(this.config));
  }

  preflight(ctx: PreflightContext): Promise<PreflightResult> {
    return runGenericPreflight(ctx, this.config, this.binaryRunner);
  }

  /** `07` §7.5's own schema has no model-catalog field at all — `SessionRequest.model` is passed
   * straight through to `{{model}}` with no adapter-level enumeration to validate a tier mapping
   * against. An honestly empty list, not an invented one, is the disclosed reading (`SPEC-QUESTIONS.md`).
   */
  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.resolve([]);
  }

  resumeSession(sessionId: string, req: ResumeRequest): Promise<SessionHandle> {
    // `07` §7.6 C9 (resume) is skipped whenever `capabilities().sessionResume` is `false`
    // (`@forge/adapter-kit/conformance`'s own honest-capability-gating design) -- this method still
    // needs a real, fail-closed body for a caller that ignores that and calls it anyway, rather than
    // silently starting a fresh, context-free session under a resumed session's own id.
    return Promise.reject(
      new Error(
        `@forge/adapter-generic: adapter "${this.config.id}" declares capabilities.sessionResume: ` +
          `false; session "${sessionId}" cannot be resumed with the probe prompt "${req.prompt}".`,
      ),
    );
  }

  async startSession(req: SessionRequest): Promise<SessionHandle> {
    if (this.config.events.format !== 'ndjson') {
      throw new Error(
        `@forge/adapter-generic: adapter "${this.config.id}" declares events.format: ` +
          `"${this.config.events.format}", which this package does not implement (only 'ndjson' is ` +
          "real in this milestone -- see events-map.ts's own doc comment).",
      );
    }
    if (this.config.files.changeDetection !== 'git-status') {
      throw new Error(
        `@forge/adapter-generic: adapter "${this.config.id}" declares files.changeDetection: ` +
          `"${this.config.files.changeDetection}", which this package does not implement (only ` +
          "'git-status' is real in this milestone -- see changed-files.ts's own doc comment).",
      );
    }

    this.sessionCounter += 1;
    const sessionId = `generic-${this.config.id}-${String(this.sessionCounter)}`;

    const sessionScratchDir = await mkdtemp(path.join(this.scratchDir, 'forge-adapter-generic-'));
    const outFile = path.join(sessionScratchDir, 'out.txt');
    let promptFile: string | undefined;
    if (this.config.invoke.stdin === 'none') {
      promptFile = path.join(sessionScratchDir, 'prompt.txt');
      await writeFile(promptFile, req.prompt, 'utf8');
    }

    // A caller-owned `req.abortSignal` cannot itself be `.abort()`-ed by this adapter -- this inner
    // controller is what `SessionHandle.stop()` actually triggers, wired to fire whenever the
    // caller's own signal does too, mirroring `@forge/adapter-claude-code`'s own identical shape.
    const abortController = new AbortController();
    if (req.abortSignal.aborted) {
      abortController.abort();
    } else {
      req.abortSignal.addEventListener('abort', () => {
        abortController.abort();
      });
    }

    // `07` §7.2: "Never pass secrets in prompt. Secrets reach the session only via env and only when
    // the step's grant includes them." `req.env` wins last, so a session's own grant-scoped secrets
    // never lose to a static `invoke.env` value that happens to share a key.
    const binaryEnv: Readonly<Record<string, string>> = {
      ...this.env,
      ...(this.config.invoke.env ?? {}),
      ...req.env,
    };

    const createGenerator = () =>
      runGenericSession({
        config: this.config,
        req,
        sessionId,
        binaryEnv,
        promptFile,
        outFile,
        now: this.now,
        abortSignal: abortController.signal,
      });

    return makeSessionHandle(sessionId, createGenerator, () => {
      abortController.abort();
      return Promise.resolve();
    });
  }
}
