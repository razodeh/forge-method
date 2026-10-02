---
id: DISC-001
kind: trade-off
summary: '<a one-sentence statement of the disclosed trade-off or known gap>'
owner: '<the role accountable for this disclosure>'
sources:
  - kind: decision
    ref: '<an ADR id, or another real source this disclosure traces back to>'
resolved: false
---

<A one-off entry stub: copy this front-matter block into `kb/disclosures.md` to register a new
disclosure. This type has no whole-document body — the register is the front matter itself.
`forge kb disclose` is the real way to create one: it validates `--kind`/`--owner`/`--source` before
writing, which a hand-copied stub cannot do. Once recorded, a disclosure is never deleted — only
resolved, with a real reason and owner, via `forge kb disclose resolve <id>`.>
