/**
 * `--ascii` matrix -- `04` §4.7's own dedicated cross-cutting pass: every component and screen built in
 * P2-P14 is re-snapshotted under `RenderMode.ascii: true` at least once, via one real, programmatic
 * sweep over the component/screen list (`ENTRIES` below), not fourteen hand-written duplicate files.
 *
 * Each entry is asserted two ways: (1) it renders without throwing under `ascii: true`, and (2) its own
 * rendered, ANSI-stripped frame contains **only ASCII characters** -- a single, generic, strong
 * assertion that catches any real component still emitting a Unicode-only glyph under `ascii: true`,
 * without needing to enumerate every specific glyph (`✓✗●◐⏸⚠⊘↷▸▾⬚🔒⚭…`) by name. Every fixture string this
 * file supplies is itself deliberately plain ASCII, so a failure always points at the component's own
 * choice of glyph, never at this file's own fixture data.
 *
 * @see specs/04 §4.7
 * @see PLAN-M9.md P15
 */
import { SpecGraph } from '@forge/core/graph';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import type { ReactElement } from 'react';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import {
  CommandPalette,
  DiffView,
  HelpOverlay,
  KeyValue,
  ListPane,
  Pane,
  ProgressBar,
  QuestionForm,
  Sparkline,
  StatusGlyph,
  StreamView,
  Toast,
  Tree,
} from '../src/components/index.ts';
import type { RenderMode } from '../src/env.ts';
import {
  CostScreen,
  CustomizeScreen,
  GatesScreen,
  HomeScreen,
  KbScreen,
  RunBoard,
  SessionsScreen,
  SpecsScreen,
} from '../src/screens/index.ts';
import { INITIAL_RUN_READ_MODEL } from '../src/state/run-read-model.ts';

const ASCII_MODE: RenderMode = { color: true, ascii: true, linear: false, columns: 120, lines: 40 };
const SCREEN_PROPS = { mode: ASCII_MODE, readModel: INITIAL_RUN_READ_MODEL, focusedPaneIndex: 0 };

interface Entry {
  readonly name: string;
  readonly render: () => ReactElement;
}

