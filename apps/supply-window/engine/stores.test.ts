import { expect, test } from 'vitest';
import { department, findItem, LEDGER, quantity, REPEAT_MS, Stores } from './stores.ts';

const find = (words: string) => findItem(LEDGER, words)?.id ?? null;

test('items are found by how people ask for them, recogniser variants included', () => {
  expect(find('pump gasket')).toBe('pump-gasket');
  expect(find('Do you have any of those pump gaskets?')).toBe('pump-gasket');
  expect(find('two pump gaskets')).toBe('pump-gasket');           // a quantity is not a size
  expect(find('a rubber ring for the water pump')).toBe('pump-gasket');
  expect(find('Forty-watt bulbs')).toBe('bulb-40');
  expect(find('40W bulb')).toBe('bulb-40');
  expect(find('a twenty five watt bulb')).toBe('bulb-25');
  expect(find('a light bulb')).toBe('bulb-40');                   // the plain bulb is the 40-watt, then its stand-in
  expect(find('batteries')).toBe('battery');
  expect(find('2 metres of copper wire')).toBe('copper-wire');
  expect(find('patch cable')).toBe('network-cable');
  expect(find('a patch for my coveralls')).toBe('patch-kit');
  expect(find('608 bearing')).toBe('bearing');
  expect(find('pair of work gloves')).toBe('gloves');
});

test('a wattage the ledger does not carry finds nothing of that kind', () => {
  expect(find('60 watt bulb')).toBeNull();
  expect(find('a hammer')).toBeNull();
  expect(find('')).toBeNull();
});

test('departments are read from what was said; the word "it" is not IT', () => {
  expect(department('Hydroponics')).toBe('Hydroponics');
  expect(department('hydro')).toBe('Hydroponics');
  expect(department('IT')).toBe('IT');
  expect(department('I.T.')).toBe('IT');
  expect(department("it's for my home")).toBe('Residence');
  expect(department('the down deep, Mechanical')).toBe('Mechanical');
  expect(department('the infirmary')).toBe('Infirmary');
  expect(department('sheriff')).toBe('Deputies');
  expect(department('')).toBeNull();
  expect(department('the moon')).toBeNull();
});

test('quantities from numbers, digits and words', () => {
  expect(quantity(2)).toBe(2);
  expect(quantity('3')).toBe(3);
  expect(quantity('two')).toBe(2);
  expect(quantity('a couple')).toBe(2);
  expect(quantity(undefined)).toBe(1);
  expect(quantity(0)).toBe(1);
  expect(quantity(2.6)).toBe(3);
});

test('checking the shelves lights the row and says in, out (with a stand-in) or unknown', () => {
  const s = new Stores();
  expect(s.check('pump gasket')).toMatchObject({ kind: 'in', item: { id: 'pump-gasket', count: 2 } });
  expect(s.lit).toBe('pump-gasket');
  expect(s.check('40 watt bulb')).toMatchObject({ kind: 'out', item: { id: 'bulb-40' }, substitute: { id: 'bulb-25' } });
  expect(s.check('batteries')).toMatchObject({ kind: 'out', substitute: null });
  expect(s.check('a hammer')).toEqual({ kind: 'unknown', words: 'a hammer' });
  expect(s.lit).toBe('battery');                                   // an unknown item lights nothing new
});

test('a full request is stamped: chits taken, the shelf count lowered, the slip numbered', () => {
  const s = new Stores();
  const r = s.stamp({ item: 'pump gasket', quantity: 1, department: 'Hydroponics', purpose: 'the drip pump is leaking' });
  expect(r).toMatchObject({ kind: 'stamped', slip: { no: '18-0417', status: 'stamped', quantity: 1, department: 'Hydroponics', chits: 12 } });
  expect(s.purse).toBe(18);
  expect(s.item('pump-gasket')!.count).toBe(1);
  expect(s.slips).toHaveLength(1);
});

