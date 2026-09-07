/**
 * `SessionRequest`/`SessionHandle`/`SessionResult`/`ResumeRequest` — `07` §7.2's own session
 * lifecycle shapes, verbatim where given. `ResumeRequest` is not elaborated anywhere in the spec pack
 * (`SPEC-QUESTIONS.md` Q58 point 4): a resume is a new instruction to continue with, not a full new
 * session, so it reuses `SessionRequest`'s own `SessionLimits` shape rather than inventing a second one.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P1
 */
import type { AdapterEvent } from './events.ts';
import type { ParsedControlToken } from './control-tokens.ts';
import type { JSONSchema } from './json-schema.ts';
import type { ToolGrant } from './tool-grant.ts';

export interface SessionLimits {
  readonly maxTurns?: number;
  readonly wallClockMs?: number;
  readonly maxCostUsd?: number;
}

export interface SessionAttachment {
  readonly path: string;
  readonly role: 'input' | 'reference';
}

export interface SessionRequest {
  readonly runId: string;
  readonly stepId: string;
  /** Lane worktree. */
  readonly cwd: string;
  readonly systemPrompt: { readonly mode: 'append' | 'replace'; readonly text: string };
  /** The step brief, already context-packed. */
  readonly prompt: string;
  /** Resolved from tier. */
  readonly model: string;
  readonly thinking?: 'none' | 'low' | 'medium' | 'high';
  /** FORGE-neutral grant; the adapter maps it. */
  readonly tools: ToolGrant;
  readonly permissionMode: 'manual' | 'accept-edits' | 'deny-unlisted' | 'auto';
  readonly limits: SessionLimits;
  /** Never includes secrets not explicitly granted. */
  readonly env: Readonly<Record<string, string>>;
  /** When structured output is required. */
  readonly outputSchema?: JSONSchema;
  readonly attachments?: readonly SessionAttachment[];
  readonly abortSignal: AbortSignal;
}

export interface ResumeRequest {
  readonly prompt: string;
  readonly limits: SessionLimits;
  readonly abortSignal: AbortSignal;
}

export interface SessionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd?: number;
  readonly turns: number;
}

export interface SessionResult {
  readonly sessionId: string;
  readonly ok: boolean;
  readonly finalText: string;
  readonly structured?: unknown;
  readonly usage: SessionUsage;
  readonly durationMs: number;
  readonly changedFiles: readonly string[];
  readonly controlTokens: readonly ParsedControlToken[];
  readonly error?: { readonly code: string; readonly message: string };
}

export interface SessionHandle {
  readonly sessionId: string;
  readonly events: AsyncIterable<AdapterEvent>;
  interject?(text: string): Promise<void>;
  stop(reason: string): Promise<void>;
  /** Resolves after the stream ends. */
  result(): Promise<SessionResult>;
}
