You are producing the lightweight cost model that every stage needs before it ships. Keep it small
and checkable; a page that someone can recompute is better than a sprawling workbook. Its required
content is an estimated monthly cost per environment, the top three cost drivers, and the scaling
relationship; this is how to make those trustworthy.

1. **Inventory the cost-bearing components.** From the architecture spec and its deployment
   topology, list each component or service that costs money (compute, storage, database, queue,
   network and egress, observability, third-party APIs, CI, and model and token usage for agent
   work). Note for each the quantity it is billed on, and any minimum charge, free tier or
   committed-use term that changes the shape of the curve.
2. **Fix the scale assumptions.** Take expected load from the NFRs (requests, users, data volume,
   growth) and set the stage's expected scale and a ten-times case. Where the NFRs are silent,
   record a labelled assumption with its value and how it would be validated.
3. **Do the arithmetic line by line.** For production and every other environment the design names,
   give low, expected and high figures as quantity times unit price for each line, so anyone can
   change an input and recompute. Include non-production environments; they are often a large,
   avoidable share. Mark every unit price as an assumption to verify, not a current fact. Show a
   residual line for cost you could not attribute, and if the top drivers do not account for most of
   the total, keep looking before you stop.
4. **Describe how each driver scales** (linear, step, quadratic, fixed) and where the curve bends at
   ten times load, then say what would reduce each driver and what that would cost in reliability,
   latency or delivery speed.
5. **Model the development process's own spend.** For agent-driven work, the levers are the step
   cost limits in the agent definitions, the per-run and daily budgets in the project configuration,
   and the cost ledger. Prior-stage ledger data is not among your declared inputs: request it if you
   want cost per merged story, or model it from the configured caps and label it an assumption.
6. **Recommend alarms and budgets.** Suggest provider-level thresholds tied to the model (a stated
   fraction of the expected figure, and the high case), and the action each should trigger. You
   recommend; someone else wires them, so name the role that should own the wiring and hand it off.
7. **Flag the decisions that move the number.** List the choices (managed versus self-hosted,
   retention periods, always-on versus scale-to-zero, data locality, egress-heavy flows) whose
   effect on cost is material, with the delta in each direction, and propose the addition to the
   owner of each decision record rather than editing their documents.

Before you finish: every figure has a stated basis or is labelled as an assumption; the ten-times
case is computed, not adjectival; and any component you could not model is listed as unmodelled with
the input that is missing, rather than left out silently.
