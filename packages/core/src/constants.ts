/**
 * Names and identifiers that appear in more than one place.
 *
 * `specs/README` §1 requires these be centralised so a rename is a one-file change — the package
 * scope and the installer name are still unverified on npm, and the fallback is a bulk rename.
 *
 * @see specs/README §1
 */

/**
 * Base for the documentation links every `ForgeError` carries.
 *
 * Derived rather than stored per error code so a domain change is one edit; see
 * `SPEC-QUESTIONS.md` Q4, which also records that nothing fetches this at runtime.
 */
export const DOCS_BASE_URL = 'https://forge-method.dev';
