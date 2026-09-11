/**
 * `<CustomizeScreen>` — `04` §4.3 S8: the real customization surfaces with per-field layer provenance
 * colouring and live validation. Composes `<ListPane>` (P3), `<DiffView>` (P4).
 *
 * Real design decisions, recorded fully in `SPEC-QUESTIONS.md` Q146:
 *
 * 1. **`PLAN-M9.md` P14's own "the fifteen customization surfaces" is wrong against `15` §15.1's own**
 *    **real table, which has sixteen rows (C1–C16), not fifteen.** Confirmed directly by reading the
 *    table itself. `CUSTOMIZATION_SURFACES` (below) transcribes all sixteen, verbatim — the identical
 *    "trust the already-real spec table over the plan's own prose" correction `PLAN-M9.md` P1
 *    (`SPEC-QUESTIONS.md` Q133) and `PLAN-M9.md` P10 (Q142, `KB_SECTIONS`) already established, now
 *    recurring a third time in this same milestone. No code anywhere in `@forge/extensions` already
 *    exports this table as data (confirmed by search), so this screen is the first to transcribe it.
 * 2. **`@forge/tui` may not import `@forge/extensions` at all — confirmed directly against the real,**
 *    **already-established dependency graph** (`tools/eslint-plugin-forge-boundaries/src/graph.mjs`'s
 *    own `PACKAGE_GRAPH`, enforcing `specs/02` §2.2): `tui`'s own real allowed edge list is `['engine',
 *    'core', 'kb', 'telemetry', 'schemas']` — `extensions` is not in it, and this is a genuine,
 *    deliberate architectural boundary this piece must respect, not an oversight to patch around by
 *    adding the edge. `PLAN-M9.md` P14's own "`@forge/extensions`, consumed read-only here, never
 *    re-implemented" is therefore also imprecise: this screen cannot import `@forge/extensions`'s own
 *    `Layer`/`InvariantId` types at all. `Layer`/`InvariantId` below are **local, plain string-literal
 *    unions this file defines itself**, mirroring `@forge/extensions/resolve`'s real `L0`–`L4` values
 *    (`15` §15.2: built-in/installed-modules/organisation-overlay/project-overrides/personal-overrides
 *    — `PLAN-M9.md` P14's own "built-in/module/org/project/local" text says "local" where the real spec
 *    says "personal," a second, independent correction) and `@forge/extensions/invariants`'s real
 *    `I1`–`I12` values, without ever importing them — a caller on the *other* side of this boundary
 *    (one that genuinely may depend on `@forge/extensions`, e.g. a CLI or engine-side integration
 *    layer) is responsible for converting real `Layer`/`InvariantId` values into these compatible,
 *    locally-defined ones before they ever reach this screen's own props.
 * 3. **No per-field "this field is locked by invariant X" data structure exists anywhere in**
 *    **`@forge/extensions` today — confirmed directly against its real, exported `invariants` types**
 *    (a fact still worth recording even though this screen can no longer import that package directly
 *    to demonstrate it inline). `runInvariants` operates on a whole `ResolvedSet` and returns a batch
 *    `InvariantViolation[]`, not a live per-field lookup a TUI could render inline next to one resolved
 *    field. This screen accepts already-flattened `ResolvedFieldRow[]` (one row per touched field, each
 *    optionally carrying a locked-invariant id) as an explicit, caller-supplied fact — the same
 *    caller-supplied-fact pattern every prior S-screen this milestone already established, not a
 *    re-implementation of resolution or invariant-checking.
 * 4. **`e`/`r` (edit/reset) are refused structurally, not by convention, for a locked field** — the
 *    identical UI-layer-refusal discipline `<GatesScreen>` (P11)'s own approve/waive hard-MUST
 *    enforcement already established: neither command is ever constructed at all when the focused
 *    field's own `lockedInvariantId` is set; the refusal reason (the real invariant id) renders in the
 *    UI instead.
 * 5. `d` (diff-vs-base) is a pure, local view concern — the identical reasoning `<RunBoard>` (P8)'s own
 *    `d` already established — toggling `<DiffView>` (P4) for the focused field's own caller-supplied
 *    `diffPatch`, never a command. `t` (test) and `E` (eject preset) both act on the currently-selected
 *    *surface*, not the focused field, and both emit a command then render whatever pending/pass/fail
 *    state the caller-supplied `testStatusBySurfaceId` reports — never running validation logic inline.
 *    **[disclosed, not fixed]** `E` is reachable for any surface, not only `C13` "Presets" — the one
 *    surface "eject a preset" conceptually applies to. Left un-restricted here: nothing in `04` or `15`
 *    names a real per-surface command-availability rule, and inventing one unilaterally risks being
 *    wrong in a way a real engine-side handler (validating/no-op'ing for a non-`C13` surface) is the
 *    actual right place to decide, not this screen guessing at it.
 * 6. **Two `<ListPane>`s compose this screen (surfaces / fields within the selected surface), sharing**
 *    **`FIELD_PANE_INDEX`'s own focus with the fields pane's own `/`-filter-editing mode — a
 *    genuinely different situation from `<RunBoard>` (P8)'s own action keys, which are gated to a
 *    *different*, non-`<ListPane>` detail pane and so never shared a pane with any `<ListPane>`'s own
 *    filter capture at all.** A round-1 critic reproduced directly that gating this screen's own
 *    action-key `useInput` on pane focus alone (mirroring `<RunBoard>`'s own gate shape without
 *    checking whether its own precondition — "the colliding `<ListPane>` lives in a different pane" —
 *    still held) let it double-fire alongside the fields `<ListPane>`'s own filter-editing mode: typing
 *    a filter string like `"eject the test config"` while browsing fields fired real
 *    `ejectPreset`/`testSurface` commands as a side effect of typing, and `e`/`r` fired real edit/reset
 *    commands too whenever a field happened to already be selected. **Fixed**: `<ListPane>` (P3) gained
 *    a new, additive `onFilterModeChange` prop (the identical shape `<Tree>` (P3)'s own `onFocusChange`
 *    extension, P9, already established for an analogous need) — this screen's own action-key hook is
 *    now gated `focusedPane === FIELD_PANE_INDEX && !fieldsFiltering`, closing the collision
 *    structurally rather than by a pane-index shape that happened to work for a different screen. A
 *    round-2 critic, verifying that fix, found one further real gap it introduced: this screen's own
 *    fields pane conditionally unmounts `<ListPane>` in favour of a plain `<Text>` the instant
 *    `activeFields` becomes empty (below) — since `<ListPane>`'s own `onFilterModeChange` effect only
 *    ever re-fired on `isEditingFilter` *transitions*, not on an unrelated unmount, a live prop update
 *    clearing the selected surface's own fields while genuinely mid-filter left `fieldsFiltering` stuck
 *    `true` forever (until some later remount happened to reset it), silently blocking `t`/`d`/`E` even
 *    though none of them require a selected field at all. **Fixed in `<ListPane>` itself** (not here):
 *    a second, empty-deps effect's own cleanup — the one place guaranteed to run exactly once, on
 *    unmount, regardless of why — now fires a final `false` unconditionally. A round-3 critic,
 *    dispatched specifically to check whether the `onFilterModeChange` mechanism itself was now fully
 *    closed (it was — no further issue was found there across three rounds of dedicated adversarial
 *    testing), found a genuinely different, real bug while constructing its own fresh scenarios: since
 *    the fields `<ListPane>` was never keyed on `selectedSurfaceId`, switching surfaces changed its own
 *    `items` prop in place rather than remounting it — `<ListPane>`'s own internal `filterQuery`/
 *    `isEditingFilter`/`selectedId` state is untouched by an `items` change alone, so a filter query
 *    typed for one surface silently kept applying to a *different* surface's own, unrelated fields
 *    after switching, hiding real fields behind a stale query the user never typed for that surface at
 *    all. **Fixed**: the fields `<ListPane>` is now keyed on `selectedSurfaceId` — the identical "a
 *    caller switching to a genuinely different dataset must give it a distinct `key`" discipline
 *    `<Tree>` (P3)'s own doc comment already establishes, forcing a fresh, unfiltered instance every
 *    time the selected surface actually changes (and, as a side effect, additionally exercising the
 *    unmount-cleanup fix immediately above on every ordinary surface switch, not only the empty-fields
 *    case that originally found it).
 *
 * @see specs/02 §2.2
 * @see specs/04 §4.3 S8
 * @see specs/15 §15.1, §15.2, §15.10
 * @see PLAN-M9.md P14
 * @see SPEC-QUESTIONS.md Q146
 */
