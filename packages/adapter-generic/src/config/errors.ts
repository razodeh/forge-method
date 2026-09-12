/**
 * `GenericAdapterConfigError` — this package's own typed, actionable error, matching `@forge/telemetry`'s
 * `TelemetryError`/`@forge/vcs`'s `VcsError` precedent exactly: `code`/`message`/`remedy`. This
 * package's own declared graph row is `['adapter-kit', 'schemas', 'telemetry']` — no `core` edge — so
 * `@forge/core/errors`'s real `ForgeError` registry is structurally unreachable here, the identical
 * position-in-the-graph reason those two sibling packages each define their own equivalent class rather
 * than import one.
 *
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */

export interface GenericAdapterConfigErrorInit {
  readonly code: string;
  readonly message: string;
  readonly remedy: string;
}

export class GenericAdapterConfigError extends Error {
  override readonly name = 'GenericAdapterConfigError';
  readonly code: string;
  readonly remedy: string;

  constructor(init: GenericAdapterConfigErrorInit, options: { cause?: unknown } = {}) {
    super(init.message, options);
    this.code = init.code;
    this.remedy = init.remedy;
  }
}
