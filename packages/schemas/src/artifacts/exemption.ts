/**
 * `exemptionSchema` — one `EXEMPT-###` entry in `reports/exemptions.md`, a `collection: true` type
 * per `18` §18.7.
 *
 * `specs/22` M15 P6's own Mandate: "A test that genuinely cannot be mutation-bound... declares an
 * exemption carrying: the test id, a reason in prose, an owner identifier, and an expiry... reusing
 * [the waiver] machinery rather than inventing a second one." `reason`/`owner`/`expiry` are therefore
 * the identical three fields `waiverSchema` already carries (`waiver.ts`, this directory) — `testId`
 * is the one field beyond that triple, naming what the exemption actually excuses.
 *
 * `testId` is the FULLY QUALIFIED name `forge test binding`'s own `nonBinding`/`bound` arrays already
 * use — `"<testName>"` in single-story mode, `"<storyId>: <testName>"` in discover mode (`specs/22`
 * M15 P5) — never a bare test name alone: a bare name can collide across two different stories'
 * own test suites, and an exemption that silently matched the wrong story's test would be exactly the
 * "escape hatch" this piece's own two honesty rules (stale, expired) exist to prevent. `forge test
 * exempt` (the only way to create one) always requires the story the exemption belongs to and builds
 * this qualified form itself; a hand-edited `reports/exemptions.md` that uses a bare name instead
 * matches nothing (a real, visible `stale` failure, not a silent no-op).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-8
 * @see specs/22 M15 P6
 * @see PLAN-M15.md P6
 */
import { z } from 'zod';

import { entryIdSchema } from './entry-id.ts';

export const exemptionSchema = z
  .object({
    id: entryIdSchema('Exemption'),
    testId: z.string().min(1),
    reason: z.string().min(1),
    owner: z.string().min(1),
    expiry: z.string().date(),
  })
  .strict();

export type Exemption = z.infer<typeof exemptionSchema>;