import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useState } from 'react';

import type { ScreenProps } from '../components/app-shell.tsx';
import { DiffView } from '../components/diff-view.tsx';
import { defaultListItemLabel, ListPane } from '../components/list-pane.tsx';
import { Pane } from '../components/pane.tsx';
import type { EngineCommand } from '../state/engine-command.ts';

/** Mirrors `@forge/extensions/resolve`'s own real `Layer` values (`L0` built-in through `L4` personal)
 * without importing that package — see this file's own top doc comment point 2 for why. */
export type Layer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

/** Mirrors `@forge/extensions/invariants`'s own real `InvariantId` values (`I1`-`I12`) without
 * importing that package — see this file's own top doc comment point 2 for why. */
export type InvariantId =
  'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7' | 'I8' | 'I9' | 'I10' | 'I11' | 'I12';

export interface CustomizationSurface {
  readonly id: string;
  readonly name: string;
}

/** `15` §15.1's own real table, transcribed verbatim -- sixteen rows (C1-C16), not the fifteen
 * `PLAN-M9.md` P14's own text names. See this file's own top doc comment point 1. */
export const CUSTOMIZATION_SURFACES: readonly CustomizationSurface[] = [
  { id: 'C1', name: 'Agent behaviour' },
  { id: 'C2', name: 'Agent roster' },
  { id: 'C3', name: 'Agent knowledge' },
  { id: 'C4', name: 'Agent reach' },
  { id: 'C5', name: 'Tool grants' },
  { id: 'C6', name: 'Workflows' },
  { id: 'C7', name: 'Gates & checks' },
  { id: 'C8', name: 'Decision frameworks' },
  { id: 'C9', name: 'Templates & artifacts' },
  { id: 'C10', name: 'Technology catalog' },
  { id: 'C11', name: 'Standards & DoD' },
  { id: 'C12', name: 'Voice & language' },
  { id: 'C13', name: 'Presets' },
  { id: 'C14', name: 'Sessions' },
  { id: 'C15', name: 'Platform behaviour' },
  { id: 'C16', name: 'Diagrams' },
];

