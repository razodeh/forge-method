/**
 * `forge spec validate --rule version-skew` and `--rule migration-order-violations`: the two deterministic checks
 * `G-Integration` names (`10` §10.3: "version skew; migration order violations"), added by `PLAN-M13.md` P26 (Q228).
 *
 * **What the specs define and what they leave out.** `10` §10.3 names the two conditions and nothing else. The
 * `critique-integration` brief says the engine's checks "see only what is declared": "declared version skew is within
 * policy and declared migrations are ordered", against "the project's declared version-skew policy (how many versions
 * may run side by side)" and the expand, migrate, contract sequencing of `12` F-DATA-6 and `14` §14.4 rule 3. No spec or
 * brief says WHERE either is declared or in what format, so P26 defines the smallest self-describing declaration for
 * each, as a machine file beside the KB documents it summarises (the precedent is `engineering/dod-profiles.yaml`, `09`
 * §9.8):
 *
 *  - `<kb>/architecture/version-skew.yaml`: `policy.max_skew` (an integer, how many versions behind the current one may
 *    run side by side) and, per interface contract id, its `current` version, an optional `supported` list and its
 *    `consumers` (`name`, `version`).
 *  - `<kb>/data/migrations.yaml`: `migrations`, in apply order, each with `id`, `phase` (`expand`, `migrate` or
 *    `contract`), `release` (a positive integer: the release that ships it), an optional `after` list and, for `migrate` and
 *    `contract`, the `expands` id of the expand migration it belongs to.
 *
 * **These are declarations, and self-attested.** The checks prove the declaration is present, well formed, internally
 * consistent and within policy. They cannot prove that the deployed versions or the migration history match what is
 * declared; no spec defines a verifiable source, and the honest bypass for a project that cannot declare them is a Waiver.
 * `migrations: []` and `contracts: {}` are valid declarations ("none") only with a `none_reason` sentence, so an empty
 * declaration is a statement someone made and a reviewer can read; a MISSING file is a violation, because absence is not a
 * statement. `max_skew` above 10 is refused. Neither is cross-checked against migration files or consumers in the repository
 * (no convention says where they are), so an empty declaration is exactly as true as its author says.
 *
 * **Who writes them** (`PLAN-M14.md` P21). `build-stage:freeze-contracts` and fm-service
 * `contract-test-cycle:draft-contract` write or update `version-skew.yaml`; `shape-solution:model-data` writes the
 * initial `migrations.yaml` and `migrate:plan-migration` appends to it. Each brief's own `### Declarations the gate
 * reads` section states the exact shape below in prose, so `VERSION_SKEW_KEYS` and `MIGRATION_KEYS` are exported here
 * (the schemas themselves stay module-private) for a content test to hold every brief to every key, with no copy of
 * either list to drift.
 *
 * **`version-skew`.** Every valid interface contract is declared; every declared id names a contract that exists; per
 * contract `current` is a positive integer, `supported` (when given) is a strictly ascending list of positive integers
 * that ends at `current` and spans at most `max_skew + 1` versions, and every consumer targets a version that exists
 * (at most `current`), is within `max_skew` of it, and is one the provider supports.
 *
 * **`migration-order-violations`.** Identifiers are unique. Every `after` and `expands` id names a migration listed
 * EARLIER (a forward or self reference is an order violation). Releases never decrease down the list, and a migration
 * ships no earlier than any migration it comes `after`. A `migrate` and a `contract` name an `expand` migration; the
 * `contract` ships in a strictly later release than its expand and than every `migrate` of that expand (the destructive
 * change is a separate release from the code that stops using the old structure, `12` F-DATA-6, `14` §14.4 rule 3), and no
 * `migrate` of that expand is listed after the `contract`.
 *
 * @see specs/10 §10.3
 * @see specs/12 F-DATA-6
 * @see specs/14 §14.4
 * @see PLAN-M13.md P26
 */
import { parseFrontMatterYaml } from '@forge/core/artifacts';
import { pathExists, readTextFile } from '@forge/core/fs';
import { z } from 'zod';

import type { SpecCommandContext } from '../spec.ts';
import { loadContracts } from './interfaces.ts';
import { compare, errorMessage, oneLine } from './spec-files.ts';
import type { RuleValidationResult, RuleViolation, ValidateRuleId } from './validate-rules.ts';

