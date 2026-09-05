/**
 * `taskSchema` — base front matter narrowed to `type: 'Task'`; see `SPEC-QUESTIONS.md` Q20 for why
 * this schema carries no type-specific fields.
 *
 * @see specs/09 §9.3
 * @see specs/21 §21.3
 * @see SPEC-QUESTIONS.md Q20
 */
import { describe, expect, it } from 'vitest';

import { taskSchema } from '../../src/artifacts/task.ts';

function validTask(): Record<string, unknown> {
  return {
    id: 'TASK-041',
    type: 'Task',
    schemaVersion: 1,
    title: 'Write failing tests',
    status: 'draft',
    created: '2026-03-04',
    updated: '2026-03-04',
    revision: 1,
    author: 'sdet',
    changelog: [],
  };
}

describe('taskSchema — valid', () => {
  it('accepts base front matter with type Task', () => {
    expect(taskSchema.safeParse(validTask()).success).toBe(true);
  });
});

describe('taskSchema — invalid, each asserting the error path', () => {
  it('rejects an id whose prefix does not match its type', () => {
    const result = taskSchema.safeParse({ ...validTask(), id: 'STORY-041' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a type other than the literal "Task"', () => {
    const result = taskSchema.safeParse({ ...validTask(), type: 'Story' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['type']);
  });

  it('rejects an unknown top-level key', () => {
    const result = taskSchema.safeParse({ ...validTask(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
