<!-- forge:generated v=0.0.0 hash=92297270298f4ab94ff6203936fa47c0c65e0a01682bf6b00b162e4205fcee29 — edits will be overwritten; use overrides/ -->
Something changed: a gate failed, a constraint surfaced, a human asked, or a lane found that a
contract cannot hold. State the change precisely so it can be analysed, approved or rejected. This
step produces a proposal, not an edit. Nothing in the specs, ADRs, stories or code changes until a
human approves the analysed proposal.

### Inputs

- The workflow input `changeSummary`, and the event that triggered the change if one is named: a
  gate report, a contract-change request, a defect, a human message.
- The current specification state: the Vision, capabilities, NFRs, the stage plan and the accepted
  ADRs the change appears to touch, with their ids and revisions.
- The KB's constraints, risks and open questions, and the current stage goal.

### Produce

One HandoffRecord with subtype `change-proposal`, `from: pm`, `to: architect`,
`step: propose-change → impact-analysis`. The record's front matter is strict, so use exactly these
keys and no others: `id` (`HO-` and four digits), `from`, `to`, `step`, `timestamp` (ISO 8601
date-time), `delivered`, `open_questions`, `assumptions` (each an object with `id` as `ASM-` and
three digits, `text`, `confidence` of `low`, `medium` or `high`, and `validate_by`),
`constraints_for_receiver` and `acceptance_for_receiver`. There is no `subtype` key: make the first
`delivered` entry `subtype: change-proposal`, which is how a reader recognises this record. Its
content:

- `delivered`, one entry per label:
  - **Change:** what is to be different, in product and scope terms (capabilities, priorities, NFR
    targets, stage boundaries), in one paragraph a stakeholder can approve or reject.
  - **Trigger:** the event and its evidence, cited by id or path.
  - **Current baseline:** the artifacts and revisions this change starts from.
  - **Options:** the change as proposed, a smaller version, and doing nothing, each with what it
    costs and what it forfeits.
  - **Displaces:** what is cut, deferred or de-prioritised to make room. Every addition to scope
    displaces something; say what.
  - **Unchanged:** what the change explicitly does not touch.
- `open_questions`: what must be answered before impact can be assessed, each specific.
- `assumptions`: each with confidence and how it would be validated.
- `acceptance_for_receiver`: what the impact analysis must establish for a decision to be possible
  (affected artifacts and accepted ADRs, invalidated work, cost and time delta).

### Acceptance criteria

- A reader who has not seen the conversation can tell exactly what is being proposed and why.
- The trigger is evidenced, not asserted, and the baseline names real artifact ids.
- The proposal distinguishes what is decided (the request) from what is unknown (its effects).
- The do-nothing option is present and honest.

### Do not

- Do not start implementing, edit any artifact, bump a revision, or re-derive stories, tests or
  ADRs.
- Do not estimate cost, time or affected artifacts in detail; the impact analysis computes them.
- Do not approve or reject your own proposal, or word it to pre-empt the decision.
