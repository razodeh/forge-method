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
