import React from 'react';

interface GridProps {
  guesses: string[];
  currentGuess: string;
  targetWord: string;
  currentRow: number;
  gameStatus: 'playing' | 'won' | 'lost';
  isShaking: boolean;
}

export const Grid: React.FC<GridProps> = ({ guesses, currentGuess, targetWord, currentRow, gameStatus, isShaking }) => {
  const getLetterStatus = (letter: string, index: number) => {
    if (targetWord[index] === letter) return 'correct';
    if (targetWord.includes(letter)) {
      // Handle multiples (simplified Wordle logic for presence)
      // For true wordle logic, we need to count occurrences, but for a knockoff, simple presence is okay
      return 'present';
    }
    return 'absent';
  };

  return (
    <div className="grid-container">
      <div className="grid">
        {/* Completed Rows */}
        {guesses.map((guess, i) => (
          <div key={i} className="row">
            {guess.split('').map((letter, j) => {
              const status = getLetterStatus(letter, j);
              return (
                <div key={j} className={`tile filled flip ${status}`} style={{ animationDelay: `${j * 0.1}s` }}>
                  {letter}
                </div>
              );
            })}
          </div>
        ))}

        {/* Current Row */}
        {currentRow < 6 && gameStatus === 'playing' && (
          <div className={`row ${isShaking ? 'shake' : ''}`}>
            {Array.from({ length: 5 }).map((_, i) => {
              const letter = currentGuess[i];
              return (
                <div key={i} className={`tile ${letter ? 'filled' : ''}`}>
                  {letter || ''}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty Rows */}
        {Array.from({ length: Math.max(0, 6 - (guesses.length + (gameStatus === 'playing' ? 1 : 0))) }).map((_, i) => (
          <div key={`empty-${i}`} className="row">
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="tile" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
