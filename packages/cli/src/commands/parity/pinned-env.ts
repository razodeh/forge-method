/**
 * `PINNED_ENV` — `13` F-TEST-9: "Every case runs in a scrubbed environment with `TZ=UTC`,
 * `LC_ALL=C.UTF-8` and `LANG=C.UTF-8`", so a locale or timezone difference between machines is never
 * itself a behaviour difference.
 *
 * A module of its own (rather than living in, and being exported from, `observe.ts`) so that
 * `observe.ts` and `http-server.ts` can both depend on it with no import cycle between the two:
 * `observe.ts` calls INTO `observe-http.ts`'s own `http` dispatch branch, which calls INTO
 * `http-server.ts`, which needs this identical constant — putting it here, rather than re-exporting
 * it from either endpoint of that call chain, is what keeps the dependency graph acyclic
 * (`QUALITY-BAR.md` R3; `specs/02` §2.2).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3, P8
 */
export const PINNED_ENV: Readonly<Record<string, string>> = {
  TZ: 'UTC',
  LC_ALL: 'C.UTF-8',
  LANG: 'C.UTF-8',
};
