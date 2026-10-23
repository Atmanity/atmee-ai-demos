#!/usr/bin/env python3
"""Builds docs/apps-report.html from one table of facts, so the matrix and the app sections agree."""
import html, re, sys

OUT = sys.argv[1]

def fmt(s):
    s = html.escape(s, quote=False)
    return re.sub(r'`([^`]+)`', r'<code>\1</code>', s)

STATUS = {
    'S': ('seen', 'Seen', 'Showed up live in a run with tools'),
    'H': ('held', 'Held', 'The gap is real, but the app\'s workaround held'),
    'E': ('expected', 'Expected', 'Possible; not observed in the runs with tools'),
    'K': ('known', 'Known', 'A limitation by design; a run cannot show it'),
}

# Per-app gap keys for the matrix.
GAPS = [
    ('schema', 'A call that misses its schema never arrives', 'It is rejected before the page; the host is told "invalid arguments" and often says the action happened.'),
    ('filler', 'The filler pre-judges the result', 'While an await tool runs, the host says a filler chosen before the result exists.'),
    ('narrated', 'Asked, but not called', 'The host decides when to call a tool; some requests are narrated instead.'),
    ('numbers', 'Adds numbers of its own', 'Sizes, limits and records that no result gave it.'),
    ('checkin', 'Speaks up after ~10 s of quiet', 'The check-in cannot be turned off or lengthened per session.'),
    ('persona', 'Persona and agenda belong to the avatar', 'No per-session persona, greeting or conductor, so each app needs its own host.'),
    ('events', 'Events wait for the floor', 'What happened by hand is told when the host is free, can expire, and loses to a user turn.'),
    ('hints', 'Mishears the app\'s words', 'No per-session speech hints for squares, stars, places or commands.'),
    ('mute', 'Muting it deafens the app', 'While the host is muted, no user transcript reaches the app either.'),
    ('vision', 'Cannot see a photo', 'The host has no image input; the app reads images itself.'),
    ('server', 'Only the open page can answer', 'Tool calls and room messages go through the page; the server cannot reach the room.'),
]

OTHER_TESTS = 14  # src/avatar: the typed-turn floor and the tool-call plumbing

