/**
 * `ModelTierName`/`TierModelMap` — the vocabulary an adapter uses to say which of its own models
 * serves each FORGE budget tier (`05` §5.8) by default. `PLAN-M13.md` P5b, `SPEC-QUESTIONS.md` Q204.
 *
 * The three tier names are FORGE's own concept (`@forge/schemas/config`'s `models.tiers` keys,
 * `@forge/agents`' `ModelTier`), not a platform's: naming them here does not leak any platform into
 * this package. What a platform *calls* the model behind each tier is exactly the part that cannot
 * live in `@forge/schemas` (`no-platform-concept`), so it is supplied by the adapter, at `forge init`
 * time, through `PlatformAdapter.defaultTierModels`.
 *
 * @see specs/05 §5.8
 * @see specs/07 §7.2
 */

/** `05` §5.8's three tiers, in ascending capability/cost order. Kept in step by hand with
 * `@forge/schemas/config`'s `models.tiers` keys and `@forge/agents`' `ModelTier`; `forge init`'s own
 * test asserts the three lists agree, so drift fails a test rather than a live run. */
export const MODEL_TIER_NAMES = ['frugal', 'balanced', 'max'] as const;

export type ModelTierName = (typeof MODEL_TIER_NAMES)[number];

/** Tier -> model id, as `SessionRequest.model` takes it. Partial on purpose: an adapter that can
 * only vouch for some tiers says so by omitting the rest, and the caller leaves those unmapped
 * rather than inventing a value. */
export type TierModelMap = Readonly<Partial<Record<ModelTierName, string>>>;
