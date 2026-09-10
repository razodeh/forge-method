/**
 * `ConformanceContext` — the shared adapter handle, capability snapshot, and `SessionRequest` builder
 * every C1–C16 test group needs, assembled once by `runAdapterConformanceSuite`'s own `beforeAll` and
 * threaded into each group's registration function.
 *
 * @see PLAN-M4.md P4
 */
import type { AdapterCapabilities } from '../types/capabilities.ts';
import type { PlatformAdapter } from '../types/adapter.ts';
import type { SessionRequest } from '../types/session.ts';
import type { ConformanceOptions } from './fixtures.ts';

export interface ConformanceContext {
  readonly options: ConformanceOptions;
  /** Only valid once `beforeAll` has run — every test body is registered before that, but only ever
   * executes after it, the ordinary vitest `beforeAll`/`it` guarantee. */
  getAdapter(): PlatformAdapter;
  getCapabilities(): AdapterCapabilities;
  /** A `SessionRequest` with every field defaulted to a permissive, deterministic baseline
   * (`tools: { read: true, write: true, exec: false, network: 'none' }`, `permissionMode: 'auto'`, no
   * limits, no env) — a test overrides only the fields its own row actually needs to vary. */
  buildRequest(
    overrides: Partial<SessionRequest> & Pick<SessionRequest, 'cwd' | 'prompt'>,
  ): SessionRequest;
}

export function createConformanceContext(options: ConformanceOptions): {
  readonly context: ConformanceContext;
  readonly setAdapter: (adapter: PlatformAdapter) => void;
  readonly setCapabilities: (capabilities: AdapterCapabilities) => void;
} {
  let adapter: PlatformAdapter | undefined;
  let capabilities: AdapterCapabilities | undefined;
  let requestCounter = 0;

  const context: ConformanceContext = {
    options,
    getAdapter(): PlatformAdapter {
      if (adapter === undefined) {
        throw new Error('ConformanceContext.getAdapter() called before beforeAll assigned it.');
      }
      return adapter;
    },
    getCapabilities(): AdapterCapabilities {
      if (capabilities === undefined) {
        throw new Error(
          'ConformanceContext.getCapabilities() called before beforeAll assigned it.',
        );
      }
      return capabilities;
    },
    buildRequest(overrides): SessionRequest {
      requestCounter += 1;
      return {
        runId: 'conformance-run',
        stepId: `conformance-step-${String(requestCounter)}`,
        systemPrompt: { mode: 'append', text: '' },
        model: options.validModel,
        tools: { read: true, write: true, exec: false, network: 'none' },
        permissionMode: 'auto',
        limits: {},
        env: {},
        abortSignal: new AbortController().signal,
        ...overrides,
      };
    },
  };

  return {
    context,
    setAdapter: (value: PlatformAdapter) => {
      adapter = value;
    },
    setCapabilities: (value: AdapterCapabilities) => {
      capabilities = value;
    },
  };
}