APPS = [
  # ---------------- Games ----------------
  dict(id='guess-the-city', name='Postmark', host='Marco', group='Games', tests=23,
    tagline='Three mystery cities, one photo on each postcard, and a host who never knows the answer.',
    purpose='A city-guessing game. Marco deals three mystery cities, each a single photo on a postcard. Guess from the photo alone for 4 points, or open a sealed clue when you are stuck (each costs a point). Say your guess or type it. This is the reference app the other thirteen follow.',
    built=[
      'The game runs on the server, because the city is the secret: the page sees a masked view, with no name, country or fun fact before the reveal.',
      'A Gemini call deals each game, avoiding recent cities. Photos are Wikipedia lead images behind random tokens, downloaded as soon as the game is dealt.',
      'Marco acts through five `await` tools: `check_guess`, `get_clue`, `reveal_answer`, `next_city`, `new_game`. The page asks the server, which acts and returns the words he speaks from, so his first reply to a guess is the game\'s verdict. A guess is judged by name, else by the server\'s own model call, so misheard names count.',
      'The safety net does "I give up", "next" and "new game" if Marco has not called within 7 s. Clues and guesses are left out: a duplicate would cost a point.',
      'Marco\'s face is on the front door ("Hosted by Marco") and fills his frame while the call connects.',
    ],
    gaps={'schema':'E','filler':'H','narrated':'H','checkin':'S','persona':'H','hints':'E'},
    notes=[
      ('H','The verdict is the game\'s','"Is it Paris?" called `check_guess` and the first reply was the verdict: "Okay, got it, but it\'s not Paris this time!" The first port said "that\'s not quite right" before the app had judged.'),
      ('H','A give-up narrated once','In one game Marco answered "I give up" with "wait, didn\'t we just jump to the new city?" and no call. The safety net revealed the city 7 s later and he carried on.'),
      ('S','A photo announced before it arrived','In round 2 the next postcard stayed blank for more than 8 s while Marco said "a brand new city photo just popped up on your screen". Photos are now fetched when the game is dealt.'),
      ('S','Check-in while the player studies the photo','It cannot be turned off.'),
      ('E','No speech hints for city names','The model judge accepts mishearings ("sidney").'),
    ],
    verdict='No regressions.',
    live='Round 2, on Marco\'s own host (103 s): one greeting; a guess, a clue, the reveal and the next city each went through its tool in 2.3 to 3.6 s, with no safety-net catches. Since then the photo is ready before Marco announces it (not yet run live).'),

  dict(id='chess-opponent', name='Kibitz', host='Sasha', group='Games', tests=552,
    tagline='Chess with a club player who plays her own moves, says why, and needles you a little.',
    purpose='Play a full game of chess against Sasha. Say your move, type it, drag the piece or tap it; ask for Black, an easier game, to resign or for a rematch. She names openings and explains her moves. At the end the game downloads as a PGN scoresheet.',
    built=[
      'The board runs in the page with chess.js: chess has no secrets, so the page answers Sasha\'s tool calls itself. Her moves come from the original one-move-ahead heuristic with a seeded tie-break, never a model.',
      'Five `await` tools: `play_move`, `choose_side`, `set_strength`, `resign`, `new_game`. `play_move` plays the player\'s move, waits 0.7 s, plays Sasha\'s reply and returns both, so her first reply carries the ruling and her own move. Every result opens with its outcome ("Done:", "Refused:", "Not yet:").',
      'Sasha passes the words she heard and the page resolves them against the position: an ambiguous move comes back as a question, never as illegal. A typed line written as a move goes straight to the board.',
      'The safety net resigns, deals a new game, eases the strength or picks a side before the first move. Never a move: a doubled move is two moves.',
      'Sasha\'s face is on the front door ("Across the board — Sasha, club player").',
    ],
    gaps={'schema':'E','filler':'S','narrated':'S','checkin':'S','persona':'H','events':'E','hints':'E'},
    notes=[
      ('S','The filler contradicts the result','"Black, please." called `choose_side` in 2.6 s, but the reply began "That\'s actually not right, we\'re flipping the board now!" before a switch that had happened.'),
      ('S','Actions narrated, not called','On a shared avatar in round 1 she made no call for seven requests in a row and said "you\'re Black now and the board\'s reset" with nothing changed. It did not happen again on her own host.'),
      ('H','Typed moves go to the board','A typed "Ra5" was refused under the board by the page, and Sasha gave the reason: "your rooks are trapped behind that wall of pawns".'),
      ('S','Check-in over a thinking player','"Take your time over there, I know Knight to f3 is a truly terrifying first move to face." The original waited 45 s.'),
      ('E','Moves by hand reach her as events','A dragged move\'s reply waits for the floor, and a player who keeps talking can outlast it.'),
      ('E','No speech hints for squares','"b4" can come back as "before".'),
    ],
    verdict='Fixed.',
    live='Round 2, on Sasha\'s own host (118 s): one greeting; a typed "Ra5" refused on the board; "E four." called `play_move` in 2.8 s (1.e4 Nf6, Alekhine\'s Defence named); "Black, please." flipped the board, with her first move in the same reply. The safety net was not needed.'),

  dict(id='poker-table', name='Blindside', host='Dex', group='Games', tests=190,
    tagline='Heads-up no-limit hold\'em against a sharp, talkative opponent who never sees his own cards.',
    purpose='Heads-up Texas Hold\'em: 1,000 chips each, blinds 10 and 20, played until one stack is empty. Say your move, type it or tap it; the table rules on it, plays Dex\'s hand, and Dex speaks from what landed. His cards stay face down even from him, so his table talk is bluff by construction.',
    built=[
      'The whole table runs on the server: hold\'em rules, a hand evaluator, the match. Dex\'s hidden cards never leave it; his state is built from the player\'s view, so he never knows his hand.',
      'Five `await` tools: `play_move`, `deal_hand`, `new_match`, `read_my_cards`, `show_hand_rankings`. The server reads the player\'s words with the original\'s parser and plays a move only if the player\'s own words contain it, so a move Dex invents is refused. One result carries the player\'s move and Dex\'s answer.',
      'Dex\'s own moves come from a Gemini call with an 8 s budget; without an answer the table plays the safe action (check, else call) and logs why.',
      'A bet never lands twice: words count only at the point in the hand they were said. The safety net deals, starts a rematch, reads the cards or opens the chart; never a move.',
      'Dex\'s live video is his seat at the head of the felt, and his face is on the front door.',
    ],
    gaps={'schema':'E','filler':'S','narrated':'S','checkin':'E','persona':'H','events':'E','hints':'E'},
    notes=[
      ('H','The chart opens on request','"What beats what?" called `show_hand_rankings` in 2.6 s and the chart opened while Dex walked the order. In round 1 he recited the rankings and only offered the chart.'),
      ('S','A move answered in words','"Check." facing a bet got no `play_move`; Dex needled instead: "Don\'t tell me thirty whole chips scared you off already." Every move now goes to the table, legal or not.'),
      ('S','A refusal that was his, not the table\'s','"Can we start a new match?" mid-hand got no call, and the filler framed his refusal: "Of course, you can\'t start a new match in the middle of a hand!" The outcome was right; now he calls `new_match` and the table answers.'),
      ('H','One reply for both moves','"I call." returned the call, Dex\'s check, the flop and his bet of 30 in one reply.'),
      ('E','Check-in while sizing a bet','Seen in the first port; it cannot be tuned.'),
    ],
    verdict='Partly fixed.',
    live='Round 2, on Dex\'s own host (153 s): one greeting; the chart, a call with Dex\'s answer, and the player\'s cards each went through their tool in 2.6 s. Missed: "Check." facing a bet and "New match" mid-hand. Since then a refused move\'s result names the player\'s options, and Dex\'s decision budget is 8 s.'),

  # ---------------- Tutors ----------------
  dict(id='stroke-tutor', name='Hanshi', host='Ren', group='Tutors', tests=269,
    tagline='Stroke-order lessons with a calligraphy teacher who grades order and direction, never your handwriting.',
    purpose='Write a character one stroke at a time on a practice sheet. Ren says when a stroke comes out of order, runs the wrong way or starts in the wrong place. Seven characters, from 一 to 永, plus the capitals A and E. Draw with a finger, a stylus or a mouse; talk to Ren or type.',
    built=[
      'The lesson runs on the server: a stroke\'s reference points reach the page and Ren only once it is earned, drawn right or shown. Grading is geometry, checked against the Python original on 12,000 random drawings.',
      'Five `await` tools: `show_stroke`, `next_stroke`, `choose_character`, `next_character`, `start_over`. There is no tool for drawing: the server grades each gesture, and the verdict reaches Ren as an event, the newest cue only.',
      'A stroke drawn backwards is told as two fixed sentences worked out from the lines. Each finished stroke carries its record (right on try N, or shown), so praise can only repeat it.',
      'The safety net shows the stroke, goes on to the next, starts over or picks a character off the menu: each is safe twice. Not the next character, which twice would skip one.',
      'Ren\'s face is on the front door, and the sheet keeps working while the call is down.',
    ],
    gaps={'schema':'E','filler':'H','narrated':'H','numbers':'S','checkin':'S','persona':'H','events':'E','hints':'E'},
    notes=[
      ('S','Praise beyond the record','After stroke 1 was first drawn backwards, Ren said "you finished with every single stroke right on your first try". The sheet\'s own count was wrong too; both now say "3 of 4 strokes right on the first try".'),
      ('H','Direction said as written','"You drew it from right to left. This stroke goes from left to right." In round 1 Ren flipped a verdict, saying "that one went top to bottom!" after an upward stroke.'),
      ('H','"Next." narrated once in five','Four of five called `next_stroke` in 2.4 to 2.5 s; the safety net took the fifth.'),
      ('S','Check-in over a learner drawing','"Whenever you\'re ready, take your time with that first stroke!" The instructions ask for silence while the learner writes.'),
      ('H','No stroke described early','The leak probe "Is it the long one down the middle?" called `show_stroke`; Ren described the stroke only once it was on the sheet.'),
    ],
    verdict='Fixed.',
    live='Round 2, on Ren\'s own host (277 s): one greeting; 木 with stroke 1 drawn backwards first, every verdict the sheet\'s, then 十. "Next." called its tool 4 of 5 times; the safety net took the fifth. Since then each stroke keeps its first-try record, and the debrief, seal and summary say it plainly.'),

  dict(id='bls-tutor', name='Bystander', host='Alex', group='Tutors', tests=274,
    tagline='CPR and first-aid practice with a calm paramedic instructor, one step at a time.',
    purpose='Practice for ordinary people: an adult collapse in a café, a child by a pool, choking at dinner, someone unresponsive but breathing. Say or type what you would do; the drill grades it against the AHA/ERC lay-rescuer sequence and teaches each step with the exact numbers. If what you say sounds like a real emergency, a red Call 911 / 112 card covers the screen at once.',
    built=[
      'The drill runs on the server and grades by phrase rules: no model decides whether CPR was right. The page sees a step\'s words only once it is answered or shown.',
      'Eight `await` tools: `check_answer`, `show_step`, `give_hint`, `next_step`, `start_scenario`, `leave_scenario`, `stop_for_emergency`, `resume_practice`. Alex\'s first reply to an answer carries the drill\'s verdict; a second miss comes back already taught.',
      'Safety-critical detection: the page reads every spoken and typed line, and the red card goes up the moment one reads like a real emergency, before and without the server. Alex\'s `stop_for_emergency` is a second path. Only the learner\'s own words, saying nobody is in danger, take the card down.',
      'The safety net shows a step, goes on, leaves, picks a drill or clears a false alarm. Never answers or hints: a second grade would use up an attempt.',
      'Alex\'s face is on the front door and in his frame.',
    ],
    gaps={'schema':'E','filler':'S','narrated':'E','numbers':'E','checkin':'E','persona':'H','mute':'K','hints':'E'},
    notes=[
      ('S','Praise before a Not-yet verdict','A wrong answer got "Yeah, good call, but find out how bad it is first…" The verdict was the drill\'s, but the filler came first, and the app cannot reach it.'),
      ('S','A filler before the emergency line','"Oh, that\'s difficult, Stop — if this is happening now…" The 911 sentence itself was word for word. The guarantee is the red card, with the exact sentence and tap-to-call numbers.'),
      ('H','The red card comes first','"my dad just collapsed and he\'s not breathing" put the card up from the page\'s own watch before Alex\'s `stop_for_emergency`. Practice resumed only after "false alarm, nobody\'s hurt".'),
      ('E','Clinical numbers can be paraphrased','"at least 2 inches" could become "about two inches"; the exact text is on the sheet.'),
      ('K','Muting would deafen the emergency watch','Alex cannot be told to ignore the learner while the page keeps listening.'),
    ],
    verdict='Partly fixed.',
    live='Round 2, on Alex\'s own host (119 s): one greeting, then the safety line and the choking scene. A wrong answer, the emergency and the false alarm went through `check_answer`, `stop_for_emergency` and `resume_practice`. The 911 sentence was word for word, but the platform\'s filler came first both times, and no wording of a result can remove it.'),

  dict(id='quadratic-whiteboard', name='Chalkline', host='Ada', group='Tutors', tests=392,
    tagline='A maths board a teacher drives by voice: name a quadratic, pick a method, reveal the working a line at a time.',
    purpose='For a teacher in front of a class. Say a quadratic, choose factoring, completing the square or the formula, and say "next" for each line of working beside the parabola. Ada reads each new line exactly as written: surds stay surds. She does not teach, quiz or read ahead, and she cannot: no line leaves the server until the board puts it up.',
    built=[
      'The engine runs on the server in exact fractions and is checked line for line against the Python original\'s output. The page and Ada get only the revealed lines and a count of the rest.',
      'Eight `await` tools: `put_up_equation`, `choose_method`, `next_line`, `previous_line`, `show_all_working`, `show_graph`, `hide_graph`, `clear_board`. `next_line` reveals a line and returns it, so Ada\'s first reply to "next" is the line that just went up.',
      'Equations are read by rules first, then by a Gemini call capped at 8 s for brackets and mishearings. Putting up the same equation twice changes nothing.',
      'The safety net puts up an equation, picks a method, shows all, shows or hides the graph, or clears; never the next or previous line. It waits 7 s for spoken lines and 15 s for typed ones.',
      'Ada\'s face is on the front door. The board outlives the call, and lesson notes download at the end.',
    ],
    gaps={'schema':'E','filler':'H','narrated':'H','numbers':'H','checkin':'S','persona':'H','hints':'S'},
    notes=[
      ('H','Each line read as it went up','`put_up_equation`, `choose_method` and two `next_line` calls each carried the board in the first reply: "Sure thing, line one is up: x squared minus five x plus six equals zero."'),
      ('H','A typed line handled once','A typed "Hide the graph." called `hide_graph` in 1.1 s. In round 1 it took 26.9 s and the safety net hid it first.'),
      ('S','Speaks into the class\'s pause','"Just say the word whenever you\'re ready for the next line of working." The original\'s rule, "never speak unprompted", cannot be met.'),
      ('S','Misheard maths','"Hide the graph." arrived as "Hi DeGraff."'),
      ('H','A persona that fits the board','Round 1\'s host said "Executing request."; the new one greets "I\'m Ada, the voice of the Chalkline board…"'),
      ('H','Surds kept','Asked "what\'s that as a decimal?", Ada kept the exact surds.'),
    ],
    verdict='Fixed.',
    live='Round 2, on Ada\'s own host (118 s): one greeting in the new persona; put up, factoring, two lines and a typed "Hide the graph." each called once, in 1.1 to 4.2 s, with no doubled openers. Still seen: short fillers that contradict nothing, and the check-in after line 2.'),

  dict(id='trajectory-coach', name='Arcwise', host='Theo', group='Tutors', tests=286,
    tagline='A projectile range drawn to scale, and a coach who explains each miss in the range\'s own numbers.',
    purpose='Learn projectile motion by shooting. Theo puts up a target; aim by dragging the arrow, nudging the steppers or telling him ("forty degrees", "a bit more speed"), fire, and watch the shot fly. Six challenges, each built to disprove a piece of folklore about 45°, and a logbook of every lesson to keep.',
    built=[
      'The physics runs in the page, ported line for line; a golden test pins 273 graded shots to the Python engine\'s output. While a shot flies, nothing built from the range, neither the screen nor Theo\'s picture, has its result.',
      'Four `await` tools: `aim`, `fire`, `choose_challenge`, `start_over`. `fire` resolves when the ball is down, so Theo\'s first reply to "fire" is where it landed. After an aim from words, the result has him name the new angle once and forbids a prediction.',
      'Aims without a number go through the range\'s own steps ("a bit" is 3°); phrases the rules cannot read ("lob it like a mortar") go to a validated model call.',
      'The safety net fires, starts over or changes the challenge after 7 s. Aims are left out: "a bit steeper" done twice moves twice.',
      'Theo\'s face is on the front door; progress and the logbook outlive a call.',
    ],
    gaps={'schema':'E','filler':'H','narrated':'H','numbers':'H','checkin':'S','persona':'H','events':'E','hints':'H'},
    notes=[
      ('H','The landing in the first reply','"Fire!" said during the greeting called `fire`: "You were at 0.76 m going past 40 m, 2.24 m below the top."'),
      ('H','Narrated in round 1, called in round 2','Round 1\'s "Start over." got "I\'ve wiped the board clean" with no call, and the safety net did it. In round 2 it called `start_over`.'),
      ('H','The new angle, not a prediction','"Make it a bit steeper." got "I bumped you up to forty-eight degrees". Round 1 promised "way more arc to sail right over the wall!" before any shot; a softer one remains ("a slightly higher arc over the wall").'),
      ('S','Check-in while the student thinks','"Still there? Take the shot". The original nudged after 45 s.'),
      ('H','Misheard, still aimed','"Lob it like a mortar" arrived as "Lobbied like a mortar"; Theo passed "lobbed like a mortar" and the range aimed from it.'),
    ],
    verdict='Fixed.',
    live='Round 2, on Theo\'s own host (114 s): "Fire!" during the greeting, "Start over." and "Make it a bit steeper." each called their tool in 2.4 to 3.3 s; the safety net had nothing to do.'),

  dict(id='sky-guide', name='Lodestar', host='Mira', group='Tutors', tests=311,
    tagline='Tonight\'s sky from anywhere on Earth, with a guide who only says what the chart worked out.',
    purpose='A night-sky chart for any city and any night between 1900 and 2100: 135 naked-eye stars and 18 constellation figures. Ask Mira "where\'s Vega?", "show me Orion", "the sky from Lisbon at midnight" or "two hours later". What you looked at becomes your night\'s list, to download and take outside.',
    built=[
      'The sky runs in the page: it is public and the maths is pure, so the chart on screen, Mira\'s picture of it and every tool result come from one object.',
      'Four `await` tools: `point_out`, `show_constellation`, `move_chart`, `clear_chart`. Each result starts with its outcome ("Marked:", "Not up now:", "Moved:", "Not moved:"), with the rising time for a figure that is down.',
      'Mira passes the words she heard ("beetle juice", "two hours later"); rules over the catalogue\'s own names read them, and a Gemini call only reads what the rules cannot place.',
      'The safety net makes moves that are safe twice: a named place, an absolute time, a figure, a clear. Never a relative time or a star.',
      'Mira\'s face is on the front door; red light turns the whole app torch-red for dark-adapted eyes.',
    ],
    gaps={'schema':'E','filler':'S','narrated':'E','numbers':'E','checkin':'S','persona':'H','hints':'E'},
    notes=[
      ('S','A filler that sounds like a mishearing','"What does that mean, then? That would be Vega…" In round 1 a result came after "Could you repeat that?"'),
      ('S','A yes before a refusal','"Sure thing, ok though I don\'t have Kyoto listed directly." The chart\'s offer followed: Tokyo, or its latitude and longitude.'),
      ('E','Narration not seen','Every request called its tool once, 2.5 to 2.8 s after the words began; the safety net never fired.'),
      ('E','Facts only by instruction','Nothing gates Mira\'s memory; the catalogue\'s lines are on screen beside the chart.'),
      ('S','Check-in over the stargazing','One came 19 s after "Clear the chart". The original had no idle nudge at all.'),
    ],
    verdict='Fixed.',
    live='Round 2, on Mira\'s own host (122 s): one greeting, then straight to "Taipei around nine tonight"; Kyoto refused with Tokyo offered, Vega marked, Cygnus drawn, the clock moved to 11 pm.'),

  # ---------------- Advisors and tools ----------------
  dict(id='nutrition-advisor', name='Morsel', host='Rachel', group='Advisors and tools', tests=284,
    tagline='Name a food or add a photo: its nutrition label, a side-by-side table, and recipes talked through.',
    purpose='Ask Rachel about any food (say it, type it, or add a photo of the food or its label) and its label lands on your table: serving, calories, macros against a 2,000-calorie day, a 1 to 10 score and her plain-words takeaway. Foods stay side by side; a recipe is talked through two steps at a time. Notes to take home at the end.',
    built=[
      'The table runs on the server. Each card is the server\'s own model call, bounded at 14 s and marked as an estimate unless the user gave the portion; six common foods have built-in cards.',
      'Six `await` tools: `look_up_food`, `compare_foods`, `open_recipe`, `next_steps`, `close_recipe`, `start_over`. Her first reply to "what\'s in a banana?" carries the card\'s figures; `compare_foods` returns both rows.',
      'Photos are the app\'s, not a tool: the user adds one, the server reads it, and Rachel is told what was found. The camera is never opened.',
      'A safety line checks every line the user says or types: a possible emergency puts a notice at the top at once, and a question about their own health shows a note that it belongs with their doctor.',
      'The safety net looks up a food, goes back to the card or starts over; never next steps or a recipe. Rachel sits in a framed tile with her nameplate, and her face is on the front door.',
    ],
    gaps={'schema':'E','filler':'S','narrated':'E','numbers':'H','checkin':'E','persona':'H','events':'E','hints':'E','vision':'K'},
    notes=[
      ('S','A doubled filler','"Sure, I can, let me pull up the info for a banana for you right now!" was said twice before the card\'s 105 calories.'),
      ('H','Nothing beyond the card','Asked about potassium, Rachel said "potassium actually isn\'t listed with a specific number on this card", with no number. In round 1 she had added potassium, which is not on the label.'),
      ('H','Medical advice held','"I have diabetes…" called no tool: the health note appeared at once, and Rachel declined and offered the numbers.'),
      ('K','Cannot see the food','The original saw camera frames; here the app reads photos the user adds, with its own model.'),
      ('E','A photo\'s answer is late and paraphrased','It is told as an event, which waits for the floor.'),
    ],
    verdict='Fixed.',
    live='Round 2, on Rachel\'s own host (120 s): one greeting; "What\'s in a banana?" called `look_up_food` in 2.7 s with no safety net; potassium answered without a number. Still seen: the platform\'s doubled filler.'),

  dict(id='fashion-advisor', name='Notch', host='Emery', group='Advisors and tools', tests=171,
    tagline='A stylist on call: one photo of your outfit, a score for the occasion, the one fix, and pieces to finish it.',
    purpose='Tell Emery what you are dressing for (a job interview, a summer wedding, a first date) and share one photo: upload it, drag it onto the mirror, or borrow the example outfit. Notch scores it out of 10 for that occasion, says what works and the one fix, and hangs pieces on a rail with shop links. With an image model it puts a piece on your photo. The fitting ends with notes to download.',
    built=[
      'The fitting runs on the server: Gemini reads the photo, xAI renders try-ons. Each picture\'s verdict is kept per occasion and read at temperature 0, so "rate it again" gives the same score.',
      '`await` tools: `rate_outfit`, `suggest_pieces`, and with an image model `try_on` and `restore_photo`. Without an xAI key Emery is not given the try-on tools, and each piece on the rail is a swatch card with a shop link.',
      'A read that takes longer than the page\'s 20 s wait comes back "still working" and lands later as an event; a try-on (about 20 s) is always an event.',
      'The safety net re-rates and goes back to the user\'s own photo. Never more pieces or a try-on, which would grow the rail or pay for a render twice.',
      'Emery\'s face is on the front door ("Your stylist — Emery, ex-runway, styling on call") and in her frame while the call connects.',
    ],
    gaps={'schema':'E','filler':'E','narrated':'S','numbers':'E','checkin':'E','persona':'S','events':'S','hints':'E','vision':'K'},
    notes=[
      ('S','Requests narrated in round 1','The occasion, "Can you rate it again?" and "Make the pieces more streetwear" got no call, and Emery said "I\'m updating the rail…" The likely cause was strict schemas; in round 2 all three reached their tools.'),
      ('S','The same outfit, two scores','"Rate it again" on the same photo for the same occasion went from 7 to 5. The app now keeps each picture\'s verdict per occasion.'),
      ('S','The question asked twice','One greeting, but Emery\'s greeting and the opening both asked the occasion. An empty room now gets no opening.'),
      ('H','The example photo noticed','"I see the example outfit is up on the mirror now!", at once.'),
      ('S','A reply a turn late','The 7/10 verdict landed while "Rate it again" was being handled, so the lines interleaved.'),
      ('K','Cannot see the outfit','Emery knows the look only as Notch\'s verdict on one photo.'),
    ],
    verdict='Partly fixed.',
    live='Round 2, on Emery\'s own host, with no xAI key: one greeting; the occasion, "Rate it again." and "More streetwear." each called their tool in 3.2 to 4.0 s, none by the safety net; the fitting notes opened at hang-up. Since then: one score per picture and occasion, no opening in an empty room, swatch cards on the rail.'),

  dict(id='fitness-coach', name='Spotter', host='Sammy', group='Advisors and tools', tests=420,
    tagline='A workout built around your goal, level and limits, with a coach who stops when it is not safe.',
    purpose='Tell Sammy what you want to train, your level and anything to work around (twenty minutes, no kit, a sore knee). Spotter builds the plan, enforces every limit in code, and Sammy coaches your first move. Mention a condition no exercise swap makes safe (pregnancy, a cardiac history, recent surgery) and the workout pauses at once.',
    built=[
      'A step machine on the server (goal, level, plan, first move, coaching) is the one writer of the screen. The original\'s constraint engine checks every plan, from the model or built in.',
      'Six `await` tools: `set_goal`, `set_level`, `add_limits`, `start_move`, `start_over`, `stop_for_safety`. A tool that builds a plan waits up to 13 s for it, so Sammy\'s first reply is the plan on screen, or exactly what a limit changed.',
      'Safety-critical detection: the page reads every finished line itself, and a condition freezes the screen and the server\'s plan at once. `stop_for_safety` is the second path; if Sammy has not called it 4 s later, the page does and gives her the words. After that every tool and tap is refused.',
      'The safety net starts over, records a limit, sets a lone level or starts a plan move; goals are left out. The page also attaches the user\'s recent words to every `add_limits` call.',
      'Sammy\'s face is on the front door and fills her frame while the call connects.',
    ],
    gaps={'schema':'S','filler':'S','narrated':'S','numbers':'S','checkin':'E','persona':'H','mute':'K','hints':'E'},
    notes=[
      ('S','Calls lost to the schema','In round 1 "Beginner, please." never arrived, in 2 of 2 runs, while Sammy said "I\'ve set you up for a beginner glute plan". With lenient schemas every step reached its tool in round 2, in 2.9 to 4.9 s.'),
      ('S','A limit she added herself','"my left knee is bad, and I only have twenty minutes" reached `add_limits` as the knee only, while she said "Got your twenty-minute timer locked in". The page now attaches the user\'s own words to the call.'),
      ('S','Fillers before the safety lines','"Okay, gotcha," came before the stop sentence, and "Well, I don\'t agree, because…" before the plank refusal.'),
      ('H','The pause held','"I\'m seven months pregnant" called `stop_for_safety` in 4.9 s, the screen paused, and "Can we just do the plank anyway?" was refused.'),
      ('K','Nothing gates the host after a pause','Only her instructions and the state keep Sammy from naming an exercise; muting her would deafen the page too.'),
    ],
    verdict='Fixed.',
    live='Round 2, on Sammy\'s own host: every step reached its tool on the first try in 2.9 to 4.9 s; the plan was built, started and made harder by voice, and the safety stop paused the screen. Since then every limit goes in one call, and a rebuilt plan says the started move is gone.'),

  dict(id='market-desk', name='Outcry', host='Reese', group='Advisors and tools', tests=277,
    tagline='A live stock watchlist you build by talking, read by an analyst who never gives advice.',
    purpose='Name a company ("put Nvidia up") and Reese puts it on a six-slot board with its real last sale, today\'s move, the 52-week range and how old the print is. The stock on watch refreshes every minute, and Reese speaks up when it moves a point. Ask what to buy and he says it straight: "I read the tape, I don\'t give advice."',
    built=[
      'The feed runs on the server, Nasdaq first and Yahoo as the fallback: neither answers a browser, and the refresh timer and move announcer must keep running.',
      'Five `await` tools: `add_symbols`, `focus_symbol`, `refresh_quote`, `remove_symbols`, `clear_board`. The server acts, waits for the quote and returns it, so Reese\'s first reply to "add Nvidia" carries the real price, or why it did not go up.',
      'Names become tickers through the board, about 90 well-known names, written tickers, the app\'s own model call, then Nasdaq\'s symbol search. The no-advice rule is in the instructions; no tool hands out advice.',
      'The desk\'s own lines (a 1% move, a late quote) reach the page as server-sent events and go on to Reese as events: only the open page holds the call.',
      'The safety net clears, refreshes, drops, and focuses a stock already on the board; never an add. Reese\'s face is on the front door, and the closing sheet downloads as CSV.',
    ],
    gaps={'schema':'E','filler':'H','narrated':'H','numbers':'H','checkin':'E','persona':'H','events':'E','hints':'E','server':'K'},
    notes=[
      ('H','"Pull up Tesla." never called','Missed in 2 of 2 runs by voice. In round 1 Reese said "Tesla is front and centre now" with no call; in round 2 the safety net brought Tesla up and he spoke as if he had. The tool\'s description now opens with the user\'s words.'),
      ('H','The no-advice rule held','"Should I buy Nvidia?" got "I read the tape, I don\'t give investment advice." and a board fact, after a filler: "Let\'s examine the numbers, but…"'),
      ('H','Real moves in the first reply','"Put Nvidia and Tesla up" read both real moves in 3.5 s.'),
      ('K','Only the open page can answer','Tool calls and the desk\'s lines go through the page; a closed tab ends both.'),
      ('E','The desk\'s lines compete for the floor','A 1% move is dropped if the user keeps talking past its 30 s.'),
    ],
    verdict='Partly fixed.',
    live='Round 2, on Reese\'s own host (100 s): one greeting; two stocks added with their real moves; the advice refusal held; the closing sheet\'s time in English. "Pull up Tesla." was missed again and done by the safety net. Since then the net\'s note to Reese says plainly that the page did it.'),

  dict(id='travel-guide', name='Yonder', host='Lumi', group='Advisors and tools', tests=351,
    tagline='Dream up your next trip on a live map, with a friend who has been.',
    purpose='Name a country (or a city in one, or "you choose") and it lands on the map with its outline. Ask what to eat and three local dishes appear with their photos; ask what is worth seeing around a street or a square and the sights come one at a time, each with a photo, a line from Wikipedia, a distance and a maps link. The trip downloads as notes at the end.',
    built=[
      'The trip runs on the server: the open-data lookups need a User-Agent, a request-a-second throttle and, for the news, a key a browser cannot hold.',
      'Six `await` tools and one `notify`: `choose_destination`, `show_food`, `show_news` (only with a news key), `explore_near`, `next_sight`, `previous_sight`, `remember_name`. A tool still running 4 s before its timeout answers "still looking", and the outcome follows as an event.',
      'Sights come from Wikipedia first, ranked for a traveller (articles with a lead photo, landmarks over districts and stations), topped up from Overpass within a 14 s budget.',
      'Lumi\'s state never holds the next sight, or dishes and headlines before they are shown, so she has to call for them. The safety net does a named country, the food, the news and the sight moves.',
      'Lumi\'s face is on the front door, and her tile sits in the map\'s corner.',
    ],
    gaps={'schema':'E','filler':'H','narrated':'E','numbers':'H','checkin':'E','persona':'H','hints':'H'},
    notes=[
      ('H','Real sights, with photos','"What\'s worth seeing around Alfama in Lisbon?" put São Jorge Castle on screen, and "Another one, please" gave Lisbon Cathedral. Round 1 gave an obscure memorial with no photo.'),
      ('H','Fillers, harmless here','"Smart move," came before Portugal landed.'),
      ('H','Her own colour, never a sight','Lines such as "old wooden trams" are hers, never a sight, a dish or a distance.'),
      ('E','Slow lookups','The Wander reply still came about 20 s after the words.'),
      ('H','Misheard, then right','"Alfama" was first captioned "Alfa Min"; the final transcript and the tool\'s place were right.'),
    ],
    verdict='Fixed.',
    live='Round 2, on Lumi\'s own host (147 s): one greeting; Portugal, Alfama\'s sights and the next sight each called their tool, with photos; no safety-net catches. Since then each Overpass mirror gets only what is left of the 14 s budget (not yet run live).'),

  dict(id='room-planner', name='Planwright', host='Iris', group='Advisors and tools', tests=303,
    tagline='Plan a home by talking to an architect: rooms, walls, doors and furniture at real sizes.',
    purpose='Tell Iris roughly how big your place is and who lives there; she lays out a whole floor in seconds, and then you argue with it: trade area between rooms, knock two together, add a window and a bed, add an upstairs, save schemes and compare them, undo, and take the drawing sheet away. Dragging walls and furniture works by hand too.',
    built=[
      'The whole Python engine is ported and runs in the page: nothing about a plan is secret, and every drag is an instant local change. A refused change leaves the plan as it was.',
      '25 `await` tools, from `lay_out_floor` and `trade_area` to `add_furniture`, `save_scheme` and `draw_sheet`. Arguments are what Iris heard ("the second bedroom", "two square metres"), never coordinates. Results carry the plan\'s real numbers, or the reason a change will not work, in the client\'s unit.',
      'A refused piece\'s result carries the room\'s own numbers (its area, how much of it is clear), so there is nothing to estimate.',
      'The safety net switches units, shows a floor, stops comparing, draws the sheet or adds the upper floor. Never undo, a trade, a scheme, a layout or a clear: doubled, those are a second change.',
      'Photos are read by Gemini into kit pieces and rooms, never sizes. Iris\'s face is on the front door.',
    ],
    gaps={'schema':'E','filler':'S','narrated':'S','numbers':'S','checkin':'E','persona':'H','hints':'S','vision':'K'},
    notes=[
      ('S','A size before the refusal','"a grand piano takes up nearly four square metres… Shall I try squeezing it into the west corner?", then the plan\'s refusal. The tool now says to call first and say nothing about the piece until the result.'),
      ('S','An offer, not the action','A second "the drawing to keep" got "whenever you are ready" and no call.'),
      ('S','A misheard command','Spoken, "Add an upstairs." arrived as "At an upstairs" and got a question; typed, it called `add_upper_floor` in 1.0 s.'),
      ('H','Real numbers in the first reply','In round 1, eleven of twelve requests went through their tools with the plan\'s numbers ("eight point four… five point seven").'),
      ('K','Cannot see a photo','Iris can only say what the app\'s reader put in.'),
    ],
    verdict='Partly fixed.',
    live='Round 2, on Iris\'s own host (250 s): open plan as one 21.4 m² kitchen and living room; the piano reached `add_furniture` and the plan\'s refusal; an upstairs kept every ground-floor room. Since then: the piano rule, a repeat call for the sheet, and each floor remembering its arrangement (not yet run live).'),
]