const LAYER_LABEL: Readonly<Record<Layer, string>> = {
  L0: 'built-in',
  L1: 'module',
  L2: 'org',
  L3: 'project',
  L4: 'personal',
};

export interface ResolvedFieldRow {
  readonly path: string;
  readonly displayValue: string;
  readonly layer: Layer;
  readonly lockedInvariantId?: InvariantId;
  readonly diffPatch?: string;
}

export type SurfaceTestStatus = 'pending' | 'pass' | 'fail';

export interface CustomizeScreenProps extends ScreenProps {
  readonly modifiedCountBySurfaceId: ReadonlyMap<string, number>;
  readonly fieldsBySurfaceId: ReadonlyMap<string, readonly ResolvedFieldRow[]>;
  readonly testStatusBySurfaceId: ReadonlyMap<string, SurfaceTestStatus>;
  readonly onCommand: (command: EngineCommand) => void;
}

const PANE_COUNT = 2;
const SURFACE_PANE_INDEX = 0;
const FIELD_PANE_INDEX = 1;
const LIST_HEIGHT = 8;

function surfaceLabel(surface: CustomizationSurface, modifiedCount: number): string {
  const badge = modifiedCount > 0 ? ` (${String(modifiedCount)})` : '';
  return `${surface.id} ${surface.name}${badge}`;
}

function fieldLabel(field: ResolvedFieldRow): string {
  const lock = field.lockedInvariantId ? ` 🔒 ${field.lockedInvariantId}` : '';
  return `${field.path} = ${field.displayValue} ← ${LAYER_LABEL[field.layer]}${lock}`;
}

