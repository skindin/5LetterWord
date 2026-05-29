import { useState } from 'react';

interface User {
  google_id: string;
  email: string;
  username: string | null;
  display_name: string | null;
}

interface Props {
  token: string;
}

type Tab = 'words' | 'players';

export default function DevPanel({ token }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('players');

  // Words tab
  const [offset, setOffset] = useState(0);
  const [days, setDays] = useState<{ offset: number; date: string; words: string[] }[]>([]);
  const [wordsLoading, setWordsLoading] = useState(false);

  // Players tab
  const [users, setUsers] = useState<User[]>([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ user: User; action: 'wipe' | 'delete' } | null>(null);

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

  const fetchDays = async (newOffset: number) => {
    setWordsLoading(true);
    setError(null);
    try {
      const data = await apiPost('/api/dev/words', { offset: newOffset, count: 5 });
      setDays(data.days);
      setOffset(newOffset);
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
    if (t === 'words' && days.length === 0) fetchDays(offset);
  };

  const confirmAction = async () => {
    if (!confirmTarget) return;
    const { user, action } = confirmTarget;
    setConfirmTarget(null);
    setError(null);
    try {
      if (action === 'wipe') {
        await apiPost('/api/dev/wipe-history', { targetGoogleId: user.google_id });
        setActionMsg(`Wiped history for ${user.display_name || user.email}`);
      } else {
        await apiPost('/api/dev/delete-account', { targetGoogleId: user.google_id });
        setUsers(prev => prev.filter(u => u.google_id !== user.google_id));
        setActionMsg(`Deleted account for ${user.display_name || user.email}`);
      }
    } catch (e: any) {
      setError(e.message);
    }
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
          ) : days.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
              {days.map(day => (
                <div key={day.offset} className="dev-panel-day">
                  <div className="dev-panel-date">
                    <strong>{day.date}</strong>
                    {day.offset === 0 ? ' (today)' : day.offset < 0 ? ` (${Math.abs(day.offset)}d ago)` : ` (+${day.offset}d)`}
                  </div>
                  <div className="dev-panel-words">
                    {day.words.map((w, i) => (
                      <div key={i} className="dev-panel-word">
                        <span className="dev-panel-word-label">Word {i + 1}</span>
                        <code>{w.toUpperCase()}</code>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="dev-panel-nav">
            <button onClick={() => fetchDays(offset - 5)} disabled={wordsLoading} title="Prev Page">⟪</button>
            <button onClick={() => fetchDays(offset - 1)} disabled={wordsLoading} title="Prev Day">←</button>
            <button onClick={() => fetchDays(0)} disabled={wordsLoading || offset === 0}>Today</button>
            <button onClick={() => fetchDays(offset + 1)} disabled={wordsLoading} title="Next Day">→</button>
            <button onClick={() => fetchDays(offset + 5)} disabled={wordsLoading} title="Next Page">⟫</button>
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
              <div key={u.google_id} className="dev-panel-player">
                <div className="dev-panel-player-info">
                  <span className="dev-panel-player-name">{u.display_name || u.email}</span>
                  {u.username && <span className="dev-panel-player-username">@{u.username}</span>}
                </div>
                <div className="dev-panel-player-actions">
                  <button
                    className="dev-panel-btn-wipe"
                    onClick={() => setConfirmTarget({ user: u, action: 'wipe' })}
                  >Wipe History</button>
                  <button
                    className="dev-panel-btn-delete"
                    onClick={() => setConfirmTarget({ user: u, action: 'delete' })}
                  >Delete</button>
                </div>
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
    </div>
  );
}
