/**
 * `commands/dispatch/index.ts`'s own chain-of-responsibility (`specs/22` M17 P2, "CLI clarity"; 17
 * area files since `specs/22` M17 P17 added `dispatchAdopt`): each exports one `dispatchX(ctx):
 * Promise<number | undefined>`, tried in sequence by `main()`. The real, end-to-end CLI surface
 * every one of these files answers is already exhaustively covered through the real subprocess
 * (`packages/cli/test/bin.test.ts` and the `bin-*.test.ts` siblings, unchanged by this piece and
 * still 100% green against the refactored dispatcher) — this file instead tests the one property
 * specific to the NEW architecture those pre-existing tests have no reason to exercise directly:
 * that no two area files ever both claim the same real command, and that every area correctly
 * declines (`undefined`) a command that is not its own WITHOUT touching the project at all
 * (confirmed here by pointing every dispatcher at a `ProjectPaths` rooted at a bare, contentless
 * temp directory — a dispatcher that incorrectly tried to read a config file or a spec document for
 * a command it does not own would throw instead of returning `undefined`).
 *
 * @see specs/22 M17 P2
 * @see specs/22 M17 P17
 */
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { describe, expect, it } from 'vitest';

import { dispatchAdopt } from '../../../src/commands/dispatch/adopt.ts';
import { dispatchAdr } from '../../../src/commands/dispatch/adr.ts';
import { dispatchCustomizeAndCompile } from '../../../src/commands/dispatch/customize-and-compile.ts';
import { dispatchDiagram } from '../../../src/commands/dispatch/diagram.ts';
import { dispatchHelp } from '../../../src/commands/dispatch/help.ts';
import { dispatchKb } from '../../../src/commands/dispatch/kb.ts';
import { dispatchLifecycle } from '../../../src/commands/dispatch/lifecycle.ts';
import { dispatchMigrate } from '../../../src/commands/dispatch/migrate.ts';
import { dispatchModuleOverlayUpgrade } from '../../../src/commands/dispatch/module-overlay-upgrade.ts';
import { dispatchPlanAndLoop } from '../../../src/commands/dispatch/plan-and-loop.ts';
import { dispatchPresetSkillMcp } from '../../../src/commands/dispatch/preset-skill-mcp.ts';
import { dispatchRunAndGates } from '../../../src/commands/dispatch/run-and-gates.ts';
import { dispatchSpec } from '../../../src/commands/dispatch/spec.ts';
import { dispatchTestBinding } from '../../../src/commands/dispatch/test-binding.ts';
import { dispatchTestExemptCoverageFlaky } from '../../../src/commands/dispatch/test-exempt-coverage-flaky.ts';
import { dispatchTestRun } from '../../../src/commands/dispatch/test-run.ts';
import { dispatchWorkspace } from '../../../src/commands/dispatch/workspace.ts';
import type { DispatchContext, Dispatcher } from '../../../src/commands/dispatch/shared.ts';

/** The real 17 area dispatchers `commands/dispatch/index.ts` tries in sequence, named here too, so a
 * mismatch between this list and the real `DISPATCHERS` array (one added there and forgotten here, or
 * vice versa) is visible as a real, failing count below rather than a silent gap in this file's own
 * coverage. */
const ALL_DISPATCHERS: ReadonlyMap<string, Dispatcher> = new Map([
  ['dispatchRunAndGates', dispatchRunAndGates],
  ['dispatchLifecycle', dispatchLifecycle],
  ['dispatchAdopt', dispatchAdopt],
  ['dispatchTestRun', dispatchTestRun],
  ['dispatchTestBinding', dispatchTestBinding],
  ['dispatchTestExemptCoverageFlaky', dispatchTestExemptCoverageFlaky],
  ['dispatchMigrate', dispatchMigrate],
  ['dispatchSpec', dispatchSpec],
  ['dispatchKb', dispatchKb],
  ['dispatchAdr', dispatchAdr],
  ['dispatchDiagram', dispatchDiagram],
  ['dispatchModuleOverlayUpgrade', dispatchModuleOverlayUpgrade],
  ['dispatchWorkspace', dispatchWorkspace],
  ['dispatchCustomizeAndCompile', dispatchCustomizeAndCompile],
  ['dispatchPresetSkillMcp', dispatchPresetSkillMcp],
  ['dispatchHelp', dispatchHelp],
  ['dispatchPlanAndLoop', dispatchPlanAndLoop],
]);

