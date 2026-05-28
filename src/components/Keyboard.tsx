import React from 'react';

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
    // Determine the highest precedence status for a key across all guesses
    // correct > present > absent > empty
    
    let isCorrect = false;
    let isPresent = false;
    let isAbsent = false;

    for (const guess of guesses) {
      for (let i = 0; i < 5; i++) {
        if (guess[i] === key) {
          if (targetWord[i] === key) {
            isCorrect = true;
          } else if (targetWord.includes(key)) {
            isPresent = true;
          } else {
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
