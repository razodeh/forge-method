/**
 * `environmentSchema` — one `ENV-###` entry in `kb/delivery/environments.md`, a `collection: true`
 * type per `18` §18.7.
 *
 * `14` §14: "Every environment is described as an `ENV-###` artifact: purpose, URL, deploy trigger,
 * data policy, secrets source, owner, and how to get access."
 *
 * @see specs/14-frameworks-delivery-and-operations.md §14
 */
import { z } from 'zod';

import { entryIdSchema } from './entry-id.ts';

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
  })
  .strict();

export type Environment = z.infer<typeof environmentSchema>;
