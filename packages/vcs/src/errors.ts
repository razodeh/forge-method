/**
 * `VcsError` — this package's own typed, actionable error. `vcs ← schemas` only (`specs/02` §2.2), no
 * `core` edge, so `@forge/core/errors`'s real `ForgeError` registry is structurally unreachable here —
 * the same position-in-the-graph reason `@forge/adapter-kit`/`@forge/testkit` never throw it either
 * (`SPEC-QUESTIONS.md` Q58 point 15). `@forge/engine` (which has both `core` and `vcs`) is where a
 * caught `VcsError` is wrapped into a real `ForgeError` carrying a matching registered code — this
 * class carries the same three load-bearing fields (`code`, `message`, `remedy`) `ForgeError` itself
 * exposes, so that wrap can be lossless.
 *
 * @see specs/02 §2.6
 * @see SPEC-QUESTIONS.md Q62
 */

export interface VcsErrorInit {
  readonly code: string;
  readonly message: string;
  readonly remedy: string;
  /** Structured facts a caller can turn into its own message without parsing `message` (the dirty file
   * list of `VCS-DIRTY-TREE`, say). Never load-bearing for `message`/`remedy`, which stand alone. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export class VcsError extends Error {
  override readonly name = 'VcsError';
  readonly code: string;
  readonly remedy: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(init: VcsErrorInit, options: { cause?: unknown } = {}) {
    super(init.message, options);
    this.code = init.code;
    this.remedy = init.remedy;
    this.details = init.details;
  }
}