type IntegrationRuleId = Extract<ValidateRuleId, 'version-skew' | 'migration-order-violations'>;

export const VERSION_SKEW_FILE = 'architecture/version-skew.yaml';
export const MIGRATIONS_FILE = 'data/migrations.yaml';
/** A declaration is a few kilobytes; this is a ceiling against a runaway file, not a target. */
const MAX_DECLARATION_BYTES = 1024 * 1024;
const MAX_ENTRIES = 5000;
/** More versions than this side by side is not a policy. */
const MAX_SKEW_LIMIT = 10;
const NONE_REASON = 'an empty declaration must say why (none_reason: a sentence)';

/** The field names of one or more `z.object` schemas, deduplicated, in first-seen order — how
 * `VERSION_SKEW_KEYS`/`MIGRATION_KEYS` are derived from the schemas themselves rather than hand-copied. */
function uniqueKeys(...schemas: readonly z.ZodObject<z.ZodRawShape>[]): readonly string[] {
  const seen = new Set<string>();
  for (const schema of schemas) {
    for (const key of Object.keys(schema.shape)) seen.add(key);
  }
  return [...seen];
}

function violation(subject: string, message: string, remedy: string): RuleViolation {
  return { subject, message, remedy };
}

function result(
  rule: IntegrationRuleId,
  violations: readonly RuleViolation[],
): RuleValidationResult {
  return {
    rule,
    violations: [...violations].sort(
      (a, b) => compare(a.subject, b.subject) || compare(a.message, b.message),
    ),
  };
}

function refused(rule: IntegrationRuleId, cause: unknown): RuleValidationResult {
  return result(rule, [
    violation(
      rule,
      `The check could not run: ${oneLine(errorMessage(cause))}.`,
      'Fix what the message names, then run the check again.',
    ),
  ]);
}

type Declaration =
  | { readonly kind: 'read'; readonly data: Record<string, unknown> }
  | { readonly kind: 'problem'; readonly violation: RuleViolation };

/** Reads one declaration file: missing, unreadable, oversized and non-mapping are each a violation naming the file. */
async function readDeclaration(
  ctx: SpecCommandContext,
  relative: string,
  what: string,
  create: string,
): Promise<Declaration> {
  const path = `${ctx.kbRoot}/${relative}`;
  try {
    if (!(await pathExists(ctx.paths.resolveWithin(path)))) {
      return {
        kind: 'problem',
        violation: violation(
          path,
          `${what} is not declared: ${path} does not exist.`,
          `Create ${path}: ${create}`,
        ),
      };
    }
    const text = await readTextFile(ctx.paths.resolveWithin(path));
    if (text.length > MAX_DECLARATION_BYTES) {
      return {
        kind: 'problem',
        violation: violation(
          path,
          `${path} is over the ${String(MAX_DECLARATION_BYTES)} byte limit for a declaration.`,
          `Shorten ${path}.`,
        ),
      };
    }
    return { kind: 'read', data: parseFrontMatterYaml(text, path) };
  } catch (cause) {
    return {
      kind: 'problem',
      violation: violation(
        path,
        `${path} could not be read (${oneLine(errorMessage(cause))}).`,
        `Repair ${path} so it is a YAML mapping, then run the check again.`,
      ),
    };
  }
}

function issueLines(
  subject: string,
  path: string,
  error: z.ZodError,
  format: string,
): RuleViolation[] {
  return error.issues.slice(0, 20).map((issue) => {
    const where = issue.path.length === 0 ? 'the file' : oneLine(issue.path.join('.'), 80);
    return violation(
      subject,
      `${path}: ${where}: ${oneLine(issue.message)}.`,
      `Fix ${where} in ${path} to be ${format}`,
    );
  });
}

// --- version-skew ---------------------------------------------------------------------------------------

/** A sentence, not a stand-in: an empty declaration is a statement someone can be asked about. */
const reason = z
  .string()
  .trim()
  .min(8)
  .max(500)
  .refine(
    (text) => !/^(?:todo|tbd|fixme|n\/a|none|unknown|nothing|x+)\.?$/i.test(text),
    'a stand-in',
  )
  .optional();

const version = z.number().int().positive().max(1_000_000);

/** Named (rather than inlined) so `VERSION_SKEW_KEYS` below can read each level's `.shape` — the
 * validation this composes is unchanged from before P21's naming pass. */
