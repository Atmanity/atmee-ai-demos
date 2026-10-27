# Requisition

Silo 18's supply window. Step up to the counter as a resident who needs something (a pump
gasket, a bulb, thread for a coverall) and ask Hester Pell, the supply manager, for it. She
checks the shelves, asks for your department and what it's for, and stamps your slip, or
refuses it with the reason written on it. You have 30 chits.

Open it at `/apps/supply-window/`.

## How it works

| Part | Where |
|---|---|
| The stores: the ledger, item matching, the rules a slip must pass | `engine/stores.ts`, in the page: nothing is secret, the whole ledger is on screen. Each visit gets its own copy. Spoken names find their row ("forty-watt bulbs", "a rubber ring for the pump"); a wattage or a part number tells rows apart, a plain quantity does not. |
| Hester's actions | `engine/director.ts`: `check_shelves` (await) and `stamp_slip` (await) are answered by the stores; `refuse_slip` (notify) is her own call. Every result leads with its outcome: "In stock", "Out", "Not yet", "Stamped", "Not stamped", "Refused". |
| The rules | A slip needs an item, a department and a reason. Some stock goes only to certain departments, some is out (with a stand-in offered), there are per-slip limits and the chits must cover it. Anything for going outside is refused. The same stamp twice within 45 s is treated as her repeating herself, not a second slip. |
| What Hester sees | `state`: the visitor's chits, the slips so far, the ledger's item names (never counts or prices, so she checks the shelves and the row lights up). |
| The screen | A photograph of the Supply window (`host/scene.jpg`, generated): caged shelving, amber lamps, a steel counter with an old CRT on it. Hester's call plays on the CRT's glass, its box measured from the photo, under scanlines, an RGB mask, grain, a rolling refresh bar, a power-on flash, an occasional jump and a phosphor glow while she speaks (CSS over the video: nothing re-renders the stream). The slip lies on the counter; the ledger is a green-phosphor terminal; the conversation is an intercom log. The stage is fixed on wide screens, so a long conversation scrolls inside its panel and never moves the room. On a phone the view closes in on the monitor and the slip comes off the counter below it. |
| The host | `avatar.json`: Hester Pell, an original character, purpose-built for this window (`8fe47d8e`). |

No safety net (`useToolNet`): a stamp costs chits if doubled.

## What the API could not do

1. **The persona's greeting is not spoken.** *Seen.* Hester opens with her
   self-introduction. A typed first question that lands during it is answered
   right after it, one turn late.
2. **The opening event doubled her greeting.** *Seen,* in the first live run: an
   opening `event` made her speak a second line after her introduction, and every
   reply fell a turn behind. The page now says nothing at the start.
3. **A stamp narrated without the call.** *Expected,* not seen: in both runs every
   "here's your slip" came with a `stamp_slip` call and a slip on screen.
4. **One visitor at a time**: one live session per avatar.

## Tested

- `npx vitest run apps/supply-window`: item matching with recogniser variants, departments
  (the word "it" is not IT), quantities, every stamp outcome, the repeat guard, the outside
  refusal, tools and instructions against the API limits, and the page answering each tool.
- Live on staging, 2026-10-27, typed, two runs (avatar `8fe47d8e`), live 17 s after the
  click: "Got any pump gaskets?" → `check_shelves` ("We have got two pump gaskets sitting on
  shelf C-4 for twelve chits each"); "Hydroponics. One, please: the drip pump…" →
  `stamp_slip`, slip 18-0417 stamped, chits 30 → 18, shelf 2 → 1 ("Here is your stamped
  slip"); "a forty-watt bulb for my reading lamp" → out, the 25-watt offered on A-1 for
  three chits; "anything that would help me go outside?" → "We don't talk about that here,
  and there's nothing on my shelves for any such thing." Hanging up ended the call.
