/**
 * `emitJsonSchemas` — `specs/02` §2.1's JSON Schema emission.
 *
 * @see specs/02 §2.1
 * @see PLAN-M1.md P9
 */
import { describe, expect, it } from 'vitest';

import { ARTIFACT_TYPES } from '../../src/registry/artifact-types.ts';
import { emitJsonSchemas } from '../../src/json-schema/emit.ts';

describe('emitJsonSchemas', () => {
  it('emits exactly one file per registered artifact type, plus config.schema.json', () => {
    const schemas = emitJsonSchemas();
    expect(schemas.size).toBe(ARTIFACT_TYPES.length + 1);
    expect(schemas.has('config.schema.json')).toBe(true);
  });

  it('every emitted file name ends with .schema.json', () => {
    for (const filename of emitJsonSchemas().keys()) {
      expect(filename.endsWith('.schema.json'), filename).toBe(true);
    }
  });

  it('the Map iterates in sorted file-name order', () => {
    const filenames = [...emitJsonSchemas().keys()];
    expect(filenames).toEqual([...filenames].sort());
  });

  it('every emitted file is valid, parseable JSON', () => {
    for (const [filename, content] of emitJsonSchemas()) {
      expect(() => {
        JSON.parse(content);
      }, filename).not.toThrow();
    }
  });

  it('every emitted schema object has its own keys sorted', () => {
    for (const [filename, content] of emitJsonSchemas()) {
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed);
        expect(keys, filename).toEqual([...keys].sort());
      }
    }
  });

  it('every emitted file ends with exactly one trailing newline, no carriage returns', () => {
    for (const [filename, content] of emitJsonSchemas()) {
      expect(content.endsWith('\n'), filename).toBe(true);
      expect(content.endsWith('\n\n'), filename).toBe(false);
      expect(content.includes('\r'), filename).toBe(false);
    }
  });

  it('is deterministic within the same process: two calls produce byte-identical output', () => {
    expect([...emitJsonSchemas().entries()]).toEqual([...emitJsonSchemas().entries()]);
  });

  it('a required artifact schema field appears in its emitted JSON Schema', () => {
    // Spot-checks that the emission is actually derived from the real schema, not a stub — Risk's
    // `mitigation` field (packages/schemas/src/artifacts/risk.ts) should be both a declared property
    // and required.
    const content = emitJsonSchemas().get('risk.schema.json');
    expect(content).toBeDefined();
    const parsed = JSON.parse(content ?? '{}') as { properties?: object; required?: string[] };
    expect(Object.keys(parsed.properties ?? {})).toContain('mitigation');
    expect(parsed.required ?? []).toContain('mitigation');
  });
});
