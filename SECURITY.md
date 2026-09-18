# Security Policy

FORGE orchestrates AI coding agents with real filesystem write access, shell execution, and network
grants — a security defect here can mean a malicious or malformed overlay/module bundle escaping
containment, a hostile fetched dependency executing something it shouldn't, or a control checkpoint
(the capability consent screen, a destructive-operation confirmation) being silently bypassed. We
take reports in this category seriously and ask that you report them privately.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Email **radwanizzat@gmail.com** with:

- A description of the vulnerability and its real-world impact (what a malicious actor could
  actually do, not just that a check is theoretically incomplete).
- Steps to reproduce, or a minimal proof-of-concept overlay/module bundle, workflow, or input that
  triggers it.
- The version or commit SHA you tested against.

You should receive an acknowledgment within a few days. We'll work with you to understand and
confirm the issue, and to agree on a disclosure timeline once a fix is available.

## Scope

In scope: anything that lets code, a fetched bundle, or model-generated content escape a real,
documented containment boundary — path/worktree containment, the exec/network grant model, the hard
command denylist, the capability consent screen, control-token stripping, secret redaction, or any
of the `S1`–`S12` safety invariants `specs/20-security-safety-and-cost.md` §20.10 names explicitly.

Also in scope: a real defect in this project's own supply chain (a dependency pinning gap, a
`postinstall` script, a release pipeline permission broader than it needs to be).

Out of scope: a vulnerability that requires an already-fully-trusted actor (someone who already has
your `ANTHROPIC_API_KEY`, shell access to your machine, or write access to this repository) —
FORGE's threat model is about content and code it does not already trust, not about defending
against someone who already has the keys.

## Our approach to security by design

This isn't an afterthought bolted onto a finished product — `specs/20-security-safety-and-cost.md`
is one of the normative spec documents this codebase is built against, and its §20.10 invariants
each have a real, adversarial test proving the invariant holds under a genuinely hostile input, not
merely under well-formed input. If you find a gap in one of these tests — an adversarial shape it
doesn't cover — that's exactly the kind of report we want.
