<!-- forge:generated v=0.0.0 hash=e0b92f9997e9c71d0b2a1031ad5ee2fc4dd7c094d8f9dcc1cc126dea8f4552c6 — edits will be overwritten; use overrides/ -->
### Specialisation for writing the UX spec

Design the flows one capability at a time, tracing each element back to that capability's acceptance
summary, and record them in the UX specification the step brief asks for, which must also carry a
capability coverage table: every capability of the stage either has a flow here or is listed as
having no user interface, with the reason.

1. Establish who and why. From the capability and the discovery findings, state the persona or job
   to be done, the trigger that starts the flow, the situation (device, interruptions, urgency), and
   the success condition in the user's terms. Where discovery is silent, record an assumption
   instead of describing an imagined user.
2. Map the primary flow first, as a diagram with a caption and a text summary, then each alternative
   flow (returning user, shortcut, different permission level) and each failure flow (validation
   failure, service failure, timeout, lost connection, denied permission, expired session, cancelled
   midway). Every node must have an exit.
3. Build the state inventory as a table: screen or step, then every state it can be in, the exact
   copy shown, the actions available, and where each action leads. Use the full state list in your
   role instructions, and mark states that do not apply with the reason so their absence is visible.
4. Specify interaction details that cause most build ambiguity: when validation fires, what receives
   focus after each transition, what feedback appears and how quickly, what happens on back and
   reload, what is preserved on failure, and how a long-running action reports progress and
   cancellation.
5. Specify accessibility per flow: focus order, accessible names for controls, how errors and status
   changes are announced, the contrast and target-size expectations of the accessibility level the
   cited non-functional requirement sets (do not assume a level), and keyboard-only paths through
   the whole flow.
6. Information architecture delta: where the flow enters the navigation, what it is called and why
   (using the project's vocabulary), and how a user finds it again.
7. Copy deck: write every string, including error and empty-state text, with the reason the wording
   was chosen where it is non-obvious. Errors say what happened, what it affects, and what to do
   next.
8. Coverage check: each branch in the diagram appears in the state inventory; each state has copy;
   each error has a recovery action; each acceptance-summary condition is reachable through some
   flow; nothing in the design is unrelated to the capability.
9. Handoff: list the states and behaviours that should become acceptance criteria, the unresolved
   design questions (in the handoff's open questions, which do not block; create a knowledge-base
   open question only for one the product cannot be approved without, and resolve it or convert it
   to an assumption before the gate), the assumptions that need validation, and anything that
   depends on an engineering constraint you do not know.

Common mistakes: a beautifully specified happy path with "show an error" for everything else; a
modal on top of a modal; an error that blames the user and offers no way forward; assuming every
user is new or every user is returning; ignoring users who lack a permission; copy left to be
invented at build time.
