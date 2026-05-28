import React from 'react';
import { getGuessStatuses } from '../utils/gameLogic';

interface GridProps {
  guesses: string[];
  currentGuess: string;
  targetWord: string;
  currentRow: number;
  gameStatus: 'playing' | 'won' | 'lost';
  isShaking: boolean;
}

export const Grid: React.FC<GridProps> = ({ guesses, currentGuess, targetWord, currentRow, gameStatus, isShaking }) => {
        {/* Completed Rows */}
        {guesses.map((guess, i) => {
          const statuses = getGuessStatuses(guess, targetWord);
          return (
            <div key={i} className="row">
              {guess.split('').map((letter, j) => (
                <div key={j} className={`tile filled flip ${statuses[j]}`} style={{ animationDelay: `${j * 0.1}s` }}>
                  {letter}
                </div>
              ))}
            </div>
          );
        })}

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
