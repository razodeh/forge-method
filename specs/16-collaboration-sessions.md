# 16 — Collaboration Sessions

## 16.1 Purpose

Some work is not a task; it is a *conversation with structure*. Divergent exploration, adversarial
critique, tradeoff resolution and honest retrospection are all things a single agent producing a
document does badly, because they need multiple stances held simultaneously and a facilitator
enforcing a method.

FORGE models these as **sessions**: bounded, facilitated, multi-participant discussions with a
technique, a transcript, and — the part that matters — a **structured output that graduates decisions
into the KB**.

**Design stance:** a session that produces only a transcript has failed. Every session ends with
named decisions, actions with owners, and explicit non-decisions (things deliberately left open, with
a trigger for revisiting). BMAD's brainstorming techniques are the direct inspiration here; FORGE
narrows them to software-product use and adds the convergence and write-back discipline.

## 16.2 Session types

| Type | Purpose | Facilitator | Typical participants | Output |
|---|---|---|---|---|
| `brainstorm` | Divergent idea generation on a framed problem | `facilitator` | `pm`, `analyst`, `architect`, `ux`, human | Idea set → ranked shortlist → decisions/actions |
| `design-review` | Evaluate a proposed design against requirements and risks | `facilitator` | `architect`, `security`, `sre`, `data-architect`, `critic`, human | Findings, blocking issues, ADR amendments |
| `tradeoff` | Resolve a decision with no obvious winner | `facilitator` | Owners of competing concerns + `critic` | Scored comparison → ADR |
| `premortem` | "It's six months later and this failed. Why?" | `facilitator` | Whole relevant roster + human | Risk register entries with mitigations |
| `retro` | Learn from a completed stage or incident | `em` | Roles that participated + human | Retro record, process changes, KB updates |
| `war-room` | Coordinated response to a live blocking failure | `em` | `diagnostician`, `sre`, owners | Timeline, mitigation, RCA hand-off |
| `estimation` | Size and sequence work under uncertainty | `em` | `po`, engineers, `architect` | Sized stories, sequencing, risk flags |
| `standup` | Fast state sync during a long run | `orchestrator` | Active lanes | Blockers, re-planning triggers |
| `discovery-interview` | Structured elicitation from the human about domain/users | `analyst` | `analyst`, human | KB entries in `product/` and `domain/` |
| `story-refinement` | Turn a vague capability into ready stories | `po` | `po`, `architect`, `test-architect` | Stories passing DoR |

## 16.3 Session anatomy

Every session runs the same five phases. The technique varies what happens inside them.

```
FRAME → DIVERGE → CONVERGE → DECIDE → RECORD
```

1. **FRAME** — state the question in one sentence, the constraints that apply (pulled from the KB),
   what is explicitly out of scope, and what a good outcome looks like. A session whose question
   cannot be stated in one sentence is refused; that is itself the finding.
2. **DIVERGE** — generate. Techniques govern this phase. Criticism is suspended; the `critic` role is
   muted here on purpose, because premature critique collapses the option space.
3. **CONVERGE** — cluster, deduplicate, and evaluate against the framed criteria. `critic` is
   unmuted. Options that survive are scored.
4. **DECIDE** — the decision owner (the role whose mandate covers it, per `decisions_owned`) rules,
   or the human does. Explicit non-decisions are recorded with a revisit trigger.
5. **RECORD** — write the `SESSION-###` artifact, create ADRs / risks / stories / KB proposals, and
   link everything bidirectionally.

**Facilitation invariants:**

- The facilitator does not contribute content, only structure. A facilitator that starts proposing
  solutions has stopped facilitating, and the session loses its check on groupthink.
- Every participating agent must be *able to disagree*: personas declare a `disagreement_style`
  (`05` §5.3), and a session where every participant agreed on everything is flagged as low-value in
  the record.
- The human can interject at any point; their input outranks agent output in CONVERGE.
- Time and cost bounds apply per phase; DIVERGE is capped so it cannot run away generating variations.

## 16.4 The technique library

Techniques are data (`techniques/*.technique.yaml`), selectable by the facilitator or the user, and
customisable (`15` C14). Only techniques with real software-product utility are shipped — the
selection is deliberately narrower than a general creativity toolkit.

### Divergent techniques

| id | Technique | Best for |
|---|---|---|
| `scamper` | Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Reverse — applied to an existing flow or feature | Improving something that exists |
| `first-principles` | Decompose to fundamental constraints, rebuild upward | Escaping an inherited design |
| `inversion` | "How would we make this fail / make this worse?" then invert | Finding hidden assumptions |
| `analogy` | How do adjacent domains solve this? | Novel problems with mature analogues |
| `constraint-removal` | Remove one hard constraint at a time and see what becomes possible | Stuck tradeoffs |
| `constraint-addition` | Add a brutal constraint (10× users, 1/10 budget, no network) | Forcing simplicity |
| `jobs-to-be-done` | What job is the user hiring this for? | Product scope questions |
| `user-journey-walk` | Walk a persona through the flow step by step, noting friction | UX and capability gaps |
| `failure-storming` | Enumerate every way each component can fail | Reliability design |
| `what-would-X-do` | Adopt a known engineering culture's stance (e.g. "the boring-tech stance", "the platform stance") | Breaking a stalemate between styles |
| `five-whys` | Repeated causal drilling | Retros and RCA |
| `assumption-audit` | List every assumption, rate confidence and impact, design the cheapest test | Pre-commitment de-risking |

### Convergent techniques

