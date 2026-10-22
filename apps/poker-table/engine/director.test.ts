// What the avatar is told: within the limits, grounded in the table, and never
// a hand it must not know (ported from test_agent_note.py and the note halves
// of test_table.py and test_user_turn_moves.py).
import { expect, test } from 'vitest';
import { spokenCard } from './cards.ts';
import { chipFacts, NOTES, say, tableState } from './director.ts';
import { PokerMatch } from './match.ts';
import { Table } from './table.ts';

const DECK = ['As', 'Kd', 'Ah', 'Kc', '2c', '7d', '9h', '3s', '5c', '5d', '8h', 'Jc', 'Qd'];

/** Every way a card can be written in what the avatar is told. */
const mentions = (text: string, card: string) => text.includes(card) || text.toLowerCase().includes(spokenCard(card));

test('every standing note fits 2,000 characters', () => {
  for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(2000);
});

test('the busiest table still fits the 3,858-character state', () => {
  // The worst state is a showdown: five board cards, both hands, a winner, a session line.
  const match = new PokerMatch();
  match.deal(DECK);
  while (match.phase === 'playing') match.applyMove(match.actionTo()!, match.validActions(match.actionTo()!).includes('check') ? 'check' : 'call');
  const view = match.view();
  expect(view.revealed_hands).not.toBeNull();
  expect(view.board).toHaveLength(5);
  expect(tableState(view).length).toBeLessThan(3858);
  const live = new PokerMatch();
  live.deal(DECK);
  expect(tableState(live.view()).length).toBeLessThan(3858);
});

test("neither player's hole cards are in the state before a showdown", () => {
  // The user's own cards are on their screen, not in the avatar's context:
  // the avatar plays on the information a spectator has. Its own are the
  // server's alone.
  const match = new PokerMatch();
  match.deal(DECK);
  match.applyMove('user', 'call');
  match.applyMove('agent', 'check'); // the flop: 2c 7d 9h
  const state = tableState(match.view());
  for (const card of [...match.holeCards('user'), ...match.holeCards('agent')]) expect(mentions(state, card), card).toBe(false);
  expect(state).toContain('two of clubs, seven of diamonds and nine of hearts');
  expect(state).not.toContain('user_hand');
});

test('a fold reveals nothing; a showdown reveals both hands', () => {
  const folded = new PokerMatch();
  folded.deal(DECK);
  folded.applyMove('user', 'fold');
  const afterFold = tableState(folded.view());
  for (const card of [...folded.holeCards('user'), ...folded.holeCards('agent')]) expect(mentions(afterFold, card)).toBe(false);
  expect(afterFold).toContain('No cards were shown');

  const shown = new PokerMatch();
  shown.deal(DECK);
  shown.applyMove('user', 'all in');
  shown.applyMove('agent', 'call');
  const atShowdown = tableState(shown.view());
  expect(atShowdown).toContain('you showed ace of spades and ace of hearts');
  expect(atShowdown).toContain('you won 2000 with One Pair');
});

test('no event text ever names the opponent\'s live cards', async () => {
  const table = new Table();
  table.match.deal(DECK);
  const hidden = table.match.holeCards('agent');
  const texts = [
    table.act({ text: 'what are my cards?' }, 'typed').event!,
    table.act({ text: 'raise to 5' }, 'typed').event!,
    table.act({ text: 'I call' }, 'spoken').event!,
  ];
  texts.push((await table.opponentTurn(async () => ({ action: 'check', amount: 0 }))).event!);
  for (const text of texts) for (const card of hidden) expect(mentions(text, card), `${card} in: ${text}`).toBe(false);
});

test('the state forbids previewing a move the table has not played yet', () => {
  // The player called, and the avatar said "My turn now. I'll check." while
  // the table had just played raise-to-40. Whose turn it is is a fact in the
  // view, so the ban is stated from it.
  const match = new PokerMatch();
  match.deal(DECK);
  expect(tableState(match.view())).not.toContain('ACTION IS ON YOU');
  match.applyMove('user', 'call');
  const state = tableState(match.view());
  expect(state).toContain('ACTION IS ON YOU');
  expect(state.toLowerCase()).toContain('do not say what you are about to do');
});

test('the state carries the chip figures, and forbids any others', () => {
  // Three turns of one hand reported the pot as 270, 960 and 303.
  const match = new PokerMatch();
  match.deal(DECK);
  const view = match.view();
  const state = tableState(view);
  expect(state).toContain(`pot=${view.pot}`);
  expect(state).toContain(`their stack=${view.players.user.stack}`);
  expect(state).toContain(`your stack=${view.players.agent.stack}`);
  expect(state).toContain('NEVER state a chip, pot or stack number');
  expect(state).toContain('raise to anything from 40 up to 1000');
});

test('the owed figure names whoever is actually to act', () => {
  // "you owe 40", said to the player who had just raised to 60.
  const match = new PokerMatch();
  match.deal(DECK);
  expect(chipFacts(match.view())).toContain('they owe=10 to call');
  match.applyMove('user', 'raise', 60);
  const facts = chipFacts(match.view());
  expect(facts).toContain('you owe=40 to call');
  expect(facts).not.toContain('they owe');
});

test('the figures track the table, not the conversation', () => {
  const match = new PokerMatch();
  match.deal(DECK);
  const first = chipFacts(match.view());
  match.applyMove('user', 'raise', 60);
  expect(chipFacts(match.view())).not.toBe(first);
  expect(chipFacts(match.view())).toContain('pot=80');
});

test('the session line: nothing until a hand finishes, then the count', () => {
  // "we've played one hand. You're down 20", said mid-first-hand.
  const match = new PokerMatch();
  match.deal(DECK);
  expect(tableState(match.view())).toContain('no hand has finished yet');
  match.applyMove('user', 'fold');
  expect(tableState(match.view())).toContain('Session: 1 hand finished; you have won 1, they have won 0, and they are down 10 chips.');
});

test('the opening line never asks the player to deal', () => {
  expect(say.start()).toContain('Do not ask them to deal');
  expect(NOTES[0]).toContain('never ask them to deal');
});

test("the commentary names the move that landed, and the avatar's own", () => {
  const line = say.yourMove({ by: 'agent', kind: 'raise', amount: 40, applied: true });
  expect(line.toLowerCase()).toContain('your own raise');
  expect(line.toLowerCase()).toContain('nothing about the opponent');
  expect(line).toContain('state no other chip amount');
});

test('the hard-won rules survive the condensing', () => {
  const all = NOTES.join(' ');
  for (const rule of ["you're checking? cute", 'never round their number up', 'card secrecy is about yours', 'never claim, announce or preview an action of your own', 'Never add up, estimate', 'AI avatar, created by Atmee']) {
    expect(all.toLowerCase()).toContain(rule.toLowerCase());
  }
});
