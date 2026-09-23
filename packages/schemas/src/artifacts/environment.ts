/**
 * `environmentSchema` — one `ENV-###` entry in `kb/delivery/environments.md`, a `collection: true`
 * type per `18` §18.7.
 *
 * `14` §14: "Every environment is described as an `ENV-###` artifact: purpose, URL, deploy trigger,
 * data policy, secrets source, owner, and how to get access."
 *
 * `sources` is OPTIONAL here (`PLAN-M14.md` P11): `08` §8.6's own "every write records sources" is a
 * `KbWriter`/output-CHECK invariant, not a schema constraint; `@forge/engine`'s output check requires
 * it on every new or changed produced entry instead (`dispatch/outputs.ts`).
 *
 * @see specs/14-frameworks-delivery-and-operations.md §14
 * @see specs/08 §8.6
 * @see PLAN-M14.md P11
 */
import { z } from 'zod';

import { entryIdSchema } from './entry-id.ts';
import { artifactSourceSchema } from './source.ts';

export const environmentSchema = z
  .object({
    id: entryIdSchema('Environment'),
    purpose: z.string().min(1),
    url: z.string().min(1),
    deploy_trigger: z.string().min(1),
    data_policy: z.string().min(1),
    secrets_source: z.string().min(1),
    owner: z.string().min(1),
    access: z.string().min(1),
    sources: z.array(artifactSourceSchema).optional(),
  })
  .strict();

export type Environment = z.infer<typeof environmentSchema>;
