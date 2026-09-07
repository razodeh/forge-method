/**
 * `TelemetryError` — this package's own typed, actionable error. `telemetry ← schemas` only
 * (`specs/02` §2.2), no `core` edge, so `@forge/core/errors`'s real `ForgeError` registry is
 * structurally unreachable here — the same position-in-the-graph reason `@forge/vcs` never throws it
 * either (`SPEC-QUESTIONS.md` Q62, `VcsError`). `@forge/engine` (which has both `core` and `telemetry`)
 * is where a caught `TelemetryError` is wrapped into a real `ForgeError` carrying a matching registered
 * code — this class carries the same three load-bearing fields (`code`, `message`, `remedy`)
 * `ForgeError` itself exposes, so that wrap can be lossless.
 *
 * @see specs/02 §2.6
 * @see SPEC-QUESTIONS.md Q62
 */

export interface TelemetryErrorInit {
  readonly code: string;
  readonly message: string;
  readonly remedy: string;
}

export class TelemetryError extends Error {
  override readonly name = 'TelemetryError';
  readonly code: string;
  readonly remedy: string;

  constructor(init: TelemetryErrorInit, options: { cause?: unknown } = {}) {
    super(init.message, options);
    this.code = init.code;
    this.remedy = init.remedy;
  }
}
