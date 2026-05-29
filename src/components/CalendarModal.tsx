import React, { useState } from 'react';

type GameState = {
  status: 'playing' | 'won' | 'lost';
  guesses: string[];
  date: string;
  targetWord?: string;
};

interface CalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: Record<number, GameState>;
  viewerHistory: Record<number, GameState>;
  currentDate: string;
  isFriendMode: boolean;
  friendName?: string;
  onJumpToLevel?: (index: number) => void;
  onViewFriendBoard?: (level: { guesses: string[]; targetWord: string; status: 'won' | 'lost' | 'playing'; index: number; seqIndex?: number }) => void;
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

export const CalendarModal: React.FC<CalendarModalProps> = ({
  isOpen,
  onClose,
  history,
  viewerHistory,
  currentDate,
  isFriendMode,
  friendName,
  onJumpToLevel,
  onViewFriendBoard,
}) => {
  if (!isOpen) return null;

  // Initialize selected month to today
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);

  // Month navigation handlers
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(y => y - 1);
    } else {
      setCurrentMonth(m => m - 1);
    }
    setSelectedDateStr(null);
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(y => y + 1);
    } else {
      setCurrentMonth(m => m + 1);
    }
    setSelectedDateStr(null);
  };

  // Calendar generation helpers
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const startDayOfWeek = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sun, ..., 6 = Sat

  const leadingEmptyDays = Array.from({ length: startDayOfWeek });
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Helper to format date string: yyyy-mm-dd
  const formatDateStr = (day: number) => {
    return `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  // Retrieve levels completed on a specific day
  const getLevelsForDate = (dateStr: string) => {
    return Object.entries(history)
      .map(([idx, game]) => ({ index: Number(idx), ...game }))
      .filter(game => game.date === dateStr)
      .sort((a, b) => a.index - b.index);
  };

  // Determine visual highlighting for a day
  const getDayStatusClass = (dateStr: string) => {
    const levels = getLevelsForDate(dateStr);
    if (levels.length === 0) return '';

    const finished = levels.filter(g => g.status !== 'playing');
    if (finished.length === 0) return 'playing';

    const wonAll = finished.every(g => g.status === 'won');
    const lostAny = finished.some(g => g.status === 'lost');

    if (wonAll) return 'won';
    if (lostAny) return 'lost';
    return 'mixed';
  };

  // Check if a level's answers can be shown under anti-spoiler rules
  const checkIsLevelUnlocked = (levelIndex: number, levelDate: string) => {
    if (!isFriendMode) return true; // Always unlocked for self
    
    const isPastDay = levelDate !== currentDate;
    const viewerLevel = viewerHistory[levelIndex];
    const viewerCompleted = viewerLevel && viewerLevel.status !== 'playing';
    
    return isPastDay || viewerCompleted;
  };

  // Render a visual tile row representing a guesses map
  const renderMiniGuessGrid = (guesses: string[], targetWord: string) => {
    return (
      <div className="mini-grid-preview">
        {guesses.map((guess, rIndex) => (
          <div key={rIndex} className="mini-grid-row">
            {guess.split('').map((char, cIndex) => {
              let cellClass = 'absent';
              if (targetWord[cIndex] === char) {
                cellClass = 'correct';
              } else if (targetWord.includes(char)) {
                cellClass = 'present';
              }
              return <span key={cIndex} className={`mini-grid-cell ${cellClass}`}></span>;
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content calendar-modal" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>&times;</button>

        <h2>
          {isFriendMode ? `${friendName?.toLowerCase()}'s play calendar` : 'your play calendar'}
        </h2>

        {/* Month Selector Controls */}
        <div className="calendar-header-nav">
          <button className="nav-arrow" onClick={handlePrevMonth}>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <polygon points="15,18 9,12 15,6" fill="currentColor"/>
            </svg>
          </button>
          <span className="current-month-lbl">
            {MONTH_NAMES[currentMonth]} {currentYear}
          </span>
          <button className="nav-arrow" onClick={handleNextMonth}>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <polygon points="9,18 15,12 9,6" fill="currentColor"/>
            </svg>
          </button>
        </div>

        {/* Day of Week Label Row */}
        <div className="calendar-week-days">
          <span>s</span><span>m</span><span>t</span><span>w</span><span>t</span><span>f</span><span>s</span>
        </div>

        {/* Calendar Grid */}
        <div className="calendar-grid">
          {leadingEmptyDays.map((_, i) => (
            <div key={`empty-${i}`} className="calendar-day empty"></div>
          ))}

          {monthDays.map(day => {
            const dateStr = formatDateStr(day);
            const statusClass = getDayStatusClass(dateStr);
            const isSelected = selectedDateStr === dateStr;
            const levels = getLevelsForDate(dateStr);
            const hasLevels = levels.length > 0;

            return (
              <div
                key={day}
                className={`calendar-day ${statusClass} ${isSelected ? 'selected' : ''} ${hasLevels ? 'has-history' : ''}`}
                onClick={() => hasLevels && setSelectedDateStr(isSelected ? null : dateStr)}
              >
                <span className="day-number">{day}</span>
                {hasLevels && <span className="day-dot"></span>}
              </div>
            );
          })}
        </div>

        {/* Sliding drawer showing details of levels played on the selected day */}
        {selectedDateStr && (
          <div className="calendar-drawer">
            <h4>
              levels played on {selectedDateStr} ({getLevelsForDate(selectedDateStr).length})
            </h4>
            
            <div className="drawer-levels-list">
              {getLevelsForDate(selectedDateStr).map((level, seqIndex) => {
                const isUnlocked = checkIsLevelUnlocked(level.index, level.date);
                const showTargetWord = isFriendMode
                  ? (viewerHistory[level.index]?.status && viewerHistory[level.index]?.status !== 'playing')
                  : (level.status !== 'playing');
                
                return (
                  <div key={level.index} className="drawer-level-card">
                    <div className="level-card-header">
                      <span className="level-number">word #{seqIndex + 1}</span>
                      <span className={`level-status-pill ${level.status}`}>
                        {level.status === 'playing' ? 'in progress' : level.status}
                      </span>
                    </div>

                    {isUnlocked ? (
                      <div className="level-card-details">
                        {showTargetWord && level.targetWord && (
                          <div className="target-word-lbl">
                            target: <strong>{level.targetWord}</strong>
                          </div>
                        )}
                        <div className="attempts-lbl">
                          guesses: {level.guesses.length}/6
                        </div>
                        {level.targetWord && level.guesses.length > 0 && 
                          renderMiniGuessGrid(level.guesses, level.targetWord)
                        }
                      </div>
                    ) : (
                      <div className="level-card-spoiler-mask">
                        <svg viewBox="0 0 24 24" width="20" height="20" className="lock-icon">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                        <span>locked until you play this level</span>
                      </div>
                    )}

                    {!isFriendMode && onJumpToLevel && (
                      <button
                        className="jump-btn"
                        onClick={() => {
                          onJumpToLevel(level.index);
                          onClose();
                        }}
                      >
                        play/review level
                      </button>
                    )}

                    {isFriendMode && isUnlocked && showTargetWord && level.targetWord && level.guesses.length > 0 && onViewFriendBoard && (
                      <button
                        className="jump-btn view-board-btn"
                        onClick={() => onViewFriendBoard({
                          guesses: level.guesses,
                          targetWord: level.targetWord!,
                          status: level.status,
                          index: level.index,
                          seqIndex
                        })}
                      >
                        view board
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
