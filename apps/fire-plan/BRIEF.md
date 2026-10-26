# Station 12 Fire Plan: build your family's home escape plan with Captain Reyes

User and job:   A parent and kids at home on a laptop or tablet. In one call they
                leave with a printed one-page home fire escape plan.
Flow:           Landing (family name, home type) -> "Call Captain Reyes" -> agenda:
                1 Meet the family   - ends when he knows who lives there and the home layout
                2 Two ways out      - ends when every bedroom and living space has 2 exits named
                3 Meeting spot      - ends when a safe outdoor spot is agreed
                4 Smoke alarms      - ends when alarm locations are named and a monthly test is agreed
                5 Practise 911      - ends when a child has rehearsed the call (name, address, "fire")
                6 Review            - ends when the family confirms the plan
                -> done moment: plan card complete -> Print / PDF -> call ends
Avatar:         Captain Jake Reyes (83fcbd7d-2718-4730-9f66-1041afd5d94b, en). Warm, casual,
                20-year captain at Station 12. Greeting unchanged. What prompt retuned:
                mission = build this family's escape plan step by step, writing it down
                with the tools. Guardrails unchanged (live emergency -> leave and call 911;
                no medical advice; nothing on starting fires or disabling alarms;
                family-friendly).
Tools:          | name | mode | when | page does |
                | mark_step(n) | notify | moving to agenda step n | highlights step n |
                | add_room(room, exit_1, exit_2) | notify | a room's exits are agreed | adds a plan row |
                | set_meeting_spot(place) | notify | spot agreed | fills the meeting spot |
                | log_smoke_alarm(location, tested) | notify | an alarm is named | adds to the checklist |
                | finish_plan() | notify | family confirms the plan | locks the card, shows Print |
Screen vs speech: The plan card is the truth: rooms with 2 exits, meeting spot, alarms,
                911 script, step tracker, and a fixed "Fire now? Leave and call 911" bar.
App to avatar:  state = the current plan card (after every change); notes at start =
                family name, home type, kids' ages; event = "family edited <field>"
                on a hand edit.
Transcript:     Chat panel, both sides, with a type box. The page scans the user's words
                for emergency phrases -> full-screen 911 alert.
Sessions:       One family per call, one avatar, cap 45 min (2,700 s) with countdown;
                billed to the account at 1 credit/min.
Limits:         45 min cap -> countdown, plan stays after the end · one live session per
                avatar -> one family at a time (accepted) · ~10 s check-ins (accepted) ·
                persona per avatar -> retune changes him everywhere (accepted) · agenda
                blind to tools -> mark_step drives the tracker · typed line mid-turn ->
                held · mute hides user words -> "He can't hear you" · reconnect ends the
                call -> "Start again" keeps the plan · cold start 503 -> "Connecting to
                Station 12..." with retry · no server feed -> the page builds plan and PDF.
Live test:      Typed run, family of 3 in a 2-bed flat: greeting -> mark_step 1..6 ->
                add_room x3 -> set_meeting_spot -> log_smoke_alarm x2 -> finish_plan ->
                print view shows the plan; "my kitchen is on fire" -> 911 alert; end the
                call -> reason user_ended.
Deploy:         apps/fire-plan in atmee-usecase-demos, localhost:3333. Staging key:
                sessions + avatars:write, limited to Captain Reyes, 100-credit cap,
                no sign-in (localhost only).

Defaults accepted: phrase-list emergency detection; browser print for the PDF; nothing
stored server-side; English only.
