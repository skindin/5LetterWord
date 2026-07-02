import { useState, useEffect, useCallback } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { Header } from './components/Header';
import { Grid } from './components/Grid';
import { Keyboard } from './components/Keyboard';
import { StatsModal } from './components/StatsModal';
import { SocialPage } from './components/SocialPage';
import { QRCodeModal } from './components/QRCodeModal';
import { AcceptFriendModal } from './components/AcceptFriendModal';
import { CalendarModal } from './components/CalendarModal';
import DevPanel from './components/DevPanel';
import BoardViewModal from './components/BoardViewModal';

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

const getChicagoTodayStr = () => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: 'numeric', day: 'numeric'
  });
  const parts = formatter.formatToParts(new Date());
  const y = parts.find(p => p.type === 'year')?.value || '2026';
  const m = parts.find(p => p.type === 'month')?.value || '05';
  const d = parts.find(p => p.type === 'day')?.value || '29';
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
};

function xorDeobfuscate(hex: string, key: string): string {
  if (!hex || !key) return '';
  try {
    const binary = hex.match(/.{1,2}/g)?.map(byte => String.fromCharCode(parseInt(byte, 16))).join('') || '';
    let result = '';
    for (let i = 0; i < binary.length; i++) {
      const charCode = binary.charCodeAt(i) ^ key.charCodeAt(i % key.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch (e) {
    console.error("Failed to de-obfuscate target word:", e);
    return '';
  }
}

const getWordNumberForIndex = (index: number, date: string, hist: Record<number, GameState>) => {
  if (!date) return 1;
  const sameDateIndexes = Object.entries(hist)
    .filter(([idx, g]) => g.date === date && Number(idx) !== index)
    .map(([idx]) => Number(idx));
  
  if (hist[index]) {
    const allIndexes = [...sameDateIndexes, index].sort((a, b) => a - b);
    return allIndexes.indexOf(index) + 1;
  } else {
    const smallerSameDate = sameDateIndexes.filter(idx => idx < index).length;
    return smallerSameDate + 1;
  }
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
  const [token, setToken] = useState<string | null>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState<'self' | { google_id: string; username: string; display_name: string; picture: string; history: Record<number, { status: 'playing' | 'won' | 'lost'; guesses: string[]; date: string; targetWord?: string }> } | null>(null);
  
  const [isAuthChecking, setIsAuthChecking] = useState(() => {
    return !!localStorage.getItem('token');
  });
  
  // Social & Username States
  const [username, setUsername] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<{ name: string; picture: string; email?: string } | null>(null);
  const [isDev, setIsDev] = useState(false);
  const [friendBoardView, setFriendBoardView] = useState<{
    guesses: string[]; targetWord: string; status: 'won' | 'lost' | 'playing'; index: number; seqIndex?: number;
  } | null>(null);
  const [currentView, setCurrentView] = useState<'game' | 'social'>('game');
  const [isQRCodeOpen, setIsQRCodeOpen] = useState(false);
  const [friendToAccept, setFriendToAccept] = useState<string | null>(null);
  const [chosenUsername, setChosenUsername] = useState('');
  const [isSettingUsername, setIsSettingUsername] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [isAcceptFriendOpen, setIsAcceptFriendOpen] = useState(false);

  // Credentials Authentication States
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [emailConsent, setEmailConsent] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [showLinkEmailModal, setShowLinkEmailModal] = useState(false);
  const [linkEmailInput, setLinkEmailInput] = useState('');
  const [isNewGoogleUser, setIsNewGoogleUser] = useState(false);
  const [showGoogleConsentModal, setShowGoogleConsentModal] = useState(false);
  const [skipEmailPrompt, setSkipEmailPrompt] = useState(false);
  const [qrCodeImageSrc, setQrCodeImageSrc] = useState('');
  
  const countdown = useCountdownToMidnightCT();
  const todayStr = getChicagoTodayStr();

  const currentGame = history[viewingIndex];
  const targetWord = currentGame?.targetWord || '';
  const guesses = currentGame?.guesses || [];
  const gameStatus: string = currentGame?.status || 'loading';
  
  const activeDate = currentGame?.date || todayStr;

  // Fetch valid words on initial load
  useEffect(() => {
    fetch('/api/valid-words')
      .then(res => res.json())
      .then((data: string[]) => setValidWords(new Set(data)))
      .catch(err => console.error(err));
  }, []);

  // Pre-load and cache the QR code image the moment the user logs in / username is loaded
  useEffect(() => {
    if (username) {
      const addFriendUrl = `https://5letterword.gnomebuddygames.com/?friend=${encodeURIComponent(username)}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(addFriendUrl)}`;
      
      // Trigger background browser pre-fetch
      const img = new Image();
      img.src = qrUrl;
      
      setQrCodeImageSrc(qrUrl);
    } else {
      setQrCodeImageSrc('');
    }
  }, [username]);

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUsername = localStorage.getItem('username');
    const savedProfile = localStorage.getItem('userProfile');
    const savedHistory = localStorage.getItem('gameHistory');
    
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory);
        setHistory(parsedHistory);
        const max = Math.max(0, ...Object.keys(parsedHistory).map(Number));
        const latestGame = parsedHistory[max];
        let nextIndex = max;
        if (latestGame) {
          if (latestGame.date !== todayStr || latestGame.status !== 'playing') {
            nextIndex = max + 1;
          }
        }
        setViewingIndex(nextIndex);
        
        const wins = Object.values(parsedHistory).filter((g: any) => g.status === 'won').length;
        setGamesWon(wins);
      } catch (e) {
        console.error("Error parsing saved history:", e);
      }
    }

    if (savedToken) {
      setToken(savedToken);
      if (savedUsername) setUsername(savedUsername);
      if (savedProfile) setUserProfile(JSON.parse(savedProfile));
      
      fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: savedToken })
      })
      .then(r => {
        if (!r.ok) {
          throw new Error('Auth validation failed with status ' + r.status);
        }
        return r.json();
      })
      .then(data => {
        if (data.token && data.token !== savedToken) {
          localStorage.setItem('token', data.token);
          setToken(data.token);
        }
        if (data.history) {
          setHistory(prev => {
            // If already logged in and server history is empty, it's a wipe!
            if (savedToken && Object.keys(data.history).length === 0) {
              localStorage.removeItem('gameHistory');
              setViewingIndex(0);
              setGamesWon(0);
              return {};
            }

            const merged = { ...data.history, ...prev };
            for (const key of Object.keys(data.history)) {
              const numKey = Number(key);
              const serverGame = data.history[numKey];
              const localGame = prev[numKey];
              if (localGame && serverGame) {
                if (localGame.guesses.length > serverGame.guesses.length) {
                  merged[numKey] = localGame;
                } else {
                  merged[numKey] = serverGame;
                }
              }
            }
            
            const max = Math.max(0, ...Object.keys(merged).map(Number));
            const latestGame = merged[max];
            let nextIndex = max;
            if (latestGame) {
              if (latestGame.date !== todayStr || latestGame.status !== 'playing') {
                nextIndex = max + 1;
              }
            }
            setViewingIndex(nextIndex);
            
            const wins = Object.values(merged).filter((g: any) => g.status === 'won').length;
            setGamesWon(wins);
            
            return merged;
          });
        }
        if (data.username) {
          setUsername(data.username);
          localStorage.setItem('username', data.username);
        } else {
          setUsername(null);
          localStorage.removeItem('username');
        }
        if (data.user) {
          setUserProfile(data.user);
          localStorage.setItem('userProfile', JSON.stringify(data.user));
        }
        setIsDev(!!data.isDev);
        setIsAuthChecking(false);
      })
      .catch(err => {
        console.error("Auth validation failed", err);
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        localStorage.removeItem('userProfile');
        setToken(null);
        setUsername(null);
        setUserProfile(null);
        setIsAuthChecking(false);
      });
    } else {
      setIsAuthChecking(false);
    }
  }, []);

  // Fetch target word when viewing a level we haven't fetched yet
  useEffect(() => {
    if (isAuthChecking) return;
    
    if ((!history[viewingIndex] || !history[viewingIndex].targetWord) && !isFetching) {
      setIsFetching(true);
      const wordNum = getWordNumberForIndex(viewingIndex, activeDate, history);
      const seqIndex = wordNum - 1;
      fetch(`/api/word?index=${viewingIndex}&date=${activeDate}&seq=${seqIndex}`)
        .then(res => res.json())
        .then(data => {
          const decryptedWord = xorDeobfuscate(data.word, data.date);
          setHistory(prev => ({
            ...prev,
            [viewingIndex]: {
              ...prev[viewingIndex],
              targetWord: decryptedWord,
              date: data.date,
              guesses: prev[viewingIndex]?.guesses || [],
              status: prev[viewingIndex]?.status || 'playing'
            }
          }));
          setIsFetching(false);
        })
        .catch(err => {
          console.error('Error fetching target word:', err);
          setIsFetching(false);
        });
    }
  }, [viewingIndex, history, isFetching, isAuthChecking, activeDate]);

  // Check URL parameters for a friend request link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const friendParam = params.get('friend');
    if (friendParam) {
      setFriendToAccept(friendParam);
      sessionStorage.setItem('pendingFriendRequest', friendParam);
      // Clean up the URL query parameters immediately
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      const savedFriend = sessionStorage.getItem('pendingFriendRequest');
      if (savedFriend) {
        setFriendToAccept(savedFriend);
      }
    }
  }, []);

  // When username and friendToAccept are both set, prompt acceptance
  useEffect(() => {
    if (token && username && friendToAccept) {
      if (friendToAccept !== username) {
        setIsAcceptFriendOpen(true);
      } else {
        setFriendToAccept(null);
        sessionStorage.removeItem('pendingFriendRequest');
      }
    }
  }, [token, username, friendToAccept]);

  const handleAuthSuccess = (data: any) => {
    if (data.token) {
      localStorage.setItem('token', data.token);
      setToken(data.token);
    }
    if (data.username) {
      setUsername(data.username);
      localStorage.setItem('username', data.username);
    }
    if (data.user) {
      setUserProfile(data.user);
      localStorage.setItem('userProfile', JSON.stringify(data.user));
    }
    setIsDev(!!data.isDev);

    if (data.isNewUser) {
      if (data.username) {
        setShowGoogleConsentModal(true);
      } else {
        setIsNewGoogleUser(true);
      }
    } else if (!data.user?.email && !data.skipEmailPrompt && data.username) {
      setShowLinkEmailModal(true);
    }

    if (data.history) {
      setHistory(prev => {
        if (Object.keys(data.history).length === 0) {
          localStorage.removeItem('gameHistory');
          setViewingIndex(0);
          setGamesWon(0);
          return {};
        }

        const merged = { ...data.history, ...prev };
        for (const key of Object.keys(data.history)) {
          const numKey = Number(key);
          const serverGame = data.history[numKey];
          const localGame = prev[numKey];
          if (localGame && serverGame) {
            if (localGame.guesses.length > serverGame.guesses.length) {
              merged[numKey] = localGame;
            } else {
              merged[numKey] = serverGame;
            }
          }
        }
        
        const max = Math.max(0, ...Object.keys(merged).map(Number));
        const latestGame = merged[max];
        let nextIndex = max;
        if (latestGame) {
          if (latestGame.date !== todayStr || latestGame.status !== 'playing') {
            nextIndex = max + 1;
          }
        }
        setViewingIndex(nextIndex);
        
        const wins = Object.values(merged).filter((g: any) => g.status === 'won').length;
        setGamesWon(wins);
        
        // Save to local storage for quick offline loading
        localStorage.setItem('gameHistory', JSON.stringify(merged));
        
        return merged;
      });
    }
  };

  const handleLocalAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUsername.trim() || !authPassword) return;

    setIsSubmittingAuth(true);
    setAuthError('');

    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: authUsername.trim(), 
          password: authPassword, 
          emailConsent,
          email: authMode === 'register' ? authEmail : undefined 
        })
      });
      const data = await res.json();
      if (res.ok) {
        handleAuthSuccess(data);
        // Reset credentials fields
        setAuthUsername('');
        setAuthPassword('');
        setAuthEmail('');
      } else {
        setAuthError(data.error || 'Authentication failed');
      }
    } catch (err) {
      console.error(err);
      setAuthError('server connection failed');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleRegisterUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosenUsername.trim()) return;
    setIsSettingUsername(true);
    setSetupError('');
    try {
      const res = await fetch('/api/user/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, username: chosenUsername })
      });
      const data = await res.json();
      if (res.ok) {
        setUsername(data.username);
        if (isNewGoogleUser) {
          setShowGoogleConsentModal(true);
        }
      } else {
        setSetupError(data.error || 'could not set username');
      }
    } catch (err) {
      console.error(err);
      setSetupError('network error occurred');
    } finally {
      setIsSettingUsername(false);
    }
  };

  const handleAcceptFriend = async () => {
    if (!friendToAccept) return;
    try {
      const res = await fetch('/api/friends/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, friend_username: friendToAccept })
      });
      const data = await res.json();
      if (res.ok) {
        showMessage(`you are now friends with @${friendToAccept}!`);
        setIsAcceptFriendOpen(false);
        setFriendToAccept(null);
        sessionStorage.removeItem('pendingFriendRequest');
        setCurrentView('social');
      } else {
        showMessage(data.error || 'could not add friend');
        setIsAcceptFriendOpen(false);
        setFriendToAccept(null);
        sessionStorage.removeItem('pendingFriendRequest');
      }
    } catch (err) {
      console.error(err);
      showMessage('network error occurred');
      setIsAcceptFriendOpen(false);
      setFriendToAccept(null);
      sessionStorage.removeItem('pendingFriendRequest');
    }
  };

  const showMessage = (msg: string, ms = 2000) => {
    setMessage(msg);
    if (ms > 0) {
      setTimeout(() => setMessage(''), ms);
    }
  };

  // Keep localStorage backup in sync when history changes
  useEffect(() => {
    if (Object.keys(history).length === 0) return;
    localStorage.setItem('gameHistory', JSON.stringify(history));
  }, [history]);

  const onKeyPress = useCallback((key: string) => {
    if (gameStatus !== 'playing' || isFetching) return;

    if (activeDate !== todayStr) {
      return;
    }

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

      if (token) {
        const newGuesses = [...guesses, currentGuess];
        let newStatus: 'playing' | 'won' | 'lost' = 'playing';

        if (currentGuess === targetWord) {
          newStatus = 'won';
          setGamesWon(prev => prev + 1);
          showMessage('yay you got it');
        } else if (newGuesses.length === 6) {
          newStatus = 'lost';
          showMessage(`the word was ${targetWord}`, 0);
        }

        // 1. Instantly trigger flip animations and keyboard colors!
        setHistory(prev => ({
          ...prev,
          [viewingIndex]: {
            ...prev[viewingIndex],
            guesses: newGuesses,
            status: newStatus
          }
        }));
        setCurrentGuess('');

        // 2. Persist to server in the background
        setIsFetching(true);
        fetch('/api/guess', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            index: viewingIndex,
            guess: currentGuess,
            date: activeDate
          })
        })
        .then(r => {
          if (!r.ok) {
            throw new Error('Guess submission failed');
          }
          return r.json();
        })
        .then(data => {
          // Merge authoritative server state
          setHistory(prev => {
            const nextHist = {
              ...prev,
              [viewingIndex]: {
                ...data.gameState,
                targetWord: data.gameState.targetWord || prev[viewingIndex]?.targetWord
              }
            };
            const wins = Object.values(nextHist).filter((g: any) => g.status === 'won').length;
            setGamesWon(wins);
            return nextHist;
          });
          setIsFetching(false);
        })
        .catch(err => {
          console.error(err);
          showMessage('failed to sync guess with server');
          setIsFetching(false);
        });
      } else {
        const newGuesses = [...guesses, currentGuess];
        let newStatus: 'playing' | 'won' | 'lost' = 'playing';

        if (currentGuess === targetWord) {
          newStatus = 'won';
          setGamesWon(prev => prev + 1);
          showMessage('yay you got it');
        } else if (newGuesses.length === 6) {
          newStatus = 'lost';
          showMessage(`the word was ${targetWord}`, 0);
        }

        setHistory(prev => {
          const nextHist = {
            ...prev,
            [viewingIndex]: {
              ...prev[viewingIndex],
              guesses: newGuesses,
              status: newStatus
            }
          };
          return nextHist;
        });
        setCurrentGuess('');
      }
      return;
    }

    if (currentGuess.length < 5 && /^[a-z]$/.test(key)) {
      setCurrentGuess(prev => prev + key);
    }
  }, [currentGuess, gameStatus, guesses, targetWord, validWords, isFetching, token, viewingIndex, activeDate]);



  let formattedDateStr = '';
  let wordNumStr = '';
  if (activeDate) {
    const dateObj = new Date(activeDate + 'T12:00:00Z');
    formattedDateStr = dateObj.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    }).toLowerCase();
    const wordNum = getWordNumberForIndex(viewingIndex, activeDate, history);
    wordNumStr = `word #${wordNum}`;
  }

  const isLeftDisabled = viewingIndex === 0 || 
                         !history[viewingIndex - 1] || 
                         history[viewingIndex - 1].date !== activeDate;

  const isRightDisabled = gameStatus === 'playing' || 
                          gameStatus === 'loading' || 
                          (history[viewingIndex + 1] && history[viewingIndex + 1].date !== activeDate) || 
                          (!history[viewingIndex + 1] && activeDate !== todayStr);

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

  const handleSignOut = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('userProfile');
    setToken(null);
    setUsername(null);
    setUserProfile(null);
    setHistory({});
    setGamesWon(0);
    setViewingIndex(0);
  };

  // Handle physical keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (
        !token ||
        currentView !== 'game' ||
        isSettingUsername ||
        showLinkEmailModal ||
        showGoogleConsentModal ||
        isStatsOpen ||
        calendarTarget !== null ||
        isQRCodeOpen ||
        isAcceptFriendOpen ||
        isFetching
      ) {
        return;
      }

      // If the level is won or lost, Enter key goes to the next level
      if ((gameStatus === 'won' || gameStatus === 'lost') && e.key === 'Enter') {
        e.preventDefault();
        handleNext();
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
        return;
      }

      if (gameStatus !== 'playing') {
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        onKeyPress('backspace');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onKeyPress('enter');
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        onKeyPress(e.key.toLowerCase());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    token,
    currentView,
    isSettingUsername,
    showLinkEmailModal,
    showGoogleConsentModal,
    isStatsOpen,
    calendarTarget,
    isQRCodeOpen,
    isAcceptFriendOpen,
    gameStatus,
    isFetching,
    onKeyPress,
    handlePrev,
    handleNext
  ]);

  // We only count actual games finished in the viewingIndex logic, but the user requested 'gamesPlayed' at the top.
  // We can calculate games played by counting non-playing games in history, or just tracking the max index visited.
  const gamesPlayed = Object.values(history).filter(g => g.status !== 'playing').length;

  return (
    <>
      {message && (
        <div className="message-container">
          <div className="message">{message}</div>
        </div>
      )}

      {!token ? (
        <div className="login-screen">
          <div className="login-card">
            <div className="login-logo-container">
              <svg className="login-logo" viewBox="0 0 512 512" width="72" height="72">
                <rect width="512" height="512" rx="128" fill="#10b981"/>
                <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="'Outfit', sans-serif" font-weight="800" font-size="280" fill="#ffffff">5</text>
              </svg>
              <h1 className="login-title">5 letter word</h1>
            </div>

            <div className="auth-mode-tabs">
              <button 
                type="button"
                className={`auth-tab-btn ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('login');
                  setAuthError('');
                }}
              >
                login
              </button>
              <button 
                type="button"
                className={`auth-tab-btn ${authMode === 'register' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('register');
                  setAuthError('');
                }}
              >
                create account
              </button>
            </div>

            <form onSubmit={handleLocalAuth} className="credentials-form">
              <div className="input-group-field">
                <label htmlFor="auth-username">username</label>
                <input
                  id="auth-username"
                  type="text"
                  placeholder="enter username"
                  value={authUsername}
                  onChange={e => setAuthUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  maxLength={20}
                  required
                  disabled={isSubmittingAuth}
                />
              </div>

              <div className="input-group-field">
                <label htmlFor="auth-password">password</label>
                <input
                  id="auth-password"
                  type="password"
                  placeholder={authMode === 'login' ? 'enter password' : 'create secure password (min 6 chars)'}
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  minLength={6}
                  required
                  disabled={isSubmittingAuth}
                />
              </div>

              {authMode === 'register' && (
                <div className="input-group-field" style={{ marginBottom: '12px' }}>
                  <label htmlFor="auth-email">email (optional)</label>
                  <input
                    id="auth-email"
                    type="email"
                    placeholder="enter email address"
                    value={authEmail}
                    onChange={e => setAuthEmail(e.target.value)}
                    disabled={isSubmittingAuth}
                    style={{ textTransform: 'none' }}
                  />
                  <div style={{ fontSize: '0.68rem', color: '#71717a', marginTop: '4px', textTransform: 'none', lineHeight: '1.3' }}>
                    Suggested for account recovery and daily/weekly notifications.
                  </div>
                </div>
              )}

              {authMode === 'register' && (
                <div className="auth-consent-container" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '12px 0 6px 0' }}>
                  <input
                    id="auth-consent-manual"
                    type="checkbox"
                    checked={emailConsent}
                    onChange={e => setEmailConsent(e.target.checked)}
                    style={{ marginTop: '3px', cursor: 'pointer', accentColor: '#10b981' }}
                  />
                  <label htmlFor="auth-consent-manual" style={{ fontSize: '0.78rem', color: '#a1a1aa', cursor: 'pointer', lineHeight: '1.4', fontWeight: '500', textTransform: 'none', letterSpacing: 'normal' }}>
                    I consent to receive daily reminders and weekly digests to keep my streak active.
                  </label>
                </div>
              )}

              {authError && <div className="auth-error-banner">{authError}</div>}

              <button type="submit" className="btn btn-primary auth-submit-btn" disabled={isSubmittingAuth}>
                {isSubmittingAuth ? 'authenticating...' : authMode === 'login' ? 'login' : 'register'}
              </button>
            </form>

            <div className="auth-divider">
              <span>or sign in with</span>
            </div>

            <div className="google-auth-wrapper">
              <GoogleLogin
                onSuccess={credentialResponse => {
                  const userToken = credentialResponse.credential!;
                  localStorage.setItem('token', userToken);
                  setToken(userToken);
                  fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: userToken })
                  })
                  .then(r => {
                    if (!r.ok) {
                      throw new Error('Auth failed on server');
                    }
                    return r.json();
                  })
                  .then(data => {
                    handleAuthSuccess(data);
                  })
                  .catch(err => {
                    console.error("Login verification failed", err);
                    localStorage.removeItem('token');
                    localStorage.removeItem('username');
                    localStorage.removeItem('userProfile');
                    setToken(null);
                    setUsername(null);
                    setUserProfile(null);
                    setAuthError('Google sign in failed');
                  });
                }}
                onError={() => {
                  console.log('Login Failed');
                  setAuthError('Google authentication failed');
                }}
              />
            </div>
          </div>
        </div>
      ) : !username ? (
        <div className="username-setup-screen">
          <div className="setup-card">
            <h2>create your username</h2>
            <p>choose a unique username to save your stats and play with friends!</p>
            <form onSubmit={handleRegisterUsername} className="setup-form">
              <div className="input-group">
                <span className="prefix">@</span>
                <input 
                  type="text" 
                  placeholder="username" 
                  value={chosenUsername} 
                  onChange={e => setChosenUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  maxLength={20}
                  required
                />
              </div>
              <p className="setup-hint">3-20 characters. lowercase letters, numbers, or underscores only.</p>
              {setupError && <div className="setup-error">{setupError}</div>}
              <button type="submit" className="btn btn-primary" disabled={isSettingUsername}>
                {isSettingUsername ? 'saving...' : 'confirm username'}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <>
          <Header 
            gamesWon={gamesWon} 
            gamesPlayed={gamesPlayed} 
            onOpenStats={() => setIsStatsOpen(true)}
            onOpenCalendar={() => setCalendarTarget('self')}
            onSignOut={handleSignOut}
          />

          <div className="tab-navigation">
            <button 
              className={`tab-btn ${currentView === 'game' ? 'active' : ''}`}
              onClick={() => setCurrentView('game')}
            >
              game
            </button>
            <button 
              className={`tab-btn ${currentView === 'social' ? 'active' : ''}`}
              onClick={() => setCurrentView('social')}
            >
              social
            </button>
            <a 
              href="https://gnomebuddygames.com" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="tab-btn other-games-tab"
            >
              <img src="/gnomebuddy.png" alt="gnome" className="other-games-icon" />
              other games
            </a>
          </div>
          
          {currentView === 'game' ? (
            <main>
              {formattedDateStr && (
                <div className="game-header">
                  {formattedDateStr}, <strong>{wordNumStr}</strong>
                  {activeDate === todayStr ? ` - ${countdown} until next word list` : ' - view only'}
                </div>
              )}
              
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
          ) : (
            <SocialPage 
              token={token} 
              currentUsername={username || ''} 
              currentUserProfile={userProfile || { name: '', picture: '' }} 
              currentDate={activeDate}
              onOpenQRCode={() => setIsQRCodeOpen(true)}
              onOpenFriendCalendar={(friend) => setCalendarTarget(friend)}
            />
          )}
        </>
      )}

      <StatsModal 
        isOpen={isStatsOpen} 
        onClose={() => setIsStatsOpen(false)} 
        history={history} 
        currentDate={activeDate} 
      />

      <QRCodeModal 
        isOpen={isQRCodeOpen} 
        onClose={() => setIsQRCodeOpen(false)} 
        username={username || ''} 
        qrCodeImageSrc={qrCodeImageSrc}
      />

      <CalendarModal
        isOpen={calendarTarget !== null}
        onClose={() => setCalendarTarget(null)}
        history={calendarTarget === 'self' ? history : (calendarTarget?.history ?? {})}
        viewerHistory={history}
        currentDate={activeDate}
        isFriendMode={calendarTarget !== 'self' && calendarTarget !== null}
        friendName={calendarTarget !== 'self' && calendarTarget !== null ? calendarTarget.display_name : undefined}
        onJumpToLevel={(index) => {
          setViewingIndex(index);
          setCurrentView('game');
        }}
        onViewFriendBoard={(level) => setFriendBoardView(level)}
      />

      <BoardViewModal
        isOpen={friendBoardView !== null}
        onClose={() => setFriendBoardView(null)}
        guesses={friendBoardView?.guesses ?? []}
        targetWord={friendBoardView?.targetWord ?? ''}
        status={friendBoardView?.status ?? 'playing'}
        friendName={calendarTarget !== 'self' && calendarTarget !== null ? calendarTarget.display_name : ''}
        levelIndex={friendBoardView?.index ?? 0}
        seqIndex={friendBoardView?.seqIndex}
      />

      <AcceptFriendModal 
        isOpen={isAcceptFriendOpen} 
        friendUsername={friendToAccept || ''} 
        onAccept={handleAcceptFriend} 
        onClose={() => {
          setIsAcceptFriendOpen(false);
          setFriendToAccept(null);
          sessionStorage.removeItem('pendingFriendRequest');
        }}
      />

      {showGoogleConsentModal && (
        <div className="modal-overlay" style={{ zIndex: 1000 }}>
          <div className="modal-content" style={{ maxWidth: '400px', width: '90%', padding: '24px', textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.48rem', marginBottom: '8px', color: '#f8fafc', fontWeight: '800' }}>Enable Reminders?</h2>
            <p style={{ fontSize: '0.84rem', color: '#94a3b8', marginBottom: '22px', lineHeight: '1.5' }}>
              Would you like to opt in to daily email reminders to keep your win streak active and receive weekly digests?
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button 
                className="btn btn-primary" 
                onClick={async () => {
                  try {
                    const res = await fetch('/api/user/update-consent', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ token, consent: true })
                    });
                    if (res.ok) {
                      setShowGoogleConsentModal(false);
                    } else {
                      alert('Failed to save preference');
                    }
                  } catch (err) {
                    console.error(err);
                    alert('Network error while saving preferences.');
                  }
                }}
                style={{ width: '100%', padding: '10px' }}
              >
                Yes, Enable Reminders
              </button>
              <button 
                className="btn" 
                onClick={async () => {
                  try {
                    const res = await fetch('/api/user/update-consent', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ token, consent: false })
                    });
                    if (res.ok) {
                      setShowGoogleConsentModal(false);
                    } else {
                      alert('Failed to save preference');
                    }
                  } catch (err) {
                    console.error(err);
                    alert('Network error while saving preferences.');
                  }
                }}
                style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '10px' }}
              >
                No Thanks
              </button>
            </div>
          </div>
        </div>
      )}

      {showLinkEmailModal && !skipEmailPrompt && (
        <div className="modal-overlay" style={{ zIndex: 1000 }}>
          <div className="modal-content" style={{ maxWidth: '400px', width: '90%', padding: '24px', textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.48rem', marginBottom: '8px', color: '#f8fafc', fontWeight: '800' }}>Save Your Streak!</h2>
            <p style={{ fontSize: '0.84rem', color: '#94a3b8', marginBottom: '18px', lineHeight: '1.5' }}>
              Link an email to receive daily win streak reminders, weekly digests, and enable account recovery.
            </p>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!linkEmailInput.trim()) return;
              try {
                const res = await fetch('/api/user/link-email', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token, email: linkEmailInput.trim() })
                });
                const data = await res.json();
                if (res.ok) {
                  const updatedProfile = {
                    name: userProfile?.name || '',
                    picture: userProfile?.picture || '',
                    email: data.email
                  };
                  setUserProfile(updatedProfile);
                  localStorage.setItem('userProfile', JSON.stringify(updatedProfile));
                  setShowLinkEmailModal(false);
                  setLinkEmailInput('');
                } else {
                  alert(data.error || 'Failed to link email');
                }
              } catch (err) {
                console.error(err);
                alert('Network error while linking email.');
              }
            }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="input-group-field" style={{ textAlign: 'left' }}>
                <label htmlFor="modal-email-input" style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 'bold' }}>email address</label>
                <input
                  id="modal-email-input"
                  type="email"
                  placeholder="enter your email address"
                  value={linkEmailInput}
                  onChange={e => setLinkEmailInput(e.target.value)}
                  required
                  style={{ width: '100%', textTransform: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '10px' }}>
                  Link Email
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    type="button" 
                    className="btn" 
                    onClick={() => {
                      setShowLinkEmailModal(false);
                      setLinkEmailInput('');
                    }}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '8px' }}
                  >
                    Maybe Later
                  </button>
                  <button 
                    type="button" 
                    className="btn" 
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/user/skip-email-prompt', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ token })
                        });
                        if (res.ok) {
                          setSkipEmailPrompt(true);
                          setShowLinkEmailModal(false);
                          setLinkEmailInput('');
                        } else {
                          alert('Failed to save preference');
                        }
                      } catch (err) {
                        console.error(err);
                        alert('Network error while saving preferences.');
                      }
                    }}
                    style={{ flex: 1, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', padding: '8px' }}
                  >
                    Stop Asking
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDev && token && <DevPanel token={token} />}
    </>
  );
}
