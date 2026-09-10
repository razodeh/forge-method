/**
 * `AdapterEvent` — `07` §7.2's own streamed event union, verbatim. The Zod mirror used to validate a
 * raw, adapter-produced object against this exact shape (`normalizeAdapterEvent`) is
 * `@forge/adapter-kit/events`, not here — this file is the type only, since `SessionHandle`/
 * `SessionResult` (this same piece) both need it too.
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P1
 */
import type { ForgeControlToken } from './control-tokens.ts';

export type AdapterEvent =
  | {
      readonly type: 'session.started';
      readonly sessionId: string;
      readonly model: string;
      readonly tools: readonly string[];
      readonly meta: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'text';
      readonly text: string;
      readonly partial: boolean;
      // `| undefined` (not just `?`), matching what `adapterEventSchema`'s own Zod `.optional()`
      // fields actually produce under `exactOptionalPropertyTypes`: a key Zod parsed from an input
      // that never had it comes out `undefined`-valued, not omitted — TS cannot distinguish the two
      // cases in an optional field's own inferred type either way.
      readonly agentPath?: readonly string[] | undefined;
    }
  | { readonly type: 'thinking'; readonly text: string }
  | {
      readonly type: 'tool.call';
      readonly id: string;
      readonly name: string;
      // `?:`, not a required field: Zod infers any `z.unknown()`-typed object field as optional-key
      // (a known Zod behaviour, not a modelling choice) — matched here so `adapterEventSchema`'s own
      // parsed output is directly assignable without a cast.
      readonly input?: unknown;
      readonly agentPath?: readonly string[] | undefined;
    }
  | {
      readonly type: 'tool.result';
      readonly id: string;
      readonly ok: boolean;
      readonly summary: string;
      readonly bytes?: number | undefined;
    }
  | {
      readonly type: 'file.changed';
      readonly path: string;
      readonly change: 'created' | 'modified' | 'deleted';
    }
  // `07` §7.2's own literal shape: `token` names *which* control token this is; `payload` is that
  // token's own associated data, loosely typed here since a live-streamed event has not necessarily
  // been schema-validated yet (`SessionResult.controlTokens` carries the fully-typed, validated
  // `ParsedControlToken[]` once the session ends — see `session.ts`).
  | { readonly type: 'control'; readonly token: ForgeControlToken; readonly payload?: unknown }
  | {
      readonly type: 'retry';
      readonly attempt: number;
      readonly maxRetries: number;
      readonly reason: string;
      readonly delayMs: number;
    }
  | {
      readonly type: 'usage';
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cacheReadTokens?: number | undefined;
      readonly costUsd?: number | undefined;
    }
  | {
      readonly type: 'error';
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
    }
  | { readonly type: 'session.ended'; readonly reason: 'complete' | 'aborted' | 'error' | 'limit' };
