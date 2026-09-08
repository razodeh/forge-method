/**
 * `frameworkSchema` — `11` §11.0's own framework YAML shape, as a zod schema.
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M1
 */
import { z } from 'zod';

const producesSchema = z
  .object({ adr_category: z.string().min(1), kb_section: z.string().min(1) })
  .strict();

const derivedInputSchema = z.object({ id: z.string().min(1), from: z.string().min(1) }).strict();

const inputsSchema = z
  .object({
    required: z.array(z.string().min(1)),
    derived: z.array(derivedInputSchema).optional(),
  })
  .strict();

const questionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    type: z.enum(['number', 'choice', 'text', 'boolean']),
    options: z.array(z.string().min(1)).optional(),
    default_from: z.string().min(1).optional(),
  })
  .strict()
  .refine((question) => question.type !== 'choice' || (question.options?.length ?? 0) > 0, {
    message: 'a "choice" question must declare at least one option',
    path: ['options'],
  });

const optionSchema = z.object({ id: z.string().min(1) }).strict();

const criterionSchema = z
  .object({ id: z.string().min(1), weight: z.number().min(0).max(1) })
  .strict();

const ruleThenSchema = z
  .object({
    eliminate: z.array(z.string().min(1)).optional(),
    prefer: z.string().min(1).optional(),
  })
  .strict();

const ruleSchema = z.object({ if: z.string().min(1), then: ruleThenSchema }).strict();

const followOnSchema = z.object({ create_stories_from: z.string().min(1) }).strict();

export const frameworkSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    owner_agent: z.string().min(1),
    produces: producesSchema,
    inputs: inputsSchema,
    questions: z.array(questionSchema).optional(),
    options: z.array(optionSchema).min(1),
    criteria: z.array(criterionSchema).optional(),
    scoring: z.enum(['rubric', 'rules', 'hybrid']),
    rules: z.array(ruleSchema).optional(),
    output_template: z.string().min(1),
    follow_on: z.array(followOnSchema).optional(),
  })
  .strict();
