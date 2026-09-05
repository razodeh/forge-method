/**
 * `interfaceContractSchema` — `specs/09` §9.6's Interface Contract (`INT-###`).
 *
 * `09` §9.6 describes this type only by purpose and producer ("the frozen, machine-readable contract
 * (OpenAPI / SDL / proto / TS types / JSON Schema / event schema)"), with no field list or example.
 * This schema is the base front matter narrowed to `type: 'InterfaceContract'`, with no invented
 * business fields. See `SPEC-QUESTIONS.md` Q20.
 *
 * @see specs/09 §9.6
 * @see SPEC-QUESTIONS.md Q20
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

export const interfaceContractSchema = baseFrontMatterShape
  .extend({ type: z.literal('InterfaceContract') })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type InterfaceContract = z.infer<typeof interfaceContractSchema>;
