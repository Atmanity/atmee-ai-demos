// The felt, both seats, the board and the pot: the original panel's
// PokerTable, unchanged but for the logo.
import { AtmeeLogo } from "./AtmeeLogo.tsx";
import { CardView } from "./CardView.tsx";
import { ChipStack } from "./ChipStack.tsx";

export interface PlayerInfo {
  name: string;
  stack: number;
  bet: number;
  cards: readonly (string | null)[] | null;
  faceDown: boolean;
  isActive: boolean;
  isDealer: boolean;
  folded: boolean;
  handRank?: string | null;
  isThinking?: boolean;
}

interface PokerTableProps {
  board: readonly string[];
  pot: number;
  players: [PlayerInfo, PlayerInfo];
}

export function PokerTable({ board, pot, players }: PokerTableProps) {
  const [user, opponent] = players;

  return (
    <div className="poker-table">
      <div className="poker-felt">
        <div className="poker-felt__inner">
          <div className="poker-felt__brand" aria-hidden>
            <AtmeeLogo />
            <span>atmee.ai</span>
          </div>
          <div className="poker-felt__suits" aria-hidden>
            <span className="poker-felt__suits-heart">&#9829;</span>
            <span className="poker-felt__suits-spade">&#9824;</span>
            <span className="poker-felt__suits-diamond">&#9830;</span>
            <span className="poker-felt__suits-club">&#9827;</span>
          </div>
          <PlayerSlot player={opponent} position="top" />

          <div className="poker-center">
            <div className="community-cards">
              {Array.from({ length: 5 }).map((_, i) => {
                const card = board[i];
                return card ? (
                  <CardView key={i} card={card} />
                ) : (
                  <div key={i} className="card card--placeholder" />
                );
              })}
            </div>
            {pot > 0 && (
              <div className="pot-display">
                <ChipStack amount={pot} />
                <span className="pot-label">Pot</span>
              </div>
            )}
          </div>

          <PlayerSlot player={user} position="bottom" />
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function PlayerSlot({
  player,
  position,
}: {
  player: PlayerInfo;
  position: "top" | "bottom";
}) {
  const classes = [
    "player-slot",
    `player-slot--${position}`,
    player.isActive ? "player-slot--active" : "",
    player.folded ? "player-slot--folded" : "",
    player.isThinking ? "player-slot--thinking" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="player-avatar">
        <div className="avatar-placeholder">{initials(player.name) || "?"}</div>
        {player.isThinking && (
          <span className="player-avatar__pulse" aria-hidden />
        )}
      </div>

      <div className="player-body">
        <div className="player-info">
          <span className="player-name">
            {player.isDealer && <span className="dealer-chip">D</span>}
            {player.name}
          </span>
          <span className="player-stack">${player.stack.toLocaleString()}</span>
        </div>
        <div className="player-cards">
          {player.cards
            ? player.cards.map((card, i) => (
                <CardView key={i} card={card} faceDown={player.faceDown} />
              ))
            : Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="card card--placeholder card--placeholder--hole"
                />
              ))}
        </div>
        {player.handRank && <div className="hand-rank">{player.handRank}</div>}
      </div>

      {player.bet > 0 && (
        <div className="player-bet">
          <ChipStack amount={player.bet} compact />
        </div>
      )}
    </div>
  );
}
