import { expect, test } from 'vitest';
import { INSTRUCTIONS, said, TOOLS, windowState } from './director.ts';
import { Stores } from './stores.ts';

test('the instructions and the state fit the API limits', () => {
  expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
  const s = new Stores();
  for (let i = 0; i < 12; i++) s.turnDown('a very long name for something the stores do not carry at all', 'a long reason '.repeat(10));
  expect(windowState(s.view()).length).toBeLessThan(3858);
});

test('the tools fit the API: names, descriptions, schemas, timeouts', () => {
  expect(TOOLS.length).toBeLessThanOrEqual(30);
  const names = TOOLS.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  for (const tool of TOOLS) {
    expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
    expect(['web_search', 'lookup']).not.toContain(tool.name);
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeLessThanOrEqual(500);
    expect(tool.parameters.type).toBe('object');
    expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
    if (tool['x-atmee']?.mode === 'await') expect(tool['x-atmee'].timeoutSeconds!).toBeLessThanOrEqual(28);
  }
  expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
  for (const name of names) expect(INSTRUCTIONS).toContain(name);
  // Answers come from the stores; turning someone down is Hester's own act.
  expect(Object.fromEntries(TOOLS.map((t) => [t.name, t['x-atmee']?.mode]))).toEqual({ check_shelves: 'await', stamp_slip: 'await', refuse_slip: 'notify' });
});

test('the tool schemas are lenient: no enums, patterns or closed objects', () => {
  for (const tool of TOOLS) {
    expect(tool.parameters).not.toHaveProperty('additionalProperties');
    expect(JSON.stringify(tool.parameters)).not.toMatch(/"enum"|"pattern"|"additionalProperties":false/);
  }
});

test('the state names the items but never a count or a price: those come from check_shelves', () => {
  const state = windowState(new Stores().view());
  expect(state).toContain('Pump gasket');
  expect(state).toContain('30 chits');
  expect(state).not.toMatch(/shelf [A-F]-\d|12 chits/);
  expect(state).toContain('check_shelves');
});

test('every result leads with its outcome', () => {
  const s = new Stores();
  expect(said.check(s.check('pump gasket'))).toMatch(/^In stock: Pump gasket: 2 on shelf C-4, 12 chits each, issued only to Hydroponics, Mechanical and Farms/);
  expect(said.check(s.check('bulb'))).toMatch(/^Out: .* Bulb, 25-watt: 6 on shelf A-1, 3 chits each: offer it\.$/);
  expect(said.check(s.check('hammer'))).toMatch(/^Not a Supply item/);
  expect(said.stamp(s.stamp({ item: 'thread' }), s.purse)).toMatch(/^Not yet: no department/);
  expect(said.stamp(s.stamp({ item: 'thread', department: 'Residence' }), s.purse)).toMatch(/^Not yet: no reason/);
  const stamped = s.stamp({ item: 'thread', quantity: 2, department: 'Residence', purpose: 'mending' });
  expect(said.stamp(stamped, s.purse)).toMatch(/^Stamped: slip 18-0417, 2 × Thread, grey spool for Residence, 4 chits\. They have 26 chits left; 12 left on the shelf\./);
  expect(said.stamp(s.stamp({ item: 'thread', quantity: 2, department: 'Residence', purpose: 'mending' }), s.purse)).toMatch(/^Already stamped/);
  expect(said.stamp(s.stamp({ item: 'network cable', department: 'Farms', purpose: 'x y z' }), s.purse)).toMatch(/^Refused: network cable, 10 m is issued only to IT, not Farms/);
  expect(said.stamp(s.stamp({ item: 'tape', department: 'Residence', purpose: 'going outside' }), s.purse)).toMatch(/^Refused: Supply issues nothing for the outside/);
});

test('the opening never greets a second time', () => {
  expect(said.opening()).toMatch(/^You have just greeted them; do not greet/);
  expect(said.opening(2)).toContain('earlier slips');
});
