/**
 * `09` §9.8's own worked `dod-profiles.yaml` example, verbatim (the `backend-default` profile; the
 * elided `frontend-default`/`data-default` entries are not reproduced — no test in this package needs
 * a second profile to exist, only that `profiles` is a real map keyed by profile id). **Genuinely
 * verbatim** — including every `verify`/`done`-list check id's own real qualifier syntax
 * (` --scope story`, ` --story`, ` == 0`): a fresh critic round caught an earlier draft of this
 * fixture that had quietly stripped those qualifiers down to bare ids, which meant nothing had
 * actually proven that a `{ check: id }` value containing whitespace, flags, or an inline comparison
 * round-trips — precisely the case `load.ts`'s own doc comment gives as the reason `{ check: id }`
 * must stay a fully opaque string rather than a closed or structured id.
 *
 * Reflects M14 P1's amendment of `09` §9.8 (Q232 decision 13): the old single nine-item `done` list
 * split into `verify` (self-verify, `forge story verify`) and `done` (review/merge).
 *
 * @see specs/09 §9.8
 * @see PLAN-M8.md P1
 * @see PLAN-M14.md P1, P25
 */
export const DOD_PROFILES = `
profiles:
  backend-default:
    ready:
      - story.acceptance.length > 0
      - story.files_expected.length > 0
      - check: spec:story-refs-resolve
      - check: spec:no-blocking-open-questions
    verify:
      - check: build:typecheck
      - check: build:lint
      - check: test:unit --scope story
      - check: test:integration --scope story
      - check: spec:ac-coverage --story
      - check: security:secrets-scan
    done:
      - check: review:blocking-findings == 0
      - check: docs:public-api-documented
      - check: kb:no-new-contradictions
`;
