import React from 'react';
import { getGuessStatuses } from '../utils/gameLogic';

interface KeyboardProps {
  onKeyPress: (key: string) => void;
  guesses: string[];
  targetWord: string;
}

export const Keyboard: React.FC<KeyboardProps> = ({ onKeyPress, guesses, targetWord }) => {
  const rows = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace'],
  ];

  const getKeyStatus = (key: string) => {
    let isCorrect = false;
    let isPresent = false;
    let isAbsent = false;

    for (const guess of guesses) {
      const statuses = getGuessStatuses(guess, targetWord);
      for (let i = 0; i < 5; i++) {
        if (guess[i] === key) {
          if (statuses[i] === 'correct') {
            isCorrect = true;
          } else if (statuses[i] === 'present') {
            isPresent = true;
          } else if (statuses[i] === 'absent') {
            isAbsent = true;
          }
        }
      }
    }

    if (isCorrect) return 'correct';
    if (isPresent) return 'present';
    if (isAbsent) return 'absent';
    return '';
  };

  return (
    <div className="keyboard">
      {rows.map((row, i) => (
        <div key={i} className="keyboard-row">
          {row.map((key) => {
            const isWide = key === 'enter' || key === 'backspace';
            const status = isWide ? '' : getKeyStatus(key);
            
            return (
              <button
                key={key}
                className={`key ${isWide ? 'wide' : ''} ${status}`}
                onClick={() => onKeyPress(key)}
              >
                {key === 'backspace' ? '⌫' : key}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};
