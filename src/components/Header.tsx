import React from 'react';

interface HeaderProps {
  gamesWon: number;
  gamesPlayed: number;
  onOpenStats: () => void;
}

export const Header: React.FC<HeaderProps> = ({ gamesWon, gamesPlayed, onOpenStats }) => {
  return (
    <header>
      <h1>guess the 5 letter word</h1>
      <div className="header-right">
        <div className="score">
          guessed {gamesWon}/{gamesPlayed}
        </div>
        <button className="stats-btn" onClick={onOpenStats} aria-label="Statistics">
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path d="M4 22V8h4v14H4zm6 0V2h4v20h-4zm6 0v-8h4v8h-4z" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </header>
  );
};
