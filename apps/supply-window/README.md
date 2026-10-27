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
| The screen | `page/Scene.tsx` draws the Supply window (shelving, the caged hatch, the work lamp, the counter). Hester's call plays on a wall CRT, laid onto its tilted glass in perspective, with scanlines, an RGB mask, a vignette and a flicker over the picture (CSS only, no re-render of the stream). The slip lies on the counter; the ledger is a green-phosphor terminal; the conversation is the kit's chat panel. |
| The host | `avatar.json`: Hester Pell, an original character, purpose-built for this window (`8fe47d8e`). |

No safety net (`useToolNet`): a stamp costs chits if doubled.

## What the API could not do

Expected, not yet observed live:

1. **A stamp narrated without the call.** Hester may say "here you go" without calling
   `stamp_slip`; the instructions forbid it and the screen shows no slip, but nothing forces it.
2. **The ~10 s check-in** speaks up while the visitor reads the ledger. It suits her.
3. **One visitor at a time**: one live session per avatar.

## Tested

- `npx vitest run apps/supply-window`: item matching with recogniser variants, departments
  (the word "it" is not IT), quantities, every stamp outcome, the repeat guard, the outside
  refusal, tools and instructions against the API limits, and the page answering each tool.
- Not yet run live on staging: the brief's live test (`BRIEF.md`) is owed.
