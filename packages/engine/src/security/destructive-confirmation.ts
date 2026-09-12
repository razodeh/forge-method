/**
 * `requireDestructiveConfirmation` — `20` §20.10 S7: "Destructive operations require typed human
 * confirmation naming environment and resource." Human-only at every autonomy level — no autonomy
 * setting bypasses this gate.
 *
 * `PLAN-M11.md` P11's own direct investigation (before writing any test, per this piece's own mandate,
 * the same discipline `PLAN-M11.md` P9/P10 already established) confirmed the plan's own premise
 * exactly: grepping the whole workspace for "destructive"/"confirmation"/a typed-confirmation concept
 * found **no such mechanism anywhere** — S7 is genuinely new production code, not a missing test for
 * existing behaviour. Two real, existing things this module is built *from*, not invented against:
 *
 * 1. `.forge/config.yaml`'s own real `security.destructiveOps` field (`@forge/schemas`' own
 *    `securitySchema`, `packages/schemas/src/config/schema.ts`) — `z.enum(['confirm', 'deny',
 *    'allow-in-lane'])`, defaulted to `'confirm'`, documented ("How a potentially destructive operation
 *    is handled") — declared, defaulted, and documented since `@forge/schemas` shipped, but read by
 *    **zero** production code anywhere in this workspace until this module. This is the real "existing
 *    operation catalogue" this piece's own mandate asks to build from rather than inventing a fictional
 *    one: the *policy* dimension (`confirm`/`deny`/`allow-in-lane`) already exists; only the mechanism
 *    that actually consults it did not.
 * 2. `20` §20.1`/`§20.10` S2's own hard denylist (`@forge/adapter-kit/grants/denylist.ts`, `PLAN-M11.md`
 *    P9) already, permanently, and unconditionally refuses `git push --force`/`-f` — "`20` §20.2 point 4
 *    already forbids FORGE from ever force-pushing at all... this needs no branch-name context to be a
 *    correct, spec-consistent denial." A force-push is therefore deliberately **not** one of this
 *    module's own confirmable operations: S2 has already, correctly, foreclosed it with no override
 *    path at all (a `deny`-with-no-appeal policy stronger than anything a typed confirmation could ever
 *    unlock), and a caller offering to "confirm past" an S2 denial would directly contradict it. This
 *    module's own operation catalogue is therefore free-form (`operation: string`, not a closed enum
 *    seeded with `20`'s own worked examples verbatim) rather than a fixed list re-litigating ground S2
 *    already, correctly, owns — `20` §20.10 S7's own text names no closed catalogue of its own either
 *    ("Destructive operations require..." is a property of *any* operation classified destructive by a
 *    project's own `security.destructiveOps` policy, not an enumerated set `20` spells out anywhere).
 *
 * `deployEnvironment` (`@forge/cli`'s own `packages/cli/src/commands/loop/deploy.ts`) is this module's
 * one real, wired production call site — `@forge/engine/security/taint-guard`'s own doc comment already
 * established `forge deploy <env>` as "the one real, typed 'which environment' call site in this
 * codebase" for S6's identical "production targeting" surface; the same fact makes it the one real call
 * site S7 can attach to today. Disclosed, not silently assumed complete: no `forge deploy` CLI command
 * is registered anywhere in `@forge/cli`'s own command tree yet (`deployEnvironment` itself has zero
 * callers beyond its own test suite) — wiring this gate into it closes the *library* gap this piece can
 * reach; a future piece registering the real CLI verb inherits a gate that already works, rather than
 * needing to add one then.
 *
 * @see specs/20 §20.1
 * @see specs/20 §20.2 point 4
 * @see specs/20 §20.10 S2
 * @see specs/20 §20.10 S7
 * @see SPEC-QUESTIONS.md Q169
 * @see PLAN-M11.md P9
 * @see PLAN-M11.md P11
 */

/** `.forge/config.yaml`'s own real `security.destructiveOps` enum, re-declared structurally rather
 * than imported — `@forge/engine` has no dependency edge onto `@forge/schemas`' config module for this
 * one field, the same "re-declared, not imported" choice `@forge/engine/budget`'s own `BudgetConfig`
 * (`live-state.ts`) already makes for `.forge/config.yaml`'s own `budget` block. */
export type DestructiveOpsPolicy = 'confirm' | 'deny' | 'allow-in-lane';

export interface DestructiveConfirmationRequest {
  /** A short, human-readable name for *what* is being done — free-form (see this module's own doc
   * comment for why this is not a closed enum), e.g. `'deploy'`, `'drop-table:orders'`,
   * `'delete-cloud-resource'`. Never itself compared against `confirmation` — only `environment`/
   * `resource` are, per `20` §20.10 S7's own literal text ("naming environment and resource"). */
  readonly operation: string;
  readonly environment: string;
  readonly resource: string;
  readonly policy: DestructiveOpsPolicy;
  /** Whether this operation is scoped to an isolated lane/worktree rather than the shared resource
   * itself — `allow-in-lane`'s own name is exactly this distinction. `undefined`/`false` for anything
   * that is not lane-scoped (a real deploy, a real database operation — neither has a "lane" of its
   * own the way an agent step's own worktree does). */
  readonly inLane?: boolean;
  /** The human-typed confirmation text, when one was supplied — `undefined` when the caller supplied
   * none at all (the ordinary "nobody confirmed anything yet" case, refused the same as a wrong one,
   * never silently treated as "no confirmation needed"). */
  readonly confirmation?: string;
}

export type DestructiveConfirmationDecision =
  { readonly refused: true; readonly reason: string } | { readonly refused: false };

