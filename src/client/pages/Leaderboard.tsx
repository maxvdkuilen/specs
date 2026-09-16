import { LeaderboardView } from '../components/LeaderboardView';
import { useStore } from '../store';

export function Leaderboard() {
  const { boot } = useStore();
  return (
    <div className="page">
      <div className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">{boot?.config.className ?? 'Specs'}</div>
        <h1 className="headline">Leaderboard</h1>
        <p className="small">Everyone starts at 1000. Beat the crowd to climb. Under 3 lectures counts as provisional.</p>
      </div>
      <LeaderboardView />
    </div>
  );
}