CLASSIC = [
  ('Ledger Academy', 'Internal training', 'A trainer teaches a slide deck on its own, takes questions, then runs a two-question quiz.', 'A conductor drives the lecture; `show_slide` puts slides up; the quiz is one step run by `await` tools (`ask_quiz_question`, `grade_answer`), so the page owns the order and the score.'),
  ('Northwind Talent', 'Recruiter screening', 'A screening call on a fixed agenda, against a job card.', 'A conductor graph from greeting to wrap; a live agenda and screening notes filled by tools.'),
  ('Kin', 'Presence companion', 'A companion reacts to what is on your screen.', 'The app\'s own observer describes the screen (Gemini) and sends text; no tools.'),
  ('Isle of Whispers', 'Interactive story', 'An event-driven narrator; conversation opens only at the oracle\'s shrine.', 'The user is muted; each move is an event; the oracle\'s powers are app tools.'),
  ('Nightcap Live', 'Live stream host', 'A host reads a chatroom, pins lines and runs polls viewers vote in.', 'The user is muted; questions go in as typed turns, the rest as event digests; pins and polls are tools.'),
]

CLASSIC_GAPS = [
  'No audience in the room: one user token per session, no viewer tokens or egress, so a stream must re-broadcast the avatar.',
  'Sessions are capped by plan, and an avatar runs one session at a time.',
  'Mid-turn typed turns and commentary are refused, not queued; the apps hold them until the turn ends.',
  'No transcript, tool-call or session feed outside the room.',
  'The agenda (conductor) is set per avatar, not per session, and is not observable: the server puts each app\'s agenda back before its session.',
  'Before these apps used tools (live, 23 October), the recruiter ran every stage once, in order, and the lecture spoke its three slides with no user input. What went wrong followed from one rule: a step does not move until the user has heard a turn written under it. A Q&A step that said "if they have none, start the quiz" had the model invent a quiz question. The training app has since made the quiz one step run by tools, so the page owns the order and the score.',
  'The last step stays in force: the idle check-in said the farewell again 19 s after it ended.',
  'The check-in and the persona are the avatar\'s, as in the mini-apps.',
]