export function CustomizeScreen({
  mode,
  focusedPaneIndex,
  modifiedCountBySurfaceId,
  fieldsBySurfaceId,
  testStatusBySurfaceId,
  onCommand,
}: CustomizeScreenProps): JSX.Element {
  const focusedPane = focusedPaneIndex % PANE_COUNT;
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string>(
    CUSTOMIZATION_SURFACES[0]?.id ?? 'C1',
  );
  const [selectedFieldPath, setSelectedFieldPath] = useState<string | undefined>(undefined);
  const [showDiff, setShowDiff] = useState(false);
  // Tracks whether the fields `<ListPane>` (sharing this screen's own `FIELD_PANE_INDEX` focus, unlike
  // `<RunBoard>` (P8)'s own action keys, gated to a *different*, non-`<ListPane>` detail pane) is
  // currently capturing raw `/`-filter text -- a round-1 critic reproduced directly that gating this
  // screen's own action-key hook on pane focus alone let it double-fire alongside the fields pane's own
  // filter-editing mode (Ink's `useInput` has no "only the topmost/focused consumer sees this key"
  // routing): typing "eject the test config" while filtering fired real `ejectPreset`/`testSurface`
  // commands as a side effect. `<ListPane>` (P3) gained a new, additive `onFilterModeChange` prop for
  // exactly this, the identical shape `<Tree>` (P3)'s own `onFocusChange` extension (P9) already
  // established for an analogous need.
  const [fieldsFiltering, setFieldsFiltering] = useState(false);

  const activeFields = fieldsBySurfaceId.get(selectedSurfaceId) ?? [];
  // Re-derived every render, never trusted from state directly -- the same "never act on a possibly-
  // stale id" discipline every prior S-screen this milestone already established.
  const activeField =
    selectedFieldPath !== undefined
      ? activeFields.find((field) => field.path === selectedFieldPath)
      : undefined;
  const testStatus = testStatusBySurfaceId.get(selectedSurfaceId);

  useInput(
    (input) => {
      if (input === 't') {
        onCommand({ type: 'customize.testSurface', surfaceId: selectedSurfaceId });
        return;
      }
      if (input === 'E') {
        onCommand({ type: 'customize.ejectPreset', surfaceId: selectedSurfaceId });
        return;
      }
      if (input === 'd') {
        setShowDiff((current) => !current);
        return;
      }
      if (activeField === undefined) return;
      if (input === 'e') {
        if (activeField.lockedInvariantId !== undefined) return;
        onCommand({
          type: 'customize.editOverlay',
          surfaceId: selectedSurfaceId,
          fieldPath: activeField.path,
        });
        return;
      }
      if (input === 'r') {
        if (activeField.lockedInvariantId !== undefined) return;
        onCommand({
          type: 'customize.resetField',
          surfaceId: selectedSurfaceId,
          fieldPath: activeField.path,
        });
      }
    },
    { isActive: focusedPane === FIELD_PANE_INDEX && !fieldsFiltering },
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Pane title="Surfaces" focused={focusedPane === SURFACE_PANE_INDEX} mode={mode}>
          <ListPane
            items={CUSTOMIZATION_SURFACES}
            getId={(surface) => surface.id}
            getFilterText={(surface) => surface.name}
            renderItem={(surface) =>
              defaultListItemLabel(
                surfaceLabel(surface, modifiedCountBySurfaceId.get(surface.id) ?? 0),
                undefined,
                mode,
              )
            }
            onSelect={(surface) => {
              setSelectedSurfaceId(surface.id);
              setSelectedFieldPath(undefined);
              setShowDiff(false);
            }}
            focused={focusedPane === SURFACE_PANE_INDEX}
            height={LIST_HEIGHT}
          />
        </Pane>
        <Pane title="Resolved fields" focused={focusedPane === FIELD_PANE_INDEX} mode={mode}>
          {activeFields.length === 0 ? (
            <Text dimColor>No resolved fields for this surface.</Text>
          ) : (
            <ListPane
              // Keyed on the selected surface -- a round-3 critic reproduced directly that switching
              // surfaces while the fields list was still mid-filter left the OLD surface's own filter
              // query applied to the NEW surface's own, unrelated fields, since `items` changing alone
              // never resets `<ListPane>`'s own internal `filterQuery`/`isEditingFilter`/`selectedId`
              // state: a real field could go silently invisible behind a stale query the user never
              // typed for this surface at all. The identical "a caller switching to a genuinely
              // different dataset that might reuse ids must give it a distinct `key`" discipline `<Tree>`
              // (P3)'s own doc comment already establishes forces a fresh instance -- with fresh,
              // unfiltered state -- every time the selected surface actually changes.
              key={selectedSurfaceId}
              items={activeFields}
              getId={(field) => field.path}
              getFilterText={(field) => field.path}
              renderItem={(field) => <Text>{fieldLabel(field)}</Text>}
              onSelect={(field) => {
                setSelectedFieldPath(field.path);
              }}
              focused={focusedPane === FIELD_PANE_INDEX}
              height={LIST_HEIGHT}
              onFilterModeChange={setFieldsFiltering}
            />
          )}
          {showDiff && activeField?.diffPatch !== undefined ? (
            <DiffView patch={activeField.diffPatch} mode={mode} />
          ) : undefined}
        </Pane>
      </Box>
      <Pane title="Validation" focused={false} mode={mode}>
        <Text>
          {selectedSurfaceId}: {testStatus ?? 'not tested'}
        </Text>
      </Pane>
    </Box>
  );
}