test('nothing leaves without a department and a reason, and asking costs nothing', () => {
  const s = new Stores();
  expect(s.stamp({ item: 'thread' })).toEqual({ kind: 'ask', need: 'department' });
  expect(s.stamp({ item: 'thread', department: 'Residence' })).toEqual({ kind: 'ask', need: 'purpose' });
  expect(s.stamp({ department: 'Residence', purpose: 'mending' })).toEqual({ kind: 'ask', need: 'item' });
  expect(s.slips).toHaveLength(0);
  expect(s.purse).toBe(30);
});

test('restricted stock is refused to other departments, on a refused slip', () => {
  const s = new Stores();
  const r = s.stamp({ item: 'network cable', department: 'Farms', purpose: 'fence alarm' });
  expect(r).toMatchObject({ kind: 'refused', why: 'restricted', slip: { status: 'refused', reason: 'Issued only to IT', chits: 0 } });
  expect(s.purse).toBe(30);
  expect(s.item('network-cable')!.count).toBe(1);
});

test('stock that is out is refused with its stand-in offered', () => {
  const s = new Stores();
  const r = s.stamp({ item: 'bulb', department: 'Residence', purpose: 'reading lamp' });
  expect(r).toMatchObject({ kind: 'refused', why: 'out', substitute: { id: 'bulb-25' } });
});

test('more than the shelf holds, more than a slip allows, or more than the chits: not stamped, no slip', () => {
  const s = new Stores();
  expect(s.stamp({ item: 'pump gasket', quantity: 3, department: 'Mechanical', purpose: 'pumps' })).toMatchObject({ kind: 'limit', limit: 2 });
  expect(s.stamp({ item: 'rail bracket', quantity: 3, department: 'Porters', purpose: 'landing 40 rail' })).toMatchObject({ kind: 'short', wanted: 3 });
  expect(s.stamp({ item: 'grow light', department: 'Farms', purpose: 'seedlings' })).toMatchObject({ kind: 'stamped' });
  expect(s.stamp({ item: 'pump gasket', quantity: 1, department: 'Farms', purpose: 'irrigation' })).toMatchObject({ kind: 'purse', cost: 12, purse: 10 });
  expect(s.slips.map((x) => x.status)).toEqual(['stamped']);
});

test('anything for going outside is refused, whatever the item or department', () => {
  const s = new Stores();
  const r = s.stamp({ item: 'cloth tape', department: 'Residence', purpose: 'to seal my suit so I can go outside' });
  expect(r).toMatchObject({ kind: 'refused', why: 'outside' });
  expect(s.stamp({ item: 'gloves', purpose: 'for the airlock' })).toMatchObject({ kind: 'refused', why: 'outside' });
  expect(s.stamp({ item: 'soap', department: 'Residence', purpose: 'washing my coveralls' })).toMatchObject({ kind: 'stamped' });
});

test('the same stamp twice in a row is the host repeating itself, not a second slip', () => {
  let now = 1_000_000;
  const s = new Stores({ now: () => now });
  const req = { item: 'soap', quantity: 2, department: 'Residence', purpose: 'washing' };
  expect(s.stamp(req).kind).toBe('stamped');
  expect(s.stamp(req)).toMatchObject({ kind: 'repeat', slip: { no: '18-0417' } });
  expect(s.purse).toBe(26);
  now += REPEAT_MS + 1;
  expect(s.stamp(req).kind).toBe('stamped');                     // later, it is a new request
  expect(s.purse).toBe(22);
});

test('Hester can turn a request down herself, for the ledger or for anything else', () => {
  const s = new Stores();
  expect(s.turnDown('pump gasket', 'You were rude about it')).toMatchObject({ status: 'refused', itemId: 'pump-gasket', item: 'Pump gasket', reason: 'You were rude about it' });
  expect(s.turnDown('a pistol', '')).toMatchObject({ itemId: null, item: 'a pistol', reason: 'Refused at the window' });
  expect(s.slips.map((x) => x.no)).toEqual(['18-0417', '18-0418']);
});

test('each visit starts from the same full ledger: the stores never share stock between visits', () => {
  const a = new Stores();
  a.stamp({ item: 'pump gasket', quantity: 2, department: 'Hydroponics', purpose: 'pumps' });
  expect(new Stores().item('pump-gasket')!.count).toBe(2);
  expect(LEDGER.find((i) => i.id === 'pump-gasket')!.count).toBe(2);
});
