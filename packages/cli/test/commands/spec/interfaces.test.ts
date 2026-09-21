/**
 * `forge spec interfaces --check-frozen` (`G-Design` `interfaces:frozen`, `PLAN-M13.md` P26, Q228).
 *
 * `06` §6.6 rule 5: the design gate fails "if any consumer references an undefined contract". Every fixture is a real
 * document: contracts are plain YAML with the artifact's front matter keys at the top level (the form the
 * `freeze-contracts` brief asks for and the engine's output check accepts) or front-matter documents; stories are
 * written from the shipped Story template.
 *
 * @see specs/06 §6.6
 * @see specs/10 §10.3
 * @see PLAN-M13.md P26
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { specInterfacesCheck } from '../../../src/commands/spec/interfaces.ts';
import type { SpecCommandContext } from '../../../src/commands/spec.ts';
import {
  KB_ROOT,
  SPECS_ROOT,
  cleanupAll,
  createTestProject,
  type TestProject,
} from '../helpers.ts';

afterEach(cleanupAll);

function ctx(project: TestProject): SpecCommandContext {
  return { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT };
}

async function put(project: TestProject, relative: string, text: string): Promise<void> {
  const target = path.join(project.dir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

const BASE = (id: string, type = 'InterfaceContract', title = 'Orders API'): string =>
  [
    `id: ${id}`,
    `type: ${type}`,
    'schemaVersion: 1',
    `title: ${title}`,
    'status: draft',
    'created: 2026-01-15',
    'updated: 2026-01-15',
    'revision: 1',
    'author: architect',
    'changelog: []',
  ].join('\n');

/** A plain-YAML contract: the base keys plus an OpenAPI body the rule must ignore. */
const yamlContract = (id: string): string => `${BASE(id)}\nopenapi: 3.1.0\npaths: {}\n`;

async function contract(project: TestProject, id: string, name = id.toLowerCase()): Promise<void> {
  await put(project, `${SPECS_ROOT}/interfaces/${name}.yaml`, yamlContract(id));
}

async function story(
  project: TestProject,
  id: string,
  extras: { interfaces?: string; context_refs?: string } = {},
): Promise<void> {
  await put(
    project,
    `${SPECS_ROOT}/stories/${id}.md`,
    `---
id: ${id}
type: Story
schemaVersion: 1
title: A story
status: draft
created: 2026-01-15
updated: 2026-01-15
revision: 1
author: po
changelog: []
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
owner_role: backend
depends_on: []
blocked_by: []
interfaces: ${extras.interfaces ?? '[]'}
data: []
files_expected: []
context_refs: ${extras.context_refs ?? '[]'}
acceptance: []
tests: []
dod_profile: backend-default
---

Body.
`,
  );
}

