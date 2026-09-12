/**
 * `@forge/adapter-generic` — `07` §7.5's declarative `adapter.yaml`-driven `PlatformAdapter`.
 *
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
export { GenericAdapter, type GenericAdapterOptions } from './adapter.ts';
export { genericCapabilities } from './capabilities.ts';
export { computeChangedFiles } from './changed-files.ts';
export { GenericAdapterConfigError, type GenericAdapterConfigErrorInit } from './config/errors.ts';
export { parseAdapterConfig } from './config/parse.ts';
export { adapterYamlConfigSchema, type AdapterYamlConfig } from './config/schema.ts';
export { mapLineToCandidate, parseNdjsonLine, type RawLine } from './events-map.ts';
export {
  probeBinaryVersion,
  realGenericBinaryRunner,
  runGenericPreflight,
  type BinaryVersionProbe,
  type GenericBinaryRunner,
  type GenericBinaryRunResult,
} from './preflight.ts';
export {
  spawnGenericBinary,
  type SpawnedGenericBinary,
  type SpawnGenericBinaryOptions,
} from './process.ts';
export { makeSessionHandle } from './session-handle.ts';
export {
  appendBounded,
  MAX_ACCUMULATOR_BYTES,
  resolveFinalText,
  runGenericSession,
  synthesizeToolResult,
  type RunGenericSessionOptions,
} from './session-stream.ts';
export {
  buildInvokeArgs,
  buildInvokeTemplateVars,
  evaluateWhenCondition,
  resolveEmitTemplate,
  resolveEmitValue,
  resolveInvokeTemplate,
  type InvokeTemplateVars,
} from './templates.ts';
