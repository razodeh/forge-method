<!-- forge:generated v=0.0.0 hash=fbcdf02f5913b0c21e059b52cab9f2bae88852a6c7646272dbf276e6ee1b729c — edits will be overwritten; use overrides/ -->
### Specialisation for implementing a mobile story

1. Before writing code, map each acceptance criterion to the platform states it touches: lifecycle
   (background, process death, restore), connectivity (offline, retry, duplicate submit),
   permissions (denied, revoked), and device class (small screen, large text, screen reader). Note
   which of these the story's tests already exercise and which have no test; the untested ones are
   where you are most likely to be wrong, so read the code path twice.
2. Decide where the logic lives. Business rules and state transitions go in plain,
   platform-independent code that can be tested without a device; views only render state and
   forward events. If the project is cross-platform, put shared behaviour in the shared layer and
   confine each platform-specific branch to a small, named adapter.
3. Implement against the tests you were given and the story's file claim. Do not edit test files. If
   a test asserts something the acceptance criteria do not say, request a change with the criterion
   quoted.
4. For every screen or step you touch, handle in code the states the acceptance criteria and tests
   require, and check the remaining ones (loading, empty, error with a recovery action, offline,
   permission-denied where relevant) against them; a state that matters but has no criterion is
   asked about, not silently invented, and is listed in your handoff. Use externalised strings, not
   literals, and set accessibility labels, roles and focus order for anything interactive.
5. Guard newer platform APIs by version check with a fallback down to the project's minimum
   supported OS. Confirm the minimum in the standards rather than assuming.
6. If the story changes local storage, add a migration that works from every previously shipped
   schema version and note how it can be verified. If it changes a network request, check the
   request still works against the previous server version and tolerates unknown response fields.
7. Any permission, entitlement, background mode, or third-party SDK you add changes the store
   privacy declaration. List it explicitly in your handoff so the release role does not discover it
   at submission time.
8. Leave your changes in the lane for the engine to commit; do not commit yourself, and touch only
   what the story requires.

Hand off with: the exact build and test commands for each platform, the device and OS combinations
that should be exercised (including at least one small-screen and one older-OS case), the behaviours
that can only be verified on real hardware, and any acceptance criterion you interpreted, with your
interpretation stated.

Common mistakes: handling the happy path on one platform and assuming the other matches; persisting
UI state that should be derived; a retry that double-submits because the first request actually
succeeded; requesting a permission at launch instead of at the moment of need; swallowing a
migration error; hard-coding a string or a colour that breaks dark mode or localisation.
