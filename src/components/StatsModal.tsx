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

const parseDateString = (dateStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const getStreakStats = (winDatesSorted: string[], currentDateStr: string) => {
  if (winDatesSorted.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const dates = winDatesSorted.map(parseDateString);
  
  let longestStreak = 0;
  let tempStreak = 1;
  
  for (let i = 0; i < dates.length; i++) {
    if (i > 0) {
      const diffTime = dates[i].getTime() - dates[i-1].getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        tempStreak++;
      } else if (diffDays > 1) {
        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
        }
        tempStreak = 1;
      }
    }
  }
  if (tempStreak > longestStreak) {
    longestStreak = tempStreak;
  }

  // Calculate current streak
  let currentStreak = 0;
  const lastWinDateStr = winDatesSorted[winDatesSorted.length - 1];
  const lastWinDate = parseDateString(lastWinDateStr);
  const currentDate = parseDateString(currentDateStr);
  
  const diffTime = currentDate.getTime() - lastWinDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0 || diffDays === 1) {
    let currentTemp = 1;
    for (let i = dates.length - 1; i > 0; i--) {
      const diffT = dates[i].getTime() - dates[i-1].getTime();
      const diffD = Math.round(diffT / (1000 * 60 * 60 * 24));
      if (diffD === 1) {
        currentTemp++;
      } else {
        break;
      }
    }
    currentStreak = currentTemp;
  } else {
    currentStreak = 0;
  }

  return { currentStreak, longestStreak };
};

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

  // Group won games by date to find most won in a single day
  const winsByDate: Record<string, number> = {};
  const wonGames = allGames.filter(g => g.status === 'won');
  
  for (const g of allGames) {
    if (g.date && g.status === 'won') {
      winsByDate[g.date] = (winsByDate[g.date] || 0) + 1;
    }
  }
  
  const mostWonInADay = Object.keys(winsByDate).length > 0 
    ? Math.max(...Object.values(winsByDate)) 
    : 0;

  // Calculate streaks
  const sortedWinDates = Array.from(new Set(wonGames.map(g => g.date))).sort();
  const { currentStreak, longestStreak } = getStreakStats(sortedWinDates, currentDate);

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
          <div className="stat-box"><div className="stat-box-val">{currentStreak}</div>current streak</div>
        </div>
        {renderDistribution(todayStats)}

        <div className="stats-divider"></div>

        <h2>overall stats</h2>
        <div className="stats-summary">
          <div className="stat-box"><div className="stat-box-val">{overallStats.played}</div>played</div>
          <div className="stat-box"><div className="stat-box-val">{Math.round((overallStats.won / Math.max(overallStats.played, 1)) * 100)}%</div>win %</div>
          <div className="stat-box"><div className="stat-box-val">{mostWonInADay}</div>most won/day</div>
          <div className="stat-box"><div className="stat-box-val">{longestStreak}</div>longest streak</div>
        </div>
        {renderDistribution(overallStats)}
      </div>
    </div>
  );
};
