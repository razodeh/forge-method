/**
 * `claudeCodeAdapterConfigSchema` — this adapter's own config shape.
 *
 * @see specs/07 §7.3
 * @see PLAN-M7.md P1
 */
import { describe, expect, it } from 'vitest';

import { claudeCodeAdapterConfigSchema } from '../src/config.ts';

describe('claudeCodeAdapterConfigSchema', () => {
  it('accepts the real worked shape from 07 §7.3', () => {
    const result = claudeCodeAdapterConfigSchema.parse({ transport: 'sdk', bare: true });
    expect(result).toEqual({ transport: 'sdk', bare: true, mcp: { adoptHostServers: false } });
  });

  it('defaults bare to true and mcp.adoptHostServers to false when omitted', () => {
    const result = claudeCodeAdapterConfigSchema.parse({});
    expect(result.bare).toBe(true);
    expect(result.mcp.adoptHostServers).toBe(false);
    expect(result.transport).toBeUndefined();
  });

  it('accepts an explicit bare: false and mcp.adoptHostServers: true', () => {
    const result = claudeCodeAdapterConfigSchema.parse({
      bare: false,
      mcp: { adoptHostServers: true },
    });
    expect(result.bare).toBe(false);
    expect(result.mcp.adoptHostServers).toBe(true);
  });

  it('rejects an unknown extra key', () => {
    expect(() => claudeCodeAdapterConfigSchema.parse({ bare: true, unknownField: 'x' })).toThrow();
  });

  it('rejects a transport value other than sdk/cli', () => {
    expect(() => claudeCodeAdapterConfigSchema.parse({ transport: 'http' })).toThrow();
  });
});
