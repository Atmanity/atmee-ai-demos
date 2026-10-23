// The safety net: what it does when the host does not, and only the moves
// that are safe to make twice.
import { describe, expect, test } from 'vitest';
import { runTool } from './actions.ts';
import { SkyChart } from './chart.ts';
import { mustDo, type NetCall } from './net.ts';

const EPOCH = 1785931200;   // 2026-08-05, 8 pm in Taipei

describe('what the net does when the host does not', () => {
  test.each<[string, NetCall | null]>([
    ['Show me the sky from Lisbon', { name: 'move_chart', arguments: { place: 'Lisbon' } }],
    ["I'm in Tokyo", { name: 'move_chart', arguments: { place: 'Tokyo' } }],
    ['Take me to Sydney at dawn', { name: 'move_chart', arguments: { place: 'Sydney', time: 'Take me to Sydney at dawn' } }],
    ['What about midnight?', { name: 'move_chart', arguments: { time: 'What about midnight?' } }],
    ['Back to tonight', { name: 'move_chart', arguments: { time: 'Back to tonight' } }],
    ['Show me 3 a.m.', { name: 'move_chart', arguments: { time: 'Show me 3 a.m.' } }],
    ['Lisbon', { name: 'move_chart', arguments: { place: 'Lisbon' } }],
    ['December please', { name: 'move_chart', arguments: { time: 'December please' } }],
    ['Show me Orion', { name: 'show_constellation', arguments: { name: 'Orion' } }],
    ['Can you draw the Plough?', { name: 'show_constellation', arguments: { name: 'Ursa Major' } }],
    ['Clear the chart', { name: 'clear_chart', arguments: { what: 'everything' } }],
    ['Hide the lines', { name: 'clear_chart', arguments: { what: 'constellation' } }],
    ['unmark it', { name: 'clear_chart', arguments: { what: 'star' } }],
  ])('%s', (said, expected) => {
    expect(mustDo(said)).toEqual(expected);
  });
});

test('the equator and the poles keep the chart\'s longitude', () => {
  expect(mustDo('Show me the sky from the equator', { lon: 121.56 })).toEqual({ name: 'move_chart', arguments: { place: '0, 121.56' } });
});

describe('what it leaves to the host', () => {
  test.each([
    'Two hours later',          // twice would be four hours
    'Tomorrow night',           // relative too
    "Where's Vega?",            // often answered rightly from the live chart
    'Tell me about Sirius',
    'Is Scorpio up?',           // a question about a figure, not a command
    'Will Orion be up at midnight?',   // two tools at once
    'My sister lives in Paris, she loves the stars',   // a place in a story
    'the sky from Kyoto',       // the rules cannot place it
    'Where is Jupiter?',
    "What's up tonight?",
    'Thank you!',
  ])('%s', (said) => {
    expect(mustDo(said)).toBeNull();
  });
});

test('every call it makes is one the tools understand, and lands where the user asked', async () => {
  const sky = new SkyChart({ place: 'Taipei', epoch: EPOCH, now: EPOCH });
  const call = mustDo('Show me the sky from Lisbon at midnight')!;
  expect(call.name).toBe('move_chart');
  await runTool(sky, call.name, call.arguments, { now: EPOCH });
  expect(sky.placeLabel).toBe('Lisbon');
  expect(new Date((sky.epoch + sky.tz * 3600) * 1000).getUTCHours()).toBe(0);
  // Made twice (the host called it after all), the chart is where it was.
  const first = sky.epoch;
  await runTool(sky, call.name, call.arguments, { now: EPOCH });
  expect([sky.placeLabel, sky.epoch]).toEqual(['Lisbon', first]);
});
