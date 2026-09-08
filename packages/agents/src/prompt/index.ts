/**
 * `@forge/agents/prompt` — `05` §5.3's nine-block system prompt compiler.
 *
 * @see specs/05 §5.3
 * @see specs/05 §5.5
 * @see PLAN-M6.md A5
 */
export { OPERATING_CONTRACT } from './operating-contract.ts';
export { compilePrompt, type CompilePromptOptions } from './compile-prompt.ts';
export { writePromptRecord } from './write-prompt-record.ts';
export type {
  AutonomyLevel,
  CompiledPrompt,
  CompiledPromptBlock,
  PromptConstraints,
} from './types.ts';
