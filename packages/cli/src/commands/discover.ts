/**
 * `forge discover` — `03` §3.2.2: "Run intake: idea capture, problem framing, level selection,
 * constraints."
 *
 * The real `intake` content this maps to is a workflow (`@forge/templates`' own
 * `templates/workflows/intake.workflow.yaml`, `WORKFLOW_INDEX.intake`), run end to end via
 * `@forge/engine`'s own `runEngine` (M5, already built — the scheduler, gates, budget and dispatch
 * machinery are all real). What is *not* built yet is the CLI-facing wiring `03` §3.2.4's own
 * `forge run <workflow>` names as its own piece (`PLAN-M6.md` C4, ordered explicitly after this one):
 * compiling a workflow definition into the `RunEngineContext` (real adapters, a compiled plan, a
 * telemetry sink) `runEngine` requires. Building that compilation pipeline here, ahead of C4's own
 * explicit scope, would be re-deriving C4's own work rather than thinly dispatching to it. Refused
 * rather than fabricated — the same "record the gap, do not invent the mechanism" discipline
 * `forge adopt`'s own doc comment applies to brownfield ingestion.
 *
 * @see specs/03 §3.2.2
 * @see specs/03 §3.2.4
 */
import { ForgeError } from '@forge/core/errors';

export function discover(): never {
  throw new ForgeError('USR-003', {
    feature: 'forge discover (needs forge run, @forge/cli C4)',
  });
}
