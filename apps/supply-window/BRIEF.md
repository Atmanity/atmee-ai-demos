# Requisition: Silo 18's supply window, with Hester behind the counter

User and job:   a visitor to the Atmee demo site steps up to Supply in Silo 18 as a
                resident who needs something (a pump gasket, a bulb, thread for a
                coverall). They leave with a requisition slip, stamped or refused,
                on screen, with the chits it cost.
Flow:           front door (what Supply is, voice or typing) -> Hester greets ->
                the visitor asks for an item -> she checks the shelves -> she asks
                department and reason -> she stamps the slip, or refuses it with a
                reason -> another request, or "close the window" (hang up).
                Free conversation, no agenda: the tools drive the page.
Avatar:         a new, original character. Hester Pell, Silo 18's supply manager
                for 22 years: dry, gruff and fair, knows the ledger down to the
                bolt; nothing leaves without a slip, a department and a reason,
                paid in chits, never favours. Greeting: "Supply. Name, department,
                and what you're after. And don't tell me it's urgent; everything
                down here is urgent." English. Guardrails: stays in Silo 18 (modern
                or real-world questions answered in character, never mentions a
                show or book); goes quiet and changes the subject at talk of the
                outside; never promises or prices stock she has not checked; if
                sincerely asked whether she is an AI, says yes briefly and carries
                on; one to three short spoken sentences.
Tools:          | name          | mode   | when Hester calls it                         | what the page does or returns |
                | check_shelves | await  | the visitor names an item or asks if it's in | highlights the ledger row; "In stock: 2 pump gaskets, 12 chits each, shelf C-4…" / "Out: … substitute …" / "Not a Supply item" |
                | stamp_slip    | await  | she agrees to issue it (item, qty, dept, why) | the store's rules decide; "Stamped: slip 18-0417 …" fills and stamps the slip, takes the chits, lowers the count; or "Not stamped: …" with the reason |
                | refuse_slip   | notify | she turns a request down on her own judgement | shows a REFUSED slip with her reason |
Screen vs speech: the page is the truth for the stores ledger (counts, prices,
                restrictions), the visitor's chits, and every slip (stamped or
                refused). Hester only says them.
App to avatar:  state = the visitor's chits, the slips so far and the catalogue
                (names only, no counts); the opening event after her greeting
                ("you have just greeted them…"); an event when a slip lands.
Transcript:     the chat panel (kit ChatPanel), with the visitor's own words;
                captions over the video off by default.
Sessions:       one per visitor, one avatar (one visitor at a time: a second gets
                the "busy" screen); 10-minute cap; the demo site's key pays.
Limits:         - one live session per avatar: accepted gap, as for every demo app.
                - 10-minute cap (plan allows 45): accepted; the kit shows the end.
                - the ~10 s check-in: fits Hester ("Well? I haven't got all shift.").
                - persona fixed per avatar: Hester is purpose-built, so it is right.
                - tools narrated, not called: no safety net (a stamp has a cost if
                  doubled); strong instructions, and the README records what the
                  live run saw.
                - strict schemas drop calls: lenient schemas, the engine
                  normalises item names, departments and quantities.
                - mid-turn typed messages: handled by the kit's ChatPanel.
                - cold start 503: the kit's "connecting" screen.
                - the name "Silo 18" borrows a published world: fine on the
                  password-gated demo site; check before linking it publicly.
Live test:      typed, on staging: "Do you have a pump gasket?" -> check_shelves,
                the row lights; "Hydroponics, the drip pump is leaking" ->
                stamp_slip, slip stamped, chits 30 -> 18, count 2 -> 1; "A
                40-watt bulb too" -> check_shelves -> out, a 25-watt offered;
                "Something to help me go outside" -> refusal (refuse_slip or a
                "Not stamped"); hang up -> session ended by the user.
Deploy:         the demo site (Atmanity/atmee-ai-demos), behind its DEMO_PASSWORD,
                on its one sessions key; ships with the site's next release after
                the PR merges.

Defaults accepted on the creator's behalf ("decide everything"): app name
Requisition, id supply-window, 30 starting chits, the ledger's items and rules,
the three tools, no safety net, 10-minute sessions, chat panel over captions.
