/**
 * `@forge/schemas/registry` — the canonical artifact type registry and base front matter.
 *
 * @see specs/18 §18.6
 * @see specs/18 §18.7
 */
export {
  ARTIFACT_TYPES,
  artifactTypeById,
  artifactTypeByPrefix,
  definitionForType,
  type ArtifactTypeDefinition,
  type ArtifactTypeId,
} from './artifact-types.ts';
export { baseFrontMatterSchema, type BaseFrontMatter } from './front-matter.ts';
export { renderArtifactPath, type RenderArtifactPathResult } from './paths.ts';
