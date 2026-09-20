### Specialisation for documenting a story's UI components

This applies when the story created, or materially changed, a reusable component: one with its own
props and states that other code will use. For each such component, write a component specification
in addition to the documentation the step brief asks for; if the story added none, follow the step
brief alone. The specification's path is a knowledge-base file that your claim may not cover: if it
does not, raise `FORGE_REQUEST_CHANGE:` with the path and the specification text you would add
rather than writing it elsewhere. If the implementing step already wrote a specification for the
component, update that one and keep its id instead of creating a second. The specification lets
another engineer use the component correctly without reading its source, and makes its accessibility
contract explicit. The artifact's front matter carries the component name and three lists of plain
strings (props, states, accessibility notes), and the body has matching Props, States and
Accessibility notes sections. Each list entry is written into YAML as a bare string, so keep every
entry plain: no backticks (the template adds its own around props in the body), no leading quote,
bracket, brace, asterisk, at-sign, ampersand, exclamation mark or percent sign, no ": " and no " #"
inside it. Write "open (boolean, required, default false) - whether the panel is expanded". Keep the
front matter and the three body sections identical in content. The artifact needs an id of the form
CS-### and a draft status, alongside the other standard front-matter fields. Anything that does not
fit those fields (purpose, usage, open questions) goes in extra body sections after them, not in new
front matter.

**Name and purpose.** State the exported name and one sentence on the job it does for a user. If a
component with the same purpose already exists in the project, say why it is not being reused;
duplication costs maintenance and bundle size.

**Props.** One entry per prop: name, type, required or optional, default, and its meaning in
behavioural terms ("when true, the panel is closed but stays mounted"). Include callbacks with their
argument shapes. Say which props are controlled and which are not, list invalid prop combinations as
invalid, and do not list internal state as props.

**States.** Every state the component can be in and what the user sees and can do in each: default,
hover and focus, active, disabled, loading, empty, error, success, and any permission or data
variation. For each, the trigger and how the user leaves it. A missing state here is a missing test
later, so err towards completeness, and mark states you inferred rather than were told.

**Accessibility notes.** Concrete and testable: the element or role it renders as; its accessible
name and where it comes from; keyboard interaction (which keys do what, tab order, behaviour inside
a focus trap); focus management on open, close and error; what is announced to assistive technology
and when; contrast and non-colour cues; behaviour under zoom, reduced motion and narrow widths.
"Accessible" is not a note; a note describes an observable behaviour someone could turn into a test.
The spec should not leave draft with this section empty.

**Usage and limits (extra body section).** One correct example and one common misuse, the
bundle-size effect if it pulls in a dependency, the design artifact it implements, the story or
contract that requires it, and open questions for the designer in place of guesses at visual detail.

Before finishing, check that every prop and state in the code or tests appears in the spec and the
reverse, and that the accessibility notes could be turned directly into assertions.
