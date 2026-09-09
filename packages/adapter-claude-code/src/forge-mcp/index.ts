/**
 * `@forge/adapter-claude-code/forge-mcp` — the package.json `exports` subpath this directory fulfils.
 *
 * @see specs/07 §7.3
 * @see PLAN-M7.md P8
 */
export type {
  AcknowledgedResult,
  AskAnswer,
  AssumeConfidence,
  ForgeMcpBackend,
  KbEntry,
  KbSearchHit,
  SkillBody,
  SpecEntry,
} from './backend.ts';
export { createForgeMcpServer } from './server.ts';
