/**
 * `@forge/kb/schema` — `08` §8.2/§8.3: the KB entry schema and the whole-tree parse/validate entry
 * point.
 *
 * @see PLAN-M3.md P6
 */
export {
  kbEntrySchema,
  KB_ENTRY_TYPES,
  type KbEntry,
  type KbEntryType,
  type KbSource,
} from './kb-entry.ts';
export { KB_SECTIONS, sectionIdToken, sectionForIdToken, type KbSection } from './sections.ts';
export {
  parseKbTree,
  DEFAULT_KB_ROOT,
  type KbTree,
  type KbParsedEntry,
  type KbParseError,
} from './tree.ts';
