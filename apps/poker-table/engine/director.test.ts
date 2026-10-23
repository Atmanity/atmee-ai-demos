// What Dex is told: within the API's limits, grounded in the table, and never
// a hand he must not know (ported from test_agent_note.py and the note halves
// of test_table.py and test_user_turn_moves.py; the tool checks are new).
import { expect, test } from 'vitest';
import { spokenCard } from './cards.ts';
import { chipFacts, INSTRUCTIONS, RULES_NOTE, said, speak, tableState, TOOLS } from './director.ts';
import { PokerMatch } from './match.ts';
import { Table } from './table.ts';

const DECK = ['As', 'Kd', 'Ah', 'Kc', '2c', '7d', '9h', '3s', '5c', '5d', '8h', 'Jc', 'Qd'];

/** Every way a card can be written in what Dex is told. */
const mentions = (text: string, card: string) => text.includes(card) || text.toLowerCase().includes(spokenCard(card));

test('the tools fit the API: names, descriptions, schemas, modes and timeouts', () => {
  expect(TOOLS.length).toBeLessThanOrEqual(30);
  const names = TOOLS.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  for (const tool of TOOLS) {
    expect(tool.type).toBe('function');
    expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
    expect(['web_search', 'lookup']).not.toContain(tool.name);
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeLessThanOrEqual(500);
    expect(tool.parameters.type).toBe('object');
    expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
    const mode = tool['x-atmee']?.mode;
    expect(['await', 'notify']).toContain(mode);
    if (mode === 'await') {
      expect(tool['x-atmee']!.timeoutSeconds!).toBeGreaterThanOrEqual(1);
      expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
    }
  }
  expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
});

test('everything Dex must speak about waits for the table; only the chart is fire-and-forget', () => {
  const modes = Object.fromEntries(TOOLS.map((t) => [t.name, t['x-atmee']?.mode]));
  expect(modes).toEqual({ play_move: 'await', deal_hand: 'await', new_match: 'await', read_my_cards: 'await', show_hand_rankings: 'notify' });
  // The move's result can carry Dex's own move too: the decider's 4.5 s budget, twice, fits.
  expect(TOOLS.find((t) => t.name === 'play_move')!['x-atmee']!.timeoutSeconds).toBeGreaterThanOrEqual(15);
});

test('the instructions fit 4,000 characters and name every tool', () => {
  expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
  for (const tool of TOOLS) expect(INSTRUCTIONS).toContain(tool.name);
});

test('the rules note fits 2,000 characters and teaches the whole game', () => {
  expect(RULES_NOTE.length).toBeLessThanOrEqual(2000);
  const note = RULES_NOTE.toLowerCase();
  for (const words of ['two private cards', 'fold', 'check', 'call', 'raise', 'royal flush', 'high card', 'small blind']) expect(note).toContain(words);
});

test('the hard-won rules survive the move to tools', () => {
  const all = INSTRUCTIONS.toLowerCase();
  for (const rule of [
    "you're checking? cute", 'never pick, round or fix an amount', 'their cards and they are entitled to them', 'never announce, preview or promise',
    'never add up, estimate', 'never ask them to deal', 'ai, made by atmee', 'a question about a move', 'call the tool even when you think you know',
    'changes only when a tool runs', 'new_match, only when they ask',
  ]) {
    expect(all, rule).toContain(rule.toLowerCase());
  }
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
  // The player's own cards are on their screen, not in Dex's context: he plays
  // on the information a spectator has. His own are the server's alone.
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

test("no result Dex is handed ever names his live cards", async () => {
  const table = new Table();
  table.open();
  const hidden = table.match.holeCards('agent');
  const seq = () => table.view().seq;
  const texts = [
    speak([table.open().line]),
    speak([table.ownCards().line]),
    speak([table.playerMove('raise to 5', [{ text: 'raise to 5', seq: seq() }]).line]),
    speak([table.playerMove('purple banana forty seven?', [{ text: 'purple banana forty seven?', seq: seq() }]).line]),
    speak([table.playerMove('I call', [{ text: 'I call', seq: seq() }]).line]),
    speak([table.deal().line, table.rematch().line]),
  ];
  texts.push(speak([(await table.opponentTurn(async () => ({ action: 'raise', amount: 60 }))).line]));
  for (const text of texts) {
    expect(text.length).toBeGreaterThan(0);
    for (const card of hidden) expect(mentions(text, card), `${card} in: ${text}`).toBe(false);
  }
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
  expect(state).toContain('only through play_move');
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

test('the session line: nothing until a hand finishes, then the count', () => {
  // "we've played one hand. You're down 20", said mid-first-hand.
  const match = new PokerMatch();
  match.deal(DECK);
  expect(tableState(match.view())).toContain('no hand has finished yet');
  match.applyMove('user', 'fold');
  expect(tableState(match.view())).toContain('Session: 1 hand finished; you have won 1, they have won 0, and they are down 10 chips.');
});

test('the opening never asks the player to deal, and names whose move it is', () => {
  const table = new Table();
  const text = speak([table.open().line]);
  expect(text).toContain('never ask them to deal');
  expect(text).toContain('Hand 1 is dealt');
  expect(text).toContain('The action is on them: they can fold, call 10 or raise to anything from 40 up to 1000');
});

test('results never ask Dex to act on his own: the next hand and a rematch wait for the player', async () => {
  const table = new Table({ startingStack: 20 });
  table.match.deal(DECK);
  const seq = table.view().seq;
  // 20-chip stacks: the shove can only call the big blind, and Dex's aces take every chip.
  const over = table.playerMove('all in', [{ text: "I'm all in", seq }]);
  expect(over.view.phase).toBe('game-over');
  expect(speak([over.line])).toContain('call new_match only if they say so');
  const handOver = new Table();
  handOver.match.deal(DECK);
  const folded = handOver.playerMove('I fold', [{ text: 'I fold', seq: handOver.view().seq }]);
  expect(speak([folded.line])).toContain('never deal it yourself');
});

test("Dex's move is named as his own, as done, with the figures that landed", () => {
  const match = new PokerMatch();
  match.deal(DECK);
  match.applyMove('user', 'call');
  const before = match.view();
  match.applyMove('agent', 'raise', 60);
  const line = said.yours(before, match.view());
  expect(line.facts).toContain('The table played your move: you raised to 60.');
  expect(line.facts).toContain('The action is on them: they can fold, call 40 or raise to anything from 100 up to 1000');
  expect(line.cue).toContain('never as a plan');
  // Every figure in it is the table's.
  for (const figure of line.facts.match(/\d+/g)!) expect(['60', '40', '100', '1000']).toContain(figure);
});

test('a move and the reply to it are spoken as one result, the last cue last', () => {
  const match = new PokerMatch();
  match.deal(DECK);
  const before = match.view();
  match.applyMove('user', 'call');
  const mid = match.view();
  match.applyMove('agent', 'raise', 60);
  const text = speak([said.played(before, mid, 'call'), said.yours(mid, match.view())]);
  expect(text.indexOf('The table played their call of 10.')).toBeLessThan(text.indexOf('you raised to 60'));
  expect(text).not.toContain('say nothing about yours');
  expect(text.endsWith(said.yours(mid, match.view()).cue)).toBe(true);
});
