// Requisition: Silo 18's supply window, with Hester behind the counter. She
// calls the stores' tools (check the shelves, stamp a slip, turn someone
// down) and speaks from the results; the page runs the stores, answers those
// calls, shows the ledger, the chits and the slips, and keeps Hester's picture
// of the window current.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useCaptionToggle, type ToolCall } from '../../../src/kit/index.ts';
import { said, windowState } from '../engine/director.ts';
import { Stores } from '../engine/stores.ts';
import type { View } from '../engine/types.ts';
import { Ledger, Purse, Slips } from './Counter.tsx';
import { Lobby, Logo } from './Lobby.tsx';
import { SceneBackdrop } from './Scene.tsx';
import hester from '../host/portrait.jpg';
import './requisition.css';

const ID = 'supply-window';
const HOST = 'Hester';

export function App() {
  // One visit per page: calling Hester again carries on with the same chits and slips.
  const stores = useRef(new Stores());
  const [view, setView] = useState<View>(() => stores.current.view());

  // Hester's tool calls: the stores act, the counter follows, the result is what she says.
  const onToolCall = useCallback(({ name, arguments: args }: ToolCall) => {
    const s = stores.current;
    let result: string;
    if (name === 'check_shelves') {
      result = said.check(s.check(args.item));
    } else if (name === 'stamp_slip') {
      const outcome = s.stamp(args);
      result = said.stamp(outcome, s.purse);
    } else if (name === 'refuse_slip') {
      s.turnDown(args.item, args.reason);
      result = 'Refused: the slip is on their screen.';
    } else {
      throw new Error(`unknown tool ${name}`);
    }
    setView(s.view());
    return result;
  }, []);

  // Hester's words over the video: off by default, since the chat carries them.
  const cc = useCaptionToggle(ID, false);
  const avatar = useAvatar(ID, { onToolCall });
  const live = avatar.phase === 'live';

  // She greets on her own; the opening only hands her the floor.
  useEffect(() => { if (avatar.phase === 'starting') avatar.event(said.opening(stores.current.slips.length), 60); }, [avatar.phase]);

  // Hester's picture of the window follows the window.
  useEffect(() => { avatar.state(windowState(view)); }, [view]);

  if (avatar.phase === 'idle') return <Lobby onStart={(mic) => void avatar.start({ mic })} />;

  return (
    <div className="rq-app">
      <header className="rq-top">
        <BackToApps avatar={avatar} name={HOST} /><Logo />
        <Purse view={view} />
        <CallControls avatar={avatar} className="rq-controls" />
      </header>

      <main className="rq-main">
        {/* The Supply window itself: Hester on the wall monitor, the slip on the counter. */}
        <section className="rq-scene" aria-label="Hester, at the Supply window">
          <SceneBackdrop />
          <div className="rq-monitor">
            <div className="rq-crt">
              <HostVideo avatar={avatar} captions={cc.on} onToggleCaptions={cc.toggle} name={HOST} poster={hester} className="rq-host-video">
                <CallStatus avatar={avatar} name={HOST} again="Call Hester again" />
              </HostVideo>
            </div>
            <p className="rq-nameplate"><b>Hester Pell</b> Supply manager{live && <span className="rq-open">Line open</span>}</p>
          </div>
          <div className="rq-counter"><Slips view={view} /></div>
        </section>

        <ChatPanel
          avatar={avatar} name={HOST} className="rq-chat" placeholder="Ask for something, or answer Hester…"
          empty={<>Say what you need out loud, or type it here. Try “Got any pump gaskets?”</>}
        />

        <Ledger view={view} />
      </main>
    </div>
  );
}