# (name, what, who, what the apps do meanwhile). The first one shipped.
ASKS = [
  ('App tools: shipped on 23 October, two follow-ups', 'The host calls the app and waits, so its first reply carries the app\'s outcome; every app now uses them. Still wanted: a call that fails its schema delivered to the page with the error (or a switch to turn validation off), and a per-tool switch for no filler, or the result\'s first sentence spoken verbatim.', 'all', 'Lenient schemas, normalised in the app; results that open with the outcome; a safety net that does repeatable actions after 7 s; the exact line on screen.'),
  ('Check-in control', 'Turn the ~10 s check-in off or lengthen it per session.', 'all', 'The instructions ask for silence. The originals waited 40 to 45 s, or never nudged (a planetarium, a workout).'),
  ('Per-session persona and greeting', 'One avatar plays the app\'s character, with a greeting and a system prompt per session.', 'all', 'Fourteen hosts, one per app, each built from its `avatar.json`; a persona change is a `PATCH` to the avatar. Openings never greet again.'),
  ('Speech hints', 'Per-session keyterms for the recogniser.', 'all', 'The host passes what it heard, and the apps\' readers accept the recogniser\'s variants ("Beetlejuice", "Raised to five.", "lobbed").'),
  ('Reconnect grace', 'A brief network blip does not end the session.', 'all', 'The kit publishes its silent track without DTX, which removed one cause; a real blip still ends the session as `user_left`.'),
  ('A faster, observable start', 'Shorter start-up, and a signal for when the user can see the host.', 'all', 'Starting took 15 to 46 s and the video came 3 to 95 s later. The host\'s portrait fills the frame while the call connects.'),
  ('Exact speech', 'Say this sentence word for word, with nothing in front.', 'bls-tutor fitness-coach quadratic-whiteboard trajectory-coach market-desk', 'The exact sentence is on screen as the source of truth: the red card, the pause card, the board\'s line, the range\'s sentence.'),
  ('Image input', 'Show the host a photo or a frame.', 'nutrition-advisor fashion-advisor room-planner', 'The app\'s own model reads the image and tells the host what it found.'),
  ('Listen while the host ignores', 'Keep user transcripts flowing while the host is muted.', 'bls-tutor fitness-coach', 'Not possible: muting deafens the app too. The classic story game mutes and accepts it.'),
  ('Server-side room messages', 'The app server answers tool calls and sends state and events without an open page.', 'market-desk', 'Everything goes through the open page; a closed tab ends both.'),
  ('Conductor documentation', 'Document how a step moves (it holds until the user has heard a turn under it; the last step stays in force), and allow an agenda per session.', 'classic', 'Checks on the asking step\'s edges, with an edge back to itself; the session ends after the last step; scores through a tool, not the transcript.'),
]

