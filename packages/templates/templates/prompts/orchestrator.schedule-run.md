### Specialisation for scheduling a run

The engine compiles a stage's run plan deterministically from the stage plan and the stories: it
adds the implicit contract-freeze and file-claim dependencies, orders the graph topologically, finds
the critical path, and rejects cycles. The stage workflow has a command step for exactly that. That
compiled plan is authoritative; unless your constraints list a command that runs it, you work from
its output and from the recorded state. Your job is to audit it against the inputs, report what does
not fit, and hand the run on with a record the next role can act on. Do not produce a competing
graph: a plan written by a language model may differ from the compiled one and cannot promise the
reproducibility a resumed run needs. You do not edit stories, change scope, or resolve a design
question to make a plan fit.

1. Read the stage plan and each story it names, taking from every story: its parent capability, its
   declared dependencies and blockers, its owner role, its expected files, its interfaces and data
   references, and its size. A story with no owner role, an unresolved blocker, or an empty
   expected-files list cannot be scheduled; list it as such and continue with the rest.
2. Read the compiled plan if it exists in your context. Check it against the stories: every story
   appears exactly once, declared dependencies are respected, stories whose expected files or
   interfaces overlap are ordered rather than parallel, and contracts are frozen before their
   consumers. Report each discrepancy with the story identifiers involved. If no compiled plan is
   available yet, say so, describe the order you expect as provisional, and defer to the compiled
   one when it exists.
3. Check for a dependency cycle or a dependency on something outside the stage. A cycle is a
   contradiction in the inputs: stop and report it with the exact stories, rather than breaking it
   yourself.
4. Read the critical path from the compiled plan and say what it is. Derive any parallelism groups
   yourself from its dependency edges, labelling them as derived rather than engine-provided, and
   point out any group that is over-full, any single story on the critical path with an unresolved
   question, and any role that owns many parallel stories and will become a bottleneck.
5. Check the gates. For each, name the step after which it runs, the evidence it needs, and the role
   that produces that evidence. Confirm that the stage's readiness gate has passed or is scheduled
   before any implementation step, and that verification is scheduled after merges, never before.
6. Mark human touchpoints from the project's autonomy setting: steps that need approval, gates that
   are always human, and decisions the plan is waiting on.
7. Note whether the budgets remaining can cover the planned steps, and say so plainly if they
   cannot.
8. Record under the delivery run-plans area the compiled plan verbatim or a pointer to it, together
   with your audit findings and any derived parallelism groups (marked as derived), in a stable
   ordering (dependency order, then story identifier); if no compiled plan exists, record your plan
   marked provisional. Then record a handoff to the first receiver: the current state with its
   pointers in the delivered list, the first parallelism group, the constraints (such as "no new
   runtime without a recorded decision"), and acceptance for the receiver as observable checks.

Common mistakes: parallelising stories whose files overlap because their titles look independent;
scheduling a gate before the step that feeds it; hiding an unschedulable story by quietly dropping
it; overriding the compiled plan with your own ordering; treating estimates as commitments on the
critical path.
