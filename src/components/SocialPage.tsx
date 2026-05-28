import React, { useState, useEffect } from 'react';
import { ConfirmUnfriendModal } from './ConfirmUnfriendModal';

type FriendGameState = {
  status: 'playing' | 'won' | 'lost';
  guesses: string[];
  date: string;
};

interface Friend {
  google_id: string;
  username: string;
  display_name: string;
  picture: string;
  history: Record<number, FriendGameState>;
}

interface SearchResult {
  google_id: string;
  username: string;
  display_name: string;
  picture: string;
  is_friend: boolean;
}

interface SocialPageProps {
  token: string;
  currentUsername: string;
  currentUserProfile: { name: string; picture: string };
  currentDate: string;
  onOpenQRCode: () => void;
  onOpenFriendCalendar: (friend: Friend) => void;
}

export const SocialPage: React.FC<SocialPageProps> = ({
  token,
  currentUsername,
  currentUserProfile,
  currentDate,
  onOpenQRCode,
  onOpenFriendCalendar
}) => {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingFriends, setIsLoadingFriends] = useState(true);
  const [expandedFriendId, setExpandedFriendId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [unfriendTarget, setUnfriendTarget] = useState<{ id: string; username: string } | null>(null);

  const showNotification = (type: 'success' | 'error', msg: string) => {
    if (type === 'success') {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(''), 3000);
    } else {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(''), 3000);
    }
  };

  const fetchFriends = async () => {
    setIsLoadingFriends(true);
    try {
      const res = await fetch('/api/friends/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      if (data.friends) {
        setFriends(data.friends);
      }
    } catch (err) {
      console.error('Error fetching friends:', err);
    } finally {
      setIsLoadingFriends(false);
    }
  };

  useEffect(() => {
    fetchFriends();
  }, [token]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch('/api/users/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, query: searchQuery })
      });
      const data = await res.json();
      if (data.users) {
        setSearchResults(data.users);
        if (data.users.length === 0) {
          showNotification('error', 'no users found');
        }
      }
    } catch (err) {
      console.error('Error searching users:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddFriend = async (friendUsername: string) => {
    try {
      const res = await fetch('/api/friends/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, friend_username: friendUsername })
      });
      const data = await res.json();
      if (res.ok) {
        showNotification('success', `friended @${friendUsername}!`);
        // Refresh friends list & search results
        fetchFriends();
        setSearchResults(prev =>
          prev.map(u => u.username === friendUsername ? { ...u, is_friend: true } : u)
        );
      } else {
        showNotification('error', data.error || 'could not add friend');
      }
    } catch (err) {
      console.error('Error adding friend:', err);
      showNotification('error', 'network error adding friend');
    }
  };

  const handleRemoveFriend = (friendId: string, friendUsername: string) => {
    setUnfriendTarget({ id: friendId, username: friendUsername });
  };

  const executeRemoveFriend = async () => {
    if (!unfriendTarget) return;
    const { id: friendId, username: friendUsername } = unfriendTarget;
    try {
      const res = await fetch('/api/friends/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, friend_id: friendId })
      });
      if (res.ok) {
        showNotification('success', `unfriended @${friendUsername}`);
        fetchFriends();
        setSearchResults(prev =>
          prev.map(u => u.google_id === friendId ? { ...u, is_friend: false } : u)
        );
        if (expandedFriendId === friendId) {
          setExpandedFriendId(null);
        }
      } else {
        showNotification('error', 'could not remove friend');
      }
    } catch (err) {
      console.error('Error removing friend:', err);
      showNotification('error', 'network error removing friend');
    } finally {
      setUnfriendTarget(null);
    }
  };

  const computeFriendStats = (history: Record<number, FriendGameState>) => {
    const games = Object.values(history).filter(g => g.status !== 'playing');
    const todayGames = games.filter(g => g.date === currentDate);

    const calc = (list: FriendGameState[]) => {
      const distribution = [0, 0, 0, 0, 0, 0];
      let won = 0;
      for (const g of list) {
        if (g.status === 'won') {
          won++;
          const tries = g.guesses.length;
          if (tries >= 1 && tries <= 6) {
            distribution[tries - 1]++;
          }
        }
      }
      const maxVal = Math.max(...distribution, 1);
      return { played: list.length, won, distribution, maxVal };
    };

    return {
      today: calc(todayGames),
      overall: calc(games)
    };
  };

  const renderStatsDistribution = (stats: any) => (
    <div className="stats-distribution social-dist">
      {stats.distribution.map((count: number, i: number) => (
        <div key={i} className="stat-row">
          <div className="stat-num">{i + 1}</div>
          <div className="stat-bar-container">
            <div 
              className={`stat-bar ${count > 0 ? 'active' : ''}`}
              style={{ width: `${Math.max(5, (count / stats.maxVal) * 100)}%` }}
            >
              {count}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="social-page-container">
      {successMsg && <div className="social-toast success">{successMsg}</div>}
      {errorMsg && <div className="social-toast error">{errorMsg}</div>}

      {/* User Profile Card */}
      <div className="profile-hero-card">
        <div className="profile-main-info">
          <img 
            src={currentUserProfile.picture || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'} 
            alt={currentUserProfile.name} 
            className="profile-hero-avatar"
          />
          <div className="profile-hero-meta">
            <h3>{currentUserProfile.name.toLowerCase()}</h3>
            <span className="profile-username">@{currentUsername}</span>
          </div>
        </div>
        <button className="qr-trigger-btn" onClick={onOpenQRCode} title="Show QR Code">
          <svg viewBox="0 0 24 24" width="20" height="20" className="qr-btn-icon">
            <path d="M3 3h8v8H3zm2 2v4h4V5zm8-2h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zm13-2h3v2h-3zm-2 2h2v3h-2zm3 3h2v2h-2zm-3-1h1v1h-1zm3-3h2v2h-2zm-5 1h2v2h-2zm2 2h1v1h-1zm-2 2h3v1h-3z" fill="currentColor"/>
          </svg>
          friend qr
        </button>
      </div>

      {/* Find Friends Search */}
      <div className="search-section">
        <h4>find players</h4>
        <form onSubmit={handleSearch} className="search-form">
          <input 
            type="text" 
            placeholder="search by username..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <button type="submit" className="search-btn" disabled={isSearching}>
            {isSearching ? 'searching...' : 'search'}
          </button>
        </form>

        {searchResults.length > 0 && (
          <div className="search-results-box">
            <h5>search results</h5>
            <div className="search-results-list">
              {searchResults.map(user => (
                <div key={user.google_id} className="search-user-card">
                  <div className="search-user-info">
                    <img src={user.picture || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'} alt={user.username} className="search-user-avatar" />
                    <div>
                      <div className="search-user-name">{user.display_name.toLowerCase()}</div>
                      <div className="search-user-username">@{user.username}</div>
                    </div>
                  </div>
                  {user.is_friend ? (
                    <button 
                      className="friend-action-btn remove"
                      onClick={() => handleRemoveFriend(user.google_id, user.username)}
                    >
                      unfriend
                    </button>
                  ) : (
                    <button 
                      className="friend-action-btn add"
                      onClick={() => handleAddFriend(user.username)}
                    >
                      add friend
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Friends List Section */}
      <div className="friends-section">
        <h4>friends ({friends.length})</h4>
        {isLoadingFriends ? (
          <div className="loading">loading friends...</div>
        ) : friends.length === 0 ? (
          <div className="no-friends-card">
            <p>no friends yet!</p>
            <p className="no-friends-hint">share your QR code or search for other players' usernames to start competing!</p>
          </div>
        ) : (
          <div className="friends-list">
            {friends.map(friend => {
              const isExpanded = expandedFriendId === friend.google_id;
              const stats = computeFriendStats(friend.history);
              
              return (
                <div key={friend.google_id} className={`friend-accordion-card ${isExpanded ? 'open' : ''}`}>
                  {/* Card Header (Clickable to Expand) */}
                  <div 
                    className="friend-card-header"
                    onClick={() => setExpandedFriendId(isExpanded ? null : friend.google_id)}
                  >
                    <div className="friend-card-profile">
                      <img src={friend.picture || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'} alt={friend.username} className="friend-avatar" />
                      <div>
                        <div className="friend-name">{friend.display_name.toLowerCase()}</div>
                        <div className="friend-username">@{friend.username}</div>
                      </div>
                    </div>
                    <div className="friend-card-actions">
                      <button 
                        className="unfriend-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFriend(friend.google_id, friend.username);
                        }}
                        title="Unfriend"
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
                        </svg>
                      </button>
                      <svg 
                        viewBox="0 0 24 24" 
                        width="24" 
                        height="24" 
                        className={`expand-arrow ${isExpanded ? 'rotated' : ''}`}
                      >
                        <polygon points="7,10 12,15 17,10" fill="currentColor" />
                      </svg>
                    </div>
                  </div>

                  {/* Card Body (Detailed stats, shown when expanded) */}
                  {isExpanded && (
                    <div className="friend-card-body">
                      <div className="friend-stats-group">
                        <h5>today's stats</h5>
                        <div className="social-stats-summary">
                          <div className="social-stat-box">
                            <span className="val">{stats.today.played}</span>
                            <span className="lbl">played</span>
                          </div>
                          <div className="social-stat-box">
                            <span className="val">
                              {Math.round((stats.today.won / Math.max(stats.today.played, 1)) * 100)}%
                            </span>
                            <span className="lbl">win %</span>
                          </div>
                        </div>
                        {renderStatsDistribution(stats.today)}
                      </div>

                      <div className="friend-stats-divider"></div>

                      <div className="friend-stats-group">
                        <h5>overall stats</h5>
                        <div className="social-stats-summary">
                          <div className="social-stat-box">
                            <span className="val">{stats.overall.played}</span>
                            <span className="lbl">played</span>
                          </div>
                          <div className="social-stat-box">
                            <span className="val">
                              {Math.round((stats.overall.won / Math.max(stats.overall.played, 1)) * 100)}%
                            </span>
                            <span className="lbl">win %</span>
                          </div>
                        </div>
                        {renderStatsDistribution(stats.overall)}
                      </div>

                      <button
                        className="view-calendar-btn"
                        onClick={() => onOpenFriendCalendar(friend)}
                      >
                        <svg viewBox="0 0 24 24" width="15" height="15">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2"/>
                          <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                        view play calendar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmUnfriendModal
        isOpen={unfriendTarget !== null}
        friendUsername={unfriendTarget?.username || ''}
        onConfirm={executeRemoveFriend}
        onClose={() => setUnfriendTarget(null)}
      />
    </div>
  );
};
