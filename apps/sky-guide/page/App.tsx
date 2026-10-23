// Lodestar: a night-sky chart for anywhere on Earth, with Mira, a stargazing
// guide. Mira calls the chart's tools (point out a star, draw a figure, move
// the place or the clock) and speaks from what the chart computed; the page
// answers those calls (the chart runs here: the sky is public and the maths
// is pure), keeps Mira's picture of the chart current, and tells her about
// what the user does with the chart's own controls.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useToolNet, type ToolCall } from '../../../src/kit/index.ts';
import { isToolName, runTool, type Notice } from '../engine/actions.ts';
import { SkyChart } from '../engine/chart.ts';
import { figureName, said, skyState, told } from '../engine/director.ts';
import { apply } from '../engine/guide.ts';
import { whenUp } from '../engine/later.ts';
import { Narrator } from '../engine/narrator.ts';
import { mustDo } from '../engine/net.ts';
import { remember, seenFigure, seenStar, type NightEntry } from '../engine/night.ts';
import type { Intent, SkyView } from '../engine/types.ts';
import { Dome, NightStrip, NoticeBar, Side, SkyHeader } from './Chart.tsx';
import { Lobby, Logo } from './Lobby.tsx';
import { NightCard } from './NightCard.tsx';
import portrait from '../host/portrait.jpg';
import { NIGHT, RED } from './SkyDome.tsx';
import { browserPlace, useRedLight } from './start.ts';
import './lodestar.css';

const API = '/api/apps/sky-guide';
export const HOST = 'Mira';