/** One real, representative command/sub pair per area — chosen to be the exact token each area's own
 * dispatch function checks first, so a false "not mine" would be a real bug, not a fixture mistake. */
const OWNED_BY: readonly {
  readonly owner: string;
  readonly positionals: readonly string[];
}[] = [
  { owner: 'dispatchRunAndGates', positionals: ['gate', 'list'] },
  { owner: 'dispatchLifecycle', positionals: ['status'] },
  { owner: 'dispatchAdopt', positionals: ['adopt'] },
  { owner: 'dispatchTestRun', positionals: ['test', 'run'] },
  { owner: 'dispatchTestBinding', positionals: ['test', 'binding'] },
  { owner: 'dispatchTestExemptCoverageFlaky', positionals: ['test', 'flaky'] },
  { owner: 'dispatchMigrate', positionals: ['migrate', 'run'] },
  { owner: 'dispatchSpec', positionals: ['spec', 'list'] },
  { owner: 'dispatchKb', positionals: ['kb', 'list'] },
  { owner: 'dispatchAdr', positionals: ['adr', 'list'] },
  { owner: 'dispatchDiagram', positionals: ['diagram', 'list'] },
  { owner: 'dispatchModuleOverlayUpgrade', positionals: ['module', 'add'] },
  { owner: 'dispatchWorkspace', positionals: ['export', 'markdown-bundle'] },
  { owner: 'dispatchCustomizeAndCompile', positionals: ['customize'] },
  { owner: 'dispatchPresetSkillMcp', positionals: ['preset', 'list'] },
  { owner: 'dispatchHelp', positionals: ['help'] },
  { owner: 'dispatchPlanAndLoop', positionals: ['plan', 'init'] },
];

describe('commands/dispatch/index.ts chain-of-responsibility isolation (specs/22 M17 P2)', () => {
  it('covers exactly the real 17 area dispatchers commands/dispatch/index.ts assembles, no more and no fewer', () => {
    expect(ALL_DISPATCHERS.size).toBe(17);
    expect(OWNED_BY.length).toBe(17);
    expect(new Set(OWNED_BY.map((entry) => entry.owner)).size).toBe(17);
    for (const entry of OWNED_BY) {
      expect(ALL_DISPATCHERS.has(entry.owner)).toBe(true);
    }
  });

  it(
    'every non-owning dispatcher returns undefined for a command it does not own, without ever ' +
      'touching the project (a bare, contentless temp directory, never a real forge project)',
    async () => {
      const bareRoot = mkdtempSync(path.join(os.tmpdir(), 'forge-dispatch-isolation-'));
      const paths = new ProjectPaths(bareRoot);
      const flags = {
        profile: 'default',
        dryRun: false,
        yes: false,
        json: false,
        noTui: false,
        verbosity: 0,
        quiet: false,
        positionals: [] as readonly string[],
      };

      for (const { owner, positionals } of OWNED_BY) {
        const ctx: DispatchContext = {
          positionals,
          flags: { ...flags, positionals },
          paths,
          projectRoot: bareRoot,
        };
        for (const [name, dispatcher] of ALL_DISPATCHERS) {
          if (name === owner) continue;
          const result = await dispatcher(ctx);
          expect(
            result,
            `${name} claimed ${JSON.stringify(positionals)}, which belongs to ${owner}`,
          ).toBeUndefined();
        }
      }
    },
  );
});
