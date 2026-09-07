/**
 * `ForgeControlToken`/`ParsedControlToken` — the closed set of `FORGE_*` tokens `05` §5.4 point 4,
 * §5.5 and §15.4.3 name in worked examples (`SPEC-QUESTIONS.md` Q58 point 12: no eighth token is named
 * anywhere in the spec pack). The type lives here, since `AdapterEvent`/`SessionResult` (this same
 * piece) both reference it; the Zod payload schema per token, and the parser/stripper that actually
 * produce a `ParsedControlToken`, are `@forge/adapter-kit/control-tokens` (P3).
 *
 * @see specs/05 §5.4
 * @see specs/05 §5.5
 * @see specs/15 §15.4.3
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P1
 */
export const FORGE_CONTROL_TOKENS = [
  'FORGE_REQUEST_CONTEXT',
  'FORGE_ASK',
  'FORGE_ASSUME',
  'FORGE_HANDOFF',
  'FORGE_REQUEST_CHANGE',
  'FORGE_CONFLICT',
  'FORGE_LOAD_SKILL',
] as const;

export type ForgeControlToken = (typeof FORGE_CONTROL_TOKENS)[number];

export type ParsedControlToken =
  | { readonly token: 'FORGE_REQUEST_CONTEXT'; readonly query: string }
  | { readonly token: 'FORGE_ASK'; readonly question: string; readonly options: readonly string[] }
  | {
      readonly token: 'FORGE_ASSUME';
      readonly text: string;
      readonly confidence: 'low' | 'medium' | 'high';
      readonly impact: string;
      readonly validateBy: string;
    }
  | { readonly token: 'FORGE_HANDOFF'; readonly role: string; readonly reason: string }
  | { readonly token: 'FORGE_REQUEST_CHANGE'; readonly target: string; readonly reason: string }
  | { readonly token: 'FORGE_CONFLICT'; readonly reason: string }
  | { readonly token: 'FORGE_LOAD_SKILL'; readonly skillId: string };