const policySchema = z.object({ max_skew: z.number().int().min(0).max(MAX_SKEW_LIMIT) }).strict();
const consumerSchema = z.object({ name: z.string().min(1), version }).strict();
const contractEntrySchema = z
  .object({
    current: version,
    supported: z.array(version).min(1).max(1000).optional(),
    consumers: z.array(consumerSchema).max(MAX_ENTRIES),
  })
  .strict();
const contractsSchema = z
  .record(z.string().min(1), contractEntrySchema)
  .refine((all) => Object.keys(all).length <= MAX_ENTRIES, 'too many contracts');

const skewObjectSchema = z
  .object({
    policy: policySchema,
    none_reason: reason,
    contracts: contractsSchema,
  })
  .strict();
const skewSchema = skewObjectSchema.refine(
  (all) => (Object.keys(all.contracts).length > 0 ? true : all.none_reason !== undefined),
  { path: ['none_reason'], message: NONE_REASON },
);

/** Every key a `version-skew.yaml` declaration may carry, at any nesting level, derived from the schema
 * itself (not copied by hand) so a brief that names them all cannot silently fall behind a schema change
 * (`test/gate-declarations-authored.test.ts`, `PLAN-M14.md` P21). */
export const VERSION_SKEW_KEYS: readonly string[] = uniqueKeys(
  skewObjectSchema,
  policySchema,
  contractEntrySchema,
  consumerSchema,
);

const REMEDY_SKEW_FILE =
  'a YAML mapping with policy.max_skew (an integer) and contracts (an INT-### id to {current, supported?, consumers: [{name, version}]}); "contracts: {}" with a none_reason sentence declares that there are none.';

export async function validateVersionSkew(ctx: SpecCommandContext): Promise<RuleValidationResult> {
  const rule: IntegrationRuleId = 'version-skew';
  try {
    const declaration = await readDeclaration(
      ctx,
      VERSION_SKEW_FILE,
      'The version-skew policy',
      REMEDY_SKEW_FILE,
    );
    if (declaration.kind === 'problem') return result(rule, [declaration.violation]);
    const path = `${ctx.kbRoot}/${VERSION_SKEW_FILE}`;
    const parsed = skewSchema.safeParse(declaration.data);
    if (!parsed.success)
      return result(rule, issueLines(path, path, parsed.error, REMEDY_SKEW_FILE));
    const { policy, contracts: declared } = parsed.data;

    const violations: RuleViolation[] = [];
    const loaded = await loadContracts(ctx);
    violations.push(...loaded.problems);
    const defined = new Set(
      loaded.contracts.flatMap((contract) => (contract.kind === 'valid' ? [contract.id] : [])),
    );
    for (const contract of loaded.contracts) {
      if (contract.kind === 'invalid') {
        violations.push(
          violation(
            contract.path,
            `${contract.path} does not define an interface contract (${contract.reason}), so its version cannot be checked.`,
            `Repair ${contract.path} (forge spec interfaces --check-frozen says what is wrong).`,
          ),
        );
      }
    }
    for (const id of [...defined].sort(compare)) {
      if (declared[id] === undefined) {
        violations.push(
          violation(
            id,
            `${id} has no declared version: it is not listed under contracts in ${path}.`,
            `Add ${id} to ${path} with its current version and its consumers.`,
          ),
        );
      }
    }
    for (const [id, entry] of Object.entries(declared).sort(([a], [b]) => compare(a, b))) {
      if (!defined.has(id)) {
        violations.push(
          violation(
            id,
            `${path} declares versions for ${oneLine(id, 60)}, which no interface contract defines.`,
            `Remove ${oneLine(id, 60)} from ${path} or write the contract.`,
          ),
        );
        continue;
      }
      const { current, supported, consumers } = entry;
      if (supported !== undefined) {
        const ascending = supported.every(
          (value, at) => at === 0 || value > (supported[at - 1] ?? 0),
        );
        if (!ascending) {
          violations.push(
            violation(
              id,
              `${id}: supported ${oneLine(supported)} is not a strictly ascending list of versions.`,
              `List ${id}'s supported versions in ascending order without repeats.`,
            ),
          );
        } else if (supported[supported.length - 1] !== current) {
          violations.push(
            violation(
              id,
              `${id}: supported ${oneLine(supported)} does not end at the current version ${String(current)}.`,
              `Make the highest supported version of ${id} equal to its current version.`,
            ),
          );
        } else if (current - (supported[0] ?? current) > policy.max_skew) {
          violations.push(
            violation(
              id,
              `${id}: the provider supports versions ${String(supported[0])} to ${String(current)}, a skew of ${String(current - (supported[0] ?? current))}, over the policy maximum of ${String(policy.max_skew)}.`,
              `Retire the oldest versions of ${id} or raise policy.max_skew deliberately, with an ADR.`,
            ),
          );
        }
      }
      const seen = new Set<string>();
      for (const consumer of consumers) {
        const label = `${id}: consumer ${oneLine(consumer.name, 60)}`;
        if (seen.has(consumer.name)) {
          violations.push(
            violation(
              id,
              `${label} is listed more than once.`,
              `Declare each consumer of ${id} once.`,
            ),
          );
          continue;
        }
        seen.add(consumer.name);
        if (consumer.version > current) {
          violations.push(
            violation(
              id,
              `${label} targets version ${String(consumer.version)}, which does not exist yet (current is ${String(current)}).`,
              `Correct the consumer's version, or raise ${id}'s current version when the new one ships.`,
            ),
          );
        } else if (current - consumer.version > policy.max_skew) {
          violations.push(
            violation(
              id,
              `${label} is on version ${String(consumer.version)}, ${String(current - consumer.version)} behind the current ${String(current)}; the policy allows ${String(policy.max_skew)}.`,
              `Migrate ${oneLine(consumer.name, 60)} to a version within ${String(policy.max_skew)} of ${String(current)} before the provider moves on.`,
            ),
          );
        } else if (supported !== undefined && !supported.includes(consumer.version)) {
          violations.push(
            violation(
              id,
              `${label} is on version ${String(consumer.version)}, which the provider does not list as supported (${oneLine(supported)}).`,
              `Move ${oneLine(consumer.name, 60)} to a supported version, or support ${String(consumer.version)} again.`,
            ),
          );
        }
      }
    }
    return result(rule, violations);
  } catch (cause) {
    return refused(rule, cause);
  }
}

