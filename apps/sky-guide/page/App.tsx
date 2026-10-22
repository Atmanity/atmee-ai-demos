// Sky Guide: the avatar is the guide standing next to you; the chart (one
// SkyChart, in this page) decides what is up. The page draws the chart, keeps
// the avatar's state in step with it, judges every typed and spoken request
// against the catalogue's own names, and passes on what happened as events.
import { useEffect, useRef, useState } from "react";
import { AvatarStage, Composer, Transcript, useAvatar } from "../../../src/kit/index.ts";
import { SkyChart } from "../engine/chart.ts";
import { NOTES, say, skyState } from "../engine/director.ts";
import { act, type Outcome } from "../engine/guide.ts";
import { parse } from "../engine/judge.ts";
import { Narrator } from "../engine/narrator.ts";
import type { Intent, SkyView } from "../engine/types.ts";
import { SkyGuide } from "./SkyGuide.tsx";
import "./sky.css";

const API = "/api/apps/sky-guide";

/** The model's reading of a command the rules could not place, or null when
 *  there is no model (the rules' own fallback then stands). */
async function interpret(text: string): Promise<Intent[] | null> {
  try {
    const res = await fetch(`${API}/interpret`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) return null;
    const body = (await res.json()) as { model: boolean; intents: Intent[] };
    return body.model ? body.intents : null;
  } catch {
    return null;
  }
}

/** ?place=Lisbon starts the chart there (the original's appParams.place). */
const startingPlace = () => new URLSearchParams(location.search).get("place") || "Taipei";

export function App() {
  const chart = useRef<SkyChart | null>(null);
  chart.current ??= new SkyChart({ place: startingPlace() });
  const [view, setView] = useState<SkyView>(() => chart.current!.view());
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const avatar = useAvatar("sky-guide", {
    // The avatar hears the user too and has already started its reply; the
    // chart's answer follows as an event when the state could not stage it.
    onUserSaid: (text, how) => { if (how === "spoken") void request(text, "spoken"); },
    // The opening names the place and hour the chart shows when the guide arrives.
    onLive: () => avatar.event(say.start(viewRef.current), 60),
    onEnded: () => narrator.current?.cancel(),
  });
  const live = avatar.phase === "live";
  const liveRef = useRef(live);
  liveRef.current = live;

  // The guide's line about a change made with the chart's own controls,
  // coalesced so a drag across the night is one line, not twenty.
  const narrator = useRef<Narrator | null>(null);
  narrator.current ??= new Narrator((line) => { if (liveRef.current) avatar.event(line, 20); });
  useEffect(() => () => narrator.current?.cancel(), []);

  const show = (outcome: Outcome) => {
    setView(outcome.view);
    setMessage(outcome.refusals.join(" "));
  };

  /** A button, a tap, the picker or the slider. */
  const control = (intent: Intent) => {
    const outcome = act(chart.current!, [intent], "control");
    show(outcome);
    if (outcome.event && liveRef.current) avatar.event(outcome.event, 20);
    if (outcome.narrate) narrator.current!.changed(outcome.before, outcome.view);
  };

  /** A typed or spoken line: judged by rules over the catalogue's names; a
   *  model only for a command naming something the rules cannot place.
   *  Returns whether it asked anything of the chart. */
  async function request(text: string, how: "typed" | "spoken"): Promise<boolean> {
    const sky = chart.current!;
    const parsed = parse(text, { lon: sky.lon });
    if (!parsed) return false;
    let { intents, exact } = parsed;
    if (parsed.unresolved) {
      setPending(true);
      const model = await interpret(text);
      setPending(false);
      // The model saw the whole request, so its reading replaces the rules';
      // without one, the rules' fallback is refused by name by the chart.
      if (model) [intents, exact] = [model.length ? model : intents, false];
      else intents = [...intents, parsed.unresolved.fallback];
      if (!intents.length) return false;
    }
    narrator.current!.flush();
    const outcome = act(sky, intents, how, { exact });
    show(outcome);
    // The state first, so the event is read against the chart it talks about.
    avatar.state(skyState(outcome.view));
    if (outcome.event) avatar.event(outcome.event, 30);
    return true;
  }

  // Notes once, while the avatar is on its way (the kit delivers them on arrival).
  useEffect(() => {
    if (avatar.phase !== "starting") return;
    for (const note of NOTES) avatar.note(note);
  }, [avatar.phase]);

  // The avatar's picture of the chart follows the chart; a drag is sent once it settles.
  useEffect(() => {
    const id = setTimeout(() => avatar.state(skyState(view)), 250);
    return () => clearTimeout(id);
  }, [view]);

  // A typed line is judged first; only what isn't a chart request goes to the avatar.
  const onTyped = (text: string) => {
    void request(text, "typed").then((handled) => (handled ? avatar.record(text) : avatar.say(text)));
  };

  return (
    <div className="kit-layout">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar} name="Your guide" startLabel="Start the guide"
          lobby={<><div className="kit-title">Sky Guide</div><div className="kit-detail">Tonight's sky on the right, from anywhere, at any hour. Tap a star or ask about it; ask to see a constellation, another city or another hour.</div></>}
        />
        <Composer avatar={avatar} placeholder='Try "show me Orion" or "the sky from Lisbon"…' onSubmit={(t) => { onTyped(t); }} />
        <Transcript avatar={avatar} names={{ avatar: "Guide" }} />
      </div>
      <SkyGuide view={view} message={message} pending={pending} onIntent={control} />
    </div>
  );
}
