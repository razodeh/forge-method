/**
 * `stranglerFigCompliant`/`characterisationGatePasses`/`conventionChangeCompliant` — `17` §17.4 points
 * 1, 3, 4.
 *
 * @see specs/17 §17.4
 * @see PLAN-M10.md P20
 */
import { describe, expect, it } from 'vitest';

import {
  characterisationGatePasses,
  conventionChangeCompliant,
  stranglerFigCompliant,
} from '../src/adopted-gates.ts';

describe('stranglerFigCompliant', () => {
  it('is vacuously compliant outside a legacy area', () => {
    expect(
      stranglerFigCompliant({
        touchesLegacyArea: false,
        builtBehindFlag: false,
        hasStranglerFigAdr: false,
      }),
    ).toBe(true);
  });

  it('requires both a feature flag and a recorded ADR in a legacy area', () => {
    expect(
      stranglerFigCompliant({
        touchesLegacyArea: true,
        builtBehindFlag: true,
        hasStranglerFigAdr: true,
      }),
    ).toBe(true);
    expect(
      stranglerFigCompliant({
        touchesLegacyArea: true,
        builtBehindFlag: true,
        hasStranglerFigAdr: false,
      }),
    ).toBe(false);
    expect(
      stranglerFigCompliant({
        touchesLegacyArea: true,
        builtBehindFlag: false,
        hasStranglerFigAdr: true,
      }),
    ).toBe(false);
  });
});

describe('characterisationGatePasses', () => {
  it('is vacuously compliant when the step is not an untested-refactor target', () => {
    expect(
      characterisationGatePasses({
        isUntestedRefactorTarget: false,
        hasCharacterisationTest: false,
      }),
    ).toBe(true);
  });

  it('requires a real characterisation test before refactoring untested code', () => {
    expect(
      characterisationGatePasses({
        isUntestedRefactorTarget: true,
        hasCharacterisationTest: true,
      }),
    ).toBe(true);
    expect(
      characterisationGatePasses({
        isUntestedRefactorTarget: true,
        hasCharacterisationTest: false,
      }),
    ).toBe(false);
  });
});

describe('conventionChangeCompliant', () => {
  it('is vacuously compliant when no convention change is happening', () => {
    expect(
      conventionChangeCompliant({
        conventionChanged: false,
        hasAdr: false,
        hasMigrationStory: false,
      }),
    ).toBe(true);
  });

  it('requires both an ADR and a migration story for a real convention change', () => {
    expect(
      conventionChangeCompliant({ conventionChanged: true, hasAdr: true, hasMigrationStory: true }),
    ).toBe(true);
    expect(
      conventionChangeCompliant({
        conventionChanged: true,
        hasAdr: true,
        hasMigrationStory: false,
      }),
    ).toBe(false);
    expect(
      conventionChangeCompliant({
        conventionChanged: true,
        hasAdr: false,
        hasMigrationStory: true,
      }),
    ).toBe(false);
  });
});
