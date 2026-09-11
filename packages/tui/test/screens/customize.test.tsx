/**
 * `<CustomizeScreen>` -- `04` §4.3 S8: the sixteen real customization surfaces with per-field layer
 * provenance colouring and live validation.
 *
 * See `list-pane.test.tsx`'s own header comment for why every test that presses a key awaits `flush()`
 * once right after `render()`, before the first `stdin.write()`.
 *
 * @see specs/04 §4.3 S8
 * @see PLAN-M9.md P14
 */
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import type { RenderMode } from '../../src/env.ts';
import {
  CUSTOMIZATION_SURFACES,
  CustomizeScreen,
  type CustomizeScreenProps,
  type ResolvedFieldRow,
} from '../../src/screens/customize.tsx';
import type { EngineCommand } from '../../src/state/engine-command.ts';
import { INITIAL_RUN_READ_MODEL } from '../../src/state/run-read-model.ts';

const DOWN = '\x1B[B';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

interface StdinLike {
  write(data: string): void;
}

async function press(stdin: StdinLike, data: string): Promise<void> {
  stdin.write(data);
  await flush();
}

const MODE: RenderMode = { color: true, ascii: false, linear: false, columns: 120, lines: 40 };

function field(overrides: Partial<ResolvedFieldRow> & { path: string }): ResolvedFieldRow {
  return {
    displayValue: 'balanced',
    layer: 'L3',
    ...overrides,
  };
}

function baseProps(overrides: Partial<CustomizeScreenProps> = {}): CustomizeScreenProps {
  return {
    mode: MODE,
    readModel: INITIAL_RUN_READ_MODEL,
    focusedPaneIndex: 1,
    modifiedCountBySurfaceId: new Map([['C1', 3]]),
    fieldsBySurfaceId: new Map([
      [
        'C1',
        [
          field({ path: 'model.tier', displayValue: 'balanced', layer: 'L3' }),
          field({
            path: 'gates.may_approve',
            displayValue: '[]',
            layer: 'L0',
            lockedInvariantId: 'I1',
          }),
        ],
      ],
    ]),
    testStatusBySurfaceId: new Map(),
    onCommand: () => undefined,
    ...overrides,
  };
}

