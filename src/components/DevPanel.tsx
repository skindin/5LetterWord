import { useState } from 'react';

interface GameState {
  status: 'playing' | 'won' | 'lost';
  guesses: string[];
  date: string;
  targetWord?: string;
}

interface User {
  google_id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  history?: Record<number, GameState>;
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

  const renderPlayerHistory = (u: User) => {
    const historyObj = u.history;
    if (!historyObj || Object.keys(historyObj).length === 0) {
      return <div className="dev-panel-no-history" style={{ padding: '8px', fontSize: '0.8rem', color: '#6b7280', textAlign: 'center' }}>No play history recorded.</div>;
    }

    const grouped = groupHistoryByDate(historyObj);
    return (
      <div className="dev-panel-player-history-details" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px', marginTop: '4px', maxHeight: '200px', overflowY: 'auto' }}>
        {Object.entries(grouped).map(([dateStr, levels]) => (
          <div key={dateStr} className="dev-panel-history-date-group" style={{ marginBottom: '10px' }}>
            <div className="dev-panel-history-date-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '4px 6px', borderRadius: '4px' }}>
              <span className="dev-panel-history-date-lbl" style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#9ca3af' }}>📅 {dateStr}</span>
              <button
                className="dev-panel-btn-wipe"
                onClick={() => setConfirmWipeDay({ user: u, date: dateStr })}
                style={{ padding: '1px 4px', fontSize: '0.65rem' }}
              >
                Wipe Day
              </button>
            </div>
            <div className="dev-panel-history-levels" style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px', paddingLeft: '8px' }}>
              {levels.map(({ index, game }, seqIndex) => {
                const targetWord = game.targetWord || 'unknown';
                return (
                  <div key={index} className="dev-panel-history-level" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                    <span className="dev-panel-history-level-info" style={{ fontSize: '0.72rem', color: '#d1d5db' }}>
                      Word #{seqIndex + 1} (Lvl {index}): <code style={{ color: '#fbbf24', fontStyle: 'normal' }}>{targetWord.toUpperCase()}</code> ({game.guesses.length}/6, {game.status})
                    </span>
                    <button
                      className="dev-panel-btn-delete"
                      onClick={() => setConfirmWipeWord({ user: u, index, word: targetWord })}
                      style={{ padding: '1px 4px', fontSize: '0.65rem' }}
                    >
                      Wipe Word
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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
              return !q || (u.display_name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
            }).map(u => (
              <div key={u.google_id} className="dev-panel-player-wrapper" style={{ display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '6px', marginBottom: '4px' }}>
                <div className="dev-panel-player" style={{ background: 'none', padding: 0 }}>
                  <div className="dev-panel-player-info">
                    <span className="dev-panel-player-name">{u.display_name || u.email}</span>
                    {u.username && <span className="dev-panel-player-username">@{u.username}</span>}
                  </div>
                  <div className="dev-panel-player-actions">
                    <button
                      className="dev-panel-btn-wipe"
                      onClick={() => setExpandedUser(expandedUser === u.google_id ? null : u.google_id)}
                      style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8' }}
                    >
                      {expandedUser === u.google_id ? '▲ Hide' : '▼ History'}
                    </button>
                    <select
                      className="dev-panel-email-select"
                      onChange={(e) => {
                        if (e.target.value) {
                          handleSendEmail(u, e.target.value);
                          e.target.value = ""; // Reset dropdown
                        }
                      }}
                      defaultValue=""
                      style={{
                        background: 'rgba(16,185,129,0.15)',
                        border: '1px solid rgba(16,185,129,0.3)',
                        color: '#34d399',
                        borderRadius: '6px',
                        padding: '2px 4px',
                        fontSize: '0.72rem',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        outline: 'none',
                        height: '24px'
                      }}
                    >
                      <option value="" style={{ background: '#1e293b', color: '#94a3b8' }}>✉ Send Email</option>
                      <option value="live_streak" style={{ background: '#1e293b', color: '#f8fafc' }}>Live Streak</option>
                      <option value="lost_streak" style={{ background: '#1e293b', color: '#f8fafc' }}>Lost Streak</option>
                      <option value="weekly_digest" style={{ background: '#1e293b', color: '#f8fafc' }}>Weekly Digest</option>
                    </select>
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
