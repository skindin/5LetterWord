import React from 'react';

interface HeaderProps {
  gamesWon: number;
  gamesPlayed: number;
  onOpenStats: () => void;
  onOpenCalendar: () => void;
  onSignOut?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ 
  gamesWon, 
  gamesPlayed, 
  onOpenStats, 
  onOpenCalendar, 
  onSignOut 
}) => {
  return (
    <header>
      <h1>guess the 5 letter word</h1>
      <div className="header-right">
        <div className="score">
          guessed {gamesWon}/{gamesPlayed}
        </div>
        <button className="calendar-btn" onClick={onOpenCalendar} aria-label="Play Calendar">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2"/>
            <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="2"/>
            <rect x="7" y="14" width="2" height="2" fill="currentColor"/>
            <rect x="11" y="14" width="2" height="2" fill="currentColor"/>
            <rect x="15" y="14" width="2" height="2" fill="currentColor"/>
            <rect x="7" y="18" width="2" height="2" fill="currentColor"/>
            <rect x="11" y="18" width="2" height="2" fill="currentColor"/>
          </svg>
        </button>
        <button className="stats-btn" onClick={onOpenStats} aria-label="Statistics">
          <svg viewBox="0 0 24 24" width="24" height="24">
             <path d="M4 22V8h4v14H4zm6 0V2h4v20h-4zm6 0v-8h4v8h-4z" fill="currentColor"/>
          </svg>
        </button>
        {onSignOut && (
          <button className="logout-btn" onClick={onSignOut} aria-label="Sign Out">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M16 17v-3H9v-4h7V7l5 5-5 5M14 2a2 2 0 0 1 2 2v2h-2V4H4v16h10v-2h2v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10z" fill="currentColor"/>
            </svg>
          </button>
        )}
      </div>
    </header>
  );
};
