import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Grid } from './components/Grid';
import { Keyboard } from './components/Keyboard';

export default function App() {
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [gamesWon, setGamesWon] = useState(0);
  
  const [targetWord, setTargetWord] = useState('');
  const [validWords, setValidWords] = useState<Set<string>>(new Set());
  
  const [guesses, setGuesses] = useState<string[]>([]);
  const [currentGuess, setCurrentGuess] = useState('');
  const [gameStatus, setGameStatus] = useState<'playing' | 'won' | 'lost' | 'loading'>('loading');
  const [message, setMessage] = useState('');

  // Fetch valid words on initial load
  useEffect(() => {
    fetch('/api/valid-words')
      .then(res => res.json())
      .then((data: string[]) => {
        setValidWords(new Set(data));
      })
      .catch(err => console.error('Error fetching valid words:', err));
  }, []);

  // Fetch target word based on gamesPlayed
  useEffect(() => {
    setGameStatus('loading');
    fetch(`/api/word?index=${gamesPlayed}`)
      .then(res => res.json())
      .then(data => {
        setTargetWord(data.word);
        setGuesses([]);
        setCurrentGuess('');
        setGameStatus('playing');
        setMessage('');
      })
      .catch(err => console.error('Error fetching target word:', err));
  }, [gamesPlayed]);

  const showMessage = (msg: string, ms = 2000) => {
    setMessage(msg);
    if (ms > 0) {
      setTimeout(() => setMessage(''), ms);
    }
  };

  const onKeyPress = useCallback((key: string) => {
    if (gameStatus !== 'playing') return;

    if (key === 'backspace') {
      setCurrentGuess(prev => prev.slice(0, -1));
      return;
    }

    if (key === 'enter') {
      if (currentGuess.length !== 5) {
        showMessage('Not enough letters');
        return;
      }
      
      if (validWords.size > 0 && !validWords.has(currentGuess)) {
        showMessage('Not in word list');
        return;
      }

      const newGuesses = [...guesses, currentGuess];
      setGuesses(newGuesses);
      setCurrentGuess('');

      if (currentGuess === targetWord) {
        setGameStatus('won');
        setGamesWon(prev => prev + 1);
        showMessage('Splendid!', 0);
        setTimeout(() => setGamesPlayed(prev => prev + 1), 2500); // Auto next game after 2.5s
      } else if (newGuesses.length === 6) {
        setGameStatus('lost');
        showMessage(`The word was ${targetWord}`, 0);
        setTimeout(() => setGamesPlayed(prev => prev + 1), 3000); // Auto next game after 3s
      }
      return;
    }

    if (currentGuess.length < 5 && /^[a-z]$/.test(key)) {
      setCurrentGuess(prev => prev + key);
    }
  }, [currentGuess, gameStatus, guesses, targetWord, validWords]);

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

  if (gameStatus === 'loading') {
    return <div className="loading">Loading...</div>;
  }

  return (
    <main>
      <div className="message-container">
        {message && <div className="message">{message}</div>}
      </div>
      
      <Header gamesWon={gamesWon} gamesPlayed={gamesPlayed} />
      
      <Grid 
        guesses={guesses}
        currentGuess={currentGuess}
        targetWord={targetWord}
        currentRow={guesses.length}
        gameStatus={gameStatus}
      />
      
      <Keyboard 
        onKeyPress={onKeyPress}
        guesses={guesses}
        targetWord={targetWord}
      />
    </main>
  );
}
