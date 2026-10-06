/**
 * Shared, minimal `ParityDeclaration`/`ParityCapture` builders for this directory's own test files
 * (specs/22 M16 P2) — not itself a test file, so it carries no `describe`/`it` of its own.
 */
import type {
  ParityCase,
  ParityDeclaration,
  SurfaceDeclaration,
} from '../../../src/commands/parity/declaration-types.ts';
import type {
  ParityCapture,
  ParityCaptureCaseEntry,
} from '../../../src/commands/parity/capture.ts';

export const SAMPLE_SHA = 'a'.repeat(40);

export function minimalCase(overrides: Partial<ParityCase> = {}): ParityCase {
  return { ...overrides };
}

export function minimalSurface(overrides: Partial<SurfaceDeclaration> = {}): SurfaceDeclaration {
  return {
    run: 'node check.js',
    stability: { runs: 3 },
    cases: [minimalCase()],
    ...overrides,
  };
}

export function minimalDeclaration(overrides: Partial<ParityDeclaration> = {}): ParityDeclaration {
  return {
    name: 'sample',
    reference: { ref: SAMPLE_SHA },
    review: { by: 'alice', basis: 'read the diff by hand', at: '2026-01-01' },
    expires: '2026-12-31',
    surfaces: { process: minimalSurface() },
    unobservable: [],
    ...overrides,
  };
}

export function minimalCaptureCase(
  overrides: Partial<ParityCaptureCaseEntry> = {},
): ParityCaptureCaseEntry {
  return {
    surface: 'process',
    caseIndex: 0,
    observation: { surface: 'process', stdout: 'ok\n', exit: { kind: 'code', code: 0 } },
    ...overrides,
  };
}

export function minimalCapture(overrides: Partial<ParityCapture> = {}): ParityCapture {
  return {
    name: 'sample',
    digest: 'd'.repeat(64),
    reference: { ref: SAMPLE_SHA, sha: SAMPLE_SHA },
    platform: 'linux-x64',
    cases: [minimalCaptureCase()],
    ...overrides,
  };
}
