import { useState } from 'react';

interface GameState {
  status: 'playing' | 'won' | 'lost';
  guesses: string[];
  date: string;
  targetWord?: string;
}

interface User {
  google_id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  history?: Record<number, GameState>;
  email_consent?: boolean;
}

interface Props {
  token: string;
}

type Tab = 'words' | 'players' | 'emails';

const groupHistoryByDate = (historyObj?: Record<number, GameState>) => {
  if (!historyObj) return {};
  const grouped: Record<string, { index: number; game: GameState }[]> = {};
  for (const [key, game] of Object.entries(historyObj)) {
    if (!game) continue;
    const dateStr = game.date || 'no date';
    if (!grouped[dateStr]) grouped[dateStr] = [];
    grouped[dateStr].push({ index: Number(key), game });
  }
  const sortedDates: Record<string, { index: number; game: GameState }[]> = {};
  Object.keys(grouped)
    .sort((a, b) => b.localeCompare(a))
    .forEach(d => {
      sortedDates[d] = grouped[d].sort((a, b) => a.index - b.index);
    });
  return sortedDates;
};

export default function DevPanel({ token }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('players');

  // Words tab
  const [offset, setOffset] = useState(0);
  const [wordOffset, setWordOffset] = useState(0);
  const [dayData, setDayData] = useState<{ date: string; words: string[]; wordOffset: number } | null>(null);
  const [wordsLoading, setWordsLoading] = useState(false);

  // Players tab
  const [users, setUsers] = useState<User[]>([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ user: User; action: 'wipe' | 'delete' } | null>(null);
  const [confirmWipeDay, setConfirmWipeDay] = useState<{ user: User; date: string } | null>(null);
  const [confirmWipeWord, setConfirmWipeWord] = useState<{ user: User; index: number; word: string } | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [activeEmailDropdown, setActiveEmailDropdown] = useState<string | null>(null);
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const apiPost = async (path: string, body: object) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const fetchWords = async (newOffset: number, newWordOffset: number) => {
    setWordsLoading(true);
    setError(null);
    try {
      const data = await apiPost('/api/dev/words', { offset: newOffset, wordOffset: newWordOffset, count: 5 });
      setDayData({ date: data.date, words: data.words, wordOffset: data.wordOffset });
      setOffset(newOffset);
      setWordOffset(newWordOffset);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWordsLoading(false);
    }
  };

  const [cronLogs, setCronLogs] = useState<any[]>([]);
  const [cronLogsLoading, setCronLogsLoading] = useState(false);
  const [forceCronType, setForceCronType] = useState('');
  const [cronRunning, setCronRunning] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  const fetchCronLogs = async () => {
    setCronLogsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dev/cron-logs?token=${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch cron logs');
      setCronLogs(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCronLogsLoading(false);
    }
  };

  const handleTriggerCron = async () => {
    setCronRunning(true);
    setError(null);
    setActionMsg(null);
    try {
      const forceQuery = forceCronType ? `&forceType=${forceCronType}` : '';
      const res = await fetch(`/api/cron/reminders?token=${token}${forceQuery}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to run cron job');
      setActionMsg(`Triggered automated reminder check successfully. Action: "${data.actionType || 'none'}". Emails Sent: ${data.emailsSentCount || 0}.`);
      await fetchCronLogs();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCronRunning(false);
    }
  };

  const fetchUsers = async () => {
    setUsersLoading(true);
    setError(null);
    setActionMsg(null);
    try {
      const data = await apiPost('/api/dev/users', {});
      setUsers(data.users);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUsersLoading(false);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    fetchUsers();
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setError(null);
    setActionMsg(null);
    if (t === 'players' && users.length === 0) fetchUsers();
    if (t === 'words' && !dayData) fetchWords(offset, wordOffset);
    if (t === 'emails') fetchCronLogs();
  };

  const confirmAction = async () => {
    if (!confirmTarget) return;
    const { user, action } = confirmTarget;
    setConfirmTarget(null);
    setError(null);
    try {
      if (action === 'wipe') {
        const data = await apiPost('/api/dev/wipe-history', { targetGoogleId: user.google_id });
        if (data.isSelf) {
          localStorage.removeItem('gameHistory');
          window.location.reload();
          return;
        }
        setActionMsg(`Wiped history for ${user.display_name || user.email}`);
        await fetchUsers();
      } else {
        await apiPost('/api/dev/delete-account', { targetGoogleId: user.google_id });
        setUsers(prev => prev.filter(u => u.google_id !== user.google_id));
        setActionMsg(`Deleted account for ${user.display_name || user.email}`);
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleWipeDay = async () => {
    if (!confirmWipeDay) return;
    const { user, date } = confirmWipeDay;
    setConfirmWipeDay(null);
    setError(null);
    setActionMsg(null);
    try {
      const data = await apiPost('/api/dev/wipe-day', { targetGoogleId: user.google_id, date });
      if (data.isSelf) {
        localStorage.removeItem('gameHistory');
        window.location.reload();
        return;
      }
      setActionMsg(`Wiped history for date ${date} for player ${user.display_name || user.email}`);
      await fetchUsers();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleWipeWord = async () => {
    if (!confirmWipeWord) return;
    const { user, index, word } = confirmWipeWord;
    setConfirmWipeWord(null);
    setError(null);
    setActionMsg(null);
    try {
      const data = await apiPost('/api/dev/wipe-word', { targetGoogleId: user.google_id, index });
      if (data.isSelf) {
        localStorage.removeItem('gameHistory');
        window.location.reload();
        return;
      }
      setActionMsg(`Wiped word "${word.toUpperCase()}" (Lvl ${index}) for player ${user.display_name || user.email}`);
      await fetchUsers();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSendEmail = async (user: User, emailType: string) => {
    if (!user.email) {
      setError("User does not have a registered email address.");
      return;
    }
    setError(null);
    setActionMsg(null);
    try {
      await apiPost('/api/dev/send-email', { targetGoogleId: user.google_id, emailType });
      setActionMsg(`Manually triggered "${emailType}" email to ${user.display_name || user.email}`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handlePrevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear(prev => prev - 1);
    } else {
      setCalendarMonth(prev => prev - 1);
    }
    setSelectedDateStr(null);
  };

  const handleNextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear(prev => prev + 1);
    } else {
      setCalendarMonth(prev => prev + 1);
    }
    setSelectedDateStr(null);
  };

  const renderPlayerHistory = (u: User) => {
    const historyObj = u.history;
    const grouped = groupHistoryByDate(historyObj);
    
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const startDayOfWeek = new Date(calendarYear, calendarMonth, 1).getDay();
    const monthName = new Date(calendarYear, calendarMonth).toLocaleString('default', { month: 'long' });

    return (
      <div className="dev-panel-player-history-details" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px', marginTop: '4px' }}>
        
        {/* Calendar Navigation Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', padding: '0 4px' }}>
          <button 
            type="button" 
            onClick={handlePrevMonth} 
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#10b981', cursor: 'pointer', fontWeight: 'bold', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}
          >
            &lt;
          </button>
          <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ffffff' }}>
            {monthName} {calendarYear}
          </span>
          <button 
            type="button" 
            onClick={handleNextMonth} 
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#10b981', cursor: 'pointer', fontWeight: 'bold', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}
          >
            &gt;
          </button>
        </div>

        {/* Days of the Week Header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '6px' }}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
            <span key={day} style={{ fontSize: '0.65rem', color: '#6b7280', fontWeight: 'bold' }}>{day}</span>
          ))}
        </div>

        {/* Calendar Days Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '12px' }}>
          {/* Empty prefix cells for start of month */}
          {Array.from({ length: startDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {/* Day number buttons */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const hasPlayed = !!grouped[dateStr] && grouped[dateStr].length > 0;
            const isSelected = selectedDateStr === dateStr;

            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDateStr(dateStr)}
                style={{
                  background: isSelected 
                    ? '#6366f1' 
                    : hasPlayed 
                      ? 'rgba(16, 185, 129, 0.2)' 
                      : 'transparent',
                  border: isSelected 
                    ? '1px solid #818cf8' 
                    : hasPlayed
                      ? '1px solid rgba(16, 185, 129, 0.4)'
                      : '1px solid rgba(255,255,255,0.05)',
                  color: isSelected 
                    ? '#ffffff'
                    : hasPlayed 
                      ? '#34d399' 
                      : '#9ca3af',
                  borderRadius: '4px',
                  padding: '4px 0',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  fontWeight: hasPlayed ? 'bold' : 'normal',
                  transition: 'all 0.2s',
                  outline: 'none'
                }}
              >
                {day}
              </button>
            );
          })}
        </div>

        {/* Selected Date Details Panel */}
        {selectedDateStr ? (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 'bold' }}>📅 {selectedDateStr}</span>
              {grouped[selectedDateStr] && grouped[selectedDateStr].length > 0 && (
                <button
                  className="dev-panel-btn-wipe"
                  onClick={() => setConfirmWipeDay({ user: u, date: selectedDateStr })}
                  style={{ padding: '2px 8px', fontSize: '0.65rem' }}
                >
                  Wipe Day
                </button>
              )}
            </div>

            {grouped[selectedDateStr] && grouped[selectedDateStr].length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {grouped[selectedDateStr].map(({ index, game }, seqIndex) => {
                  const targetWord = game.targetWord || 'unknown';
                  return (
                    <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.03)' }}>
                      <span style={{ fontSize: '0.72rem', color: '#d1d5db' }}>
                        Word #{seqIndex + 1} (Lvl {index}): <code style={{ color: '#fbbf24', fontStyle: 'normal' }}>{targetWord.toUpperCase()}</code> ({game.guesses.length}/6, {game.status})
                      </span>
                      <button
                        className="dev-panel-btn-delete"
                        onClick={() => setConfirmWipeWord({ user: u, index, word: targetWord })}
                        style={{ padding: '2px 6px', fontSize: '0.65rem' }}
                      >
                        Wipe Word
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '0.72rem', color: '#6b7280', textAlign: 'center', padding: '6px' }}>
                No play history recorded on this day.
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: '0.72rem', color: '#6b7280', textAlign: 'center', padding: '8px', background: 'rgba(255,255,255,0.01)', borderRadius: '6px', border: '1px dashed rgba(255,255,255,0.05)' }}>
            Select a day from the calendar to inspect or edit words.
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) {
    return (
      <button className="dev-panel-toggle" onClick={handleOpen}>🛠 Dev</button>
    );
  }

  return (
    <div className="dev-panel">
      <div className="dev-panel-header">
        <strong>Dev Tools</strong>
        <button className="dev-panel-close" onClick={() => setIsOpen(false)}>✕</button>
      </div>

      <div className="dev-panel-tabs">
        <button className={tab === 'words' ? 'active' : ''} onClick={() => switchTab('words')}>Words</button>
        <button className={tab === 'players' ? 'active' : ''} onClick={() => switchTab('players')}>Players</button>
        <button className={tab === 'emails' ? 'active' : ''} onClick={() => switchTab('emails')}>Reminder Logs</button>
      </div>

      {error && <div className="dev-panel-error">{error}</div>}
      {actionMsg && <div className="dev-panel-success">{actionMsg}</div>}

      {tab === 'words' && (
        <>
          {wordsLoading ? (
            <div className="dev-panel-loading">Loading…</div>
          ) : dayData ? (
            <div className="dev-panel-day" style={{ marginBottom: '1rem' }}>
              <div className="dev-panel-date">
                <strong>{dayData.date}</strong>
                {offset === 0 ? ' (today)' : offset < 0 ? ` (${Math.abs(offset)}d ago)` : ` (+${offset}d)`}
              </div>
              <div className="dev-panel-words" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1rem' }}>
                {dayData.words.map((w, i) => {
                  const globalWordIndex = dayData.wordOffset + i;
                  return (
                    <div key={i} className="dev-panel-word">
                      <span className="dev-panel-word-label">Word {globalWordIndex + 1}</span>
                      <code>{w.toUpperCase()}</code>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="dev-panel-nav" style={{ marginBottom: '8px' }}>
            <button 
              onClick={() => fetchWords(offset, Math.max(0, wordOffset - 5))} 
              disabled={wordsLoading || wordOffset === 0}
            >
              ⟪ Prev 5
            </button>
            <button 
              onClick={() => fetchWords(offset, wordOffset + 5)} 
              disabled={wordsLoading}
            >
              Next 5 ⟫
            </button>
          </div>

          <div className="dev-panel-nav">
            <button onClick={() => fetchWords(offset - 1, 0)} disabled={wordsLoading}>
              ← Prev Day
            </button>
            <button onClick={() => fetchWords(0, 0)} disabled={wordsLoading || (offset === 0 && wordOffset === 0)}>
              Today
            </button>
            <button onClick={() => fetchWords(offset + 1, 0)} disabled={wordsLoading}>
              Next Day →
            </button>
          </div>
        </>
      )}

      {tab === 'players' && (
        <>
          <div className="dev-panel-player-toolbar">
            <input
              className="dev-panel-search"
              type="text"
              placeholder="search players…"
              value={playerSearch}
              onChange={e => setPlayerSearch(e.target.value)}
            />
            <button className="dev-panel-refresh" onClick={fetchUsers} disabled={usersLoading}>
              {usersLoading ? '…' : '↻'}
            </button>
          </div>
          <div className="dev-panel-player-list">
            {users.filter(u => {
              const q = playerSearch.toLowerCase();
              return !q || (u.display_name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
            }).map(u => (
              <div key={u.google_id} className="dev-panel-player-wrapper" style={{ display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '6px', marginBottom: '4px' }}>
                <div className="dev-panel-player" style={{ background: 'none', padding: 0 }}>
                  <div className="dev-panel-player-info">
                    <span className="dev-panel-player-name">{u.display_name || u.email || 'No Name'}</span>
                    {u.username && <span className="dev-panel-player-username">@{u.username}</span>}
                  </div>
                  <div className="dev-panel-player-actions">
                    <button
                      className="dev-panel-btn-wipe"
                      onClick={() => {
                        if (expandedUser === u.google_id) {
                          setExpandedUser(null);
                        } else {
                          setExpandedUser(u.google_id);
                          setCalendarMonth(new Date().getMonth());
                          setCalendarYear(new Date().getFullYear());
                          setSelectedDateStr(null);
                        }
                      }}
                      style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8' }}
                    >
                      {expandedUser === u.google_id ? '▲ Hide' : '▼ History'}
                    </button>
                    <div className="dev-panel-dropdown-container" style={{ position: 'relative', display: 'inline-block' }}>
                      <button
                        className="dev-panel-btn-wipe"
                        onClick={() => setActiveEmailDropdown(activeEmailDropdown === u.google_id ? null : u.google_id)}
                        style={{
                          background: 'rgba(16,185,129,0.15)',
                          border: '1px solid rgba(16,185,129,0.3)',
                          color: '#34d399'
                        }}
                      >
                        {activeEmailDropdown === u.google_id ? '▲ Email' : '▼ Email'}
                      </button>
                      
                      {activeEmailDropdown === u.google_id && (
                        <>
                          <div 
                            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 90 }} 
                            onClick={() => setActiveEmailDropdown(null)} 
                          />
                           <div
                            className="dev-panel-dropdown-menu"
                            style={{
                              position: 'absolute',
                              top: '26px',
                              right: 0,
                              background: '#1e293b',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              borderRadius: '8px',
                              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                              zIndex: 100,
                              minWidth: '140px',
                              padding: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              boxSizing: 'border-box'
                            }}
                          >
                            <label style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontSize: '0.72rem',
                              color: '#94a3b8',
                              padding: '4px 6px 8px 6px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              userSelect: 'none',
                              fontWeight: '600',
                              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                              marginBottom: '4px'
                            }}>
                              <input
                                type="checkbox"
                                checked={!!u.email_consent}
                                onChange={async (e) => {
                                  const newConsent = e.target.checked;
                                  try {
                                    await apiPost('/api/dev/update-consent', { targetGoogleId: u.google_id, consent: newConsent });
                                    await fetchUsers(); // Refresh the list
                                  } catch (err: any) {
                                    setError(err.message);
                                  }
                                }}
                                style={{ cursor: 'pointer', accentColor: '#10b981', margin: 0 }}
                              />
                              Consent Opt-in
                            </label>
                            <button
                              onClick={() => {
                                handleSendEmail(u, 'password_reset');
                                setActiveEmailDropdown(null);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#e2e8f0',
                                textAlign: 'left',
                                padding: '6px 8px',
                                fontSize: '0.72rem',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                width: '100%',
                                transition: 'background 0.2s',
                                fontWeight: '600'
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                            >
                              Password Reset
                            </button>
                            <button
                              onClick={() => {
                                handleSendEmail(u, 'live_streak');
                                setActiveEmailDropdown(null);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#e2e8f0',
                                textAlign: 'left',
                                padding: '6px 8px',
                                fontSize: '0.72rem',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                width: '100%',
                                transition: 'background 0.2s',
                                fontWeight: '600'
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                            >
                              Live Streak
                            </button>
                            <button
                              onClick={() => {
                                handleSendEmail(u, 'welcome_reminder');
                                setActiveEmailDropdown(null);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#e2e8f0',
                                textAlign: 'left',
                                padding: '6px 8px',
                                fontSize: '0.72rem',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                width: '100%',
                                transition: 'background 0.2s',
                                fontWeight: '600'
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                            >
                              Welcome Reminder
                            </button>
                            <button
                              onClick={() => {
                                handleSendEmail(u, 'lost_streak');
                                setActiveEmailDropdown(null);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#e2e8f0',
                                textAlign: 'left',
                                padding: '6px 8px',
                                fontSize: '0.72rem',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                width: '100%',
                                transition: 'background 0.2s',
                                fontWeight: '600'
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                            >
                              Lost Streak
                            </button>
                            <button
                              onClick={() => {
                                handleSendEmail(u, 'weekly_digest');
                                setActiveEmailDropdown(null);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#e2e8f0',
                                textAlign: 'left',
                                padding: '6px 8px',
                                fontSize: '0.72rem',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                width: '100%',
                                transition: 'background 0.2s',
                                fontWeight: '600'
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                            >
                              Weekly Digest
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      className="dev-panel-btn-wipe"
                      onClick={() => setConfirmTarget({ user: u, action: 'wipe' })}
                    >Wipe All</button>
                    <button
                      className="dev-panel-btn-delete"
                      onClick={() => setConfirmTarget({ user: u, action: 'delete' })}
                    >Delete</button>
                  </div>
                </div>
                {expandedUser === u.google_id && renderPlayerHistory(u)}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'emails' && (
        <div className="dev-panel-cron" style={{ display: 'flex', flexDirection: 'column', gap: '16px', color: '#e2e8f0' }}>
          {/* Cron Trigger Tool */}
          <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Trigger Automated Scheduler</h3>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <select 
                value={forceCronType} 
                onChange={(e) => setForceCronType(e.target.value)}
                style={{
                  background: '#1e293b',
                  border: '1px solid #475569',
                  color: '#fff',
                  borderRadius: '4px',
                  padding: '6px 10px',
                  fontSize: '0.8rem',
                  outline: 'none',
                  flex: 1
                }}
              >
                <option value="">Default (run based on current Chicago time)</option>
                <option value="live_streak">Force: Keep Streak Reminders (10 PM style)</option>
                <option value="lost_streak">Force: Lost Streak Warnings (10 AM style)</option>
                <option value="welcome_reminder">Force: Welcome Reminders</option>
                <option value="weekly_digest">Force: Weekly Digests</option>
              </select>
              <button 
                onClick={handleTriggerCron}
                disabled={cronRunning}
                style={{
                  background: '#10b981',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  cursor: cronRunning ? 'default' : 'pointer',
                  opacity: cronRunning ? 0.6 : 1
                }}
              >
                {cronRunning ? 'Running...' : 'Run Scheduler'}
              </button>
            </div>
            <p style={{ margin: '8px 0 0 0', fontSize: '0.72rem', color: '#64748b', lineHeight: '1.4' }}>
              This runs the full automated logic. Users must have email consent set to TRUE in the DB to be processed.
            </p>
          </div>

          {/* Cron Logs List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <h3 style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Recent Runs Log</h3>
              <button 
                onClick={fetchCronLogs}
                disabled={cronLogsLoading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#10b981',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline'
                }}
              >
                Refresh
              </button>
            </div>

            {cronLogsLoading ? (
              <div className="dev-panel-loading" style={{ padding: '20px 0' }}>Loading logs...</div>
            ) : cronLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '0.8rem', border: '1px dashed #334155', borderRadius: '8px' }}>
                No executions logged yet. Trigger the scheduler to generate logs.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto', paddingRight: '4px' }}>
                {cronLogs.map((log: any) => {
                  const isExpanded = expandedLogId === log.id;
                  const runDate = new Date(log.run_at).toLocaleString();
                  const detailsObj = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                  
                  return (
                    <div 
                      key={log.id} 
                      style={{
                        background: 'rgba(15, 23, 42, 0.4)',
                        border: `1px solid ${log.success ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                        borderRadius: '6px',
                        padding: '10px',
                        fontSize: '0.75rem'
                      }}
                    >
                      <div 
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                      >
                        <div>
                          <span style={{ fontWeight: 'bold', color: log.success ? '#10b981' : '#ef4444', marginRight: '6px' }}>
                            {log.success ? '● SUCCESS' : '● FAILED'}
                          </span>
                          <span style={{ color: '#fff', fontWeight: 'bold' }}>{log.action_type || 'unspecified'}</span>
                          <span style={{ color: '#64748b', marginLeft: '8px' }}>{runDate}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: '#94a3b8' }}>
                            Sent: <strong style={{ color: '#10b981' }}>{log.sent_count ?? 0}</strong> | Skipped: <strong>{log.skipped_count ?? 0}</strong>
                          </span>
                          <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{isExpanded ? '▼' : '▶'}</span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {log.success ? (
                            <>
                              {detailsObj?.sentEmails?.length > 0 && (
                                <div>
                                  <div style={{ color: '#10b981', fontWeight: 'bold', marginBottom: '4px' }}>✓ Sent Emails:</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '8px' }}>
                                    {detailsObj.sentEmails.map((email: any, idx: number) => (
                                      <div key={idx} style={{ color: '#e2e8f0' }}>
                                        - {email.email} ({email.type})
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {detailsObj?.skippedUsers?.length > 0 && (
                                <div>
                                  <div style={{ color: '#f59e0b', fontWeight: 'bold', marginBottom: '4px' }}>◌ Skipped Users:</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '8px', maxHeight: '150px', overflowY: 'auto' }}>
                                    {detailsObj.skippedUsers.map((skip: any, idx: number) => (
                                      <div key={idx} style={{ color: '#94a3b8' }}>
                                        - {skip.email || `ID: ${skip.google_id.slice(0, 8)}...`}: <span style={{ color: '#94a3b8', opacity: 0.8 }}>({skip.reason || skip.error || 'skipped'})</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {(!detailsObj?.sentEmails?.length && !detailsObj?.skippedUsers?.length) && (
                                <div style={{ color: '#64748b', fontStyle: 'italic' }}>No users met the email consent criteria.</div>
                              )}
                            </>
                          ) : (
                            <div style={{ color: '#ef4444', fontFamily: 'monospace' }}>
                              Error: {detailsObj?.error || 'Unknown execution failure.'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {confirmTarget && (
        <div className="dev-panel-confirm">
          <p>
            {confirmTarget.action === 'wipe'
              ? `Wipe all game history for ${confirmTarget.user.display_name || confirmTarget.user.email}?`
              : `Permanently delete account for ${confirmTarget.user.display_name || confirmTarget.user.email}? This cannot be undone.`}
          </p>
          <div className="dev-panel-confirm-btns">
            <button onClick={() => setConfirmTarget(null)}>Cancel</button>
            <button
              className={confirmTarget.action === 'delete' ? 'dev-panel-btn-delete' : 'dev-panel-btn-wipe'}
              onClick={confirmAction}
            >Confirm</button>
          </div>
        </div>
      )}

      {confirmWipeDay && (
        <div className="dev-panel-confirm">
          <p>
            Wipe all history for date <strong>{confirmWipeDay.date}</strong> for player <strong>{confirmWipeDay.user.display_name || confirmWipeDay.user.email}</strong>?
          </p>
          <div className="dev-panel-confirm-btns">
            <button onClick={() => setConfirmWipeDay(null)}>Cancel</button>
            <button className="dev-panel-btn-wipe" onClick={handleWipeDay}>Confirm Wipe Day</button>
          </div>
        </div>
      )}

      {confirmWipeWord && (
        <div className="dev-panel-confirm">
          <p>
            Wipe the word <strong>{confirmWipeWord.word.toUpperCase()}</strong> (Lvl {confirmWipeWord.index}) for player <strong>{confirmWipeWord.user.display_name || confirmWipeWord.user.email}</strong>?
          </p>
          <div className="dev-panel-confirm-btns">
            <button onClick={() => setConfirmWipeWord(null)}>Cancel</button>
            <button className="dev-panel-btn-wipe" onClick={handleWipeWord}>Confirm Wipe Word</button>
          </div>
        </div>
      )}
    </div>
  );
}
