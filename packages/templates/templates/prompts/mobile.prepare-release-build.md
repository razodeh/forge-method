### Specialisation for preparing a store release build

The workflow brief gives the checklist; this is the mobile-specific judgement behind it. Anything
you cannot verify with your tools stays marked unverified, not passed.

1. Version numbers. The build number (iOS build, Android version code) must strictly increase for
   every upload, and the two platforms track it separately, so read each platform's current values
   from the project's own configuration and state old and new values and where each is defined. If a
   single source could drive both, mention it as a recommendation only.
2. Release versus development. Search the source for what must not ship: debug flags, developer
   menus, staging or test endpoints, permissive network-security exceptions, verbose logging, and
   analytics keys for a non-production environment. List what you found and changed, and what you
   found and left, with the reason for each.
3. If signing material or secrets are already committed to the repository, that is a blocking
   finding for the security role, not something you tidy up quietly.
4. Permissions and privacy. Compare the manifest or entitlements with what the code actually uses
   and with the store's privacy declarations (data-collection disclosures, the privacy manifest,
   required-reason API usage). Every permission and every third-party SDK needs a stated reason in
   the record. Remove only manifest or entitlement declarations that a search of the code shows are
   unused; a permission or SDK that is used but unjustified is a finding for the release role and
   the human, because this step does not change application behaviour.
5. Store compatibility. Check the target platform version and minimum OS against the current store
   submission requirements as they are stated in the project's own KB or standards. If the
   requirement is not in your context, ask; do not rely on memory of store policy, which changes.
6. Symbols and shrinking. If the release build minifies or obfuscates, the mapping and debug-symbol
   files must be produced and retained per build so crashes can be symbolicated; say where they are
   stored.
7. Device matrix. You create the suite that will produce the evidence, never the evidence: the
   record (`docs/forge/kb/mobile/device-matrix.md`) is written from devices that really ran, by
   whoever runs them, and a fabricated passing row is a defect. This step is the one place you
   create a test file yourself, because the brief says so. List the platform and OS combinations the
   project claims to support, so the runner knows which rows to expect, and know how the delivery
   check reads the record: lines of the form `- Device: iPhone 15 | OS: iOS 17.4 | Result: pass`
   under a Coverage heading; at least one iOS row and one Android row are required (a project that
   ships only one platform needs a recorded waiver, not a blank); Android is recognised only when
   the device or OS text says so (for example `Device: Pixel 8 | OS: Android 14`); any failing row
   fails the check; and lines of any other shape are silently ignored, so a malformed row counts as
   no row.

Hand off to the release role with the versions, the permission and SDK list, the symbol storage
location, the combinations the device-matrix suite must cover, the known issues the store notes
should mention, and the plain statement that no matrix rows exist from you. You do not submit to a
store or deploy.
