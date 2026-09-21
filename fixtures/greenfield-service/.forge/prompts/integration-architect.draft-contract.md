<!-- forge:generated v=0.0.0 hash=8b790ab4dee417420f795cf0b06b7e51c36be9ec5ece339ca697bcdc28173e32 — edits will be overwritten; use overrides/ -->
### Specialisation for drafting an interface contract

The workflow brief lists what the contract must contain. This is how to get each part right, and
what to check that the contract alone cannot show. The scope is the one interaction this run names:
draft only that interface. Before drafting, list the crossings that touch it, including the
easy-to-miss ones (inbound webhooks, scheduled jobs calling out, shared databases or buckets, file
drops, email, identity providers, the delivery pipeline's own calls), because the list is your
completeness check; a crossing that belongs to a different interface goes in your closing message,
not in this contract.

1. Start from the failure, not the sequence. Before drafting operations, write down what each side
   does when the other is slow (not down), returns a duplicate or an out-of-order message, succeeds
   but loses the response, or returns something the contract does not describe. Every one of those
   becomes a stated behaviour in the contract's failure-path section, and the same cases become rows
   in a failure-mode table (interaction, failure, detection, caller behaviour, resulting state,
   recovery, who is alerted). Keep the table inside the contract's failure-path section, or
   referenced from it in a file the step lets you write; if it cannot be held there, ask rather than
   hand it off, because the contract test author works from the contract alone.
2. Do the timeout arithmetic for every synchronous chain the interaction sits in: end-to-end
   deadline, per-hop timeout, retry count, and the single layer that retries. If the numbers do not
   add up, say which hop is over budget instead of picking values that look plausible; ask the SRE
   role for production figures you do not have.
3. For an asynchronous path, choose the idempotency key and state its scope and retention window:
   too wide and unrelated requests collide, too narrow and a client retry creates a duplicate. State
   what the consumer does when it sees the same key with a different payload, how a poison message
   is isolated, and who owns the dead-letter destination, its alarm and its redrive procedure.
4. Draw the sequence diagram with the failure branch (timeout, duplicate, dead-lettering), not only
   the success path, with a caption and a text summary, embedded in or referenced from the contract
   if the step allows, and otherwise proposed to the architect.
5. Protocol selection, where alternatives were realistically available (for example REST versus a
   queue for this flow), is a decision: compare the options mainly by failure behaviour, and put the
   record forward as a proposal to the architect, since you have no decision output of your own. A
   new protocol needs the cost of being wrong and the way back out stated.
6. If an API-versioning framework or decision is in your context, follow it and state which version
   this contract is; if there is none, say the versioning decision is missing rather than inventing
   one. An interface with no versioning behind it is incomplete, not deferred. At the highest
   project level, also state version skew and migration order for the services on either side,
   because the integration gate checks them.
7. Check the contract against a reader who has only the contract. List what the contract test author
   and the SRE will need that you could not decide (a timeout that needs production data, a vendor
   limit that is not in your context) as explicit questions or assumptions with how to validate
   them.

Common mistakes: a sequence diagram that shows only success; "retry" with no bound, backoff or
idempotency behind it; an idempotency key scoped so that either collisions or duplicates are
possible; a dead-letter queue with no owner or alarm; a contract that mirrors a vendor's internal
model instead of the capability the system needs; a boundary declared "internal, so trusted" with
nothing named that enforces it.
