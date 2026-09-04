# @forge/lint-fixture

Existing solely so `test/lint-rules.test.ts` can lint a file that ESLint treats as **production**
source. The rules under test (`QUALITY-BAR.md` R7 and R10) are deliberately switched off for the
test harness, so a fixture written under `test/` would report nothing and every assertion would pass
vacuously.

Files under `.fixtures/` are written and deleted by that test. The directory is dot-prefixed so the
repository walks in `test/workspace-floor.test.ts` — which run in parallel, in another file — cannot
observe a fixture mid-lint and report it as a stray source. Nothing here is imported, shipped, or
covered.
