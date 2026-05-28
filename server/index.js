import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { formatInTimeZone } from 'date-fns-tz';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { OAuth2Client } from 'google-auth-library';

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

app.post('/api/auth', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const payload = await verifyGoogleToken(req.body.token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  try {
    const result = await pool.query(`
      INSERT INTO users (google_id, email, display_name, picture)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (google_id) DO UPDATE SET 
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        picture = EXCLUDED.picture
      RETURNING history, username, is_dev
    `, [payload.sub, payload.email, payload.name, payload.picture]);

    const row = result.rows[0];
    res.json({
      history: row.history,
      username: row.username,
      isDev: row.is_dev,
      user: { name: payload.name, picture: payload.picture }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.post('/api/sync', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const payload = await verifyGoogleToken(req.body.token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  try {
    await pool.query(`
      UPDATE users SET history = $1 WHERE google_id = $2
    `, [JSON.stringify(req.body.history), payload.sub]);
    
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Set or update a unique username
app.post('/api/user/username', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const payload = await verifyGoogleToken(req.body.token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  const username = req.body.username?.trim().toLowerCase();
  if (!username || username.length < 3 || username.length > 20 || !/^[a-z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: "username must be 3-20 characters and contain only lowercase letters, numbers, or underscores." });
  }

  try {
    await pool.query(`
      UPDATE users SET username = $1 WHERE google_id = $2
    `, [username, payload.sub]);
    
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
  
  const payload = await verifyGoogleToken(req.body.token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

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
    `, [`%${searchQuery}%`, payload.sub]);
    
    res.json({ users: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Add a friend by username or by user ID
app.post('/api/friends/add', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const payload = await verifyGoogleToken(req.body.token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

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

    if (targetFriendId === payload.sub) {
      return res.status(400).json({ error: "you cannot friend yourself." });
    }

    // Order user IDs to ensure a single unique pair representation (user_id_1 < user_id_2)
    const id1 = payload.sub < targetFriendId ? payload.sub : targetFriendId;
    const id2 = payload.sub < targetFriendId ? targetFriendId : payload.sub;

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
  
  const payload = await verifyGoogleToken(req.body.token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  const { friend_id } = req.body;
  if (!friend_id) return res.status(400).json({ error: "missing friend id." });

  try {
    const id1 = payload.sub < friend_id ? payload.sub : friend_id;
    const id2 = payload.sub < friend_id ? friend_id : payload.sub;

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
  
  const payload = await verifyGoogleToken(req.body.token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  try {
    const result = await pool.query(`
      SELECT u.google_id AS google_id, u.username, u.display_name, u.picture, u.history
      FROM users u
      JOIN friendships f ON (f.user_id_1 = u.google_id OR f.user_id_2 = u.google_id)
      WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1)
        AND u.google_id != $1
    `, [payload.sub]);
    
    res.json({ friends: result.rows });
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
    
    // Get current date in US Central Time (America/Chicago)
    const centralTimeDateStr = formatInTimeZone(new Date(), 'America/Chicago', 'yyyy-MM-dd');
    
    // Seed is based on the date and the index
    const seedString = `${centralTimeDateStr}-${index}`;
    const seedNumber = hashString(seedString);
    
    const rng = mulberry32(seedNumber);
    
    // Pick a word
    const randIndex = Math.floor(rng() * targetWords.length);
    const word = targetWords[randIndex];
    
    res.json({ word, date: centralTimeDateStr, index });
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
    const payload = await verifyGoogleToken(req.body.token);
    if (!payload) { res.status(401).json({ error: 'Invalid token' }); return null; }
    const r = await pool.query('SELECT is_dev FROM users WHERE google_id = $1', [payload.sub]);
    if (!r.rows[0]?.is_dev) { res.status(403).json({ error: 'Not authorized' }); return null; }
    return payload;
}

// Dev-only: preview one day's words at a given day offset from today
app.post('/api/dev/words', async (req, res) => {
    if (!await requireDev(req, res)) return;

    const offset = parseInt(req.body.offset) || 0;
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const dateStr = formatInTimeZone(date, 'America/Chicago', 'yyyy-MM-dd');

    const words = [];
    for (let wordIndex = 0; wordIndex < 3; wordIndex++) {
        const seedString = `${dateStr}-${wordIndex}`;
        const rng = mulberry32(hashString(seedString));
        words.push(targetWords[Math.floor(rng() * targetWords.length)]);
    }

    res.json({ offset, date: dateStr, words });
});

// Dev-only: list all users (email, username, google_id)
app.post('/api/dev/users', async (req, res) => {
    if (!await requireDev(req, res)) return;
    const r = await pool.query(
        'SELECT google_id, email, username, display_name FROM users ORDER BY display_name'
    );
    res.json({ users: r.rows });
});

// Dev-only: wipe a player's game history
app.post('/api/dev/wipe-history', async (req, res) => {
    if (!await requireDev(req, res)) return;
    const { targetGoogleId } = req.body;
    if (!targetGoogleId) return res.status(400).json({ error: 'targetGoogleId required' });
    await pool.query("UPDATE users SET history = '{}' WHERE google_id = $1", [targetGoogleId]);
    res.json({ success: true });
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