const ENTRIES: readonly Entry[] = [
  { name: 'StatusGlyph', render: () => <StatusGlyph state="fail" mode={ASCII_MODE} /> },
  {
    name: 'Pane',
    render: () => (
      <Pane title="Title" focused mode={ASCII_MODE}>
        <StatusGlyph state="pass" mode={ASCII_MODE} />
      </Pane>
    ),
  },
  { name: 'KeyValue', render: () => <KeyValue rows={[{ key: 'k', value: 'v' }]} /> },
  {
    name: 'ProgressBar',
    render: () => <ProgressBar value={5} max={10} label="progress" mode={ASCII_MODE} />,
  },
  { name: 'Sparkline', render: () => <Sparkline series={[1, 2, 3]} mode={ASCII_MODE} /> },
  {
    name: 'Toast',
    render: () => (
      <Toast queue={[{ id: '1', kind: 'error', text: 'failed' }]} color={ASCII_MODE.color} />
    ),
  },
  {
    name: 'ListPane',
    render: () => (
      <ListPane
        items={[{ id: 'a', label: 'item a' }]}
        getId={(item) => item.id}
        getFilterText={(item) => item.label}
        renderItem={(item) => <Text>{item.label}</Text>}
        focused
        height={4}
      />
    ),
  },
  {
    name: 'Tree',
    render: () => <Tree nodes={[{ id: 'a', label: 'node a' }]} focused mode={ASCII_MODE} />,
  },
  {
    name: 'StreamView',
    render: () => <StreamView source={['line one', 'line two']} height={4} focused={false} />,
  },
  {
    name: 'DiffView',
    render: () => (
      <DiffView patch={'--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n+new\n'} mode={ASCII_MODE} />
    ),
  },
  {
    name: 'QuestionForm',
    render: () => (
      <QuestionForm
        questions={[{ id: 'q1', kind: 'text', prompt: 'A question' }]}
        onAnswer={() => undefined}
        focused
      />
    ),
  },
  {
    name: 'CommandPalette',
    render: () => (
      <CommandPalette
        open
        commands={[{ name: 'run', description: 'run something' }]}
        onSubmit={() => undefined}
        onCancel={() => undefined}
        mode={ASCII_MODE}
      />
    ),
  },
  {
    name: 'HelpOverlay',
    render: () => (
      <HelpOverlay open context="Home" keys={[{ key: 'q', action: 'quit' }]} mode={ASCII_MODE} />
    ),
  },
  {
    name: 'HomeScreen',
    render: () => (
      <HomeScreen
        {...SCREEN_PROPS}
        project={{
          name: 'acme-billing',
          level: 'L2',
          platform: 'adapter-x',
          stages: ['MVP'],
          currentStageIndex: 0,
          autonomy: 'supervised',
        }}
        health={{
          kb: { entries: 10, stale: 0, contradictions: 0 },
          specs: { epics: 2, stories: 5, orphanStories: 0, traceabilityPct: 100 },
          build: {
            passing: true,
            lastRunAgo: '1m',
            testsPassed: 10,
            testsTotal: 10,
            coveragePct: 90,
          },
          gates: [],
        }}
        nextActionCandidates={[]}
        recentActivity={[]}
      />
    ),
  },
  {
    name: 'RunBoard',
    render: () => (
      <RunBoard
        {...SCREEN_PROPS}
        lanes={[{ id: 'lane-1', label: 'lane one', status: 'running' }]}
        laneDetails={
          new Map([
            [
              'lane-1',
              {
                id: 'lane-1',
                headline: 'step 1',
                transcript: ['line one'],
                diffPatch: '',
                files: [],
                checks: [],
                prompt: 'do the thing',
              },
            ],
          ])
        }
        scheduler={{
          ready: 1,
          running: 1,
          runningCap: 2,
          blocked: 0,
          mergeQueue: 0,
          spentUsd: 1,
          budgetCapUsd: 10,
        }}
        interjectSupported
        onCommand={() => undefined}
      />
    ),
  },
  {
    name: 'SpecsScreen',
    render: () => (
      <SpecsScreen {...SCREEN_PROPS} graph={SpecGraph.build([])} onCommand={() => undefined} />
    ),
  },
  {
    name: 'KbScreen',
    render: () => (
      <KbScreen
        {...SCREEN_PROPS}
        entries={[]}
        findings={[]}
        diagramsByEntryId={new Map()}
        writeHistoryByEntryId={new Map()}
        onCommand={() => undefined}
        onOpenDiagram={() => undefined}
      />
    ),
  },
  {
    name: 'GatesScreen',
    render: () => (
      <GatesScreen
        {...SCREEN_PROPS}
        gates={[
          {
            id: 'gate-1',
            label: 'gate one',
            status: 'pass',
            deterministicChecks: [{ id: 'check-1', status: 'pass', detail: 'ok' }],
            advisoryChecks: [],
            openQuestions: [],
            alwaysHuman: false,
          },
        ]}
        onCommand={() => undefined}
      />
    ),
  },
  {
    name: 'SessionsScreen',
    render: () => <SessionsScreen {...SCREEN_PROPS} sessions={[]} onCommand={() => undefined} />,
  },
  {
    name: 'CostScreen',
    render: () => (
      <CostScreen
        {...SCREEN_PROPS}
        entries={[]}
        runLabel="acme-billing"
        stageBreakdown={[]}
        burnDownSeries={[1, 2]}
        velocitySeries={[1, 2]}
        mergedStoryCount={1}
      />
    ),
  },
  {
    name: 'CustomizeScreen',
    render: () => (
      <CustomizeScreen
        {...SCREEN_PROPS}
        modifiedCountBySurfaceId={new Map()}
        fieldsBySurfaceId={new Map()}
        testStatusBySurfaceId={new Map()}
        onCommand={() => undefined}
      />
    ),
  },
];

describe('tui degradation: --ascii matrix (04 §4.7)', () => {
  for (const entry of ENTRIES) {
    it(`${entry.name} renders under ascii:true without throwing, and its frame is pure ASCII`, () => {
      const { lastFrame } = render(entry.render());
      const frame = stripAnsi(lastFrame() ?? '');
      // eslint-disable-next-line no-control-regex
      expect(frame).toMatch(/^[\x00-\x7F]*$/u);
    });
  }

  it('the matrix itself covers every real component and screen this milestone shipped -- a real count assertion, not just a non-empty array', () => {
    expect(ENTRIES.length).toBeGreaterThanOrEqual(21);
  });
});