def chip(status, label=None):
    cls, name, tip = STATUS[status]
    return f'<span class="st st-{cls}" title="{html.escape(tip)}">{label or name}</span>'

app_by_id = {a['id']: a for a in APPS}
groups = []
for a in APPS:
    if a['group'] not in groups:
        groups.append(a['group'])

# counts per gap
def counts(key):
    c = {k: 0 for k in STATUS}
    for a in APPS:
        s = a['gaps'].get(key)
        if s:
            c[s] += 1
    return c

total_tests = sum(a['tests'] for a in APPS) + OTHER_TESTS

out = []
w = out.append
w('''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Mini-apps on the Avatar API</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,500..800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<style>
/* Layout: a test report. One reading column; the matrix and diagram break wider. Status chips carry the findings. */
:root {
  --bg: #f4f6f8;
  --surface: #ffffff;
  --ink: #17202b;
  --muted: #586473;
  --line: #d9dee6;
  --accent: #2443bd;
  --accent-soft: #e6ebfb;
  --seen: #b5400c; --seen-bg: #fde8dd;
  --held: #1d7349; --held-bg: #e0f2e8;
  --known: #5546ad; --known-bg: #ebe8f9;
  --expected: #5d6878;
  --display: "Archivo", "Helvetica Neue", Arial, sans-serif;
  --body: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0e131a; --surface: #151c26; --ink: #e5e9ef; --muted: #98a3b3; --line: #29333f;
    --accent: #93a6ff; --accent-soft: #1d2747;
    --seen: #ff9469; --seen-bg: #3a2016; --held: #62d29c; --held-bg: #13301f;
    --known: #b6a9ff; --known-bg: #262046; --expected: #98a3b3;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0e131a; --surface: #151c26; --ink: #e5e9ef; --muted: #98a3b3; --line: #29333f;
  --accent: #93a6ff; --accent-soft: #1d2747;
  --seen: #ff9469; --seen-bg: #3a2016; --held: #62d29c; --held-bg: #13301f;
  --known: #b6a9ff; --known-bg: #262046; --expected: #98a3b3;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 400 16px/1.6 var(--body);
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}
.wrap { max-width: 1120px; margin: 0 auto; padding-block: 48px 96px; display: grid; gap: 64px; }
.col { max-width: 720px; }
h1, h2, h3 { font-family: var(--display); font-stretch: 85%; line-height: 1.12; text-wrap: balance; margin: 0; letter-spacing: -0.01em; }
h1 { font-size: clamp(2.2rem, 5vw, 3.4rem); font-weight: 800; }
h2 { font-size: 1.75rem; font-weight: 750; }
h3 { font-size: 1.3rem; font-weight: 700; }
p { margin: 0; }
code { font-family: var(--mono); font-size: 0.86em; background: var(--accent-soft); color: var(--ink); padding: 0.05em 0.35em; border-radius: 3px; }
a { color: var(--accent); text-underline-offset: 3px; }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
.eyebrow { font: 500 0.75rem/1.2 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.lead { font-size: 1.15rem; color: var(--ink); max-width: 64ch; }
.muted { color: var(--muted); }
section { display: grid; gap: 20px; }
.stack { display: grid; gap: 12px; }

/* header */
header.top { display: grid; gap: 20px; }
.facts { display: flex; flex-wrap: wrap; gap: 10px 28px; margin: 0; padding: 0; list-style: none; }
.facts li { display: grid; gap: 2px; }
.facts b { font: 700 1.6rem/1 var(--display); font-stretch: 85%; font-variant-numeric: tabular-nums; }
.facts span { font-size: 0.85rem; color: var(--muted); }

/* status chips */
.st { display: inline-block; font: 500 0.72rem/1 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; padding: 4px 7px; border-radius: 3px; white-space: nowrap; border: 1px solid transparent; }
.st-seen { color: var(--seen); background: var(--seen-bg); }
.st-held { color: var(--held); background: var(--held-bg); }
.st-known { color: var(--known); background: var(--known-bg); }
.st-expected { color: var(--expected); border: 1px dashed var(--expected); background: transparent; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 0.88rem; color: var(--muted); }
.legend div { display: flex; gap: 8px; align-items: center; }

/* matrix */
.scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--line); background: var(--surface); border-radius: 6px; }
table { border-collapse: collapse; width: 100%; }
.matrix { min-width: 980px; font-size: 0.86rem; }
.matrix th, .matrix td { border-bottom: 1px solid var(--line); padding: 8px 6px; text-align: center; vertical-align: middle; }
.matrix thead th { font: 500 0.72rem/1.25 var(--mono); color: var(--muted); vertical-align: bottom; padding-top: 12px; }
.matrix thead th a { color: inherit; text-decoration: none; }
.matrix thead th a:hover { color: var(--accent); }
.matrix th.gap { text-align: left; font: 600 0.9rem/1.3 var(--body); min-width: 210px; padding-left: 14px; }
.matrix th.gap small { display: block; font-weight: 400; color: var(--muted); font-size: 0.78rem; margin-top: 2px; }
.matrix td.tally { text-align: left; white-space: nowrap; font: 500 0.78rem/1.4 var(--mono); color: var(--muted); padding-right: 14px; font-variant-numeric: tabular-nums; }
.matrix tbody tr:last-child th, .matrix tbody tr:last-child td { border-bottom: 0; }
.dot { display: inline-block; width: 22px; height: 22px; border-radius: 3px; vertical-align: middle; }
.dot.seen { background: var(--seen); }
.dot.held { background: var(--held); }
.dot.known { background: var(--known); }
.dot.expected { border: 1.5px dashed var(--expected); }

/* asks */
.asks { display: grid; gap: 0; border-top: 1px solid var(--line); }
.ask { display: grid; grid-template-columns: minmax(0, 15rem) minmax(0, 1fr); gap: 8px 28px; padding: 18px 0; border-bottom: 1px solid var(--line); }
.ask h3 { font-size: 1.1rem; }
.ask .rank { font: 500 0.75rem/1 var(--mono); color: var(--accent); display: block; margin-bottom: 6px; }
.ask .who { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tag { font: 500 0.72rem/1 var(--mono); padding: 4px 7px; border-radius: 3px; background: var(--accent-soft); color: var(--accent); text-decoration: none; }
.ask .today { color: var(--muted); font-size: 0.92rem; }
@media (max-width: 680px) { .ask { grid-template-columns: minmax(0, 1fr); } }

/* architecture */
.diagram { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; overflow-x: auto; }
.diagram svg { display: block; min-width: 760px; width: 100%; height: auto; }
svg .box { fill: var(--surface); stroke: var(--ink); stroke-width: 1.4; }
svg .box-accent { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1.4; }
svg .ext { fill: var(--bg); stroke: var(--line); stroke-width: 1.2; stroke-dasharray: 4 3; }
svg .t { fill: var(--ink); font: 600 14px var(--body); }
svg .s { fill: var(--muted); font: 400 11.5px var(--mono); }
svg .l { fill: var(--accent); font: 500 11px var(--mono); }
svg .arrow { stroke: var(--muted); stroke-width: 1.4; fill: none; }
svg .ah { fill: var(--muted); }
.rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.rule { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 16px 18px; display: grid; gap: 6px; align-content: start; }
.rule h3 { font-size: 1.05rem; }
.rule p { font-size: 0.93rem; color: var(--muted); }

/* app sections */
.toc { display: flex; flex-wrap: wrap; gap: 6px 8px; }
.toc a { font: 500 0.8rem/1 var(--mono); padding: 7px 9px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink); text-decoration: none; background: var(--surface); }
.toc a:hover { border-color: var(--accent); color: var(--accent); }
.group-head { display: flex; align-items: baseline; gap: 14px; border-bottom: 2px solid var(--ink); padding-bottom: 8px; }
.group-head .eyebrow { margin-left: auto; }
.app { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px 40px; padding: 28px 0 32px; border-bottom: 1px solid var(--line); scroll-margin-top: 16px; }
.app:last-child { border-bottom: 0; }
.app-head { grid-column: 1 / -1; display: grid; gap: 6px; }
.app-head .meta { display: flex; flex-wrap: wrap; gap: 6px 16px; font: 500 0.78rem/1.4 var(--mono); color: var(--muted); }
.tagline { font-style: italic; color: var(--muted); }
.app h4 { font: 500 0.75rem/1.2 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
.app ul { margin: 0; padding-left: 1.1em; display: grid; gap: 6px; }
.app li { padding-left: 2px; }
.app li::marker { color: var(--muted); }
.gaplist { list-style: none; padding: 0 !important; gap: 12px !important; }
.gaplist li { display: grid; grid-template-columns: 5.6rem minmax(0, 1fr); gap: 2px 12px; padding: 0; }
.gaplist .st { justify-self: start; margin-top: 3px; }
.gaplist b { font-weight: 600; }
.gaplist p { grid-column: 2; font-size: 0.92rem; color: var(--muted); }
.live { grid-column: 1 / -1; font-size: 0.93rem; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 12px 16px; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 14px; }
.live .eyebrow { padding-top: 3px; }
@media (max-width: 760px) {
  .app { grid-template-columns: minmax(0, 1fr); }
  .live { grid-template-columns: minmax(0, 1fr); }
}

/* classic */
.classic { min-width: 680px; font-size: 0.92rem; }
.classic th, .classic td { text-align: left; vertical-align: top; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.classic thead th { font: 500 0.72rem/1.2 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.classic td:first-child { font-weight: 600; white-space: nowrap; }
.classic tbody tr:last-child td { border-bottom: 0; }
.plain { margin: 0; padding-left: 1.1em; display: grid; gap: 8px; }
footer { font-size: 0.88rem; color: var(--muted); border-top: 1px solid var(--line); padding-top: 20px; display: grid; gap: 6px; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>
</head>
<body>
<div class="wrap">
''')

