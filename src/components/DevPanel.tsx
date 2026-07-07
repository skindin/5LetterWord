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

type Tab = 'words' | 'players';

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
