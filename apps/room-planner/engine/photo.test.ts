// A photo becomes kit pieces in rooms: never a size, never a coordinate.
import { expect, test } from 'vitest';
import { CATALOG } from './catalog.ts';
import { PHOTO_SCHEMA, photoIntents, photoPrompt } from './photo.ts';

const rooms = [
  { id: 'r1', name: 'Living room', kind: 'living' },
  { id: 'r2', name: 'Main bedroom', kind: 'bedroom' },
  { id: 'r3', name: 'Study', kind: 'office' },
];

test('the model can only answer with kit types, and with no sizes at all', () => {
  const item = PHOTO_SCHEMA.properties.pieces.items.properties;
  expect([...item.type.enum].sort()).toEqual(Object.keys(CATALOG).sort());
  expect(Object.keys(item)).toEqual(['type', 'room']);
});

test('pieces go to the room the model named, else where such a piece usually lives', () => {
  const intents = photoIntents({ seen: '', pieces: [
    { type: 'sofa_3', room: 'r1' }, { type: 'bed_queen' }, { type: 'desk', room: 'r9' }, { type: 'piano' }, { type: 'floor_lamp' },
  ] }, 'room', rooms, null);
  expect(intents).toEqual([
    { kind: 'add_item', type: 'sofa_3', room: 'r1', near: 'center' },
    { kind: 'add_item', type: 'bed_queen', room: 'r2', near: 'center' },
    { kind: 'add_item', type: 'desk', room: 'r3', near: 'center' },
    { kind: 'add_item', type: 'floor_lamp', room: 'r1', near: 'center' },
  ]);
});

test('a photo of one piece adds one piece', () => {
  expect(photoIntents({ seen: '', pieces: [{ type: 'armchair' }, { type: 'rug' }] }, 'piece', rooms, null)).toHaveLength(1);
});

test('the prompt lists the plan rooms by id and forbids guessing a size', () => {
  const prompt = photoPrompt('room', rooms);
  expect(prompt).toContain('r2 Main bedroom (bedroom)');
  expect(prompt).toContain('Never guess a dimension');
});
