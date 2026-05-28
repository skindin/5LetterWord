import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Grid } from './components/Grid';
import { Keyboard } from './components/Keyboard';

type GameState = {
  targetWord: string;
  guesses: string[];
  status: 'playing' | 'won' | 'lost';
  date: string;
};

export default function App() {
  const [gamesWon, setGamesWon] = useState(0);
  const [viewingIndex, setViewingIndex] = useState(0);
  const [history, setHistory] = useState<Record<number, GameState>>({});
  
  const [validWords, setValidWords] = useState<Set<string>>(new Set());
  const [currentGuess, setCurrentGuess] = useState('');
  const [message, setMessage] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  // Fetch valid words on initial load
  useEffect(() => {
    fetch('/api/valid-words')
      .then(res => res.json())
      .then((data: string[]) => setValidWords(new Set(data)))
      .catch(err => console.error(err));
  }, []);

  // Fetch target word when viewing a level we haven't fetched yet
  useEffect(() => {
    if (!history[viewingIndex] && !isFetching) {
      setIsFetching(true);
      fetch(`/api/word?index=${viewingIndex}`)
        .then(res => res.json())
        .then(data => {
          setHistory(prev => ({
            ...prev,
            [viewingIndex]: {
              targetWord: data.word,
              date: data.date,
              guesses: [],
              status: 'playing'
            }
          }));
          setIsFetching(false);
        })
        .catch(err => {
          console.error('Error fetching target word:', err);
          setIsFetching(false);
        });
    }
  }, [viewingIndex, history, isFetching]);

  const showMessage = (msg: string, ms = 2000) => {
    setMessage(msg);
    if (ms > 0) {
      setTimeout(() => setMessage(''), ms);
    }
  };

  const currentGame = history[viewingIndex];
  const targetWord = currentGame?.targetWord || '';
  const guesses = currentGame?.guesses || [];
  const gameStatus = currentGame?.status || 'loading';
  const rawDate = currentGame?.date || '';

  const updateCurrentGame = useCallback((updates: Partial<GameState>) => {
    setHistory(prev => ({
      ...prev,
      [viewingIndex]: {
        ...prev[viewingIndex],
        ...updates
      }
    }));
  }, [viewingIndex]);

  const onKeyPress = useCallback((key: string) => {
    if (gameStatus !== 'playing' || isFetching) return;

    if (key === 'backspace') {
      setCurrentGuess(prev => prev.slice(0, -1));
      return;
    }

    if (key === 'enter') {
      if (currentGuess.length !== 5) {
        showMessage('not enough letters');
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 400);
        return;
      }
      
      if (validWords.size > 0 && !validWords.has(currentGuess)) {
        showMessage('not in word list');
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 400);
        return;
      }

      const newGuesses = [...guesses, currentGuess];
      let newStatus = 'playing';

      if (currentGuess === targetWord) {
        newStatus = 'won';
        setGamesWon(prev => prev + 1);
        showMessage('splendid!', 0);
      } else if (newGuesses.length === 6) {
        newStatus = 'lost';
        showMessage(`the word was ${targetWord}`, 0);
      }

      updateCurrentGame({ guesses: newGuesses, status: newStatus as any });
      setCurrentGuess('');
      return;
    }

    if (currentGuess.length < 5 && /^[a-z]$/.test(key)) {
      setCurrentGuess(prev => prev + key);
    }
  }, [currentGuess, gameStatus, guesses, targetWord, validWords, isFetching, updateCurrentGame]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'enter' || key === 'backspace' || /^[a-z]$/.test(key)) {
        onKeyPress(key);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onKeyPress]);

  let formattedDateStr = '';
  if (rawDate) {
    const dateObj = new Date(rawDate + 'T12:00:00Z');
    formattedDateStr = dateObj.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    }).toLowerCase() + `, word #${viewingIndex + 1}`;
  }

  const isLeftDisabled = viewingIndex === 0;
  const isRightDisabled = gameStatus === 'playing' || gameStatus === 'loading';

  const handlePrev = () => {
    if (!isLeftDisabled) {
      setViewingIndex(v => v - 1);
      setCurrentGuess('');
      setMessage('');
    }
  };

  const handleNext = () => {
    if (!isRightDisabled) {
      setViewingIndex(v => v + 1);
      setCurrentGuess('');
      setMessage('');
    }
  };

  // We only count actual games finished in the viewingIndex logic, but the user requested 'gamesPlayed' at the top.
  // We can calculate games played by counting non-playing games in history, or just tracking the max index visited.
  const gamesPlayed = Object.values(history).filter(g => g.status !== 'playing').length;

  return (
    <>
      <div className="message-container">
        {message && <div className="message">{message}</div>}
      </div>
      
      <Header gamesWon={gamesWon} gamesPlayed={gamesPlayed} />
      
      <main>
        <div className="grid-nav-wrapper">
          <button 
            className={`nav-button ${isLeftDisabled ? 'disabled' : ''}`} 
            onClick={handlePrev}
            disabled={isLeftDisabled}
          >
            &#9664;
          </button>
          
          <div className="grid-content">
            {formattedDateStr && <div className="game-header">{formattedDateStr}</div>}
            <Grid 
              guesses={guesses}
              currentGuess={currentGuess}
              targetWord={targetWord}
              currentRow={guesses.length}
              gameStatus={gameStatus as any}
              isShaking={isShaking}
            />
          </div>

          <button 
            className={`nav-button ${isRightDisabled ? 'disabled' : ''}`} 
            onClick={handleNext}
            disabled={isRightDisabled}
          >
            &#9654;
          </button>
        </div>
        
        <div className="legend">
          <div className="legend-item"><span className="tile-mini correct"></span> right place</div>
          <div className="legend-item"><span className="tile-mini present"></span> wrong place</div>
          <div className="legend-item"><span className="tile-mini absent"></span> not in word</div>
        </div>
        
        <Keyboard 
          onKeyPress={onKeyPress}
          guesses={guesses}
          targetWord={targetWord}
        />
      </main>
    </>
  );
}