| id | Technique | Best for |
|---|---|---|
| `dot-voting` | Weighted preference across many options | Large idea sets |
| `impact-effort` | 2×2 placement | Prioritisation |
| `rice` | Reach × Impact × Confidence ÷ Effort | Product backlog ordering |
| `moscow` | Must/Should/Could/Won't | Stage scoping |
| `weighted-rubric` | The decision-framework scoring model (`11` §11.0) | Technical selection |
| `steel-man-debate` | Each side argues the opposing position before its own | Contested decisions |
| `reversibility-sort` | Sort by one-way vs two-way door; decide two-way doors fast, one-way doors slowly | Any decision batch |
| `cost-of-delay` | What does waiting cost? | Sequencing |

### Retro techniques

`what-went-well-badly-next`, `start-stop-continue`, `timeline-review` (reconstruct from the event log
— FORGE has the actual data, which is a real advantage over human retros), `five-whys`,
`sailboat` (wind/anchors/rocks), `data-driven` (velocity, cost per story, gate failure rates, flake
rates, rework ratio, review finding counts).

## 16.5 Session record

`# canonical` — `docs/forge/sessions/SESSION-{id}-{slug}.md`

```yaml
---
id: SESSION-012
type: brainstorm
title: "Reduce time-to-first-invoice"
technique: [ scamper, dot-voting ]
question: "How do we get a new user from signup to a sent invoice in under 10 minutes?"
constraints_applied: [ KB-CON-0003, NFR-0002, ADR-0016 ]
participants: [ facilitator, pm, architect, ux, human ]
started: 2026-03-08T14:02:00Z
ended: 2026-03-08T14:41:00Z
cost_usd: 2.14
status: complete
---

## Frame
<the one-sentence question, the constraints, what's out of scope, what good looks like>

## Diverge
<idea inventory, attributed to the participant that raised it, deduplicated but not yet judged>

## Converge
<clusters, scoring table, options eliminated with the reason>

## Decisions
| # | Decision | Owner | Artifact |
|---|---|---|---|
| 1 | Ship a 3-field quick-invoice path alongside the full form | pm | CAP-009 |
| 2 | Defer template branding to M2 | pm | stages.md |

## Non-decisions
| Question | Why deferred | Revisit trigger |
|---|---|---|
| Multi-currency defaults | No signal on demand | First non-US signup cohort |

## Actions
| # | Action | Owner | Artifact |
|---|---|---|---|
| 1 | Draft ADR for the quick-path data shape | data-architect | ADR-0019 |
| 2 | Add RISK: quick path bypasses tax validation | pm | RISK-007 |

## KB write-back
- KB-PROD-0009 updated: activation definition now "first invoice sent"
```

**Write-back is mandatory and is a distinct step**, not a byproduct. `forge session` will not mark a
session `complete` until every decision has an artifact reference and every action has an owner.
Sessions with zero decisions and zero actions are recorded as `inconclusive` with a stated reason —
which is honest, and sometimes correct.

## 16.6 Running sessions

```
forge session brainstorm --question "…" [--technique scamper] [--roles pm,architect,ux]
forge session design-review --target ADR-0011
forge session premortem --scope stage:mvp
forge session retro --stage mvp
forge session war-room --defect DEF-014
forge session tradeoff --question "…" --options a,b,c
forge session list | show <id> | resume <id> | export <id>
```

Sessions can also be **workflow steps** (`kind: session`), which is how they become part of the
process rather than something a user has to remember to do. Built-in placements:

| Where | Session |
|---|---|
| P1 Discovery | `discovery-interview`, `brainstorm` on the problem space |
| P2 Product Definition | `brainstorm` on capabilities, `story-refinement` |
| P3 Solution Shaping | `tradeoff` for contested ADRs, `design-review` before `G-Design`, `premortem` at L3+ |
| P5 Planning | `estimation`, `story-refinement` |
| P6 Implementation | `standup` on long runs (triggered by elapsed time or blocked-lane count) |
| P8 Stabilization | `war-room` on Sev1, `five-whys` in RCA |
| P10 Operate & Learn | `retro` at every stage boundary — **not optional** |

The stage retro is mandatory because it is the only mechanism by which the process improves itself.
It consumes real data from the event log (cost per story, gate failure rates, rework ratio, review
findings by perspective, flake trends) rather than relying on recollection, and its outputs feed
`engineering/ways-of-working.md` and overlay changes.

## 16.7 Multi-agent dynamics

Sessions use the interaction modes from `05` §5.7 — `panel` for independent-then-reconciled opinions,
`debate` for contested decisions, `swarm-review` for multi-perspective critique.

**Anti-groupthink measures**, which matter more than they sound because agents default to agreement:

1. In `panel` mode, participants answer **independently before seeing each other's answers**. Order
   effects and anchoring are the main failure of naive multi-agent discussion.
2. `critic` participates in CONVERGE with a mandate to produce falsifiable objections; "this seems
   fine" is not an acceptable contribution and is rejected by the facilitator.
3. `steel-man-debate` requires each side to state the opposing case convincingly before its own.
4. The record flags a session where no participant disagreed with any other, so the user can see when
   a session was theatre.
5. The human's position is not revealed to participants during DIVERGE, so agents do not simply
   converge on it. It enters at CONVERGE, where it outranks.

## 16.8 Cost and bounds

Sessions are conversational and can burn tokens fast. Defaults, all configurable:

| Bound | Default |
|---|---|
| Max rounds per phase | DIVERGE 3, CONVERGE 2, DECIDE 1 |
| Max participants | 5 agents + human |
| Max wall clock | 20 min |
| Max cost | $3 |
| Idea cap in DIVERGE | 30 before forced clustering |

On breach: the facilitator forces convergence with what it has and records that the session was
truncated — better a bounded, honest partial result than an unbounded conversation.
