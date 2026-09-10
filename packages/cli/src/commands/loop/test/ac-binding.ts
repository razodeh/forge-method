/**
 * `extractAcId` — `09` §9.5's own "generic fallback" for AC-test binding: "the ID appears in the
 * test name and is regex-extracted from the report."
 *
 * Two patterns, not one: the canonical hyphenated form (`AC-\d{3,4}-\d+`) — the exact form
 * `@forge/core/graph`'s own `TEST_NAME_AC_IDS` regex uses for `Story.tests[]` entries, which are
 * free-form, human-authored strings a story author can hyphenate freely — and an underscore-
 * separated form (`AC_\d{3,4}_\d+`), converted to the canonical hyphenated id. The second form
 * exists because a real pytest function name cannot contain a hyphen at all (confirmed directly
 * against a real pytest run during this piece's own build: `test_AC_014_2_...`, never
 * `test-AC-014-2-...`) — without it, no real, idiomatically-named Python test could ever bind to an
 * AC id through this reporter.
 *
 * @see specs/09 §9.5
 * @see PLAN-M8.md P3
 */
const HYPHENATED_AC_ID = /AC-\d{3,4}-\d+/;
const UNDERSCORE_AC_ID = /AC_\d{3,4}_\d+/;

export function extractAcId(testName: string): string | undefined {
  const hyphenated = HYPHENATED_AC_ID.exec(testName);
  if (hyphenated !== null) return hyphenated[0];

  const underscored = UNDERSCORE_AC_ID.exec(testName);
  if (underscored !== null) return underscored[0].replaceAll('_', '-');

  return undefined;
}
