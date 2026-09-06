/**
 * `@forge/core/artifacts` — reading, editing and validating artifact files.
 *
 * @see specs/18 §18.6
 * @see PLAN-M1.md P12
 */
export { ArtifactDocument, type FrontMatterPath } from './document.ts';
export { readArtifact, writeArtifact } from './io.ts';
export { parseFrontMatterYaml, splitFrontMatter, type FrontMatterSplit } from './parse.ts';
export {
  DEFAULT_ARTIFACT_REGISTRY,
  validateArtifact,
  type ArtifactSchemaRegistry,
  type ArtifactTypeRegistryEntry,
  type ValidationOutcome,
} from './validate.ts';