describe('spec interfaces --check-frozen', () => {
  it('passes an empty project and says so: nothing is referenced, so nothing is undefined', async () => {
    const outcome = await specInterfacesCheck(ctx(await createTestProject()));
    expect(outcome.violations).toEqual([]);
    expect(outcome.fields).toMatchObject({
      contracts: 0,
      references: 0,
      unresolved_refs: 0,
      undefined_refs: 0,
    });
  });

  it('passes when every interface a story lists is defined by a valid contract', async () => {
    const project = await createTestProject();
    await contract(project, 'INT-001');
    await contract(project, 'INT-002');
    await story(project, 'STORY-001', { interfaces: '[INT-001, INT-002]' });
    await story(project, 'STORY-002', { interfaces: '[INT-001]' });
    const outcome = await specInterfacesCheck(ctx(project));
    expect(outcome.violations).toEqual([]);
    expect(outcome.fields).toMatchObject({ contracts: 2, references: 3, undefined_refs: 0 });
  });

  it('fails a story that references a contract nothing defines, naming story and id', async () => {
    const project = await createTestProject();
    await contract(project, 'INT-001');
    await story(project, 'STORY-001', { interfaces: '[INT-001, INT-009]' });
    const outcome = await specInterfacesCheck(ctx(project));
    expect(outcome.fields).toMatchObject({ unresolved_refs: 1, undefined_refs: 1 });
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.subject).toBe('STORY-001 -> INT-009');
    expect(outcome.violations[0]?.remedy).toMatch(/^Write the missing InterfaceContract/);
  });

  it('counts each story that names the same missing contract, once per story', async () => {
    const project = await createTestProject();
    await story(project, 'STORY-001', { interfaces: '[INT-009, INT-009]' });
    await story(project, 'STORY-002', { interfaces: '[INT-009]' });
    const outcome = await specInterfacesCheck(ctx(project));
    expect(outcome.fields).toMatchObject({ references: 2, unresolved_refs: 2, undefined_refs: 2 });
  });

  it('treats an INT-shaped context_refs entry as a reference, and ignores other context refs', async () => {
    const project = await createTestProject();
    await story(project, 'STORY-001', { context_refs: '[INT-004, ADR-0001, "kb:architecture/x"]' });
    const outcome = await specInterfacesCheck(ctx(project));
    expect(outcome.violations.map((v) => v.subject)).toEqual(['STORY-001 -> INT-004']);
  });

  describe('`Needs interface:` lines (the shipped flow leaves `interfaces` empty)', () => {
    async function needing(project: TestProject, lines: readonly string[]): Promise<void> {
      await story(project, 'STORY-001');
      const file = path.join(project.dir, `${SPECS_ROOT}/stories/STORY-001.md`);
      await writeFile(
        file,
        `${await readFile(file, 'utf8')}\n${lines.map((line) => `- Needs interface: ${line}`).join('\n')}\n`,
      );
    }

    it('fails while no contract exists at all', async () => {
      const project = await createTestProject();
      await needing(project, ['(create order), consumer (web)']);
      const outcome = await specInterfacesCheck(ctx(project));
      expect(outcome.fields).toMatchObject({
        stories_needing_interfaces: 1,
        needs_interface_lines: 1,
        undefined_refs: 1,
      });
      expect(outcome.violations[0]?.subject).toBe('STORY-001 needs create order');
    });

    it('an unrelated contract does not cover the line; a contract whose text names the operation does', async () => {
      const project = await createTestProject();
      await needing(project, ['(POST /orders), consumer (web)']);
      await put(
        project,
        `${SPECS_ROOT}/interfaces/users.yaml`,
        `${BASE('INT-001', 'InterfaceContract', 'Users API')}\nopenapi: 3.1.0\npaths:\n  /users:\n    get: {}\n`,
      );
      expect((await specInterfacesCheck(ctx(project))).fields).toMatchObject({ undefined_refs: 1 });
      await put(
        project,
        `${SPECS_ROOT}/interfaces/orders.yaml`,
        `${BASE('INT-002', 'InterfaceContract', 'Orders API')}\nopenapi: 3.1.0\npaths:\n  /orders:\n    post: {}\n`,
      );
      await put(
        project,
        `${SPECS_ROOT}/interfaces/orders2.yaml`,
        `${BASE('INT-003', 'InterfaceContract', 'Orders operations')}\noperations:\n  - POST /orders\n`,
      );
      expect((await specInterfacesCheck(ctx(project))).violations).toEqual([]);
    });

    it('matches ignoring case and spacing; a line naming no operation is undefined; each line counts', async () => {
      const project = await createTestProject();
      await put(
        project,
        `${SPECS_ROOT}/interfaces/inv.yaml`,
        `${BASE('INT-001', 'InterfaceContract', 'Invoices')}\noperations: [Create   Invoice]\n`,
      );
      await needing(project, [
        '(create invoice), consumer (web)',
        '(send reminder), consumer (worker)',
        '',
      ]);
      const outcome = await specInterfacesCheck(ctx(project));
      expect(outcome.fields).toMatchObject({ needs_interface_lines: 3, undefined_refs: 2 });
      expect(outcome.violations.map((v) => v.subject)).toEqual([
        'STORY-001 needs (no operation named)',
        'STORY-001 needs send reminder',
      ]);
    });
  });

  describe('`Needs interface:` matching', () => {
    async function withLines(project: TestProject, lines: readonly string[]): Promise<void> {
      await story(project, 'STORY-001');
      const file = path.join(project.dir, `${SPECS_ROOT}/stories/STORY-001.md`);
      await writeFile(file, `${await readFile(file, 'utf8')}\n${lines.join('\n')}\n`);
    }

    it.each([
      '1. Needs interface: (refund payment), consumer (web)',
      '> Needs interface: (refund payment), consumer (web)',
      '**Needs interface:** (refund payment), consumer (web)',
      '- [ ] Needs interface: (refund payment), consumer (web)',
      '  * needs interface: (refund payment), consumer (web)',
    ])('counts the Markdown form %s', async (line) => {
      const project = await createTestProject();
      await withLines(project, [line]);
      expect((await specInterfacesCheck(ctx(project))).fields).toMatchObject({
        needs_interface_lines: 1,
        undefined_refs: 1,
      });
    });

    it('a story file with no front matter is a violation, not a README to skip; a README is skipped', async () => {
      const project = await createTestProject();
      await put(
        project,
        `${SPECS_ROOT}/stories/STORY-009.md`,
        '- Needs interface: (refund payment)\n',
      );
      await put(project, `${SPECS_ROOT}/stories/README.md`, '# Stories\n');
      const found = (await specInterfacesCheck(ctx(project))).violations;
      expect(found.map((v) => v.subject)).toEqual([`${SPECS_ROOT}/stories/STORY-009.md`]);
    });

    it('a contract does not cover an operation by its standard keys or by accident', async () => {
      const project = await createTestProject();
      await put(
        project,
        `${SPECS_ROOT}/interfaces/orders.yaml`,
        `${BASE('INT-001', 'InterfaceContract', 'Orders API')}\noperations: [create order, already paid]\n`,
      );
      // `status: draft`, `author: architect` are about the record; `a`/`id` are too short to be a name; `read` is inside `already`
      await withLines(project, [
        '- Needs interface: (status)',
        '- Needs interface: (a)',
        '- Needs interface: (id)',
        '- Needs interface: (read)',
        '- Needs interface: (architect)',
        '- Needs interface: (create order)',
      ]);
      const outcome = await specInterfacesCheck(ctx(project));
      expect(outcome.violations.map((v) => v.subject)).toEqual([
        'STORY-001 needs (no operation named)',
        'STORY-001 needs (no operation named)',
        'STORY-001 needs architect',
        'STORY-001 needs read',
        'STORY-001 needs status',
      ]);
    });

    it('the operations of a notation file beside a thin YAML record count for it', async () => {
      const project = await createTestProject();
      await put(
        project,
        `${SPECS_ROOT}/interfaces/orders.yaml`,
        `${BASE('INT-001', 'InterfaceContract', 'Orders')}\n`,
      );
      await put(
        project,
        `${SPECS_ROOT}/interfaces/orders.proto`,
        'service Orders { rpc CreateOrder (Req) returns (Res); }\n',
      );
      await withLines(project, ['- Needs interface: (createorder)', '- Needs interface: (rpc)']);
      const outcome = await specInterfacesCheck(ctx(project));
      expect(outcome.violations.map((v) => v.subject)).toEqual([]);
    });

    it('identifiers are split: createOrder, CreateOrder and list_orders are found by plain-English lines', async () => {
      const project = await createTestProject();
      await put(
        project,
        `${SPECS_ROOT}/interfaces/orders.yaml`,
        `${BASE('INT-001', 'InterfaceContract', 'Orders')}\npaths:\n  /orders:\n    post:\n      operationId: createOrder\n  /orders/list:\n    get:\n      operationId: list_orders\n`,
      );
      await put(
        project,
        `${SPECS_ROOT}/interfaces/orders.proto`,
        'service S { rpc CancelOrder (A) returns (B); }\n',
      );
      await withLines(project, [
        '- Needs interface: (create order), consumer (web)',
        '- Needs interface: (createOrder), consumer (web)',
        '- Needs interface: (list orders), consumer (web)',
        '- Needs interface: (cancel order), consumer (web)',
        '- Needs interface: (delete order), consumer (web)',
      ]);
      expect((await specInterfacesCheck(ctx(project))).violations.map((v) => v.subject)).toEqual([
        'STORY-001 needs delete order',
      ]);
    });

    it("a consumer's parentheses are not the operation", async () => {
      const project = await createTestProject();
      await put(
        project,
        `${SPECS_ROOT}/interfaces/orders.yaml`,
        `${BASE('INT-001', 'InterfaceContract', 'Orders')}\noperations: [createOrder]\n`,
      );
      await withLines(project, ['- Needs interface: create order, consumer web (Checkout UI)']);
      expect((await specInterfacesCheck(ctx(project))).violations).toEqual([]);
    });

    it('a hostile line costs bounded time (no quadratic scan)', async () => {
      const project = await createTestProject();
      await withLines(project, [`- Needs interface: ${'('.repeat(400_000)}`]);
      const started = Date.now();
      const outcome = await specInterfacesCheck(ctx(project));
      expect(Date.now() - started).toBeLessThan(3000);
      expect(outcome.fields).toMatchObject({ undefined_refs: 1 });
    });
  });

  it('a README in the interfaces directory is not a contract', async () => {
    const project = await createTestProject();
    await put(project, `${SPECS_ROOT}/interfaces/README.md`, '# Contracts\n');
    await contract(project, 'INT-001');
    expect((await specInterfacesCheck(ctx(project))).violations).toEqual([]);
  });

  it('a contract file that is not a valid contract defines nothing and is itself a violation, referenced or not', async () => {
    const project = await createTestProject();
    // wrong type: a Story is not an interface contract
    await put(project, `${SPECS_ROOT}/interfaces/wrong.yaml`, `${BASE('INT-001', 'Story')}\n`);
    // no front matter keys at all: raw OpenAPI
    await put(project, `${SPECS_ROOT}/interfaces/raw.yaml`, 'openapi: 3.1.0\npaths: {}\n');
    // not YAML
    await put(project, `${SPECS_ROOT}/interfaces/broken.yaml`, 'id: [unclosed\n');
    const outcome = await specInterfacesCheck(ctx(project));
    expect(outcome.fields).toMatchObject({ invalid_contracts: 3, undefined_refs: 3, contracts: 0 });
    expect(outcome.violations.map((v) => v.subject)).toEqual([
      `${SPECS_ROOT}/interfaces/broken.yaml`,
      `${SPECS_ROOT}/interfaces/raw.yaml`,
      `${SPECS_ROOT}/interfaces/wrong.yaml`,
    ]);
    for (const violation of outcome.violations) {
      expect(violation.remedy).toMatch(/^Repair /);
    }
  });

  it('a story referencing the id of an invalid contract is also unresolved (the id defines nothing)', async () => {
    const project = await createTestProject();
    await put(project, `${SPECS_ROOT}/interfaces/wrong.yaml`, `${BASE('INT-001', 'Story')}\n`);
    await story(project, 'STORY-001', { interfaces: '[INT-001]' });
    const outcome = await specInterfacesCheck(ctx(project));
    expect(outcome.fields).toMatchObject({
      unresolved_refs: 1,
      invalid_contracts: 1,
      undefined_refs: 2,
    });
  });

  it('two files claiming one id make a reference to it ambiguous: a violation', async () => {
    const project = await createTestProject();
    await contract(project, 'INT-001', 'first');
    await contract(project, 'INT-001', 'second');
    await story(project, 'STORY-001', { interfaces: '[INT-001]' });
    const outcome = await specInterfacesCheck(ctx(project));
    expect(outcome.fields).toMatchObject({ duplicate_ids: 1, undefined_refs: 1 });
    expect(outcome.violations[0]?.message).toContain('first.yaml');
    expect(outcome.violations[0]?.message).toContain('second.yaml');
  });

  it('reads a front-matter contract, a `---`-led plain YAML contract, and ignores notations beside them', async () => {
    const project = await createTestProject();
    await put(
      project,
      `${SPECS_ROOT}/interfaces/framed.yaml`,
      `---\n${BASE('INT-001')}\n---\nnotes\n`,
    );
    await put(project, `${SPECS_ROOT}/interfaces/led.yaml`, `---\n${yamlContract('INT-002')}`);
    await put(project, `${SPECS_ROOT}/interfaces/orders.proto`, 'syntax = "proto3";\n');
    await story(project, 'STORY-001', { interfaces: '[INT-001, INT-002]' });
    const outcome = await specInterfacesCheck(ctx(project));
    expect(outcome.violations).toEqual([]);
    expect(outcome.fields).toMatchObject({ contracts: 2 });
  });

  it('a front-matter contract with an unknown key is invalid (strict), unlike the body of a plain YAML contract', async () => {
    const project = await createTestProject();
    await put(
      project,
      `${SPECS_ROOT}/interfaces/framed.yaml`,
      `---\n${BASE('INT-001')}\nextra: 1\n---\n`,
    );
    const outcome = await specInterfacesCheck(ctx(project));
    expect(outcome.fields).toMatchObject({ invalid_contracts: 1, undefined_refs: 1 });
  });

  it('fails closed on a story whose "interfaces" is not a list, and on a story file that cannot be parsed', async () => {
    const project = await createTestProject();
    await story(project, 'STORY-001', { interfaces: '"INT-001"' });
    await put(project, `${SPECS_ROOT}/stories/STORY-002.md`, '---\nid: STORY-002\ntype: Story\n');
    const outcome = await specInterfacesCheck(ctx(project));
    expect(outcome.fields).toMatchObject({ undefined_refs: 2 });
    expect(outcome.violations.map((v) => v.subject).sort()).toEqual([
      'STORY-001',
      `${SPECS_ROOT}/stories/STORY-002.md`,
    ]);
  });

  it('skips a spec file with no front matter (a README) rather than failing on it', async () => {
    const project = await createTestProject();
    await put(project, `${SPECS_ROOT}/README.md`, '# Specs\n');
    expect((await specInterfacesCheck(ctx(project))).violations).toEqual([]);
  });

  it('is unaffected by a plain YAML contract that starts with `---` and has no closing line (which other spec readers refuse)', async () => {
    const project = await createTestProject();
    await put(project, `${SPECS_ROOT}/interfaces/led.yaml`, `---\n${yamlContract('INT-001')}`);
    await story(project, 'STORY-001', { interfaces: '[INT-001]' });
    expect((await specInterfacesCheck(ctx(project))).violations).toEqual([]);
  });

  it('is deterministic: the same tree gives the same bytes, and violations are sorted', async () => {
    const project = await createTestProject();
    await story(project, 'STORY-002', { interfaces: '[INT-020, INT-010]' });
    await story(project, 'STORY-001', { interfaces: '[INT-030]' });
    const first = JSON.stringify(await specInterfacesCheck(ctx(project)));
    expect(JSON.stringify(await specInterfacesCheck(ctx(project)))).toBe(first);
    expect((await specInterfacesCheck(ctx(project))).violations.map((v) => v.subject)).toEqual([
      'STORY-001 -> INT-030',
      'STORY-002 -> INT-010',
      'STORY-002 -> INT-020',
    ]);
  });
});
