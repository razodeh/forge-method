/**
 * `dodProfileFileSchema` — `09` §9.8's own `dod-profiles.yaml` shape, as a zod schema.
 *
 * @see specs/09 §9.8
 * @see PLAN-M8.md P1
 */
import { z } from 'zod';

const dodCheckSchema = z.union([
  z.string().min(1),
  z.object({ check: z.string().min(1) }).strict(),
]);

const dodPhaseSchema = z
  .object({
    ready: z.array(dodCheckSchema),
    // Optional, not required: `09` §9.8's own `verify`/`done` split (M14 P1, Q232 decision 13) is new
    // this milestone, and a pre-M14 profile that still holds only `ready`/`done` must keep loading —
    // `load.ts`'s own `loadDodProfile` reports its absence as a warning, not a schema failure.
    verify: z.array(dodCheckSchema).optional(),
    done: z.array(dodCheckSchema),
  })
  .strict();

export const dodProfileFileSchema = z
  .object({
    // Profile ids are themselves data (`dod_profile: backend-default` on a real Story), not a closed
    // set this package can enumerate — the identical stance `frameworkSchema`'s own `owner_agent`/
    // `criteria[].id` fields already take for open-ended id strings.
    profiles: z.record(z.string().min(1), dodPhaseSchema),
  })
  .strict();