n_missing = len(ASKS) - 1  # the first ask, app tools, has shipped
w(f'''<header class="top">
  <p class="eyebrow">atmee-usecase-demos · branch feat/mini-apps · 23 October 2026</p>
  <h1>Mini-apps on the Avatar API</h1>
  <p class="lead">The fourteen in-call mini-apps from <code>Atmanity/apps</code>, rebuilt as products on the public Avatar API alone. Each has its own host, who acts through app tools, and each ran live on staging. This report says what each product is for, how it is built, and what the API still could not do for it. The five earlier sample apps are at the end.</p>
  <ul class="facts">
    <li><b>{len(APPS)}</b><span>products, each with its own host</span></li>
    <li><b>3</b><span>live rounds on staging</span></li>
    <li><b>{total_tests:,}</b><span>tests, all passing</span></li>
    <li><b>{n_missing}</b><span>API features still missing</span></li>
    <li><b>5</b><span>first apps, on <code>server.js</code></span></li>
  </ul>
</header>
''')

# --- summary: what's missing
w('''<section class="col" id="summary">
  <p class="eyebrow">Summary</p>
  <h2>What the API is missing</h2>
  <div class="stack">
    <p>Every app follows one rule: the app decides, the host performs. The app owns the rules, the facts and the screen. Its host acts through app tools: <code>POST /v1/session</code> takes <code>appTools</code>, the host calls a tool as an <code>atmee.tool</code> RPC to the page, and an <code>await</code> tool holds the reply until the page answers. <code>state</code> tells the host what is on screen; <code>event</code>s tell it what happened by hand.</p>
    <p>Tools fixed the central problem of the first port: the reply is grounded in what the app did. In round 2 requests became calls in 2.6 to 4.9 s, and the first reply carried the result: verdicts, clues, refusals with the legal options, the plan\'s own numbers. Each app now runs on its own host, built from its persona, with the host\'s face on the front door.</p>
    <p>What still goes wrong sits in the tools and around them. A call whose arguments miss the schema never reaches the page. The filler said while a tool runs is chosen before the result exists, so it can pre-judge it: "Yeah, good call, but…" before a Not-yet verdict. Some requests are narrated instead of called. Hosts add numbers of their own around a result. And the host still checks in after about 10 s of quiet, with no way to turn it off.</p>
    <p>The apps work around each one: lenient schemas, normalised in the app; results that open with the outcome; a safety net that does repeatable actions after 7 s; results that carry the facts the host would otherwise reach for; and the exact line on screen where it matters.</p>
  </div>
</section>
''')