/** A model's reading of words the rules could not place, or null without one. */
async function interpret(text: string): Promise<Intent[] | null> {
  try {
    const res = await fetch(`${API}/interpret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) return null;
    const body = (await res.json()) as { model: boolean; intents: Intent[] };
    return body.model ? body.intents : null;
  } catch {
    return null;
  }
}

/** What the user did with a control, for the host: "pressed Orion". */
function didWith(intent: Intent, view: SkyView): string {
  switch (intent.kind) {
    case 'select': return `tapped ${view.snapshot.visible.find((v) => v.id === intent.star)?.name ?? 'a star'}`;
    case 'show_constellation': return `pressed ${figureName(intent.name)}`;
    case 'set_place': return intent.label ? `picked ${intent.label}` : 'typed in coordinates';
    case 'set_time': return 'moved the clock';
    default: return 'used a control';
  }
}

const LampIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 3h10l-2 6H9z" /><path d="M9 9v10a3 3 0 0 0 6 0V9" /><path d="M12 13v3" />
  </svg>
);

export function App() {
  const chart = useRef<SkyChart | null>(null);
  chart.current ??= new SkyChart({ place: browserPlace() });
  const [view, setView] = useState<SkyView>(() => chart.current!.view());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [night, setNight] = useState<NightEntry[]>([]);
  const [tab, setTab] = useState<'star' | 'night'>('star');
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(false);
  const [red, setRed] = useRedLight();
  const viewRef = useRef(view);
  viewRef.current = view;

  // Which call the page is serving: bumped when a call goes live and when it
  // stops, so work started for one call (a model reading of a name) is dropped
  // if it answers after that call is over or another has begun.
  const callGen = useRef(0);

  // The line about a change made with the chart's own controls, coalesced so a
  // drag across the night is one line, not twenty. Only for changes made during
  // the call, and cancelled when it ends: the next call opens on the chart as it is.
  const narrator = useRef<Narrator | null>(null);
  narrator.current ??= new Narrator((line) => { if (avatarRef.current?.phase === 'live') avatarRef.current.event(line, 20); });

  // Mira's tool calls: the chart acts, the screen follows, the result is what she says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    if (!isToolName(name)) throw new Error(`there is no tool called ${name}`);
    narrator.current!.flush();
    const gen = callGen.current;
    const run = await runTool(chart.current!, name, args ?? {}, {
      // The one wait inside a tool: if the call ended meanwhile, the chart is not touched.
      interpret: async (text) => {
        setWorking(true);
        try {
          const intents = await interpret(text);
          if (gen !== callGen.current) throw new Error('the call this was for has ended');
          return intents;
        } finally {
          if (gen === callGen.current) setWorking(false);
        }
      },
    });
    setView(run.view);
    setNotice(run.notice);
    if (run.seen.length) setNight((list) => run.seen.reduce(remember, list));
    if (run.seen.some((e) => e.kind === 'star')) setTab('star');
    return run.result;
  }, []);

  // If Mira narrates "let's look at midnight" without calling the tool, the chart does it and tells her.
  const net = useToolNet({
    match: (text) => { const call = mustDo(text, { lon: chart.current!.lon }); return call ? { id: `net-${Date.now()}`, ...call } : null; },
    run: async (call) => String(await onToolCall(call)),
    avatar: () => avatarRef.current!,
  });
  const avatar = useAvatar('sky-guide', {
    onToolCall: net.watch(onToolCall),
    onUserSaid: (text) => net.heard(text),
    // The opening names the place and hour the chart shows when Mira arrives.
    onLive: () => avatarRef.current?.event(said.opening(viewRef.current), 60),
    onEnded: () => { callGen.current++; narrator.current?.cancel(); setDone(true); },
  });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // A call starting or stopping: nothing pending carries across.
  useEffect(() => {
    callGen.current++;
    narrator.current?.cancel();
    setWorking(false);
  }, [live]);
  useEffect(() => () => { callGen.current++; narrator.current?.cancel(); }, []);

  // Mira's picture of the chart follows the chart; a drag is sent once it settles.
  useEffect(() => {
    const id = setTimeout(() => avatar.state(skyState(view)), 250);
    return () => clearTimeout(id);
  }, [view]);

  /** A tap, a button, the picker, the strip: the chart acts at once and Mira is told. */
  function control(intent: Intent) {
    const sky = chart.current!;
    const out = apply(sky, [intent]);
    setView(out.view);
    if (out.refusals.length) {
      const text = out.refusals.join(' ');
      setNotice({ text, later: whenUp(sky, intent), retry: intent });
      if (live) avatar.event(told.refused(didWith(intent, out.before), text), 20);
      return;
    }
    setNotice(null);
    if (intent.kind === 'select') {
      setNight((list) => remember(list, seenStar(out.view)));
      setTab('star');
    }
    if (intent.kind === 'show_constellation') setNight((list) => remember(list, seenFigure(out.view)));
    if (out.change && live) narrator.current!.changed(out.before, out.view);
  }

  /** "Show the sky at 3:15 am": the clock moves there and the refused thing is shown. */
  function showLater(found: Notice) {
    if (found.later === null) return;
    narrator.current!.flush();
    const sky = chart.current!;
    const intents: Intent[] = [{ kind: 'set_time', epoch: found.later }, ...(found.retry ? [found.retry] : [])];
    const out = apply(sky, intents);
    setView(out.view);
    setNotice(out.refusals.length ? { text: out.refusals.join(' '), later: null } : null);
    const entry = found.retry?.kind === 'select' ? seenStar(out.view) : found.retry?.kind === 'show_constellation' ? seenFigure(out.view) : null;
    setNight((list) => remember(list, entry));
    if (live) {
      const parts = [told.timeMoved(out.before, out.view)];
      if (found.retry?.kind === 'show_constellation' && out.view.snapshot.figure) parts.push(told.figure(out.view));
      if (found.retry?.kind === 'select' && out.view.snapshot.fact) parts.push(told.tapped(out.view));
      avatar.event(`${parts.join(' ')} Keep it all to two short lines.`, 20);
    }
  }

  const palette = red ? RED : NIGHT;
  const callAgain = () => { setDone(false); void avatar.start({ mic: avatar.micOn }); };

  if (avatar.phase === 'idle') {
    return (
      <Lobby
        view={view} host={HOST} palette={palette}
        onPlace={(label) => control({ kind: 'set_place', label })}
        onStart={(mic) => void avatar.start({ mic })}
      />
    );
  }

  return (
    <div className="ls-app">
      <header className="ls-top">
        <Logo />
        <button
          type="button" className={`ls-red ${red ? 'is-on' : ''}`} aria-pressed={red} onClick={() => setRed(!red)}
          title="Red light keeps your eyes used to the dark"
        >
          <LampIcon /><span>Red light</span>
        </button>
        <CallControls avatar={avatar} className="ls-controls" />
      </header>

      {done && <NightCard night={night} host={HOST} onAgain={callAgain} onClose={() => setDone(false)} />}

      <main className="ls-main">
        <section className="ls-sky" aria-label="The chart">
          <SkyHeader view={view} working={working} host={HOST} onIntent={control} />
          <Dome view={view} palette={palette} onIntent={control} />
          <NoticeBar notice={notice} tz={chart.current.tz} onLater={showLater} onDismiss={() => setNotice(null)} />
          <NightStrip view={view} onIntent={control} />
        </section>

        <Side view={view} night={night} tab={tab} host={HOST} onTab={setTab} onIntent={control} />

        <aside className="ls-host" aria-label={`${HOST}, your guide`}>
          <HostVideo avatar={avatar} name={HOST} poster={portrait} className="ls-host-video">
            <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} onAgain={callAgain} />
          </HostVideo>
          <div className="ls-nameplate">
            <p><b>{HOST}</b> your guide{live && <span className="ls-onair">Live</span>}</p>
            {live && avatar.caption && <p className="ls-caption-line">{avatar.caption}</p>}
          </div>
        </aside>

        <ChatPanel
          avatar={avatar} name={HOST} className="ls-chat" placeholder={`Ask ${HOST}: "Where's Vega?"`}
          empty={<>Ask out loud or type here: <em>"What's that bright one?"</em>, <em>"Show me Orion"</em>, <em>"The sky from Lisbon at midnight"</em>.</>}
        />
      </main>
    </div>
  );
}
