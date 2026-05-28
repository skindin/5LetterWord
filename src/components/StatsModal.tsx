import React from 'react';

type GameState = {
  status: 'playing' | 'won' | 'lost';
  guesses: string[];
  date: string;
};

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: Record<number, GameState>;
  currentDate: string;
}

export const StatsModal: React.FC<StatsModalProps> = ({ isOpen, onClose, history, currentDate }) => {
  if (!isOpen) return null;

  const allGames = Object.values(history).filter(g => g.status !== 'playing');
  const todayGames = allGames.filter(g => g.date === currentDate);

  const computeStats = (games: GameState[]) => {
    const distribution = [0, 0, 0, 0, 0, 0];
    let won = 0;
    for (const g of games) {
      if (g.status === 'won') {
        won++;
        const tries = g.guesses.length;
        if (tries >= 1 && tries <= 6) {
          distribution[tries - 1]++;
        }
      }
    }
    const maxVal = Math.max(...distribution, 1);
    return { played: games.length, won, distribution, maxVal };
  };

  const todayStats = computeStats(todayGames);
  const overallStats = computeStats(allGames);

  const renderDistribution = (stats: any) => (
    <div className="stats-distribution">
      {stats.distribution.map((count: number, i: number) => (
        <div key={i} className="stat-row">
          <div className="stat-num">{i + 1}</div>
          <div className="stat-bar-container">
            <div 
              className={`stat-bar ${count > 0 ? 'active' : ''}`}
              style={{ width: `${Math.max(5, (count / stats.maxVal) * 100)}%` }}
            >
              {count}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>&times;</button>
        
        <h2>today's stats</h2>
        <div className="stats-summary">
          <div className="stat-box"><div className="stat-box-val">{todayStats.played}</div>played</div>
          <div className="stat-box"><div className="stat-box-val">{Math.round((todayStats.won / Math.max(todayStats.played, 1)) * 100)}%</div>win %</div>
        </div>
        {renderDistribution(todayStats)}

        <div className="stats-divider"></div>

        <h2>overall stats</h2>
        <div className="stats-summary">
          <div className="stat-box"><div className="stat-box-val">{overallStats.played}</div>played</div>
          <div className="stat-box"><div className="stat-box-val">{Math.round((overallStats.won / Math.max(overallStats.played, 1)) * 100)}%</div>win %</div>
        </div>
        {renderDistribution(overallStats)}
      </div>
    </div>
  );
};