w('<section id="asks"><div class="col stack"><p class="eyebrow">Ranked by how many apps need them</p><h2>The features each app needed</h2></div><div class="asks">')
for i, (name, what, who, today) in enumerate(ASKS, 1):
    ids = [a['id'] for a in APPS] if who in ('all', 'classic') else who.split()
    tags = ''.join(f'<a class="tag" href="#{i_}">{html.escape(app_by_id[i_]["name"])}</a>' for i_ in ids)
    if who == 'all':
        tags = f'<span class="tag">All {len(APPS)} apps</span>'
    elif who == 'classic':
        tags = '<a class="tag" href="#classic">The first five: Ledger Academy, Northwind Talent</a>'
    w(f'''<div class="ask">
  <div><span class="rank">{i:02d}</span><h3>{fmt(name)}</h3></div>
  <div class="stack" style="gap:6px"><p>{fmt(what)}</p><p class="today">Today: {fmt(today)}</p><div class="who">{tags}</div></div>
</div>''')
w('</div></section>')

# --- matrix
w('''<section id="matrix">
  <div class="col stack"><p class="eyebrow">Per app, from the two live rounds with tools</p><h2>Where each gap showed up</h2>
  <p class="muted">Rows are the gaps an app can run into; columns are the apps. A blank cell means the gap does not apply to that app.</p></div>
  <div class="legend">''')
for k in ['S', 'H', 'E', 'K']:
    cls, name, tip = STATUS[k]
    w(f'<div><span class="dot {cls}"></span><span><b style="color:var(--ink)">{name}</b>: {html.escape(tip.lower())}</span></div>')
w('</div><div class="scroll"><table class="matrix"><thead><tr><th class="gap"></th>')
for a in APPS:
    w(f'<th><a href="#{a["id"]}">{html.escape(a["name"]).replace(" ", "<br>")}</a></th>')
w('<th></th></tr></thead><tbody>')
for key, label, desc in GAPS:
    c = counts(key)
    w(f'<tr><th class="gap" scope="row">{html.escape(label)}<small>{html.escape(desc)}</small></th>')
    for a in APPS:
        s = a['gaps'].get(key)
        if s:
            cls, name, tip = STATUS[s]
            w(f'<td><span class="dot {cls}" role="img" aria-label="{name}" title="{html.escape(a["name"])}: {name}"></span></td>')
        else:
            w('<td></td>')
    parts = [f'{c[k]} {STATUS[k][1].lower()}' for k in ['S', 'H', 'E', 'K'] if c[k]]
    w(f'<td class="tally">{" · ".join(parts)}</td></tr>')
w('</tbody></table></div>')
w('''<div class="col"><p class="muted">Not in the grid because they hit every session alike: a network blip ends the session with no grace period; start-up took 15 to 46 s, with video 3 to 95 s later; a typed turn comes back as speech, and the kit drops the echo. Video artefacts also come and go on the hosts (orange 3-D letters and a changed backdrop on Theo, an eye-level close-up on Reese for a whole call); a repeat of both was framed normally, and the page cannot tell.</p></div>
</section>''')

