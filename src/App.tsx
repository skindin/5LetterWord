import { useState, useEffect, useCallback } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { Header } from './components/Header';
import { Grid } from './components/Grid';
import { Keyboard } from './components/Keyboard';
import { StatsModal } from './components/StatsModal';

type GameState = {
  targetWord: string;
  guesses: string[];
  status: 'playing' | 'won' | 'lost';
  date: string;
};

function useCountdownToMidnightCT() {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
      });
      const parts = formatter.formatToParts(now);
      const hStr = parts.find(p => p.type === 'hour')?.value || '0';
      const mStr = parts.find(p => p.type === 'minute')?.value || '0';
      const sStr = parts.find(p => p.type === 'second')?.value || '0';

      let hour = parseInt(hStr, 10);
      if (hour === 24) hour = 0;

      const minute = parseInt(mStr, 10);
      const second = parseInt(sStr, 10);

      const secondsPassed = hour * 3600 + minute * 60 + second;
      const secondsInDay = 24 * 3600;
      let secondsRemaining = secondsInDay - secondsPassed;
      if (secondsRemaining === secondsInDay) secondsRemaining = 0;

      const hRem = Math.floor(secondsRemaining / 3600);
      secondsRemaining %= 3600;
      const mRem = Math.floor(secondsRemaining / 60);
      const sRem = secondsRemaining % 60;

      const pad = (n: number) => n.toString().padStart(2, '0');
      setTimeLeft(`${pad(hRem)}:${pad(mRem)}:${pad(sRem)}`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return timeLeft;
}

export default function App() {
  const [gamesWon, setGamesWon] = useState(0);
  const [viewingIndex, setViewingIndex] = useState(0);
  const [history, setHistory] = useState<Record<number, GameState>>({});
  
  const [validWords, setValidWords] = useState<Set<string>>(new Set());
  const [currentGuess, setCurrentGuess] = useState('');
  const [message, setMessage] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  
  const countdown = useCountdownToMidnightCT();

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
  const gameStatus: string = currentGame?.status || 'loading';
  
  let rawDate = currentGame?.date;
  if (!rawDate && Object.keys(history).length > 0) {
    rawDate = Object.values(history)[0].date;
  }

  const updateCurrentGame = useCallback((updates: Partial<GameState>) => {
    setHistory(prev => {
      const newHistory = {
        ...prev,
        [viewingIndex]: {
          ...prev[viewingIndex],
          ...updates
        }
      };

      if (token) {
        fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, history: newHistory })
        }).catch(console.error);
      }

      return newHistory;
    });
  }, [viewingIndex, token]);

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
  let wordNumStr = '';
  if (rawDate) {
    const dateObj = new Date(rawDate + 'T12:00:00Z');
    formattedDateStr = dateObj.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    }).toLowerCase();
    wordNumStr = `word #${viewingIndex + 1}`;
  }

  const isLeftDisabled = viewingIndex === 0;
  const isRightDisabled = gameStatus === 'playing' || gameStatus === 'loading';

  const maxIndex = Math.max(-1, ...Object.keys(history).map(Number));
  const shouldHighlightRight = viewingIndex === maxIndex && !isRightDisabled;

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

  if (!token) {
    return (
      <div className="login-screen">
        <h1 style={{color: 'white', marginBottom: '24px'}}>Sign in to play</h1>
        <GoogleLogin
          onSuccess={credentialResponse => {
            setToken(credentialResponse.credential!);
            fetch('/api/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: credentialResponse.credential })
            })
            .then(r => r.json())
            .then(data => {
              if (data.history) {
                setHistory(data.history);
                const max = Math.max(0, ...Object.keys(data.history).map(Number));
                setViewingIndex(max);
                
                // Count wins
                const wins = Object.values(data.history).filter((g: any) => g.status === 'won').length;
                setGamesWon(wins);
              }
            }).catch(console.error);
          }}
          onError={() => {
            console.log('Login Failed');
          }}
        />
      </div>
    );
  }

  return (
    <>
      <div className="message-container">
        {message && <div className="message">{message}</div>}
      </div>
      
      <Header 
        gamesWon={gamesWon} 
        gamesPlayed={gamesPlayed} 
        onOpenStats={() => setIsStatsOpen(true)}
      />
      
      <main>
        {formattedDateStr && <div className="game-header">{formattedDateStr}, <strong>{wordNumStr}</strong> - {countdown} until next word list</div>}
        
        <div className="grid-nav-wrapper">
          <button 
            className={`nav-button ${isLeftDisabled ? 'disabled' : ''}`} 
            onClick={handlePrev}
            disabled={isLeftDisabled}
          >
            <svg viewBox="0 0 24 24" width="24" height="24">
              <polygon points="15,6 7,12 15,18" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" fill="currentColor" />
            </svg>
          </button>
          
          <div className="grid-content">
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
            className={`nav-button ${isRightDisabled ? 'disabled' : ''} ${shouldHighlightRight ? 'highlight' : ''}`} 
            onClick={handleNext}
            disabled={isRightDisabled}
          >
            <svg viewBox="0 0 24 24" width="24" height="24">
              <polygon points="9,6 17,12 9,18" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" fill="currentColor" />
            </svg>
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

      <StatsModal 
        isOpen={isStatsOpen} 
        onClose={() => setIsStatsOpen(false)} 
        history={history} 
        currentDate={rawDate || ''} 
      />
    </>
  );
}
