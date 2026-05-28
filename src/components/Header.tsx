import React from 'react';

interface HeaderProps {
  gamesWon: number;
  gamesPlayed: number;
}

export const Header: React.FC<HeaderProps> = ({ gamesWon, gamesPlayed }) => {
  return (
    <header>
      <h1>guess the 5 letter word</h1>
      <div className="score">
        guessed {gamesWon}/{gamesPlayed}
      </div>
    </header>
  );
};