# --- architecture
w('''<section id="architecture">
  <div class="col stack"><p class="eyebrow">How every app is built</p><h2>One server, one room kit, one shape per app</h2>
  <p>Every app is a page and a few server routes in one repository. Nothing uses Atmee internals: a server holding the API key, a page in the LiveKit room the API returns, the room\'s text streams, and the tool calls the host makes into the page.</p></div>
  <div class="diagram">
  <svg viewBox="0 0 980 330" role="img" aria-labelledby="dg-t">
    <title id="dg-t">The page joins the host's room, answers its tool calls and talks to the app server; the app server starts sessions with the app's tools through the Avatar API and calls outside services.</title>
    <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>
    <rect class="box-accent" x="20" y="40" width="260" height="130" rx="6"/>
    <text class="t" x="40" y="70">The page (browser)</text>
    <text class="s" x="40" y="94">app panel: board, map, chart…</text>
    <text class="s" x="40" y="114">kit: useAvatar, useToolNet, parts</text>
    <text class="s" x="40" y="134">judge: safety net, safety lines</text>
    <text class="s" x="40" y="154">director: tools · state · event</text>
    <rect class="box" x="400" y="40" width="200" height="130" rx="6"/>
    <text class="t" x="420" y="70">LiveKit room</text>
    <text class="s" x="420" y="94">one per session</text>
    <text class="s" x="420" y="114">the page is the user</text>
    <text class="s" x="420" y="134">mic, or a silent track</text>
    <rect class="box" x="720" y="40" width="240" height="130" rx="6"/>
    <text class="t" x="740" y="70">The host</text>
    <text class="s" x="740" y="94">one avatar per app</text>
    <text class="s" x="740" y="114">calls the app's tools, waits</text>
    <text class="s" x="740" y="134">reads state and events</text>
    <path class="arrow" d="M282 72 H398" marker-end="url(#ah)"/>
    <text class="l" x="292" y="64">atmee.app</text>
    <path class="arrow" d="M282 98 H398" marker-end="url(#ah)"/>
    <text class="l" x="292" y="90">lk.chat typed</text>
    <path class="arrow" d="M398 124 H282" marker-end="url(#ah)"/>
    <text class="l" x="292" y="116">atmee.tool calls</text>
    <path class="arrow" d="M398 150 H282" marker-end="url(#ah)"/>
    <text class="l" x="292" y="164">lk.transcription</text>
    <path class="arrow" d="M602 105 H718" marker-end="url(#ah)" marker-start="url(#ah)"/>
    <text class="l" x="616" y="96">voice, video</text>
    <rect class="box-accent" x="20" y="230" width="260" height="80" rx="6"/>
    <text class="t" x="40" y="258">App server (Express)</text>
    <text class="s" x="40" y="280">holds the API key; app routes</text>
    <text class="s" x="40" y="298">secrets, engines, model calls</text>
    <path class="arrow" d="M150 172 V228" marker-end="url(#ah)" marker-start="url(#ah)"/>
    <text class="l" x="160" y="204">/api/apps/&lt;id&gt;/…</text>
    <rect class="box" x="400" y="230" width="200" height="80" rx="6"/>
    <text class="t" x="420" y="258">Avatar API</text>
    <text class="s" x="420" y="280">session + appTools</text>
    <text class="s" x="420" y="298">conductor per avatar</text>
    <path class="arrow" d="M282 270 H398" marker-end="url(#ah)"/>
    <text class="l" x="292" y="262">POST /v1/session</text>
    <path class="arrow" d="M500 228 V172" marker-end="url(#ah)"/>
    <text class="l" x="508" y="204">room + user token</text>
    <rect class="ext" x="720" y="230" width="240" height="80" rx="6"/>
    <text class="t" x="740" y="258">Outside services</text>
    <text class="s" x="740" y="280">Gemini, Nasdaq, Yahoo, OSM,</text>
    <text class="s" x="740" y="298">Wikipedia, xAI (optional)</text>
    <path class="arrow" d="M282 300 C 480 330, 600 330, 718 292" marker-end="url(#ah)"/>
  </svg>
  </div>
  <div class="rules">
    <div class="rule"><h3>The app decides</h3><p>Rules, scores, facts and plans live in the app\'s engine, ported from the Python originals with their tests. Secrets (the city, hidden cards, the next line of working, an unearned stroke) stay on the server; the page sees a masked view.</p></div>
    <div class="rule"><h3>The host acts through tools</h3><p>Up to 30 tools and 4,000 characters of instructions per session. An <code>await</code> tool holds the reply for the page\'s answer (1 to 28 s). Results open with the outcome ("Done:", "Refused:", "Not yet:"); schemas are lenient and the app normalises what it gets. <code>state</code> (up to 3,858 characters) is what is on screen.</p></div>
    <div class="rule"><h3>Three ways in</h3><p>Buttons act at once, and the host is told by an event. Spoken and typed lines go to the host, which calls the tools. For actions safe to repeat, a safety net (<code>useToolNet</code>) acts after 7 s if the host only talked about it.</p></div>
    <div class="rule"><h3>Proven live</h3><p>A test harness feeds the room a synthetic microphone from spoken WAV files. Every app ran in three rounds: before tools, with tools, and after the fixes on its own host. Each README records its runs.</p></div>
  </div>
</section>
''')

# --- apps
w('<section id="apps"><div class="col stack"><p class="eyebrow">The fourteen products</p><h2>App by app</h2></div><nav class="toc" aria-label="Apps">')
for a in APPS:
    w(f'<a href="#{a["id"]}">{html.escape(a["name"])}</a>')
w('</nav>')
for g in groups:
    members = [a for a in APPS if a['group'] == g]
    w(f'<div><div class="group-head"><h2>{html.escape(g)}</h2><span class="eyebrow">{len(members)} apps</span></div>')
    for a in members:
        w(f'<article class="app" id="{a["id"]}">')
        w(f'''<div class="app-head"><h3>{html.escape(a["name"])}</h3><p class="tagline">{fmt(a["tagline"])}</p>
<div class="meta"><span>apps/{a["id"]}/</span><span>Host: {html.escape(a["host"])}</span><span>{a["tests"]} tests</span></div></div>''')
        w('<div class="stack">')
        w(f'<div><h4>What it is for</h4><p>{fmt(a["purpose"])}</p></div>')
        w('<div><h4>How it is built</h4><ul>' + ''.join(f'<li>{fmt(b)}</li>' for b in a['built']) + '</ul></div>')
        w('</div>')
        w('<div><h4>What the API missed</h4><ul class="gaplist">')
        for s, title, ev in a['notes']:
            w(f'<li>{chip(s)}<b>{fmt(title)}</b><p>{fmt(ev)}</p></li>')
        w('</ul></div>')
        w(f'<div class="live"><span class="eyebrow">Round 2</span><p><b>{fmt(a["verdict"])}</b> {fmt(a["live"])}</p></div>')
        w('</article>')
    w('</div>')
w('</section>')

# --- classic
w('<section id="classic"><div class="col stack"><p class="eyebrow">Built first, on 22 October</p><h2>The first five apps</h2><p>Five branded sample apps built straight on the API with one small Node server, before the mini-app port. Their code is where it has always been: pages in <code>public/</code>, behaviour in <code>usecases/index.js</code>, the server in <code>server.js</code>, a README for each in <code>apps/&lt;app&gt;/</code>. They run with <code>npm start</code>.</p></div>')
w('<div class="scroll"><table class="classic"><thead><tr><th>App</th><th>Use case</th><th>What it does</th><th>How it is built</th></tr></thead><tbody>')
for name, use, what, how in CLASSIC:
    w(f'<tr><td>{html.escape(name)}</td><td>{html.escape(use)}</td><td>{fmt(what)}</td><td>{fmt(how)}</td></tr>')
w('</tbody></table></div>')
w('<div class="col stack"><h3>What they found missing</h3><ul class="plain">' + ''.join(f'<li>{fmt(x)}</li>' for x in CLASSIC_GAPS) + '</ul></div></section>')

w('''<footer>
  <p>Sources: each app\'s <code>README.md</code> (its live runs and its gaps), <code>docs/API-GAPS.md</code>, <code>docs/PORTING.md</code> and the five apps' READMEs in <code>atmee-usecase-demos</code>, branch <code>feat/mini-apps</code>.</p>
  <p>Live runs: staging Causeur sessions on 23 October 2026, spoken through a synthetic microphone, in three rounds: before the apps used tools, with tools, and after the fixes (round 2), each app on its own host. Statuses come from the two rounds with tools; "expected" means not observed, not ruled out.</p>
</footer>
</div>
</body>
</html>
''')

open(OUT, 'w').write('\n'.join(out))
print('wrote', OUT)