// --- migration-order-violations --------------------------------------------------------------------------

const migrationSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,63}$/),
    phase: z.enum(['expand', 'migrate', 'contract']),
    release: z.number().int().positive().max(1_000_000),
    after: z.array(z.string().min(1)).max(MAX_ENTRIES).optional(),
    expands: z.string().min(1).optional(),
  })
  .strict();

const migrationsObjectSchema = z
  .object({
    migrations: z.array(migrationSchema).max(MAX_ENTRIES),
    none_reason: reason,
  })
  .strict();
const migrationsSchema = migrationsObjectSchema.refine(
  (all) => (all.migrations.length > 0 ? true : all.none_reason !== undefined),
  { path: ['none_reason'], message: NONE_REASON },
);

/** Every key a `migrations.yaml` declaration may carry, derived from the schema itself (see
 * `VERSION_SKEW_KEYS`). */
export const MIGRATION_KEYS: readonly string[] = uniqueKeys(
  migrationsObjectSchema,
  migrationSchema,
);

const REMEDY_MIGRATIONS_FILE =
  'a YAML mapping with migrations: a list in apply order of {id, phase (expand|migrate|contract), release, after?, expands?}; "migrations: []" with a none_reason sentence declares that there are none.';

export async function validateMigrationOrder(
  ctx: SpecCommandContext,
): Promise<RuleValidationResult> {
  const rule: IntegrationRuleId = 'migration-order-violations';
  try {
    const declaration = await readDeclaration(
      ctx,
      MIGRATIONS_FILE,
      'The migration order',
      REMEDY_MIGRATIONS_FILE,
    );
    if (declaration.kind === 'problem') return result(rule, [declaration.violation]);
    const path = `${ctx.kbRoot}/${MIGRATIONS_FILE}`;
    const parsed = migrationsSchema.safeParse(declaration.data);
    if (!parsed.success)
      return result(rule, issueLines(path, path, parsed.error, REMEDY_MIGRATIONS_FILE));

    const violations: RuleViolation[] = [];
    const list = parsed.data.migrations;
    const position = new Map<string, number>();
    list.forEach((migration, at) => {
      if (position.has(migration.id)) {
        violations.push(
          violation(
            migration.id,
            `${migration.id} is declared more than once.`,
            `Give each migration in ${path} its own id.`,
          ),
        );
      } else {
        position.set(migration.id, at);
      }
    });

    /** The migration a reference names, or a violation when it is unknown, itself, or listed later. */
    const earlier = (from: number, id: string, how: string): number | undefined => {
      const migration = list[from];
      const at = position.get(id);
      if (migration === undefined) return undefined;
      if (at === undefined) {
        violations.push(
          violation(
            migration.id,
            `${migration.id}: ${how} ${oneLine(id, 60)}, which is not declared.`,
            `Declare ${oneLine(id, 60)} in ${path}, before ${migration.id}, or remove the reference.`,
          ),
        );
        return undefined;
      }
      if (at >= from) {
        violations.push(
          violation(
            migration.id,
            `${migration.id}: ${how} ${id}, which is ${at === from ? 'itself' : 'listed after it'}: it would be applied before it exists.`,
            `Reorder ${path} so ${id} comes before ${migration.id}.`,
          ),
        );
        return undefined;
      }
      return at;
    };

    let highest = 0;
    list.forEach((migration, at) => {
      if (migration.release < highest) {
        violations.push(
          violation(
            migration.id,
            `${migration.id} ships in release ${String(migration.release)} but is listed after a migration that ships in release ${String(highest)}.`,
            `Order ${path} by release, or correct ${migration.id}'s release.`,
          ),
        );
      }
      highest = Math.max(highest, migration.release);
      for (const id of migration.after ?? []) {
        const before = earlier(at, id, 'comes after');
        const predecessor = before === undefined ? undefined : list[before];
        if (predecessor !== undefined && predecessor.release > migration.release) {
          violations.push(
            violation(
              migration.id,
              `${migration.id} (release ${String(migration.release)}) comes after ${predecessor.id}, which ships later, in release ${String(predecessor.release)}.`,
              `Ship ${migration.id} in release ${String(predecessor.release)} or later, or drop the dependency.`,
            ),
          );
        }
      }
      if (migration.phase === 'expand') {
        if (migration.expands !== undefined) {
          violations.push(
            violation(
              migration.id,
              `${migration.id} is an expand migration and names "expands"; only a migrate or contract migration belongs to an expand.`,
              `Remove "expands" from ${migration.id}.`,
            ),
          );
        }
        return;
      }
      if (migration.expands === undefined) {
        violations.push(
          violation(
            migration.id,
            `${migration.id} is a ${migration.phase} migration and does not say which expand migration it belongs to.`,
            `Set "expands" on ${migration.id} to the id of its expand migration.`,
          ),
        );
        return;
      }
      const target = earlier(at, migration.expands, 'expands');
      const expand = target === undefined ? undefined : list[target];
      if (expand === undefined) return;
      if (expand.phase !== 'expand') {
        violations.push(
          violation(
            migration.id,
            `${migration.id} expands ${expand.id}, which is a ${expand.phase} migration, not an expand.`,
            `Point "expands" on ${migration.id} at the expand migration it follows.`,
          ),
        );
        return;
      }
      if (migration.phase !== 'contract') return;
      if (migration.release <= expand.release) {
        violations.push(
          violation(
            migration.id,
            `${migration.id} is the contract of ${expand.id} and ships in release ${String(migration.release)}, not after its expand's release ${String(expand.release)}: the destructive change must be a separate, later release.`,
            `Move ${migration.id} to a later release than ${expand.id}, after the readers have switched.`,
          ),
        );
      }
      list.forEach((other, otherAt) => {
        if (other.phase !== 'migrate' || other.expands !== expand.id) return;
        if (otherAt > at) {
          violations.push(
            violation(
              migration.id,
              `${migration.id} (contract of ${expand.id}) is listed before ${other.id}, a migrate step of the same expand: the old structure would be removed first.`,
              `List ${other.id} before ${migration.id}.`,
            ),
          );
        } else if (migration.release <= other.release) {
          violations.push(
            violation(
              migration.id,
              `${migration.id} (contract of ${expand.id}) ships in release ${String(migration.release)}, the same release as or before ${other.id}, a migrate step that moves readers to the new structure.`,
              `Ship ${migration.id} in a release after ${String(other.release)}.`,
            ),
          );
        }
      });
    });
    return result(rule, violations);
  } catch (cause) {
    return refused(rule, cause);
  }
}