describe('<CustomizeScreen>', () => {
  it('the real surface table has all sixteen rows (C1-C16), never a hand-picked fifteen', () => {
    expect(CUSTOMIZATION_SURFACES).toHaveLength(16);
    expect(CUSTOMIZATION_SURFACES.map((s) => s.id)).toEqual([
      'C1',
      'C2',
      'C3',
      'C4',
      'C5',
      'C6',
      'C7',
      'C8',
      'C9',
      'C10',
      'C11',
      'C12',
      'C13',
      'C14',
      'C15',
      'C16',
    ]);
    expect(CUSTOMIZATION_SURFACES[15]).toEqual({ id: 'C16', name: 'Diagrams' });
  });

  it('C16 (the surface PLAN-M9.md\'s own "fifteen" text would have silently dropped) is reachable via the real list, not just present in the array', async () => {
    const { lastFrame, stdin } = render(
      <CustomizeScreen {...baseProps({ focusedPaneIndex: 0 })} />,
    );
    await flush();
    for (let i = 0; i < 15; i += 1) {
      await press(stdin, DOWN);
    }
    expect(stripAnsi(lastFrame() ?? '')).toContain('C16 Diagrams');
  });

  it("renders a surface's own modified-count badge only when it has real modifications", () => {
    const { lastFrame } = render(<CustomizeScreen {...baseProps()} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('C1 Agent behaviour (3)');
    expect(frame).toContain('C2 Agent roster'); // no badge
    expect(frame).not.toContain('C2 Agent roster (');
  });

  it("renders the default-selected surface's own resolved fields with real layer provenance", () => {
    const { lastFrame } = render(<CustomizeScreen {...baseProps()} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('model.tier = balanced ← project');
    expect(frame).toContain('gates.may_approve = [] ← built-in');
  });

  it('renders a lock glyph and the real invariant id for a locked field', () => {
    const { lastFrame } = render(<CustomizeScreen {...baseProps()} />);
    expect(stripAnsi(lastFrame() ?? '')).toContain('🔒 I1');
  });

  it('renders "No resolved fields for this surface." for a surface with none', () => {
    const { lastFrame } = render(
      <CustomizeScreen {...baseProps({ fieldsBySurfaceId: new Map() })} />,
    );
    expect(stripAnsi(lastFrame() ?? '')).toContain('No resolved fields for this surface.');
  });

  describe('filter-mode collision (the fields pane shares its own pane index with action keys)', () => {
    it('typing "e"/"t"/"E" while filtering the fields list never also fires edit/test/eject -- only filters', async () => {
      const commands: EngineCommand[] = [];
      const { lastFrame, stdin } = render(
        <CustomizeScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '\r'); // select model.tier first, so e/r would have a real target
      await press(stdin, '/'); // enter filter-editing mode on the fields list
      await press(stdin, 'eject the test config');
      expect(commands).toEqual([]);
      expect(stripAnsi(lastFrame() ?? '')).toContain('/eject the test config');
    });

    it('"E"/"t" alone (no field ever selected) also never fire while filtering', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <CustomizeScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '/');
      await press(stdin, 'Et');
      expect(commands).toEqual([]);
    });

    it('once filter-editing ends (Enter confirms it), action keys work normally again', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <CustomizeScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '/');
      await press(stdin, 'model');
      await press(stdin, '\r'); // confirms the filter, exits filter-editing mode
      await press(stdin, '\r'); // now a real select on the (still sole-matching) model.tier row
      await press(stdin, 't');
      expect(commands).toEqual([{ type: 'customize.testSurface', surfaceId: 'C1' }]);
    });

    it("a live prop update that empties the selected surface's own fields while still mid-filter does not leave t/d/E permanently blocked", async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ onCommand: (c) => commands.push(c) });
      const { rerender, stdin } = render(<CustomizeScreen {...props} />);
      await flush();
      await press(stdin, '/'); // start filtering the fields <ListPane> -- never confirmed or cancelled

      // C1's own fields are cleared by a live update, unmounting the fields <ListPane> in favour of
      // the "No resolved fields" <Text> fallback while still mid-filter.
      rerender(<CustomizeScreen {...props} fieldsBySurfaceId={new Map()} />);
      await flush();

      await press(stdin, 't');
      expect(commands).toEqual([{ type: 'customize.testSurface', surfaceId: 'C1' }]);
    });
  });

  describe('e (edit overlay)', () => {
    it('emits exactly one customize.editOverlay for the focused, unlocked field', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <CustomizeScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '\r'); // select model.tier (first field)
      await press(stdin, 'e');
      expect(commands).toEqual([
        { type: 'customize.editOverlay', surfaceId: 'C1', fieldPath: 'model.tier' },
      ]);
    });

    it('structurally emits nothing at all for a locked field, never a rejected command', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <CustomizeScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, DOWN); // move onto gates.may_approve
      await press(stdin, '\r'); // select it
      await press(stdin, 'e');
      expect(commands).toEqual([]);
    });

    it('emits nothing while the surfaces pane (not the fields pane) is focused', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ focusedPaneIndex: 0, onCommand: (c) => commands.push(c) });
      const { stdin } = render(<CustomizeScreen {...props} />);
      await flush();
      await press(stdin, 'e');
      expect(commands).toEqual([]);
    });
  });

  describe('r (reset)', () => {
    it('emits exactly one customize.resetField for the focused, unlocked field', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <CustomizeScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '\r');
      await press(stdin, 'r');
      expect(commands).toEqual([
        { type: 'customize.resetField', surfaceId: 'C1', fieldPath: 'model.tier' },
      ]);
    });

    it('structurally emits nothing at all for a locked field', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <CustomizeScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, DOWN);
      await press(stdin, '\r');
      await press(stdin, 'r');
      expect(commands).toEqual([]);
    });
  });

  describe('t (test)', () => {
    it('emits exactly one customize.testSurface for the currently-selected surface', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <CustomizeScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, 't');
      expect(commands).toEqual([{ type: 'customize.testSurface', surfaceId: 'C1' }]);
    });

    it('renders the read-model-driven pending/pass/fail state, never runs validation inline', () => {
      const { lastFrame } = render(
        <CustomizeScreen {...baseProps({ testStatusBySurfaceId: new Map([['C1', 'pending']]) })} />,
      );
      expect(stripAnsi(lastFrame() ?? '')).toContain('C1: pending');
    });

    it('renders "not tested" before any real test status exists', () => {
      const { lastFrame } = render(<CustomizeScreen {...baseProps()} />);
      expect(stripAnsi(lastFrame() ?? '')).toContain('C1: not tested');
    });
  });

  describe('E (eject preset)', () => {
    it('emits exactly one customize.ejectPreset for the currently-selected surface', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <CustomizeScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, 'E');
      expect(commands).toEqual([{ type: 'customize.ejectPreset', surfaceId: 'C1' }]);
    });
  });

  describe('d (diff-vs-base)', () => {
    it("toggles rendering the focused field's own diff, never a command", async () => {
      const commands: EngineCommand[] = [];
      const fieldsBySurfaceId = new Map([
        [
          'C1',
          [
            field({
              path: 'model.tier',
              diffPatch: '--- a/d\n+++ b/d\n@@ -1 +1 @@\n-fast\n+balanced\n',
            }),
          ],
        ],
      ]);
      const props = baseProps({ fieldsBySurfaceId, onCommand: (c) => commands.push(c) });
      const { lastFrame, stdin } = render(<CustomizeScreen {...props} />);
      await flush();
      await press(stdin, '\r'); // select the field
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('-fast');

      await press(stdin, 'd');
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('-fast');
      expect(frame).toContain('+balanced');
      expect(commands).toEqual([]);

      await press(stdin, 'd'); // toggle back off
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('-fast');
    });
  });

  it('switching surfaces resets the selected field and diff view', async () => {
    const { lastFrame, stdin } = render(
      <CustomizeScreen {...baseProps({ focusedPaneIndex: 0 })} />,
    );
    await flush();
    await press(stdin, DOWN); // highlight C2
    await press(stdin, '\r'); // select C2
    expect(stripAnsi(lastFrame() ?? '')).toContain('No resolved fields for this surface.');
  });

  it("switching surfaces while the fields list is still mid-filter never leaves the new surface's own fields hidden behind the old, stale query", async () => {
    const fieldsBySurfaceId = new Map([
      ['C1', [field({ path: 'model.tier' })]],
      ['C2', [field({ path: 'roster.size' })]],
    ]);
    const props = baseProps({ fieldsBySurfaceId });
    const { lastFrame, rerender, stdin } = render(<CustomizeScreen {...props} />);
    await flush();
    await press(stdin, '/'); // filter the fields pane for "model" -- matches C1's own field
    await press(stdin, 'model');
    expect(stripAnsi(lastFrame() ?? '')).toContain('model.tier');

    // Switch to the surfaces pane and select C2, still mid-filter on the fields list the whole time.
    rerender(<CustomizeScreen {...props} focusedPaneIndex={0} />);
    await flush();
    await press(stdin, DOWN); // highlight C2
    await press(stdin, '\r'); // select C2

    rerender(<CustomizeScreen {...props} focusedPaneIndex={1} />);
    const frame = stripAnsi(lastFrame() ?? '');
    // C2's own real field is visible -- never hidden behind C1's own leftover "model" query.
    expect(frame).toContain('roster.size');
  });

  it('renders at three canonical terminal widths without throwing', () => {
    for (const columns of [60, 100, 160]) {
      const mode: RenderMode = { ...MODE, columns };
      expect(() => render(<CustomizeScreen {...baseProps({ mode })} />)).not.toThrow();
    }
  });
});
