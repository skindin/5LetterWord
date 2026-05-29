import React from 'react';
import { Grid } from './Grid';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  guesses: string[];
  targetWord: string;
  status: 'won' | 'lost' | 'playing';
  friendName: string;
  levelIndex: number;
  seqIndex?: number;
}

const BoardViewModal: React.FC<Props> = ({ isOpen, onClose, guesses, targetWord, status, friendName, levelIndex, seqIndex }) => {
  if (!isOpen) return null;
  const wordNumber = seqIndex !== undefined ? seqIndex + 1 : (levelIndex % 3) + 1;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content board-view-modal" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>&times;</button>
        <h2>{friendName.toLowerCase()}'s board</h2>
        <p className="board-view-meta">word #{wordNumber} · {guesses.length}/6 guesses · <span className={`board-view-status ${status}`}>{status}</span></p>
        <div className="board-view-grid">
          <Grid
            guesses={guesses}
            currentGuess=""
            targetWord={targetWord}
            currentRow={guesses.length}
            gameStatus={status === 'playing' ? 'playing' : status}
            isShaking={false}
          />
        </div>
        <div className="board-view-target">
          answer: <strong>{targetWord}</strong>
        </div>
      </div>
    </div>
  );
};

export default BoardViewModal;