const ALLOWED: DestructiveConfirmationDecision = { refused: false };

const SPEC_CITATION = '20 §20.10 S7';

/** Whether `environment`/`resource` can be joined by a single `/` with no ambiguity at all — true
 * exactly when *neither* contains a `/` of its own, the only case where the one `/` in the joined
 * string can only ever be the separator. A gauntlet critic round found this module's own first fix
 * attempt (doubling every literal `/` before joining, the "escape the delimiter" scheme CSV's own
 * double-quote escaping uses) was **still** not actually collision-free at a boundary case the fix's
 * own test never constructed: `destructiveConfirmationPhrase('a/', 'b')` and
 * `destructiveConfirmationPhrase('a', '/b')` both doubled to the identical `'a///b'` (doubling a
 * separator adjacent to the real join point does not disambiguate *where* the real, single separator
 * falls). Rather than chase a cleverer escaping scheme and risk a third, subtler collision, this module
 * fails closed instead, the same "do not try to cleverly disambiguate an adversarial shape, refuse it
 * outright" stance `@forge/adapter-kit/grants/denylist.ts`'s own hard denylist and `taint-guard.ts`'s
 * own guards both already take: an `environment`/`resource` pair that cannot be joined unambiguously
 * is refused by `requireDestructiveConfirmation` below before any confirmation is even compared,
 * regardless of what `confirmation` was supplied. */
function canJoinUnambiguously(environment: string, resource: string): boolean {
  return !environment.includes('/') && !resource.includes('/');
}

/** The exact phrase a human must type, naming both `environment` and `resource` per `20` §20.10 S7's
 * own literal text — `${environment}/${resource}`, matching the real, already-established "environment/
 * resource" pairing shape `@forge/cli`'s own `forge deploy <env>` already treats `environment` and a
 * project's own `resource` (its `project.name`) as two independent, nameable things. Only ever called
 * once `canJoinUnambiguously` has already confirmed this join is safe (`requireDestructiveConfirmation`
 * below checks that first) — this function itself does not re-check, matching `destructiveConfirmationPhrase`'s
 * own role as a pure formatter a caller can also use to render a real confirmation prompt, not a second
 * decision point. Exported so a caller building that prompt (a future TUI/CLI piece) can render the
 * exact string a human needs to type, rather than reverse-engineering this module's own internal
 * comparison. */
export function destructiveConfirmationPhrase(environment: string, resource: string): string {
  return `${environment}/${resource}`;
}

/**
 * `20` §20.10 S7's own real, typed confirmation gate. Human-only at every autonomy level: this function
 * takes no autonomy parameter at all, and has no branch that ever admits a request on the basis of who
 * (or what autonomy level) is asking — the same "no special-casing exists to bypass" shape
 * `@forge/adapter-kit/grants/denylist.ts`'s own `isHardDenylisted` already establishes for S2 ("A hard
 * denylist overrides every allowlist and every autonomy level").
 *
 * `policy: 'deny'` refuses unconditionally — no confirmation, however well-typed, can proceed past it
 * (the same "no override path" shape S2's own force-push refusal already establishes, deliberately, one
 * policy tier up). `policy: 'allow-in-lane'` admits without any confirmation *only* when `inLane` is
 * true; outside a lane it falls through to the identical typed-confirmation requirement `'confirm'`
 * itself always applies, since a lane-scoped operation touches an isolated worktree/branch a human can
 * freely discard, while the same operation against the real, shared resource cannot be undone by
 * discarding anything. `policy: 'confirm'` (and `'allow-in-lane'` outside a lane) requires `confirmation`
 * to equal `destructiveConfirmationPhrase(environment, resource)` **exactly** — any mismatch (a
 * different resource name, a truncated or padded string, the environment alone with no resource, wrong
 * case) is refused with the identical "no confirmation" reason a caller who supplied nothing at all
 * gets, never partially accepted or silently normalised.
 */
export function requireDestructiveConfirmation(
  request: DestructiveConfirmationRequest,
): DestructiveConfirmationDecision {
  if (request.policy === 'deny') {
    return {
      refused: true,
      reason:
        `operation ${JSON.stringify(request.operation)} against ${JSON.stringify(request.resource)} ` +
        `in ${JSON.stringify(request.environment)} is denied by this project's own ` +
        `security.destructiveOps: 'deny' policy, with no confirmation able to override it (${SPEC_CITATION})`,
    };
  }

  if (request.policy === 'allow-in-lane' && request.inLane === true) {
    return ALLOWED;
  }

  if (!canJoinUnambiguously(request.environment, request.resource)) {
    return {
      refused: true,
      reason:
        `operation ${JSON.stringify(request.operation)} against ${JSON.stringify(request.resource)} ` +
        `in ${JSON.stringify(request.environment)} cannot be confirmed: environment/resource cannot ` +
        `both be joined into one unambiguous confirmation phrase because at least one of them contains ` +
        `a "/" (${SPEC_CITATION})`,
    };
  }

  const expected = destructiveConfirmationPhrase(request.environment, request.resource);
  if (request.confirmation === expected) {
    return ALLOWED;
  }

  return {
    refused: true,
    reason:
      `operation ${JSON.stringify(request.operation)} against ${JSON.stringify(request.resource)} ` +
      `in ${JSON.stringify(request.environment)} requires typed confirmation ` +
      `${JSON.stringify(expected)}; ` +
      (request.confirmation === undefined
        ? 'none was supplied'
        : `${JSON.stringify(request.confirmation)} does not match`) +
      ` (${SPEC_CITATION})`,
  };
}
