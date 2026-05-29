import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { formatInTimeZone } from 'date-fns-tz';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const { Pool } = pg;
let pool = null;
if (process.env.DATABASE_URL) {
  console.log("Found DATABASE_URL, attempting to connect to database...");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL
    // Removed strict SSL config as Railway's internal networks often reject SSL connections
  });
  
  pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      google_id TEXT PRIMARY KEY,
      email TEXT,
      history JSONB DEFAULT '{}'
    )
  `).then(async () => {
    // Run migrations to support usernames and profile images
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_dev BOOLEAN DEFAULT FALSE`);
    
    // Create relationship table for mutual friendships
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friendships (
        user_id_1 TEXT REFERENCES users(google_id) ON DELETE CASCADE,
        user_id_2 TEXT REFERENCES users(google_id) ON DELETE CASCADE,
        PRIMARY KEY (user_id_1, user_id_2)
      )
    `);
    
    // Create sessions table for persistent Google Sign-In sessions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_token TEXT PRIMARY KEY,
        google_id TEXT REFERENCES users(google_id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Database tables verified, migrated, and ready.");
  }).catch(err => {
    console.error("CRITICAL DB INIT ERROR. Connection failed:", err.message);
  });
} else {
  console.warn("DATABASE_URL not set. Database features will not work.");
}

const googleClient = new OAuth2Client(process.env.VITE_GOOGLE_CLIENT_ID);

async function verifyGoogleToken(token) {
  if (!token) return null;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.VITE_GOOGLE_CLIENT_ID,
    });
    return ticket.getPayload();
  } catch (e) {
    console.error("Google token verification failed:", e);
    return null;
  }
}

async function getUserFromToken(token) {
  if (!token) return null;
  if (!pool) return null;

  try {
    // 1. Try to find session in our database
    const sessionRes = await pool.query(`
      SELECT u.google_id, u.email, u.username, u.display_name, u.picture, u.is_dev, u.history
      FROM sessions s
      JOIN users u ON s.google_id = u.google_id
      WHERE s.session_token = $1
    `, [token]);

    if (sessionRes.rows.length > 0) {
      return { user: sessionRes.rows[0], token };
    }

    // 2. Try to verify as a Google ID token
    const payload = await verifyGoogleToken(token);
    if (!payload) return null;

    // Create or update user
    const userRes = await pool.query(`
      INSERT INTO users (google_id, email, display_name, picture)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (google_id) DO UPDATE SET 
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        picture = EXCLUDED.picture
      RETURNING google_id, email, username, display_name, picture, is_dev, history
    `, [payload.sub, payload.email, payload.name, payload.picture]);

    const user = userRes.rows[0];
    const sessionToken = crypto.randomBytes(32).toString('hex');
    
    await pool.query(`
      INSERT INTO sessions (session_token, google_id)
      VALUES ($1, $2)
    `, [sessionToken, user.google_id]);

    return { user, token: sessionToken };
  } catch (e) {
    console.error("Error authenticating token:", e);
    return null;
  }
}

function sanitizeHistory(history) {
  if (!history) return {};
  const sanitized = {};
  for (const [key, game] of Object.entries(history)) {
    sanitized[key] = {
      guesses: game.guesses || [],
      status: game.status || 'playing',
      date: game.date || ''
    };
    if (game.status === 'won' || game.status === 'lost') {
      sanitized[key].targetWord = game.targetWord;
    }
  }
  return sanitized;
}

app.post('/api/auth', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  try {
    const result = await getUserFromToken(req.body.token);
    if (!result) return res.status(401).json({ error: "Invalid token" });

    const { user, token } = result;
    res.json({
      token,
      history: sanitizeHistory(user.history),
      username: user.username,
      isDev: user.is_dev,
      user: { name: user.display_name, picture: user.picture }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

function getDailySequenceIndex(history, levelIndex, date) {
    if (!history) return 0;
    const sameDateIndexes = Object.entries(history)
        .filter(([idx, g]) => g && g.date === date && parseInt(idx) !== levelIndex)
        .map(([idx]) => parseInt(idx));
    
    const smallerSameDate = sameDateIndexes.filter(idx => idx < levelIndex).length;
    return smallerSameDate;
}

app.post('/api/guess', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;
 
  const { index, guess, date } = req.body;
  const levelIndex = parseInt(index);
  if (isNaN(levelIndex) || levelIndex < 0) {
    return res.status(400).json({ error: "Invalid level index" });
  }
 
  const cleanGuess = guess?.trim().toLowerCase();
  if (!cleanGuess || cleanGuess.length !== 5 || !/^[a-z]+$/.test(cleanGuess)) {
    return res.status(400).json({ error: "Invalid guess format" });
  }
 
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Invalid date format" });
  }
 
  const centralTimeDateStr = formatInTimeZone(new Date(), 'America/Chicago', 'yyyy-MM-dd');
  if (date !== centralTimeDateStr) {
    return res.status(400).json({ error: "Guesses can only be made for today's levels." });
  }
 
  if (!validWordsSet.has(cleanGuess)) {
    return res.status(400).json({ error: "Word not in dictionary" });
  }
 
  try {
    const history = user.history || {};
 
    const seqIndex = getDailySequenceIndex(history, levelIndex, date);
    const seedString = `${date}-${seqIndex}`;
    const seedNumber = hashString(seedString);
    const rng = mulberry32(seedNumber);
    const randIndex = Math.floor(rng() * targetWords.length);
    const targetWord = targetWords[randIndex];
 
    if (!history[levelIndex]) {
      history[levelIndex] = {
        guesses: [],
        status: 'playing',
        date: date,
        targetWord: targetWord
      };
    }
 
    const game = history[levelIndex];
    if (game.status === 'won' || game.status === 'lost') {
      return res.status(400).json({ error: "Level already completed" });
    }

    if (!game.guesses) game.guesses = [];
    game.guesses.push(cleanGuess);

    if (cleanGuess === targetWord) {
      game.status = 'won';
    } else if (game.guesses.length >= 6) {
      game.status = 'lost';
    } else {
      game.status = 'playing';
    }

    await pool.query('UPDATE users SET history = $1 WHERE google_id = $2', [JSON.stringify(history), user.google_id]);

    res.json({
      index: levelIndex,
      gameState: {
        guesses: game.guesses,
        status: game.status,
        date: game.date,
        ...(game.status !== 'playing' ? { targetWord: game.targetWord } : {})
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Set or update a unique username
app.post('/api/user/username', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;

  const username = req.body.username?.trim().toLowerCase();
  if (!username || username.length < 3 || username.length > 20 || !/^[a-z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: "username must be 3-20 characters and contain only lowercase letters, numbers, or underscores." });
  }

  try {
    await pool.query(`
      UPDATE users SET username = $1 WHERE google_id = $2
    `, [username, user.google_id]);
    
    res.json({ success: true, username });
  } catch (e) {
    if (e.code === '23505') { // Unique constraint violation (duplicate key)
      return res.status(400).json({ error: "username is already taken." });
    }
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Search users by username (lowercase, partial matching)
app.post('/api/users/search', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;

  const searchQuery = req.body.query?.trim().toLowerCase();
  if (!searchQuery) return res.json({ users: [] });

  try {
    const result = await pool.query(`
      SELECT u.google_id, u.username, u.display_name, u.picture,
             EXISTS(
               SELECT 1 FROM friendships f 
               WHERE (f.user_id_1 = $2 AND f.user_id_2 = u.google_id)
                  OR (f.user_id_1 = u.google_id AND f.user_id_2 = $2)
             ) AS is_friend
      FROM users u
      WHERE u.username LIKE $1 AND u.google_id != $2 AND u.username IS NOT NULL
      LIMIT 10
    `, [`%${searchQuery}%`, user.google_id]);
    
    res.json({ users: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Add a friend by username or by user ID
app.post('/api/friends/add', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;

  const { friend_username, friend_id } = req.body;
  
  try {
    let friendResult;
    if (friend_username) {
      friendResult = await pool.query('SELECT google_id, username FROM users WHERE username = $1', [friend_username.trim().toLowerCase()]);
    } else if (friend_id) {
      friendResult = await pool.query('SELECT google_id, username FROM users WHERE google_id = $1', [friend_id]);
    } else {
      return res.status(400).json({ error: "missing friend username or id." });
    }

    if (friendResult.rows.length === 0) {
      return res.status(404).json({ error: "user not found." });
    }

    const targetFriendId = friendResult.rows[0].google_id;
    const targetFriendUsername = friendResult.rows[0].username;

    if (targetFriendId === user.google_id) {
      return res.status(400).json({ error: "you cannot friend yourself." });
    }

    // Order user IDs to ensure a single unique pair representation (user_id_1 < user_id_2)
    const id1 = user.google_id < targetFriendId ? user.google_id : targetFriendId;
    const id2 = user.google_id < targetFriendId ? targetFriendId : user.google_id;

    await pool.query(`
      INSERT INTO friendships (user_id_1, user_id_2)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [id1, id2]);

    res.json({ success: true, friend: { google_id: targetFriendId, username: targetFriendUsername } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Unfriend / Remove a mutual friend
app.post('/api/friends/remove', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;

  const { friend_id } = req.body;
  if (!friend_id) return res.status(400).json({ error: "missing friend id." });

  try {
    const id1 = user.google_id < friend_id ? user.google_id : friend_id;
    const id2 = user.google_id < friend_id ? friend_id : user.google_id;

    await pool.query(`
      DELETE FROM friendships 
      WHERE user_id_1 = $1 AND user_id_2 = $2
    `, [id1, id2]);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// List all friends along with their usernames, profile details, and histories/stats
app.post('/api/friends/list', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;

  try {
    const result = await pool.query(`
      SELECT u.google_id AS google_id, u.username, u.display_name, u.picture, u.history
      FROM users u
      JOIN friendships f ON (f.user_id_1 = u.google_id OR f.user_id_2 = u.google_id)
      WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1)
        AND u.google_id != $1
    `, [user.google_id]);
    
    const sanitizedFriends = result.rows.map(row => ({
      ...row,
      history: sanitizeHistory(row.history)
    }));
    
    res.json({ friends: sanitizedFriends });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Common words used as daily answers (top-2000 by frequency)
const targetWordsPath = path.join(__dirname, 'targetWords.json');
const targetWords = JSON.parse(fs.readFileSync(targetWordsPath, 'utf8'));

// Full word list used to validate guesses
const validWordsPath = path.join(__dirname, 'words.json');
const validWords = JSON.parse(fs.readFileSync(validWordsPath, 'utf8'));
const validWordsSet = new Set(validWords);

// Provide a simple PRNG
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// Generate a hash from a string to use as seed
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
}

// Endpoint to get the target word for the given index
app.get('/api/word', (req, res) => {
    const index = parseInt(req.query.index) || 0;
    const seq = parseInt(req.query.seq) || 0;
    
    // Get current date in US Central Time (America/Chicago)
    const centralTimeDateStr = formatInTimeZone(new Date(), 'America/Chicago', 'yyyy-MM-dd');
    const targetDate = req.query.date || centralTimeDateStr;
    
    // Seed is based on the date and the daily sequence index
    const seedString = `${targetDate}-${seq}`;
    const seedNumber = hashString(seedString);
    
    const rng = mulberry32(seedNumber);
    
    // Pick a word
    const randIndex = Math.floor(rng() * targetWords.length);
    const word = targetWords[randIndex];
    
    res.json({ word, date: targetDate, index });
});

// Optionally, provide an endpoint to check if a word is valid.
// For a Wordle clone, it's easier to just allow the client to download the full valid list
// or we can just let the client validate against any 5-letter string for simplicity,
// but since we want quality, let's serve the targetWords for validation, or a bigger list.
// To keep the network payload small, we'll validate on the server or send all targetWords.
// Actually, let's just send the whole targetWords list so the client can validate guesses against it.
app.get('/api/valid-words', (req, res) => {
    res.json(validWords);
});

async function requireDev(req, res) {
    if (!pool) { res.status(500).json({ error: 'Database not configured' }); return null; }
    const result = await getUserFromToken(req.body.token);
    if (!result) { res.status(401).json({ error: 'Invalid token' }); return null; }
    if (!result.user.is_dev) { res.status(403).json({ error: 'Not authorized' }); return null; }
    return { sub: result.user.google_id };
}

// Dev-only: preview words for consecutive days starting from a given day offset
app.post('/api/dev/words', async (req, res) => {
    if (!await requireDev(req, res)) return;

    const offset = parseInt(req.body.offset) || 0;
    const wordOffset = parseInt(req.body.wordOffset) || 0;
    const count = parseInt(req.body.count) || 5;

    const date = new Date();
    date.setDate(date.getDate() + offset);
    const dateStr = formatInTimeZone(date, 'America/Chicago', 'yyyy-MM-dd');

    const words = [];
    for (let i = 0; i < count; i++) {
        const wordIndex = wordOffset + i;
        const seedString = `${dateStr}-${wordIndex}`;
        const rng = mulberry32(hashString(seedString));
        words.push(targetWords[Math.floor(rng() * targetWords.length)]);
    }

    res.json({ offset, date: dateStr, wordOffset, words });
});

// Dev-only: list all users (email, username, google_id, history)
app.post('/api/dev/users', async (req, res) => {
    if (!await requireDev(req, res)) return;
    const r = await pool.query(
        'SELECT google_id, email, username, display_name, history FROM users ORDER BY display_name'
    );
    res.json({ users: r.rows });
});

// Dev-only: wipe a player's game history
app.post('/api/dev/wipe-history', async (req, res) => {
    const payload = await requireDev(req, res);
    if (!payload) return;
    const { targetGoogleId } = req.body;
    if (!targetGoogleId) return res.status(400).json({ error: 'targetGoogleId required' });
    await pool.query("UPDATE users SET history = '{}' WHERE google_id = $1", [targetGoogleId]);
    res.json({ success: true, isSelf: payload.sub === targetGoogleId });
});

// Dev-only: wipe a specific day's history for a player
app.post('/api/dev/wipe-day', async (req, res) => {
    const payload = await requireDev(req, res);
    if (!payload) return;
    const { targetGoogleId, date } = req.body;
    if (!targetGoogleId || !date) return res.status(400).json({ error: 'targetGoogleId and date required' });
    
    const userResult = await pool.query('SELECT history FROM users WHERE google_id = $1', [targetGoogleId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const history = userResult.rows[0].history || {};
    let wipedCount = 0;
    for (const [key, game] of Object.entries(history)) {
        if (game && game.date === date) {
            delete history[key];
            wipedCount++;
        }
    }
    
    await pool.query('UPDATE users SET history = $1 WHERE google_id = $2', [JSON.stringify(history), targetGoogleId]);
    res.json({ success: true, wipedCount, isSelf: payload.sub === targetGoogleId });
});

// Dev-only: wipe a specific word (level index) history for a player
app.post('/api/dev/wipe-word', async (req, res) => {
    const payload = await requireDev(req, res);
    if (!payload) return;
    const { targetGoogleId, index } = req.body;
    if (!targetGoogleId || index === undefined) return res.status(400).json({ error: 'targetGoogleId and level index required' });
    
    const levelIndex = parseInt(index);
    if (isNaN(levelIndex)) return res.status(400).json({ error: 'Invalid level index' });
    
    const userResult = await pool.query('SELECT history FROM users WHERE google_id = $1', [targetGoogleId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const history = userResult.rows[0].history || {};
    if (history[levelIndex]) {
        delete history[levelIndex];
    }
    
    await pool.query('UPDATE users SET history = $1 WHERE google_id = $2', [JSON.stringify(history), targetGoogleId]);
    res.json({ success: true, isSelf: payload.sub === targetGoogleId });
});

// Dev-only: delete a player's account entirely
app.post('/api/dev/delete-account', async (req, res) => {
    if (!await requireDev(req, res)) return;
    const { targetGoogleId } = req.body;
    if (!targetGoogleId) return res.status(400).json({ error: 'targetGoogleId required' });
    await pool.query('DELETE FROM users WHERE google_id = $1', [targetGoogleId]);
    res.json({ success: true });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../dist')));
app.use((req, res, next) => {
    if (req.method === 'GET') {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    } else {
        next();
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
