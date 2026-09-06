/**
 * `@forge/extensions/compile` — the compile pipeline and `overlay explain`, per `15` §15.2 rules
 * 1–3 and §15.12.
 *
 * @see specs/15 §15.2
 * @see specs/15 §15.12
 * @see PLAN-M2.md P9
 */
export { compile } from './compile.ts';
export { explainOverlay } from './explain.ts';
export { scanTargetsFor } from './scan.ts';
export {
  DOCUMENT_KINDS,
  type CompileOptions,
  type CompileResult,
  type CompileSources,
  type CompileWarning,
  type CompiledDocuments,
  type DocumentKind,
  type FieldProvenanceEntry,
} from './types.ts';
